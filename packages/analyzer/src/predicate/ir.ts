import type * as ts from "typescript";

import { standardGlobals } from "./globals.ts";

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
      readonly chain: boolean;
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
      readonly chain: boolean;
      readonly computed: boolean;
      readonly kind: "member";
      readonly object: NormalizedExpression;
      readonly optional: boolean;
      readonly property: NormalizedExpression | string;
    }
  | { readonly kind: "regexp"; readonly text: string }
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
        expression.chain,
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
        expression.chain,
        expression.computed,
        expression.optional,
      ]);
    case "regexp":
      return JSON.stringify(["regexp", expression.text]);
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

export function findOpaqueExpression(
  expression: NormalizedExpression,
): Extract<NormalizedExpression, { readonly kind: "opaque" }> | null {
  function inBinding(binding: NormalizedBinding): ReturnType<typeof findOpaqueExpression> {
    switch (binding.kind) {
      case "array-binding":
        for (const element of binding.elements) {
          if (element === null) continue;
          const opaque = inBindingElement(element);
          if (opaque !== null) return opaque;
        }
        return null;
      case "binding":
        return null;
      case "object-binding":
        for (const element of binding.elements) {
          if (typeof element.property !== "string" && element.property !== null) {
            const opaqueProperty = findOpaqueExpression(element.property);
            if (opaqueProperty !== null) return opaqueProperty;
          }
          const opaque = inBindingElement(element);
          if (opaque !== null) return opaque;
        }
        return null;
    }

    throw new Error("Unsupported normalized binding.");
  }

  function inBindingElement(
    element: NormalizedBindingElement,
  ): ReturnType<typeof findOpaqueExpression> {
    const opaqueBinding = inBinding(element.binding);
    if (opaqueBinding !== null) return opaqueBinding;
    return element.initializer === null ? null : findOpaqueExpression(element.initializer);
  }

  switch (expression.kind) {
    case "array":
      for (const element of expression.elements) {
        const opaque = findOpaqueExpression(element);
        if (opaque !== null) return opaque;
      }
      return null;
    case "binary":
      return findOpaqueExpression(expression.left) ?? findOpaqueExpression(expression.right);
    case "call": {
      const opaqueCallee = findOpaqueExpression(expression.callee);
      if (opaqueCallee !== null) return opaqueCallee;
      for (const argument of expression.arguments) {
        const opaque = findOpaqueExpression(argument);
        if (opaque !== null) return opaque;
      }
      return null;
    }
    case "conditional":
      return (
        findOpaqueExpression(expression.condition) ??
        findOpaqueExpression(expression.whenTrue) ??
        findOpaqueExpression(expression.whenFalse)
      );
    case "function":
      for (const parameter of expression.parameters) {
        const opaque = inBindingElement(parameter);
        if (opaque !== null) return opaque;
      }
      return findOpaqueExpression(expression.body);
    case "member":
      return (
        findOpaqueExpression(expression.object) ??
        (typeof expression.property === "string" ? null : findOpaqueExpression(expression.property))
      );
    case "opaque":
      return expression;
    case "free":
    case "literal":
    case "local":
    case "regexp":
    case "subject":
      return null;
    case "unary":
      return findOpaqueExpression(expression.operand);
  }

  throw new Error("Unsupported normalized expression.");
}

function binaryOperator(tsModule: typeof ts, operator: string): ts.BinaryOperatorToken {
  switch (operator) {
    case "**":
      return tsModule.factory.createToken(tsModule.SyntaxKind.AsteriskAsteriskToken);
    case "*":
      return tsModule.factory.createToken(tsModule.SyntaxKind.AsteriskToken);
    case "/":
      return tsModule.factory.createToken(tsModule.SyntaxKind.SlashToken);
    case "%":
      return tsModule.factory.createToken(tsModule.SyntaxKind.PercentToken);
    case "+":
      return tsModule.factory.createToken(tsModule.SyntaxKind.PlusToken);
    case "-":
      return tsModule.factory.createToken(tsModule.SyntaxKind.MinusToken);
    case "<<":
      return tsModule.factory.createToken(tsModule.SyntaxKind.LessThanLessThanToken);
    case ">>":
      return tsModule.factory.createToken(tsModule.SyntaxKind.GreaterThanGreaterThanToken);
    case ">>>":
      return tsModule.factory.createToken(
        tsModule.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
      );
    case "<":
      return tsModule.factory.createToken(tsModule.SyntaxKind.LessThanToken);
    case "<=":
      return tsModule.factory.createToken(tsModule.SyntaxKind.LessThanEqualsToken);
    case ">":
      return tsModule.factory.createToken(tsModule.SyntaxKind.GreaterThanToken);
    case ">=":
      return tsModule.factory.createToken(tsModule.SyntaxKind.GreaterThanEqualsToken);
    case "in":
      return tsModule.factory.createToken(tsModule.SyntaxKind.InKeyword);
    case "instanceof":
      return tsModule.factory.createToken(tsModule.SyntaxKind.InstanceOfKeyword);
    case "==":
      return tsModule.factory.createToken(tsModule.SyntaxKind.EqualsEqualsToken);
    case "!=":
      return tsModule.factory.createToken(tsModule.SyntaxKind.ExclamationEqualsToken);
    case "===":
      return tsModule.factory.createToken(tsModule.SyntaxKind.EqualsEqualsEqualsToken);
    case "!==":
      return tsModule.factory.createToken(tsModule.SyntaxKind.ExclamationEqualsEqualsToken);
    case "&":
      return tsModule.factory.createToken(tsModule.SyntaxKind.AmpersandToken);
    case "^":
      return tsModule.factory.createToken(tsModule.SyntaxKind.CaretToken);
    case "|":
      return tsModule.factory.createToken(tsModule.SyntaxKind.BarToken);
    case "&&":
      return tsModule.factory.createToken(tsModule.SyntaxKind.AmpersandAmpersandToken);
    case "||":
      return tsModule.factory.createToken(tsModule.SyntaxKind.BarBarToken);
    case "??":
      return tsModule.factory.createToken(tsModule.SyntaxKind.QuestionQuestionToken);
    case ",":
      return tsModule.factory.createToken(tsModule.SyntaxKind.CommaToken);
    default:
      throw new Error(`Unsupported normalized binary operator '${operator}'.`);
  }
}

