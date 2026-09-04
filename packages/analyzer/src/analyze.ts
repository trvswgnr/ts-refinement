import type * as ts from "typescript";

import {
  DiagnosticCode,
  createDiagnostic,
  type DiagnosticLocation,
  type RefinementDiagnostic,
} from "./diagnostics.ts";
import { evaluateSourceExpression, provePredicates, type Proof } from "./proof/evaluate.ts";
import {
  displayStaticValue,
  isStaticObjectValue,
  knownValue,
  unknownValue,
  type StaticValue,
} from "./proof/values.ts";
import { collectGuardPredicates } from "./proof/guards.ts";
import { entails } from "./proof/entail.ts";
import { getPublishVerificationDiagnostics } from "./publish.ts";
import {
  isRefinedAlias,
  resolvePredicateAtDeclaration,
  resolveRefinementChecks,
  resolveRefinementMetadata,
  typeNodeContainsRefinement,
  type AnalyzerContext,
  type RefinementCheck,
  type RefinementChecksResolution,
  type RefinementDefinition,
  type RefinementPathSegment,
  type RefinementRecursion,
  type RefinementResolution,
} from "./refinement/resolve.ts";

export interface RefinementSite {
  readonly checks: readonly RefinementCheck[];
  readonly definition: RefinementDefinition | null;
  readonly fileName: string;
  readonly node: ts.AsExpression | ts.TypeAssertion;
  readonly recursions: readonly RefinementRecursion[];
  readonly sourceType: ts.Type;
  readonly targetType: ts.Type;
}

export interface AnalysisResult {
  readonly diagnostics: readonly RefinementDiagnostic[];
  readonly proof: Proof;
  readonly site: RefinementSite;
}

const analysisCaches = new WeakMap<
  ts.Program,
  WeakMap<ts.AsExpression | ts.TypeAssertion, AnalysisResult | null>
>();

function nodeLocation(node: ts.Node): DiagnosticLocation {
  return { length: node.getWidth(), start: node.getStart() };
}

function isUnsafeSourceType(tsModule: typeof ts, type: ts.Type): boolean {
  return (type.flags & (tsModule.TypeFlags.Any | tsModule.TypeFlags.Unknown)) !== 0;
}

function baseTypeDisplay(context: AnalyzerContext, definition: RefinementDefinition): string {
  return definition.baseTypes.map((type) => context.checker.typeToString(type)).join(" & ");
}

function hasLengthBaseType(context: AnalyzerContext, definition: RefinementDefinition): boolean {
  return definition.baseTypes.some(
    (type) =>
      (type.flags & context.ts.TypeFlags.StringLike) !== 0 || context.checker.isArrayType(type),
  );
}

interface StaticRefinementLeaf {
  readonly path: string;
  readonly value: StaticValue;
}

interface NestedProof {
  readonly check?: RefinementCheck;
  readonly leaf?: StaticRefinementLeaf;
  readonly proof: Proof;
}

function propertyPath(path: string, name: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(name) ? `${path}.${name}` : `${path}[${JSON.stringify(name)}]`;
}

