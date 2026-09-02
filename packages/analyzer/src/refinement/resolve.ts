import type * as ts from "typescript";

import { DiagnosticCode } from "../diagnostics.ts";
import { findOpaqueExpression } from "../predicate/ir.ts";
import { normalizePredicate } from "../predicate/normalize.ts";
import { parsePredicate } from "../predicate/parse.ts";
import type { NormalizedPredicate } from "../predicate/ir.ts";

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

export interface RefinementResolutionIssue {
  readonly code: number;
  readonly message: string;
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

function resolveRefinementMetadataUncached(
  context: AnalyzerContext,
  targetType: ts.Type,
): RefinementResolution {
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

  if (!foundMarker) return { isRefinement: false };

  if (baseTypes.length === 0) {
    issues.push({
      code: DiagnosticCode.UnableToResolveMetadata,
      message: "Unable to resolve the unrefined base type.",
    });
  }

  const predicates: NormalizedPredicate[] = [];
  for (const source of predicateSources) {
    const parsed = parsePredicate(context.ts, source);
    if (!parsed.ok) {
      for (const diagnostic of parsed.diagnostics) {
        issues.push({
          code: diagnostic.code,
          message: diagnostic.message.replace(/^RF\d+: /u, ""),
        });
      }
    } else {
      const predicate = normalizePredicate(context.ts, parsed.predicate);
      const opaque = findOpaqueExpression(predicate.expression);
      if (opaque === null) {
        predicates.push(predicate);
      } else {
        issues.push({
          code: DiagnosticCode.UnsupportedRuntimeSyntax,
          message: `Refinement expression syntax '${opaque.syntaxKind}' cannot be compiled for runtime validation.`,
        });
      }
    }
  }

  if (issues.length > 0 || baseTypes.length === 0) {
    return { definition: null, isRefinement: true, issues };
  }

  const baseType = baseTypes[0];
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
      baseTypes,
      displayName: targetType.aliasSymbol?.getName(),
      predicates,
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
