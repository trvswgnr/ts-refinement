export type LiteralValue = bigint | boolean | null | number | string | undefined;

export type NormalizedExpression =
  | { readonly kind: "array"; readonly elements: readonly NormalizedExpression[] }
  | {
      readonly arguments: readonly NormalizedExpression[];
      readonly callee: NormalizedExpression;
      readonly kind: "call";
      readonly optional: boolean;
    }
  | {
      readonly condition: NormalizedExpression;
      readonly kind: "conditional";
      readonly whenFalse: NormalizedExpression;
      readonly whenTrue: NormalizedExpression;
    }
  | { readonly kind: "global"; readonly name: string }
  | { readonly kind: "literal"; readonly value: LiteralValue }
  | { readonly kind: "local"; readonly name: string }
  | {
      readonly computed: boolean;
      readonly kind: "member";
      readonly object: NormalizedExpression;
      readonly optional: boolean;
      readonly property: NormalizedExpression | string;
    }
  | { readonly kind: "opaque"; readonly syntaxKind: string; readonly text: string }
  | { readonly kind: "subject" }
  | {
      readonly kind: "binary";
      readonly left: NormalizedExpression;
      readonly operator: string;
      readonly right: NormalizedExpression;
    }
  | { readonly kind: "unary"; readonly operand: NormalizedExpression; readonly operator: string };

export interface NormalizedPredicate {
  readonly expression: NormalizedExpression;
  readonly key: string;
  readonly source: string;
  readonly subject: string | null;
}

function serializeLiteral(value: LiteralValue) {
  if (typeof value === "bigint") {
    return ["bigint", value.toString()];
  }

  if (value === undefined) {
    return ["undefined"];
  }

  if (typeof value === "number") {
    if (Number.isNaN(value)) return ["number", "NaN"];
    if (value === Infinity) return ["number", "Infinity"];
    if (value === -Infinity) return ["number", "-Infinity"];
    if (Object.is(value, -0)) return ["number", "-0"];
  }

  return value;
}

export function serializeExpression(expression: NormalizedExpression): string {
  switch (expression.kind) {
    case "array":
      return JSON.stringify(["array", expression.elements.map(serializeExpression)]);
    case "binary":
      return JSON.stringify([
        "binary",
        expression.operator,
        serializeExpression(expression.left),
        serializeExpression(expression.right),
      ]);
    case "call":
      return JSON.stringify([
        "call",
        serializeExpression(expression.callee),
        expression.arguments.map(serializeExpression),
        expression.optional,
      ]);
    case "conditional":
      return JSON.stringify([
        "conditional",
        serializeExpression(expression.condition),
        serializeExpression(expression.whenTrue),
        serializeExpression(expression.whenFalse),
      ]);
    case "global":
      return JSON.stringify(["global", expression.name]);
    case "literal":
      return JSON.stringify(["literal", serializeLiteral(expression.value)]);
    case "local":
      return JSON.stringify(["local", expression.name]);
    case "member":
      return JSON.stringify([
        "member",
        serializeExpression(expression.object),
        typeof expression.property === "string"
          ? expression.property
          : serializeExpression(expression.property),
        expression.computed,
        expression.optional,
      ]);
    case "opaque":
      return JSON.stringify(["opaque", expression.syntaxKind, expression.text]);
    case "subject":
      return '["subject"]';
    case "unary":
      return JSON.stringify([
        "unary",
        expression.operator,
        serializeExpression(expression.operand),
      ]);
  }

  throw new Error("Unsupported normalized expression.");
}