function unknownLeaf(path: string): readonly StaticRefinementLeaf[] {
  return [{ path, value: unknownValue }];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function templateIndexCaptures(
  segment: Extract<RefinementPathSegment, { readonly key: "template" }>,
  name: string,
): readonly string[] | null {
  const source = segment.pattern.texts
    .map(
      (text, index) =>
        `${escapeRegExp(text)}${index < segment.pattern.placeholders.length ? "([\\s\\S]*?)" : ""}`,
    )
    .join("");
  return new RegExp(`^${source}$`, "u").exec(name)?.slice(1) ?? null;
}

function isBigIntIndexValue(value: string): boolean {
  return /^-?(?:0|[1-9]\d*|0[xX][\dA-Fa-f]+|0[oO][0-7]+|0[bB][01]+)$/u.test(value);
}

function matchesIndexSegment(
  segment: Extract<RefinementPathSegment, { readonly kind: "index" }>,
  name: string,
): boolean {
  if (segment.key === "string") return true;
  if (segment.key === "number") return String(Number(name)) === name;
  if (segment.key === "symbol") return false;
  const captures = templateIndexCaptures(segment, name);
  return (
    captures !== null &&
    captures.every((capture, index) => {
      const placeholder = segment.pattern.placeholders[index];
      if (placeholder === "string") return true;
      if (placeholder === "number") return capture !== "" && Number.isFinite(Number(capture));
      return isBigIntIndexValue(capture);
    })
  );
}

function valuesAtUnion(
  value: StaticValue,
  segment: Extract<RefinementPathSegment, { readonly kind: "union" }>,
  remaining: readonly RefinementPathSegment[],
  path: string,
): readonly StaticRefinementLeaf[] {
  if (!value.known || !isStaticObjectValue(value.value)) return unknownLeaf(path);
  return value.value[segment.property] === segment.value
    ? valuesAtPath(value, remaining, path)
    : [];
}

function valuesAtProperty(
  value: StaticValue,
  segment: Extract<RefinementPathSegment, { readonly kind: "property" }>,
  remaining: readonly RefinementPathSegment[],
  path: string,
): readonly StaticRefinementLeaf[] {
  if (!value.known || !isStaticObjectValue(value.value)) return unknownLeaf(path);
  const child = value.value[segment.name];
  if (child === undefined && segment.optional) return [];
  return valuesAtPath(knownValue(child), remaining, propertyPath(path, segment.name));
}

function valuesAtTuple(
  value: StaticValue,
  segment: Extract<RefinementPathSegment, { readonly kind: "tuple" }>,
  remaining: readonly RefinementPathSegment[],
  path: string,
): readonly StaticRefinementLeaf[] {
  if (!value.known || !Array.isArray(value.value)) return unknownLeaf(path);
  const index =
    segment.fromEnd === undefined ? segment.index : value.value.length - segment.fromEnd;
  const child = value.value[index];
  if (child === undefined && segment.optional) return [];
  return valuesAtPath(knownValue(child), remaining, `${path}[${index}]`);
}

function valuesAtArray(
  value: StaticValue,
  segment: Extract<RefinementPathSegment, { readonly kind: "array" | "tupleRest" }>,
  remaining: readonly RefinementPathSegment[],
  path: string,
): readonly StaticRefinementLeaf[] {
  if (!value.known || !Array.isArray(value.value)) return unknownLeaf(path);
  const start = segment.kind === "tupleRest" ? segment.start : 0;
  const end = segment.kind === "tupleRest" ? value.value.length - segment.end : value.value.length;
  return value.value
    .slice(start, end)
    .flatMap((child, index) =>
      valuesAtPath(knownValue(child), remaining, `${path}[${index + start}]`),
    );
}

function valuesAtIndex(
  value: StaticValue,
  segment: Extract<RefinementPathSegment, { readonly kind: "index" }>,
  remaining: readonly RefinementPathSegment[],
  path: string,
): readonly StaticRefinementLeaf[] {
  if (!value.known || (!isStaticObjectValue(value.value) && !Array.isArray(value.value))) {
    return unknownLeaf(path);
  }
  return Object.entries(value.value).flatMap(([name, child]) => {
    if (!matchesIndexSegment(segment, name)) return [];
    return valuesAtPath(knownValue(child), remaining, propertyPath(path, name));
  });
}

function valuesAtPath(
  value: StaticValue,
  segments: readonly RefinementPathSegment[],
  path = "",
): readonly StaticRefinementLeaf[] {
  const [segment, ...remaining] = segments;
  if (segment === undefined) return [{ path, value }];
  if (segment.kind === "union") return valuesAtUnion(value, segment, remaining, path);
  if (segment.kind === "property") return valuesAtProperty(value, segment, remaining, path);
  if (segment.kind === "tuple") return valuesAtTuple(value, segment, remaining, path);
  if (segment.kind === "array" || segment.kind === "tupleRest") {
    return valuesAtArray(value, segment, remaining, path);
  }
  return valuesAtIndex(value, segment, remaining, path);
}

function proveNestedChecks(
  checks: readonly RefinementCheck[],
  sourceValue: StaticValue,
): NestedProof {
  let sawUnknown = false;
  for (const check of checks) {
    for (const leaf of valuesAtPath(sourceValue, check.path)) {
      const proof = provePredicates(check.definition.predicates, leaf.value);
      if (proof.kind === "false") return { check, leaf, proof };
      if (proof.kind === "unknown") sawUnknown = true;
    }
  }
  return { proof: sawUnknown ? { kind: "unknown" } : { kind: "true" } };
}

function staticFailureDiagnostic(
  context: AnalyzerContext,
  node: ts.AsExpression | ts.TypeAssertion,
  nested: NestedProof,
): RefinementDiagnostic | null {
  if (nested.proof.kind !== "false" || nested.check === undefined || nested.leaf === undefined) {
    return null;
  }
  const name =
    nested.check.definition.displayName ??
    context.checker.typeToString(context.checker.getTypeAtLocation(node.type));
  const value = nested.leaf.value.known ? displayStaticValue(nested.leaf.value.value) : "<unknown>";
  const atPath = nested.leaf.path.length === 0 ? "" : ` at '${nested.leaf.path}'`;
  return createDiagnostic(
    DiagnosticCode.StaticallyDisproven,
    `Value '${value}'${atPath} does not satisfy refinement '${name}'. Predicate: ${nested.proof.predicate ?? "<unknown>"}.`,
    nodeLocation(node),
  );
}

function isRefinedTypeReference(context: AnalyzerContext, node: ts.TypeReferenceNode): boolean {
  const symbol = context.checker.getSymbolAtLocation(node.typeName);
  if (symbol === undefined) return false;
  const target =
    (symbol.flags & context.ts.SymbolFlags.Alias) === 0
      ? symbol
      : context.checker.getAliasedSymbol(symbol);
  return isRefinedAlias(context, target);
}

export function getRefinementDefinitionDiagnostics(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
): readonly RefinementDiagnostic[] {
  const diagnostics: RefinementDiagnostic[] = [];

  function visit(node: ts.Node): void {
    if (context.ts.isTypeReferenceNode(node) && isRefinedTypeReference(context, node)) {
      const predicateType = node.typeArguments?.[1];
      if (
        predicateType !== undefined &&
        context.ts.isLiteralTypeNode(predicateType) &&
        context.ts.isStringLiteral(predicateType.literal)
      ) {
        const resolved = resolvePredicateAtDeclaration(
          context,
          predicateType.literal.text,
          predicateType,
        );
        diagnostics.push(
          ...resolved.issues.map((issue) =>
            createDiagnostic(issue.code, issue.message, nodeLocation(predicateType.literal)),
          ),
        );
      }
    }
    context.ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return diagnostics;
}

interface AssertionAnalysisState {
  readonly context: AnalyzerContext;
  readonly definition: RefinementDefinition;
  readonly diagnostics: RefinementDiagnostic[];
  readonly nestedProof: NestedProof;
  readonly node: ts.AsExpression | ts.TypeAssertion;
  readonly site: RefinementSite;
  readonly sourceValue: StaticValue;
}

function issueDiagnostics(
  node: ts.AsExpression | ts.TypeAssertion,
  resolution: RefinementResolution,
  nestedResolution: RefinementChecksResolution,
): RefinementDiagnostic[] {
  const seen = new Set<string>();
  const issues = [
    ...(resolution.isRefinement ? resolution.issues : []),
    ...nestedResolution.issues,
  ];
  return issues.flatMap((issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [createDiagnostic(issue.code, issue.message, nodeLocation(node.type))];
  });
}

function analyzeNestedOnlyAssertion(
  context: AnalyzerContext,
  node: ts.AsExpression | ts.TypeAssertion,
  site: RefinementSite,
  diagnostics: RefinementDiagnostic[],
  sourceValue: StaticValue,
): AnalysisResult {
  if (isUnsafeSourceType(context.ts, site.sourceType)) {
    diagnostics.push(
      createDiagnostic(
        DiagnosticCode.SourceNotAssignable,
        `Source type '${context.checker.typeToString(site.sourceType)}' is not assignable to a nested refinement target.`,
        nodeLocation(node),
      ),
    );
    return { diagnostics, proof: { kind: "unknown" }, site };
  }
  const nestedProof = proveNestedChecks(site.checks, sourceValue);
  const failure = staticFailureDiagnostic(context, node, nestedProof);
  if (failure !== null) diagnostics.push(failure);
  return {
    diagnostics,
    proof: failure === null ? nestedProof.proof : { kind: "false" },
    site,
  };
}

function definitionIsAssignable(state: AssertionAnalysisState): boolean {
  return (
    !isUnsafeSourceType(state.context.ts, state.site.sourceType) &&
    state.definition.baseTypes.every((baseType) =>
      state.context.checker.isTypeAssignableTo(state.site.sourceType, baseType),
    )
  );
}

function unassignableAnalysis(state: AssertionAnalysisState): AnalysisResult {
  state.diagnostics.push(
    createDiagnostic(
      DiagnosticCode.SourceNotAssignable,
      `Source type '${state.context.checker.typeToString(state.site.sourceType)}' is not assignable to refinement base type '${baseTypeDisplay(state.context, state.definition)}'.`,
      nodeLocation(state.node),
    ),
  );
  return { diagnostics: state.diagnostics, proof: { kind: "unknown" }, site: state.site };
}

function predicatesForSource(
  context: AnalyzerContext,
  sourceType: ts.Type,
): RefinementDefinition["predicates"] {
  const resolution = resolveRefinementMetadata(context, sourceType);
  return resolution.isRefinement && resolution.definition !== null
    ? resolution.definition.predicates
    : [];
}

function entailedAnalysis(
  state: AssertionAnalysisState,
  sourcePredicates: RefinementDefinition["predicates"],
): AnalysisResult | null {
  if (
    sourcePredicates.length === 0 ||
    !entails(sourcePredicates, state.definition.predicates, {
      subjectLength: hasLengthBaseType(state.context, state.definition),
    })
  ) {
    return null;
  }
  if (state.nestedProof.proof.kind === "false") {
    const failure = staticFailureDiagnostic(state.context, state.node, state.nestedProof);
    if (failure !== null) state.diagnostics.push(failure);
  }
  return {
    diagnostics: state.diagnostics,
    proof: state.nestedProof.proof.kind === "true" ? { kind: "true" } : state.nestedProof.proof,
    site: state.site,
  };
}

function directProof(
  state: AssertionAnalysisState,
  sourcePredicates: RefinementDefinition["predicates"],
): Proof {
  const staticProof = provePredicates(state.definition.predicates, state.sourceValue);
  if (staticProof.kind !== "unknown") return staticProof;
  return entails(
    [...sourcePredicates, ...collectGuardPredicates(state.context, state.node)],
    state.definition.predicates,
    { subjectLength: hasLengthBaseType(state.context, state.definition) },
  )
    ? { kind: "true" }
    : staticProof;
}

function combinedProof(direct: Proof, nested: Proof): Proof {
  if (direct.kind === "false" || nested.kind === "false") return { kind: "false" };
  return direct.kind === "true" && nested.kind === "true" ? { kind: "true" } : { kind: "unknown" };
}

function analyzeDirectAssertion(
  state: AssertionAnalysisState,
  sourcePredicates: RefinementDefinition["predicates"],
): AnalysisResult {
  const direct = directProof(state, sourcePredicates);
  if (direct.kind === "false") {
    const name =
      state.definition.displayName ?? state.context.checker.typeToString(state.site.targetType);
    const value = state.sourceValue.known
      ? displayStaticValue(state.sourceValue.value)
      : "<unknown>";
    state.diagnostics.push(
      createDiagnostic(
        DiagnosticCode.StaticallyDisproven,
        `Value '${value}' does not satisfy refinement '${name}'. Predicate: ${direct.predicate ?? "<unknown>"}.`,
        nodeLocation(state.node),
      ),
    );
  }
  const nestedFailure = staticFailureDiagnostic(state.context, state.node, state.nestedProof);
  if (nestedFailure !== null) state.diagnostics.push(nestedFailure);
  return {
    diagnostics: state.diagnostics,
    proof: combinedProof(direct, state.nestedProof.proof),
    site: state.site,
  };
}

function analyzeAssertionUncached(
  context: AnalyzerContext,
  node: ts.AsExpression | ts.TypeAssertion,
): AnalysisResult | null {
  const targetType = context.checker.getTypeAtLocation(node.type);
  const resolution = resolveRefinementMetadata(context, targetType);
  const nestedResolution =
    resolution.isRefinement || typeNodeContainsRefinement(context, node.type)
      ? resolveRefinementChecks(context, targetType)
      : { checks: [], issues: [], recursions: [] };
  if (!resolution.isRefinement && nestedResolution.checks.length === 0) return null;

  const sourceType = context.checker.getTypeAtLocation(node.expression);
  const site: RefinementSite = {
    checks: nestedResolution.checks,
    definition: resolution.isRefinement ? resolution.definition : null,
    fileName: node.getSourceFile().fileName,
    node,
    recursions: nestedResolution.recursions,
    sourceType,
    targetType,
  };
  const diagnostics = issueDiagnostics(node, resolution, nestedResolution);
  const definition = resolution.isRefinement ? resolution.definition : null;
  const sourceValue = evaluateSourceExpression(context.ts, context.checker, node.expression);
  const nestedChecks = site.checks.filter((check) => check.path.length > 0);
  const nestedProof = proveNestedChecks(nestedChecks, sourceValue);

  if (definition === null) {
    return analyzeNestedOnlyAssertion(context, node, site, diagnostics, sourceValue);
  }

  const state = { context, definition, diagnostics, nestedProof, node, site, sourceValue };
  if (!definitionIsAssignable(state)) return unassignableAnalysis(state);
  const sourcePredicates = predicatesForSource(context, sourceType);
  return (
    entailedAnalysis(state, sourcePredicates) ?? analyzeDirectAssertion(state, sourcePredicates)
  );
}

export function analyzeAssertion(
  context: AnalyzerContext,
  node: ts.AsExpression | ts.TypeAssertion,
): AnalysisResult | null {
  let cache = analysisCaches.get(context.program);
  if (cache === undefined) {
    cache = new WeakMap();
    analysisCaches.set(context.program, cache);
  }

  if (cache.has(node)) return cache.get(node) ?? null;
  const analysis = analyzeAssertionUncached(context, node);
  cache.set(node, analysis);
  return analysis;
}

export function analyzeSourceFile(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
): readonly AnalysisResult[] {
  const results: AnalysisResult[] = [];

  function visit(node: ts.Node): void {
    if (context.ts.isAsExpression(node) || context.ts.isTypeAssertionExpression(node)) {
      const result = analyzeAssertion(context, node);
      if (result !== null) results.push(result);
    }
    context.ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

export function getRefinementDiagnostics(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
): readonly RefinementDiagnostic[] {
  return [
    ...getRefinementDefinitionDiagnostics(context, sourceFile),
    ...analyzeSourceFile(context, sourceFile).flatMap((result) => result.diagnostics),
    ...getPublishVerificationDiagnostics(context, sourceFile),
  ];
}