function literalExpression(tsModule: typeof ts, value: LiteralValue): ts.Expression {
  if (value === null) return tsModule.factory.createNull();
  if (value === undefined) return tsModule.factory.createIdentifier("undefined");
  if (typeof value === "bigint") {
    return tsModule.factory.createBigIntLiteral(`${value.toString()}n`);
  }
  if (typeof value === "boolean") {
    return value ? tsModule.factory.createTrue() : tsModule.factory.createFalse();
  }
  if (typeof value === "string") return tsModule.factory.createStringLiteral(value);
  if (Number.isNaN(value)) return tsModule.factory.createIdentifier("NaN");
  if (value === Infinity) return tsModule.factory.createIdentifier("Infinity");
  if (value === -Infinity) {
    return tsModule.factory.createPrefixUnaryExpression(
      tsModule.SyntaxKind.MinusToken,
      tsModule.factory.createIdentifier("Infinity"),
    );
  }
  if (Object.is(value, -0)) {
    return tsModule.factory.createPrefixUnaryExpression(
      tsModule.SyntaxKind.MinusToken,
      tsModule.factory.createNumericLiteral(0),
    );
  }
  return tsModule.factory.createNumericLiteral(value);
}

function bindingCount(binding: NormalizedBinding): number {
  switch (binding.kind) {
    case "array-binding":
      return binding.elements.reduce(
        (count, element) => count + (element === null ? 0 : bindingCount(element.binding)),
        0,
      );
    case "binding":
      return 1;
    case "object-binding":
      return binding.elements.reduce((count, element) => count + bindingCount(element.binding), 0);
  }

  throw new Error("Unsupported normalized binding.");
}

