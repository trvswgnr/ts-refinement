import type * as ts from "typescript";

import { DiagnosticCode } from "../diagnostics.ts";
import { disallowedGlobals, standardGlobals } from "../predicate/globals.ts";
import {
  findOpaqueExpression,
  foldFreeIdentifiers,
  serializeExpression,
  type LiteralValue,
  type NormalizedPredicate,
} from "../predicate/ir.ts";
import { normalizePredicate } from "../predicate/normalize.ts";
import { parsePredicateCandidates, type ParsedPredicate } from "../predicate/parse.ts";

export interface AnalyzerContext {
  readonly checker: ts.TypeChecker;
  readonly program: ts.Program;
  readonly ts: typeof ts;
}

export interface RefinementDefinition {
  readonly baseType: ts.Type;
  readonly baseTypes: readonly ts.Type[];
  readonly displayName: string | undefined;
  readonly predicates: readonly NormalizedPredicate[];
}

export interface RefinementIndexPattern {
  readonly placeholders: readonly ("bigint" | "number" | "string")[];
  readonly texts: readonly string[];
}

export type RefinementPathSegment =
  | { readonly kind: "array" }
  | { readonly key: "number"; readonly kind: "index" }
  | { readonly key: "string"; readonly kind: "index" }
  | { readonly key: "symbol"; readonly kind: "index" }
  | { readonly key: "template"; readonly kind: "index"; readonly pattern: RefinementIndexPattern }
  | { readonly kind: "property"; readonly name: string; readonly optional: boolean }
  | { readonly index: number; readonly kind: "tuple"; readonly optional: boolean }
  | { readonly kind: "tupleRest"; readonly start: number }
  | {
      readonly kind: "union";
      readonly property: string;
      readonly value: boolean | null | number | string;
    };

export interface RefinementCheck {
  readonly definition: RefinementDefinition;
  readonly path: readonly RefinementPathSegment[];
}

export interface RefinementRecursion {
  readonly path: readonly RefinementPathSegment[];
  readonly targetPath: readonly RefinementPathSegment[];
}

export interface RefinementChecksResolution {
  readonly checks: readonly RefinementCheck[];
  readonly issues: readonly RefinementResolutionIssue[];
  readonly recursions: readonly RefinementRecursion[];
}

export interface RefinementResolutionIssue {
  readonly code: number;
  readonly message: string;
}

export interface PredicateResolution {
  readonly issues: readonly RefinementResolutionIssue[];
  readonly predicate: NormalizedPredicate | null;
}

export type RefinementResolution =
  | { readonly isRefinement: false }
  | {
      readonly definition: RefinementDefinition | null;
      readonly isRefinement: true;
      readonly issues: readonly RefinementResolutionIssue[];
    };

const resolutionCaches = new WeakMap<ts.Program, WeakMap<ts.Type, RefinementResolution>>();

function flattenIntersection(tsModule: typeof ts, type: ts.Type): readonly ts.Type[] {
  if (!type.isIntersection()) return [type];
  return type.types.flatMap((part) => flattenIntersection(tsModule, part));
}

function isRefinementMarkerSymbol(tsModule: typeof ts, symbol: ts.Symbol): boolean {
  for (const declaration of symbol.declarations ?? []) {
    if (!tsModule.isPropertySignature(declaration) || declaration.name === undefined) continue;
    if (!tsModule.isComputedPropertyName(declaration.name)) continue;
    if (!tsModule.isIdentifier(declaration.name.expression)) continue;
    if (declaration.name.expression.text !== "refinementBrand") continue;

    let ancestor: ts.Node | undefined = declaration.parent;
    while (ancestor !== undefined) {
      if (tsModule.isTypeAliasDeclaration(ancestor)) {
        return ancestor.name.text === "Refined";
      }
      ancestor = ancestor.parent;
    }
  }
  return false;
}

function markerForType(
  context: AnalyzerContext,
  type: ts.Type,
): { readonly declaration: ts.Declaration; readonly symbol: ts.Symbol } | null {
  const symbol = context.checker
    .getPropertiesOfType(type)
    .find((property) => isRefinementMarkerSymbol(context.ts, property));
  const declaration = symbol?.declarations?.[0];
  return symbol === undefined || declaration === undefined ? null : { declaration, symbol };
}

