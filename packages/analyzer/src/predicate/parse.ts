import type * as ts from "typescript";

import {
  DiagnosticCode,
  createDiagnostic,
  type DiagnosticLocation,
  type RefinementDiagnostic,
} from "../diagnostics.ts";
import { analyzeFreeIdentifiers } from "./scope.ts";

export interface ParsedPredicate {
  readonly expression: ts.Expression;
  readonly freeReferences: ReadonlyMap<string, readonly ts.Identifier[]>;
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly subject: string | null;
  readonly subjectReferences: readonly ts.Identifier[];
}

export type PredicateParseResult =
  | { readonly diagnostics: readonly RefinementDiagnostic[]; readonly ok: false }
  | {
      readonly diagnostics: readonly RefinementDiagnostic[];
      readonly ok: true;
      readonly predicate: ParsedPredicate;
    };

const parserCaches = new WeakMap<object, Map<string, PredicateParseResult>>();

function predicateLocation(source: string): DiagnosticLocation {
  return { length: Math.max(1, source.length), start: 0 };
}

function findExpression(tsModule: typeof ts, sourceFile: ts.SourceFile): ts.Expression | null {
  const statement = sourceFile.statements[0];
  if (statement === undefined || !tsModule.isVariableStatement(statement)) return null;

  const declaration = statement.declarationList.declarations[0];
  if (declaration?.initializer === undefined) return null;

  return tsModule.isParenthesizedExpression(declaration.initializer)
    ? declaration.initializer.expression
    : declaration.initializer;
}

function hasDisallowedSyntax(tsModule: typeof ts, expression: ts.Expression): boolean {
  let disallowed = false;

  function visit(node: ts.Node): void {
    if (disallowed) return;

    if (
      tsModule.isAwaitExpression(node) ||
      tsModule.isBlock(node) ||
      tsModule.isDeleteExpression(node) ||
      tsModule.isMetaProperty(node) ||
      tsModule.isYieldExpression(node) ||
      node.kind === tsModule.SyntaxKind.ThisKeyword ||
      tsModule.isPostfixUnaryExpression(node) ||
      (tsModule.isPrefixUnaryExpression(node) &&
        (node.operator === tsModule.SyntaxKind.PlusPlusToken ||
          node.operator === tsModule.SyntaxKind.MinusMinusToken)) ||
      (tsModule.isCallExpression(node) &&
        node.expression.kind === tsModule.SyntaxKind.ImportKeyword)
    ) {
      disallowed = true;
      return;
    }

    if (tsModule.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      if (
        kind >= tsModule.SyntaxKind.FirstAssignment &&
        kind <= tsModule.SyntaxKind.LastAssignment
      ) {
        disallowed = true;
        return;
      }
    }

    tsModule.forEachChild(node, visit);
  }

  visit(expression);
  return disallowed;
}