export function compileExpression(
  tsModule: typeof ts,
  expression: NormalizedExpression,
  subjectIdentifier: string,
): string {
  const sourceFile = tsModule.createSourceFile(
    "__compiled_refinement__.js",
    "",
    tsModule.ScriptTarget.Latest,
    false,
    tsModule.ScriptKind.JS,
  );

  function compile(node: NormalizedExpression, locals: readonly string[]): ts.Expression {
    switch (node.kind) {
      case "array":
        return tsModule.factory.createArrayLiteralExpression(
          node.elements.map((element) => compile(element, locals)),
        );
      case "binary":
        return tsModule.factory.createBinaryExpression(
          compile(node.left, locals),
          binaryOperator(tsModule, node.operator),
          compile(node.right, locals),
        );
      case "call": {
        const callee = compile(node.callee, locals);
        const compiledArguments = node.arguments.map((argument) => compile(argument, locals));
        return node.chain
          ? tsModule.factory.createCallChain(
              callee,
              node.optional
                ? tsModule.factory.createToken(tsModule.SyntaxKind.QuestionDotToken)
                : undefined,
              undefined,
              compiledArguments,
            )
          : tsModule.factory.createCallExpression(callee, undefined, compiledArguments);
      }
      case "conditional":
        return tsModule.factory.createConditionalExpression(
          compile(node.condition, locals),
          tsModule.factory.createToken(tsModule.SyntaxKind.QuestionToken),
          compile(node.whenTrue, locals),
          tsModule.factory.createToken(tsModule.SyntaxKind.ColonToken),
          compile(node.whenFalse, locals),
        );
      case "free":
        if (!standardGlobals.has(node.name)) {
          throw new Error(`Unapproved free identifier '${node.name}' in normalized expression.`);
        }
        return tsModule.factory.createIdentifier(node.name);
      case "function": {
        const localCount = node.parameters.reduce(
          (count, parameter) => count + bindingCount(parameter.binding),
          0,
        );
        const functionLocals = [
          ...locals,
          ...Array.from(
            { length: localCount },
            (_, index) => `__rf_local_${locals.length + index}`,
          ),
        ];
        let localOffset = locals.length;

        function compileBinding(binding: NormalizedBinding): ts.BindingName {
          switch (binding.kind) {
            case "array-binding":
              return tsModule.factory.createArrayBindingPattern(
                binding.elements.map((element) =>
                  element === null
                    ? tsModule.factory.createOmittedExpression()
                    : compileBindingElement(element),
                ),
              );
            case "binding": {
              const name = functionLocals[localOffset];
              if (name === undefined) throw new Error("Unable to allocate normalized binding.");
              localOffset += 1;
              return tsModule.factory.createIdentifier(name);
            }
            case "object-binding":
              return tsModule.factory.createObjectBindingPattern(
                binding.elements.map((element) => {
                  const property =
                    element.property === null
                      ? undefined
                      : typeof element.property === "string"
                        ? tsModule.factory.createStringLiteral(element.property)
                        : tsModule.factory.createComputedPropertyName(
                            compile(element.property, functionLocals),
                          );
                  return compileBindingElement(element, property);
                }),
              );
          }

          throw new Error("Unsupported normalized binding.");
        }

        function compileBindingElement(
          element: NormalizedBindingElement,
          property?: ts.PropertyName,
        ): ts.BindingElement {
          return tsModule.factory.createBindingElement(
            element.rest
              ? tsModule.factory.createToken(tsModule.SyntaxKind.DotDotDotToken)
              : undefined,
            property,
            compileBinding(element.binding),
            element.initializer === null ? undefined : compile(element.initializer, functionLocals),
          );
        }

        const parameters = node.parameters.map((parameter) =>
          tsModule.factory.createParameterDeclaration(
            undefined,
            parameter.rest
              ? tsModule.factory.createToken(tsModule.SyntaxKind.DotDotDotToken)
              : undefined,
            compileBinding(parameter.binding),
            undefined,
            undefined,
            parameter.initializer === null
              ? undefined
              : compile(parameter.initializer, functionLocals),
          ),
        );
        return tsModule.factory.createArrowFunction(
          node.async
            ? [tsModule.factory.createModifier(tsModule.SyntaxKind.AsyncKeyword)]
            : undefined,
          undefined,
          parameters,
          undefined,
          tsModule.factory.createToken(tsModule.SyntaxKind.EqualsGreaterThanToken),
          compile(node.body, functionLocals),
        );
      }
      case "literal":
        return literalExpression(tsModule, node.value);
      case "local": {
        const name = locals[locals.length - node.index - 1];
        if (name === undefined) throw new Error(`Unresolved normalized local index ${node.index}.`);
        return tsModule.factory.createIdentifier(name);
      }
      case "member": {
        const object = compile(node.object, locals);
        if (node.computed) {
          const property =
            typeof node.property === "string"
              ? tsModule.factory.createStringLiteral(node.property)
              : compile(node.property, locals);
          return node.chain
            ? tsModule.factory.createElementAccessChain(
                object,
                node.optional
                  ? tsModule.factory.createToken(tsModule.SyntaxKind.QuestionDotToken)
                  : undefined,
                property,
              )
            : tsModule.factory.createElementAccessExpression(object, property);
        }
        if (typeof node.property !== "string") {
          throw new Error("Normalized property access requires a string property.");
        }
        return node.chain
          ? tsModule.factory.createPropertyAccessChain(
              object,
              node.optional
                ? tsModule.factory.createToken(tsModule.SyntaxKind.QuestionDotToken)
                : undefined,
              node.property,
            )
          : tsModule.factory.createPropertyAccessExpression(object, node.property);
      }
      case "opaque":
        throw new Error(`Normalized syntax '${node.syntaxKind}' cannot be compiled.`);
      case "regexp":
        return tsModule.factory.createRegularExpressionLiteral(node.text);
      case "subject":
        return tsModule.factory.createIdentifier(subjectIdentifier);
      case "unary": {
        const operand = compile(node.operand, locals);
        if (node.operator === "typeof") return tsModule.factory.createTypeOfExpression(operand);
        switch (node.operator) {
          case "+":
            return tsModule.factory.createPrefixUnaryExpression(
              tsModule.SyntaxKind.PlusToken,
              operand,
            );
          case "-":
            return tsModule.factory.createPrefixUnaryExpression(
              tsModule.SyntaxKind.MinusToken,
              operand,
            );
          case "!":
            return tsModule.factory.createPrefixUnaryExpression(
              tsModule.SyntaxKind.ExclamationToken,
              operand,
            );
          case "~":
            return tsModule.factory.createPrefixUnaryExpression(
              tsModule.SyntaxKind.TildeToken,
              operand,
            );
          default:
            throw new Error(`Unsupported normalized unary operator '${node.operator}'.`);
        }
      }
    }

    throw new Error("Unsupported normalized expression.");
  }

  return tsModule
    .createPrinter({ removeComments: true })
    .printNode(tsModule.EmitHint.Expression, compile(expression, []), sourceFile);
}