function extractPredicateSources(
  context: AnalyzerContext,
  marker: { readonly declaration: ts.Declaration; readonly symbol: ts.Symbol },
): readonly string[] | null {
  const markerType = context.checker.getTypeOfSymbolAtLocation(marker.symbol, marker.declaration);
  const tags = context.checker.getPropertiesOfType(markerType);
  if (tags.length === 0) return null;
  return tags.map((tag) => tag.getName());
}

function resolvedSymbol(context: AnalyzerContext, node: ts.EntityName): ts.Symbol | undefined {
  const symbol = context.checker.getSymbolAtLocation(node);
  if (symbol === undefined || (symbol.flags & context.ts.SymbolFlags.Alias) === 0) return symbol;
  return context.checker.getAliasedSymbol(symbol);
}

function isRefinedAlias(context: AnalyzerContext, symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) => {
    if (!context.ts.isTypeAliasDeclaration(declaration) || declaration.name.text !== "Refined") {
      return false;
    }

    let containsMarker = false;
    function visit(node: ts.Node): void {
      if (context.ts.isIdentifier(node) && node.text === "refinementBrand") {
        containsMarker = true;
        return;
      }
      context.ts.forEachChild(node, visit);
    }
    visit(declaration);
    return containsMarker;
  });
}

interface PredicateOrigin {
  readonly scope: ts.Node;
  readonly source: string;
}

function originForRefinedReference(
  context: AnalyzerContext,
  node: ts.TypeReferenceNode,
): PredicateOrigin | null {
  const predicate = node.typeArguments?.[1];
  if (
    predicate === undefined ||
    !context.ts.isLiteralTypeNode(predicate) ||
    !context.ts.isStringLiteral(predicate.literal)
  ) {
    return null;
  }
  return { scope: predicate, source: predicate.literal.text };
}

function aliasDeclarations(
  context: AnalyzerContext,
  symbol: ts.Symbol,
): readonly ts.TypeAliasDeclaration[] {
  return (symbol.declarations ?? []).filter(context.ts.isTypeAliasDeclaration);
}

function predicateOrigins(context: AnalyzerContext, type: ts.Type): readonly PredicateOrigin[] {
  const origins: PredicateOrigin[] = [];
  const visited = new Set<ts.TypeAliasDeclaration>();

  function visitType(node: ts.TypeNode): void {
    if (context.ts.isParenthesizedTypeNode(node)) {
      visitType(node.type);
      return;
    }
    if (context.ts.isIntersectionTypeNode(node)) {
      for (const part of node.types) visitType(part);
      return;
    }
    if (!context.ts.isTypeReferenceNode(node)) return;

    const symbol = resolvedSymbol(context, node.typeName);
    if (symbol === undefined) return;
    if (isRefinedAlias(context, symbol)) {
      const base = node.typeArguments?.[0];
      if (base !== undefined) visitType(base);
      const origin = originForRefinedReference(context, node);
      if (origin !== null) origins.push(origin);
      return;
    }

    for (const declaration of aliasDeclarations(context, symbol)) {
      if (visited.has(declaration)) continue;
      visited.add(declaration);
      visitType(declaration.type);
    }
  }

  for (const declaration of type.aliasSymbol?.declarations ?? []) {
    if (!context.ts.isTypeAliasDeclaration(declaration)) continue;
    visited.add(declaration);
    visitType(declaration.type);
  }
  return origins;
}

type CaptureResolution =
  | { readonly ok: false }
  | { readonly ok: true; readonly value: LiteralValue };

function isStringLiteralType(tsModule: typeof ts, type: ts.Type): type is ts.StringLiteralType {
  return (type.flags & tsModule.TypeFlags.StringLiteral) !== 0;
}

function isNumberLiteralType(tsModule: typeof ts, type: ts.Type): type is ts.NumberLiteralType {
  return (type.flags & tsModule.TypeFlags.NumberLiteral) !== 0;
}

