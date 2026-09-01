import type * as ts from "typescript";

import {
  DiagnosticCode,
  createDiagnostic,
  type DiagnosticLocation,
  type RefinementDiagnostic,
} from "./diagnostics.ts";
import { evaluateSourceExpression, provePredicates, type Proof } from "./proof/evaluate.ts";
import { displayStaticValue } from "./proof/values.ts";
import { parsePredicate } from "./predicate/parse.ts";
import {
  resolveRefinementMetadata,
  type AnalyzerContext,
  type RefinementDefinition,
} from "./refinement/resolve.ts";

export interface RefinementSite {
  readonly definition: RefinementDefinition | null;
  readonly fileName: string;
  readonly node: ts.AsExpression | ts.TypeAssertion;
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

function isRefinedTypeReference(context: AnalyzerContext, node: ts.TypeReferenceNode): boolean {
  const symbol = context.checker.getSymbolAtLocation(node.typeName);
  if (symbol === undefined) return false;
  const target =
    (symbol.flags & context.ts.SymbolFlags.Alias) === 0
      ? symbol
      : context.checker.getAliasedSymbol(symbol);
  return (target.declarations ?? []).some((declaration) => {
    if (!context.ts.isTypeAliasDeclaration(declaration) || declaration.name.text !== "Refined") {
      return false;
    }

    let containsMarker = false;
    function visit(child: ts.Node): void {
      if (context.ts.isIdentifier(child) && child.text === "refinementBrand") {
        containsMarker = true;
        return;
      }
      context.ts.forEachChild(child, visit);
    }
    visit(declaration);
    return containsMarker;
  });
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
        const parsed = parsePredicate(context.ts, predicateType.literal.text);
        if (!parsed.ok) {
          const location = nodeLocation(predicateType.literal);
          diagnostics.push(
            ...parsed.diagnostics.map((diagnostic) => ({
              ...diagnostic,
              length: location.length,
              start: location.start,
            })),
          );
        }
      }
    }
    context.ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return diagnostics;
}

function analyzeAssertionUncached(
  context: AnalyzerContext,
  node: ts.AsExpression | ts.TypeAssertion,
): AnalysisResult | null {
  const targetType = context.checker.getTypeAtLocation(node.type);
  const resolution = resolveRefinementMetadata(context, targetType);
  if (!resolution.isRefinement) return null;

  const sourceType = context.checker.getTypeAtLocation(node.expression);
  const site: RefinementSite = {
    definition: resolution.definition,
    fileName: node.getSourceFile().fileName,
    node,
    sourceType,
    targetType,
  };
  const diagnostics: RefinementDiagnostic[] = resolution.issues.map((issue) =>
    createDiagnostic(issue.code, issue.message, nodeLocation(node.type)),
  );
  const definition = resolution.definition;

  if (definition === null) {
    return { diagnostics, proof: { kind: "unknown" }, site };
  }

  const assignable =
    !isUnsafeSourceType(context.ts, sourceType) &&
    definition.baseTypes.every((baseType) =>
      context.checker.isTypeAssignableTo(sourceType, baseType),
    );
  if (!assignable) {
    diagnostics.push(
      createDiagnostic(
        DiagnosticCode.SourceNotAssignable,
        `Source type '${context.checker.typeToString(sourceType)}' is not assignable to refinement base type '${baseTypeDisplay(context, definition)}'.`,
        nodeLocation(node),
      ),
    );
    return { diagnostics, proof: { kind: "unknown" }, site };
  }

  const sourceValue = evaluateSourceExpression(context.ts, context.checker, node.expression);
  const proof = provePredicates(definition.predicates, sourceValue);
  if (proof.kind === "false") {
    const name = definition.displayName ?? context.checker.typeToString(targetType);
    const value = sourceValue.known ? displayStaticValue(sourceValue.value) : "<unknown>";
    diagnostics.push(
      createDiagnostic(
        DiagnosticCode.StaticallyDisproven,
        `Value '${value}' does not satisfy refinement '${name}'. Predicate: ${proof.predicate ?? "<unknown>"}.`,
        nodeLocation(node),
      ),
    );
  }

  return { diagnostics, proof, site };
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
  ];
}