export function parsePredicate(tsModule: typeof ts, source: string): PredicateParseResult {
  let cache = parserCaches.get(tsModule);
  if (cache === undefined) {
    cache = new Map();
    parserCaches.set(tsModule, cache);
  }

  const cached = cache.get(source);
  if (cached !== undefined) return cached;

  const wrapped = `const __predicate = (${source});`;
  const transpiled = tsModule.transpileModule(wrapped, {
    compilerOptions: {
      allowJs: true,
      target: tsModule.ScriptTarget.Latest,
    },
    fileName: "__refinement__.js",
    reportDiagnostics: true,
  });
  const sourceFile = tsModule.createSourceFile(
    "__refinement__.js",
    wrapped,
    tsModule.ScriptTarget.Latest,
    true,
    tsModule.ScriptKind.JS,
  );
  const expression = findExpression(tsModule, sourceFile);

  if ((transpiled.diagnostics?.length ?? 0) > 0 || expression === null) {
    const result: PredicateParseResult = {
      diagnostics: [
        createDiagnostic(
          DiagnosticCode.InvalidExpression,
          "Invalid refinement JavaScript expression.",
          predicateLocation(source),
        ),
      ],
      ok: false,
    };
    cache.set(source, result);
    return result;
  }

  if (hasDisallowedSyntax(tsModule, expression)) {
    const result: PredicateParseResult = {
      diagnostics: [
        createDiagnostic(
          DiagnosticCode.InvalidExpression,
          "Refinement expression uses syntax that is not allowed in predicates.",
          predicateLocation(source),
        ),
      ],
      ok: false,
    };
    cache.set(source, result);
    return result;
  }

  const free = analyzeFreeIdentifiers(tsModule, expression);
  if (free.disallowedNames.length > 0) {
    const result: PredicateParseResult = {
      diagnostics: [
        createDiagnostic(
          DiagnosticCode.CannotInferSubject,
          `Cannot infer refinement subject. Disallowed free identifiers: ${free.disallowedNames.join(", ")}.`,
          predicateLocation(source),
        ),
      ],
      ok: false,
    };
    cache.set(source, result);
    return result;
  }

  if (free.unresolvedNames.length > 1) {
    const result: PredicateParseResult = {
      diagnostics: [
        createDiagnostic(
          DiagnosticCode.CannotInferSubject,
          `Cannot infer refinement subject. Unresolved identifiers: ${free.unresolvedNames.join(", ")}.`,
          predicateLocation(source),
        ),
      ],
      ok: false,
    };
    cache.set(source, result);
    return result;
  }

  const subject = free.unresolvedNames[0] ?? null;
  const result: PredicateParseResult = {
    diagnostics: [],
    ok: true,
    predicate: {
      expression,
      freeReferences: free.freeReferences,
      source,
      sourceFile,
      subject,
      subjectReferences: subject === null ? [] : (free.freeReferences.get(subject) ?? []),
    },
  };
  cache.set(source, result);
  return result;
}

export function emitPredicateWithSubject(
  tsModule: typeof ts,
  predicate: ParsedPredicate,
  replacement: string,
): string {
  return emitNodeWithSubject(tsModule, predicate, predicate.expression, replacement);
}

function emitNodeWithSubject(
  tsModule: typeof ts,
  predicate: ParsedPredicate,
  node: ts.Expression,
  replacement: string,
): string {
  const expressionStart = node.getStart(predicate.sourceFile);
  const expressionEnd = node.getEnd();
  let emitted = node.getText(predicate.sourceFile);
  const references = predicate.subjectReferences
    .filter(
      (reference) =>
        reference.getStart(predicate.sourceFile) >= expressionStart &&
        reference.getEnd() <= expressionEnd,
    )
    .sort((left, right) => right.getStart() - left.getStart());

  for (const reference of references) {
    const start = reference.getStart(predicate.sourceFile) - expressionStart;
    const end = reference.getEnd() - expressionStart;
    const parent = reference.parent;
    const replacementText =
      tsModule.isShorthandPropertyAssignment(parent) && parent.name === reference
        ? `${reference.text}: ${replacement}`
        : replacement;
    emitted = `${emitted.slice(0, start)}${replacementText}${emitted.slice(end)}`;
  }

  return emitted;
}

export function canonicalPredicateWithSubject(
  tsModule: typeof ts,
  predicate: ParsedPredicate,
  replacement: string,
): string {
  return canonicalExpressionWithSubject(tsModule, predicate, predicate.expression, replacement);
}

export function canonicalExpressionWithSubject(
  tsModule: typeof ts,
  predicate: ParsedPredicate,
  expressionNode: ts.Expression,
  replacement: string,
): string {
  const emitted = emitNodeWithSubject(tsModule, predicate, expressionNode, replacement);
  const sourceFile = tsModule.createSourceFile(
    "__normalized_refinement__.js",
    `const __predicate = (${emitted});`,
    tsModule.ScriptTarget.Latest,
    true,
    tsModule.ScriptKind.JS,
  );
  const expression = findExpression(tsModule, sourceFile);
  if (expression === null) return emitted;
  return tsModule
    .createPrinter({ removeComments: true })
    .printNode(tsModule.EmitHint.Expression, expression, sourceFile);
}