function isBigIntLiteralType(tsModule: typeof ts, type: ts.Type): type is ts.BigIntLiteralType {
  return (type.flags & tsModule.TypeFlags.BigIntLiteral) !== 0;
}

function unwrapLiteralInitializer(context: AnalyzerContext, node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (context.ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (context.ts.isAsExpression(current)) {
      current = current.expression;
    } else if (context.ts.isSatisfiesExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

function literalInitializer(context: AnalyzerContext, node: ts.Expression): CaptureResolution {
  const literal = unwrapLiteralInitializer(context, node);
  if (context.ts.isStringLiteral(literal) || context.ts.isNoSubstitutionTemplateLiteral(literal)) {
    return { ok: true, value: literal.text };
  }
  if (context.ts.isNumericLiteral(literal)) return { ok: true, value: Number(literal.text) };
  if (context.ts.isBigIntLiteral(literal)) {
    return { ok: true, value: BigInt(literal.text.slice(0, -1)) };
  }
  if (literal.kind === context.ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (literal.kind === context.ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (literal.kind === context.ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (
    context.ts.isPrefixUnaryExpression(literal) &&
    literal.operator === context.ts.SyntaxKind.MinusToken
  ) {
    const operand = unwrapLiteralInitializer(context, literal.operand);
    if (context.ts.isNumericLiteral(operand)) {
      return { ok: true, value: -Number(operand.text) };
    }
    if (context.ts.isBigIntLiteral(operand)) {
      return { ok: true, value: -BigInt(operand.text.slice(0, -1)) };
    }
  }
  return { ok: false };
}

function literalTypeValue(context: AnalyzerContext, type: ts.Type): CaptureResolution {
  if (isStringLiteralType(context.ts, type)) return { ok: true, value: type.value };
  if (isNumberLiteralType(context.ts, type)) return { ok: true, value: type.value };
  if (isBigIntLiteralType(context.ts, type)) {
    const { value } = type;
    return { ok: true, value: BigInt(`${value.negative ? "-" : ""}${value.base10Value}`) };
  }
  if ((type.flags & context.ts.TypeFlags.BooleanLiteral) !== 0) {
    return { ok: true, value: context.checker.typeToString(type) === "true" };
  }
  if ((type.flags & context.ts.TypeFlags.Null) !== 0) return { ok: true, value: null };
  return { ok: false };
}

function immutableLiteralCapture(context: AnalyzerContext, symbol: ts.Symbol): CaptureResolution {
  const target =
    (symbol.flags & context.ts.SymbolFlags.Alias) === 0
      ? symbol
      : context.checker.getAliasedSymbol(symbol);
  const declaration = (target.declarations ?? []).find(context.ts.isVariableDeclaration);
  if (declaration === undefined || !context.ts.isIdentifier(declaration.name)) {
    return { ok: false };
  }
  const declarationList = declaration.parent;
  if (
    !context.ts.isVariableDeclarationList(declarationList) ||
    (declarationList.flags & context.ts.NodeFlags.Const) === 0 ||
    !context.ts.isVariableStatement(declarationList.parent) ||
    !context.ts.isSourceFile(declarationList.parent.parent)
  ) {
    return { ok: false };
  }

  if (declaration.initializer === undefined) return { ok: false };
  const initialized = literalInitializer(context, declaration.initializer);
  const typed = literalTypeValue(
    context,
    context.checker.getTypeOfSymbolAtLocation(target, declaration.name),
  );
  return initialized.ok && typed.ok && Object.is(initialized.value, typed.value)
    ? typed
    : { ok: false };
}

export function resolvePredicateAtDeclaration(
  context: AnalyzerContext,
  source: string,
  scope: ts.Node,
): PredicateResolution {
  const parsed = parsePredicateCandidates(context.ts, source);
  if (!parsed.ok) {
    return {
      issues: parsed.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message.replace(/^RF\d+: /u, ""),
      })),
      predicate: null,
    };
  }

  const captures = new Map<string, LiteralValue>();
  const unresolved: string[] = [];
  const issues: RefinementResolutionIssue[] = [];
  for (const name of parsed.predicate.freeReferences.keys()) {
    if (standardGlobals.has(name) || disallowedGlobals.has(name)) continue;
    const symbol = context.checker.resolveName(name, scope, context.ts.SymbolFlags.Value, true);
    if (symbol === undefined) {
      unresolved.push(name);
      continue;
    }
    const capture = immutableLiteralCapture(context, symbol);
    if (!capture.ok) {
      issues.push({
        code: DiagnosticCode.ExternalCapture,
        message: `Predicate capture '${name}' must resolve to an immutable primitive literal.`,
      });
    } else {
      captures.set(name, capture.value);
    }
  }

  if (unresolved.length > 1) {
    issues.push({
      code: DiagnosticCode.CannotInferSubject,
      message: `Cannot infer refinement subject. Unresolved identifiers: ${unresolved.sort().join(", ")}.`,
    });
  }
  if (issues.length > 0) return { issues, predicate: null };

  const subject = unresolved[0] ?? null;
  const contextual: ParsedPredicate = {
    ...parsed.predicate,
    subject,
    subjectReferences: subject === null ? [] : (parsed.predicate.freeReferences.get(subject) ?? []),
  };
  const normalized = normalizePredicate(context.ts, contextual);
  const expression = foldFreeIdentifiers(normalized.expression, captures);
  const predicate: NormalizedPredicate = {
    ...normalized,
    expression,
    key: serializeExpression(expression),
  };
  const opaque = findOpaqueExpression(predicate.expression);
  return opaque === null
    ? { issues: [], predicate }
    : {
        issues: [
          {
            code: DiagnosticCode.UnsupportedRuntimeSyntax,
            message: `Refinement expression syntax '${opaque.syntaxKind}' cannot be compiled for runtime validation.`,
          },
        ],
        predicate: null,
      };
}

interface RefinementParts {
  readonly baseTypes: readonly ts.Type[];
  readonly constituents: readonly ts.Type[];
  readonly foundMarker: boolean;
  readonly issues: readonly RefinementResolutionIssue[];
  readonly predicateSources: readonly string[];
}

interface ResolvedPredicates {
  readonly issues: readonly RefinementResolutionIssue[];
  readonly predicates: readonly NormalizedPredicate[];
}

function collectRefinementParts(context: AnalyzerContext, targetType: ts.Type): RefinementParts {
  const constituents = flattenIntersection(context.ts, targetType);
  const baseTypes: ts.Type[] = [];
  const predicateSources: string[] = [];
  const issues: RefinementResolutionIssue[] = [];
  let foundMarker = false;

  for (const constituent of constituents) {
    const marker = markerForType(context, constituent);
    if (marker === null) {
      baseTypes.push(constituent);
      continue;
    }
    foundMarker = true;
    const sources = extractPredicateSources(context, marker);
    if (sources === null) {
      issues.push({
        code: DiagnosticCode.PredicateNotConcrete,
        message: "Refinement predicate must be a concrete string literal at the assertion site.",
      });
    } else {
      predicateSources.push(...sources);
    }
  }

  return { baseTypes, constituents, foundMarker, issues, predicateSources };
}

function resolvePredicateSources(
  context: AnalyzerContext,
  targetType: ts.Type,
  constituents: readonly ts.Type[],
  predicateSources: readonly string[],
): ResolvedPredicates {
  const issues: RefinementResolutionIssue[] = [];
  const predicates: NormalizedPredicate[] = [];
  const remainingSources = [...predicateSources];
  const fallbackMarker = constituents
    .map((constituent) => markerForType(context, constituent))
    .find((marker) => marker !== null);
  const fallbackScope = targetType.aliasSymbol?.declarations?.[0] ?? fallbackMarker?.declaration;

  function resolveAt(source: string, scope: ts.Node | undefined): void {
    if (scope === undefined) {
      issues.push({
        code: DiagnosticCode.UnableToResolveMetadata,
        message: "Unable to resolve the refinement predicate declaration.",
      });
      return;
    }
    const resolved = resolvePredicateAtDeclaration(context, source, scope);
    issues.push(...resolved.issues);
    if (resolved.predicate !== null) predicates.push(resolved.predicate);
  }

  for (const origin of predicateOrigins(context, targetType)) {
    const markerIndex = remainingSources.indexOf(origin.source);
    if (markerIndex !== -1) remainingSources.splice(markerIndex, 1);
    resolveAt(origin.source, origin.scope);
  }
  for (const source of remainingSources) resolveAt(source, fallbackScope);

  return { issues, predicates };
}

function resolveRefinementMetadataUncached(
  context: AnalyzerContext,
  targetType: ts.Type,
): RefinementResolution {
  const parts = collectRefinementParts(context, targetType);
  if (!parts.foundMarker) return { isRefinement: false };

  const issues = [...parts.issues];
  if (parts.baseTypes.length === 0) {
    issues.push({
      code: DiagnosticCode.UnableToResolveMetadata,
      message: "Unable to resolve the unrefined base type.",
    });
  }

  const resolved = resolvePredicateSources(
    context,
    targetType,
    parts.constituents,
    parts.predicateSources,
  );
  issues.push(...resolved.issues);

  if (issues.length > 0 || parts.baseTypes.length === 0) {
    return { definition: null, isRefinement: true, issues };
  }

  const baseType = parts.baseTypes[0];
  if (baseType === undefined) {
    return {
      definition: null,
      isRefinement: true,
      issues: [
        {
          code: DiagnosticCode.UnableToResolveMetadata,
          message: "Unable to resolve the unrefined base type.",
        },
      ],
    };
  }

  return {
    definition: {
      baseType,
      baseTypes: parts.baseTypes,
      displayName: targetType.aliasSymbol?.getName(),
      predicates: resolved.predicates,
    },
    isRefinement: true,
    issues: [],
  };
}

export function resolveRefinementMetadata(
  context: AnalyzerContext,
  targetType: ts.Type,
): RefinementResolution {
  let cache = resolutionCaches.get(context.program);
  if (cache === undefined) {
    cache = new WeakMap();
    resolutionCaches.set(context.program, cache);
  }

  const cached = cache.get(targetType);
  if (cached !== undefined) return cached;
  const resolution = resolveRefinementMetadataUncached(context, targetType);
  cache.set(targetType, resolution);
  return resolution;
}

export function resolveRefinement(
  context: AnalyzerContext,
  targetType: ts.Type,
): RefinementDefinition | null {
  const resolution = resolveRefinementMetadata(context, targetType);
  return resolution.isRefinement ? resolution.definition : null;
}

function arrayElementType(context: AnalyzerContext, type: ts.Type): ts.Type | undefined {
  if (
    !context.checker.isArrayType(type) &&
    !["Array", "ReadonlyArray"].includes(type.symbol?.getName() ?? "")
  ) {
    return undefined;
  }
  // SAFETY: The array guard establishes TypeReference storage for type arguments.
  return context.checker.getTypeArguments(type as ts.TypeReference)[0];
}

function templateIndexPlaceholder(
  context: AnalyzerContext,
  type: ts.Type,
): "bigint" | "number" | "string" | null {
  if ((type.flags & (context.ts.TypeFlags.Any | context.ts.TypeFlags.String)) !== 0) {
    return "string";
  }
  if ((type.flags & context.ts.TypeFlags.Number) !== 0) return "number";
  if ((type.flags & context.ts.TypeFlags.BigInt) !== 0) return "bigint";
  return null;
}

function indexPathSegment(
  context: AnalyzerContext,
  keyType: ts.Type,
): Extract<RefinementPathSegment, { readonly kind: "index" }> | null {
  if ((keyType.flags & context.ts.TypeFlags.NumberLike) !== 0) {
    return { key: "number", kind: "index" };
  }
  if ((keyType.flags & context.ts.TypeFlags.ESSymbolLike) !== 0) {
    return { key: "symbol", kind: "index" };
  }
  if ((keyType.flags & context.ts.TypeFlags.TemplateLiteral) !== 0) {
    const template = keyType as ts.TemplateLiteralType;
    const placeholders = template.types.map((type) => templateIndexPlaceholder(context, type));
    if (placeholders.some((placeholder) => placeholder === null)) return null;
    return {
      key: "template",
      kind: "index",
      pattern: {
        placeholders: placeholders.filter((placeholder) => placeholder !== null),
        texts: template.texts,
      },
    };
  }
  if ((keyType.flags & context.ts.TypeFlags.StringLike) !== 0) {
    return { key: "string", kind: "index" };
  }
  return null;
}

function discriminantValue(
  context: AnalyzerContext,
  type: ts.Type,
): boolean | null | number | string | undefined {
  if ((type.flags & context.ts.TypeFlags.StringLiteral) !== 0) {
    // SAFETY: StringLiteral flags are carried only by StringLiteralType values.
    return (type as ts.StringLiteralType).value;
  }
  if ((type.flags & context.ts.TypeFlags.NumberLiteral) !== 0) {
    // SAFETY: NumberLiteral flags are carried only by NumberLiteralType values.
    return (type as ts.NumberLiteralType).value;
  }
  if ((type.flags & context.ts.TypeFlags.BooleanLiteral) !== 0) {
    return context.checker.typeToString(type) === "true";
  }
  if ((type.flags & context.ts.TypeFlags.Null) !== 0) return null;
  return undefined;
}

function propertyType(context: AnalyzerContext, type: ts.Type, name: string): ts.Type | undefined {
  const property = context.checker.getPropertyOfType(type, name);
  const location = property?.valueDeclaration ?? property?.declarations?.[0];
  return property === undefined || location === undefined
    ? undefined
    : context.checker.getTypeOfSymbolAtLocation(property, location);
}

function unionDiscriminant(
  context: AnalyzerContext,
  type: ts.UnionType,
):
  | readonly {
      readonly property: string;
      readonly type: ts.Type;
      readonly value: boolean | null | number | string;
    }[]
  | null {
  for (const property of context.checker.getPropertiesOfType(type)) {
    const branches = type.types.map((part) => {
      const branchPropertyType = propertyType(context, part, property.getName());
      const value =
        branchPropertyType === undefined
          ? undefined
          : discriminantValue(context, branchPropertyType);
      return value === undefined ? null : { property: property.getName(), type: part, value };
    });
    if (branches.some((branch) => branch === null)) continue;
    const resolved = branches.filter((branch) => branch !== null);
    if (new Set(resolved.map((branch) => JSON.stringify(branch.value))).size === resolved.length) {
      return resolved;
    }
  }
  return null;
}

function checkKey(check: RefinementCheck): string {
  return JSON.stringify({
    path: check.path,
    predicates: check.definition.predicates.map((predicate) => predicate.key),
  });
}

function withoutUndefined(context: AnalyzerContext, type: ts.Type): ts.Type {
  if (!type.isUnion()) return type;
  const defined = type.types.filter((part) => (part.flags & context.ts.TypeFlags.Undefined) === 0);
  return defined.length === 1 && defined[0] !== undefined ? defined[0] : type;
}

export function typeNodeContainsRefinement(
  context: AnalyzerContext,
  targetNode: ts.TypeNode,
): boolean {
  const visitedDeclarations = new Set<ts.Declaration>();

  function symbolAt(node: ts.Node): ts.Symbol | undefined {
    const symbol = context.checker.getSymbolAtLocation(node);
    if (symbol === undefined || (symbol.flags & context.ts.SymbolFlags.Alias) === 0) {
      return symbol;
    }
    return context.checker.getAliasedSymbol(symbol);
  }

  function memberType(member: ts.ClassElement | ts.TypeElement): ts.TypeNode | undefined {
    if (
      context.ts.isPropertySignature(member) ||
      context.ts.isMethodSignature(member) ||
      context.ts.isCallSignatureDeclaration(member) ||
      context.ts.isConstructSignatureDeclaration(member) ||
      context.ts.isIndexSignatureDeclaration(member) ||
      context.ts.isPropertyDeclaration(member) ||
      context.ts.isMethodDeclaration(member) ||
      context.ts.isGetAccessorDeclaration(member) ||
      context.ts.isSetAccessorDeclaration(member)
    ) {
      return member.type;
    }
    return undefined;
  }

  function structuredDeclarationContainsRefinement(
    declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
  ): boolean {
    if (declaration.heritageClauses?.some(visit) === true) return true;
    return declaration.members.some((member) => {
      const type = memberType(member);
      return type !== undefined && visit(type);
    });
  }

  function typeParameterContainsRefinement(declaration: ts.TypeParameterDeclaration): boolean {
    return (
      (declaration.constraint !== undefined && visit(declaration.constraint)) ||
      (declaration.default !== undefined && visit(declaration.default))
    );
  }

  function declarationContainsRefinement(declaration: ts.Declaration): boolean {
    if (visitedDeclarations.has(declaration)) return false;
    visitedDeclarations.add(declaration);

    if (context.ts.isTypeAliasDeclaration(declaration)) {
      return visit(declaration.type);
    }
    if (
      context.ts.isInterfaceDeclaration(declaration) ||
      context.ts.isClassDeclaration(declaration)
    ) {
      return structuredDeclarationContainsRefinement(declaration);
    }
    if (context.ts.isTypeParameterDeclaration(declaration)) {
      return typeParameterContainsRefinement(declaration);
    }
    return false;
  }

  function referencedDeclarationContainsRefinement(node: ts.Node): boolean {
    const symbol = symbolAt(node);
    return symbol !== undefined && (symbol.declarations ?? []).some(declarationContainsRefinement);
  }

  function visit(node: ts.Node): boolean {
    if (context.ts.isTypeReferenceNode(node)) {
      const symbol = symbolAt(node.typeName);
      if (symbol !== undefined && isRefinedAlias(context, symbol)) return true;
      if (node.typeArguments?.some(visit) === true) return true;
      return referencedDeclarationContainsRefinement(node.typeName);
    }
    if (context.ts.isExpressionWithTypeArguments(node)) {
      if (node.typeArguments?.some(visit) === true) return true;
      return referencedDeclarationContainsRefinement(node.expression);
    }

    let found = false;
    context.ts.forEachChild(node, (child) => {
      if (!found && visit(child)) found = true;
    });
    return found;
  }

  return visit(targetNode);
}

export function resolveRefinementChecks(
  context: AnalyzerContext,
  targetType: ts.Type,
): RefinementChecksResolution {
  const checks: RefinementCheck[] = [];
  const issues: RefinementResolutionIssue[] = [];
  const recursions: RefinementRecursion[] = [];
  const activeTypes = new Map<ts.Type, readonly RefinementPathSegment[]>();

  function visitRefinement(type: ts.Type, path: readonly RefinementPathSegment[]): boolean {
    const resolution = resolveRefinementMetadata(context, type);
    if (!resolution.isRefinement) return false;
    issues.push(...resolution.issues);
    if (resolution.definition !== null) {
      checks.push({ definition: resolution.definition, path });
      for (const baseType of resolution.definition.baseTypes) visit(baseType, path);
    }
    return true;
  }

  function visitTypeParameter(type: ts.Type, path: readonly RefinementPathSegment[]): boolean {
    if ((type.flags & context.ts.TypeFlags.TypeParameter) === 0) return false;
    const constraint = context.checker.getBaseConstraintOfType(type);
    if (constraint !== undefined) visit(constraint, path);
    return true;
  }

  function visitUnion(type: ts.Type, path: readonly RefinementPathSegment[]): boolean {
    if (!type.isUnion()) return false;
    const defined = type.types.filter(
      (part) => (part.flags & context.ts.TypeFlags.Undefined) === 0,
    );
    if (defined.length === 1 && defined[0] !== undefined) {
      visit(defined[0], path);
      return true;
    }

    const discriminant = unionDiscriminant(context, type);
    if (discriminant !== null) {
      for (const branch of discriminant) {
        visit(branch.type, [
          ...path,
          { kind: "union", property: branch.property, value: branch.value },
        ]);
      }
      return true;
    }

    const branchChecks: RefinementCheck[][] = [];
    for (const branch of type.types) {
      const start = checks.length;
      visit(branch, path);
      branchChecks.push(checks.splice(start));
    }
    const keys = branchChecks.map((branch) => branch.map(checkKey).sort().join("|"));
    if (keys.length > 0 && keys.every((key) => key === keys[0])) {
      checks.push(...(branchChecks[0] ?? []));
    } else if (branchChecks.some((branch) => branch.length > 0)) {
      issues.push({
        code: DiagnosticCode.UnableToResolveMetadata,
        message: "A union containing refinements requires a unique literal discriminant.",
      });
    }
    return true;
  }

  function visitTuple(type: ts.Type, path: readonly RefinementPathSegment[]): boolean {
    if (!context.checker.isTupleType(type)) return false;
    // SAFETY: isTupleType establishes a TypeReference backed by a TupleType target.
    const reference = type as ts.TypeReference;
    const typeArguments = context.checker.getTypeArguments(reference);
    // SAFETY: TypeScript stores tuple element flags on the tuple reference target.
    const target = reference.target as ts.TupleType & {
      readonly elementFlags?: readonly ts.ElementFlags[];
    };
    for (const [index, elementType] of typeArguments.entries()) {
      const flags = target.elementFlags?.[index] ?? context.ts.ElementFlags.Required;
      if ((flags & (context.ts.ElementFlags.Rest | context.ts.ElementFlags.Variadic)) !== 0) {
        visit(elementType, [...path, { kind: "tupleRest", start: index }]);
      } else {
        visit(elementType, [
          ...path,
          {
            index,
            kind: "tuple",
            optional: (flags & context.ts.ElementFlags.Optional) !== 0,
          },
        ]);
      }
    }
    return true;
  }

  function visitArray(type: ts.Type, path: readonly RefinementPathSegment[]): boolean {
    const elementType = arrayElementType(context, type);
    if (elementType === undefined) return false;
    visit(elementType, [...path, { kind: "array" }]);
    return true;
  }

  function visitObject(type: ts.Type, path: readonly RefinementPathSegment[]): void {
    if (
      (type.flags & context.ts.TypeFlags.Object) === 0 ||
      context.checker.getSignaturesOfType(type, context.ts.SignatureKind.Call).length > 0
    ) {
      return;
    }
    for (const property of context.checker.getPropertiesOfType(type)) {
      const name = property.getName();
      if (name.startsWith("__@")) continue;
      const childType = propertyType(context, type, name);
      if (childType === undefined) continue;
      const optional =
        (property.flags & context.ts.SymbolFlags.Optional) !== 0 ||
        (childType.isUnion() &&
          childType.types.some((part) => (part.flags & context.ts.TypeFlags.Undefined) !== 0));
      visit(withoutUndefined(context, childType), [...path, { kind: "property", name, optional }]);
    }
    for (const indexInfo of context.checker.getIndexInfosOfType(type)) {
      const segment = indexPathSegment(context, indexInfo.keyType);
      if (segment === null) {
        issues.push({
          code: DiagnosticCode.UnableToResolveMetadata,
          message: `Index signature key type '${context.checker.typeToString(indexInfo.keyType)}' cannot be validated at runtime.`,
        });
      } else {
        visit(indexInfo.type, [...path, segment]);
      }
    }
  }

  function visit(type: ts.Type, path: readonly RefinementPathSegment[]): void {
    const recursiveTarget = activeTypes.get(type);
    if (recursiveTarget !== undefined) {
      recursions.push({ path, targetPath: recursiveTarget });
      return;
    }
    activeTypes.set(type, path);
    try {
      if (visitRefinement(type, path)) return;
      if (visitTypeParameter(type, path)) return;
      if (visitUnion(type, path)) return;
      if (visitTuple(type, path)) return;
      if (visitArray(type, path)) return;
      visitObject(type, path);
    } finally {
      activeTypes.delete(type);
    }
  }

  visit(targetType, []);
  return { checks, issues, recursions };
}
