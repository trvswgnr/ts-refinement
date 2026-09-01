export type LiteralValue = bigint | boolean | null | number | string | undefined;

export type NormalizedBinding =
  | { readonly kind: "binding" }
  | {
      readonly elements: readonly (NormalizedBindingElement | null)[];
      readonly kind: "array-binding";
    }
  | {
      readonly elements: readonly NormalizedObjectBindingElement[];
      readonly kind: "object-binding";
    };

export interface NormalizedBindingElement {
  readonly binding: NormalizedBinding;
  readonly initializer: NormalizedExpression | null;
  readonly rest: boolean;
}

export interface NormalizedObjectBindingElement extends NormalizedBindingElement {
  readonly computed: boolean;
  readonly property: NormalizedExpression | string | null;
}

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
  | { readonly kind: "free"; readonly name: string }
  | {
      readonly async: boolean;
      readonly body: NormalizedExpression;
      readonly kind: "function";
      readonly parameters: readonly NormalizedBindingElement[];
    }
  | { readonly kind: "literal"; readonly value: LiteralValue }
  | { readonly index: number; readonly kind: "local" }
  | {
      readonly computed: boolean;
      readonly kind: "member";
      readonly object: NormalizedExpression;
      readonly optional: boolean;
      readonly property: NormalizedExpression | string;
    }
  | {
      readonly kind: "opaque";
      readonly subjectOffsets: readonly number[];
      readonly syntaxKind: string;
      readonly text: string;
    }
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

function serializeBindingElement(element: NormalizedBindingElement): string {
  return JSON.stringify([
    serializeBinding(element.binding),
    element.initializer === null ? null : serializeExpression(element.initializer),
    element.rest,
  ]);
}

function serializeBinding(binding: NormalizedBinding): string {
  switch (binding.kind) {
    case "array-binding":
      return JSON.stringify([
        "array-binding",
        binding.elements.map((element) =>
          element === null ? null : serializeBindingElement(element),
        ),
      ]);
    case "binding":
      return '["binding"]';
    case "object-binding":
      return JSON.stringify([
        "object-binding",
        binding.elements.map((element) =>
          JSON.stringify([
            serializeBinding(element.binding),
            element.initializer === null ? null : serializeExpression(element.initializer),
            element.rest,
            element.property === null
              ? null
              : typeof element.property === "string"
                ? element.property
                : serializeExpression(element.property),
            element.computed,
          ]),
        ),
      ]);
  }

  throw new Error("Unsupported normalized binding.");
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
    case "free":
      return JSON.stringify(["free", expression.name]);
    case "function":
      return JSON.stringify([
        "function",
        expression.parameters.map(serializeBindingElement),
        serializeExpression(expression.body),
        expression.async,
      ]);
    case "literal":
      return JSON.stringify(["literal", serializeLiteral(expression.value)]);
    case "local":
      return JSON.stringify(["local", expression.index]);
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
      return JSON.stringify([
        "opaque",
        expression.syntaxKind,
        expression.text,
        expression.subjectOffsets,
      ]);
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
