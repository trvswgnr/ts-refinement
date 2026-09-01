import type * as ts from "typescript";

import type {
  NormalizedBinding,
  NormalizedBindingElement,
  NormalizedExpression,
  NormalizedObjectBindingElement,
  NormalizedPredicate,
} from "./ir.ts";
import { serializeExpression } from "./ir.ts";
import { canonicalExpressionWithSubject, type ParsedPredicate } from "./parse.ts";

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

  function collectBindingNames(name: ts.BindingName, bindings: string[]): void {
    if (tsModule.isIdentifier(name)) {
      bindings.push(name.text);
      return;
    }

    for (const element of name.elements) {
      if (tsModule.isBindingElement(element)) collectBindingNames(element.name, bindings);
    }
  }

  function localIndex(bindings: readonly string[], name: string): number | undefined {
    for (let position = bindings.length - 1; position >= 0; position -= 1) {
      if (bindings[position] === name) return bindings.length - position - 1;
    }
    return undefined;
  }

  function normalizeBinding(name: ts.BindingName, bindings: readonly string[]): NormalizedBinding {
    if (tsModule.isIdentifier(name)) return { kind: "binding" };
    if (tsModule.isArrayBindingPattern(name)) {
      return {
        elements: name.elements.map((element) =>
          tsModule.isOmittedExpression(element) ? null : normalizeBindingElement(element, bindings),
        ),
        kind: "array-binding",
      };
    }
    return {
      elements: name.elements.map((element) => normalizeObjectBindingElement(element, bindings)),
      kind: "object-binding",
    };
  }

  function normalizeBindingElement(
    element: ts.BindingElement | ts.ParameterDeclaration,
    bindings: readonly string[],
  ): NormalizedBindingElement {
    return {
      binding: normalizeBinding(element.name, bindings),
      initializer:
        element.initializer === undefined ? null : normalize(element.initializer, bindings),
      rest: element.dotDotDotToken !== undefined,
    };
  }

  function normalizeObjectBindingElement(
    element: ts.BindingElement,
    bindings: readonly string[],
  ): NormalizedObjectBindingElement {
    const normalized = normalizeBindingElement(element, bindings);
    const propertyName = element.propertyName;
    if (element.dotDotDotToken !== undefined) {
      return { ...normalized, computed: false, property: null };
    }
    if (propertyName === undefined) {
      return {
        ...normalized,
        computed: false,
        property: tsModule.isIdentifier(element.name)
          ? element.name.text
          : element.name.getText(predicate.sourceFile),
      };
    }
    if (tsModule.isComputedPropertyName(propertyName)) {
      return {
        ...normalized,
        computed: true,
        property: normalize(propertyName.expression, bindings),
      };
    }
    return {
      ...normalized,
      computed: false,
      property: propertyName.text,
    };
  }

  function normalizeOpaque(
    node: ts.Expression,
  ): Extract<NormalizedExpression, { readonly kind: "opaque" }> {
    const sourceText = node.getText(predicate.sourceFile);
    let markerIndex = 0;
    let marker = "__ts_refinement_subject_0__";
    while (sourceText.includes(marker)) {
      markerIndex += 1;
      marker = `__ts_refinement_subject_${markerIndex}__`;
    }

    const canonical = canonicalExpressionWithSubject(tsModule, predicate, node, marker);
    const subjectOffsets: number[] = [];
    let text = "";
    let cursor = 0;
    for (;;) {
      const markerOffset = canonical.indexOf(marker, cursor);
      if (markerOffset === -1) {
        text += canonical.slice(cursor);
        break;
      }
      text += canonical.slice(cursor, markerOffset);
      subjectOffsets.push(text.length);
      text += "SUBJECT";
      cursor = markerOffset + marker.length;
    }

    return {
      kind: "opaque",
      subjectOffsets,
      syntaxKind: tsModule.SyntaxKind[node.kind],
      text,
    };
  }

  function containsFunctionExpression(node: ts.Node): boolean {
    if (tsModule.isArrowFunction(node) || tsModule.isFunctionExpression(node)) return true;
    let containsFunction = false;
    node.forEachChild((child) => {
      if (!containsFunction && containsFunctionExpression(child)) containsFunction = true;
    });
    return containsFunction;
  }

  function isFunctionToStringAccess(node: ts.Expression): boolean {
    if (tsModule.isPropertyAccessExpression(node)) {
      return node.name.text === "toString" && containsFunctionExpression(node.expression);
    }
    if (!tsModule.isElementAccessExpression(node)) return false;
    const property = node.argumentExpression;
    return (
      property !== undefined &&
      (tsModule.isStringLiteral(property) || tsModule.isNoSubstitutionTemplateLiteral(property)) &&
      property.text === "toString" &&
      containsFunctionExpression(node.expression)
    );
  }

  function normalize(node: ts.Expression, bindings: readonly string[] = []): NormalizedExpression {
    if (tsModule.isParenthesizedExpression(node)) return normalize(node.expression, bindings);
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
      const index = localIndex(bindings, node.text);
      if (index !== undefined) return { index, kind: "local" };
      if (predicate.freeReferences.has(node.text)) return { kind: "free", name: node.text };
      return normalizeOpaque(node);
    }

    if (tsModule.isArrowFunction(node) && !tsModule.isBlock(node.body)) {
      const functionBindings = [...bindings];
      for (const parameter of node.parameters) {
        collectBindingNames(parameter.name, functionBindings);
      }
      return {
        async:
          node.modifiers?.some((modifier) => modifier.kind === tsModule.SyntaxKind.AsyncKeyword) ??
          false,
        body: normalize(node.body, functionBindings),
        kind: "function",
        parameters: node.parameters.map((parameter) =>
          normalizeBindingElement(parameter, functionBindings),
        ),
      };
    }

    if (tsModule.isPrefixUnaryExpression(node)) {
      return {
        kind: "unary",
        operand: normalize(node.operand, bindings),
        operator: tokenText(tsModule, node.operator),
      };
    }

    if (tsModule.isBinaryExpression(node)) {
      return {
        kind: "binary",
        left: normalize(node.left, bindings),
        operator: tokenText(tsModule, node.operatorToken.kind),
        right: normalize(node.right, bindings),
      };
    }

    if (tsModule.isConditionalExpression(node)) {
      return {
        condition: normalize(node.condition, bindings),
        kind: "conditional",
        whenFalse: normalize(node.whenFalse, bindings),
        whenTrue: normalize(node.whenTrue, bindings),
      };
    }

    if (tsModule.isPropertyAccessExpression(node)) {
      if (isFunctionToStringAccess(node)) return normalizeOpaque(node);
      return {
        computed: false,
        kind: "member",
        object: normalize(node.expression, bindings),
        optional: node.questionDotToken !== undefined,
        property: node.name.text,
      };
    }

    if (tsModule.isElementAccessExpression(node)) {
      if (isFunctionToStringAccess(node)) return normalizeOpaque(node);
      return {
        computed: true,
        kind: "member",
        object: normalize(node.expression, bindings),
        optional: node.questionDotToken !== undefined,
        property:
          node.argumentExpression === undefined
            ? { kind: "literal", value: undefined }
            : normalize(node.argumentExpression, bindings),
      };
    }

    if (tsModule.isCallExpression(node)) {
      if (
        tsModule.isIdentifier(node.expression) &&
        node.expression.text === "String" &&
        node.arguments.some(containsFunctionExpression)
      ) {
        return normalizeOpaque(node);
      }
      return {
        arguments: node.arguments.map((argument) => normalize(argument, bindings)),
        callee: normalize(node.expression, bindings),
        kind: "call",
        optional: node.questionDotToken !== undefined,
      };
    }

    if (tsModule.isArrayLiteralExpression(node)) {
      return {
        elements: node.elements.map((element) => {
          if (tsModule.isSpreadElement(element)) {
            const expression = normalizeOpaque(element.expression);
            return {
              ...expression,
              subjectOffsets: expression.subjectOffsets.map((offset) => offset + 3),
              syntaxKind: "SpreadElement",
              text: `...${expression.text}`,
            };
          }
          if (tsModule.isOmittedExpression(element)) {
            return {
              kind: "opaque",
              subjectOffsets: [],
              syntaxKind: "OmittedExpression",
              text: "",
            };
          }
          return normalize(element, bindings);
        }),
        kind: "array",
      };
    }

    return normalizeOpaque(node);
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
