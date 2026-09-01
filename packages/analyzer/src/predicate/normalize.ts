import type * as ts from "typescript";

import type { NormalizedExpression, NormalizedPredicate } from "./ir.ts";
import { serializeExpression } from "./ir.ts";
import { canonicalPredicateWithSubject, type ParsedPredicate } from "./parse.ts";

const normalizerCaches = new WeakMap<object, Map<string, NormalizedPredicate>>();

function tokenText(tsModule: typeof ts, kind: ts.SyntaxKind): string {
  return tsModule.tokenToString(kind) ?? tsModule.SyntaxKind[kind];
}

export function normalizePredicate(
  tsModule: typeof ts,
  predicate: ParsedPredicate,
): NormalizedPredicate {
  let cache = normalizerCaches.get(tsModule);
  if (cache === undefined) {
    cache = new Map();
    normalizerCaches.set(tsModule, cache);
  }
  const cached = cache.get(predicate.source);
  if (cached !== undefined) return cached;

  const subjectReferences = new Set(predicate.subjectReferences);
  let canonicalOpaqueText: string | undefined;

  function normalize(node: ts.Expression): NormalizedExpression {
    if (tsModule.isParenthesizedExpression(node)) return normalize(node.expression);
    if (tsModule.isNumericLiteral(node)) return { kind: "literal", value: Number(node.text) };
    if (tsModule.isBigIntLiteral(node)) {
      return { kind: "literal", value: BigInt(node.text.slice(0, -1)) };
    }
    if (tsModule.isStringLiteral(node) || tsModule.isNoSubstitutionTemplateLiteral(node)) {
      return { kind: "literal", value: node.text };
    }
    if (node.kind === tsModule.SyntaxKind.TrueKeyword) return { kind: "literal", value: true };
    if (node.kind === tsModule.SyntaxKind.FalseKeyword) return { kind: "literal", value: false };
    if (node.kind === tsModule.SyntaxKind.NullKeyword) return { kind: "literal", value: null };

    if (tsModule.isIdentifier(node)) {
      if (subjectReferences.has(node)) return { kind: "subject" };
      if (predicate.freeReferences.has(node.text)) return { kind: "global", name: node.text };
      return { kind: "local", name: node.text };
    }

    if (tsModule.isPrefixUnaryExpression(node)) {
      return {
        kind: "unary",
        operand: normalize(node.operand),
        operator: tokenText(tsModule, node.operator),
      };
    }

    if (tsModule.isBinaryExpression(node)) {
      return {
        kind: "binary",
        left: normalize(node.left),
        operator: tokenText(tsModule, node.operatorToken.kind),
        right: normalize(node.right),
      };
    }

    if (tsModule.isConditionalExpression(node)) {
      return {
        condition: normalize(node.condition),
        kind: "conditional",
        whenFalse: normalize(node.whenFalse),
        whenTrue: normalize(node.whenTrue),
      };
    }

    if (tsModule.isPropertyAccessExpression(node)) {
      return {
        computed: false,
        kind: "member",
        object: normalize(node.expression),
        optional: node.questionDotToken !== undefined,
        property: node.name.text,
      };
    }

    if (tsModule.isElementAccessExpression(node)) {
      return {
        computed: true,
        kind: "member",
        object: normalize(node.expression),
        optional: node.questionDotToken !== undefined,
        property:
          node.argumentExpression === undefined
            ? { kind: "literal", value: undefined }
            : normalize(node.argumentExpression),
      };
    }

    if (tsModule.isCallExpression(node)) {
      return {
        arguments: node.arguments.map(normalize),
        callee: normalize(node.expression),
        kind: "call",
        optional: node.questionDotToken !== undefined,
      };
    }

    if (tsModule.isArrayLiteralExpression(node)) {
      return {
        elements: node.elements.map((element) =>
          tsModule.isSpreadElement(element)
            ? {
                kind: "opaque",
                syntaxKind: "SpreadElement",
                text: element.getText(predicate.sourceFile),
              }
            : normalize(element),
        ),
        kind: "array",
      };
    }

    return {
      kind: "opaque",
      syntaxKind: tsModule.SyntaxKind[node.kind],
      text: (canonicalOpaqueText ??= canonicalPredicateWithSubject(tsModule, predicate, "SUBJECT")),
    };
  }

  const expression = normalize(predicate.expression);
  const normalized = {
    expression,
    key: serializeExpression(expression),
    source: predicate.source,
    subject: predicate.subject,
  } satisfies NormalizedPredicate;
  cache.set(predicate.source, normalized);
  return normalized;
}
