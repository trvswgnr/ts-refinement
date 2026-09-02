import type * as ts from "typescript";

import type { NormalizedExpression, NormalizedPredicate } from "../predicate/ir.ts";
import {
  isStaticObjectValue,
  knownValue,
  unknownValue,
  type StaticObjectValue,
  type StaticRuntimeValue,
  type StaticValue,
} from "./values.ts";

export type Proof =
  | { readonly kind: "false"; readonly predicate?: string; readonly reason?: string }
  | { readonly kind: "true" }
  | { readonly kind: "unknown" };

function isNullish(value: StaticRuntimeValue): boolean {
  return value === null || value === undefined;
}

function evaluateStrictEquality(
  left: StaticRuntimeValue,
  right: StaticRuntimeValue,
  negate: boolean,
): StaticValue {
  if (
    Array.isArray(left) ||
    Array.isArray(right) ||
    isStaticObjectValue(left) ||
    isStaticObjectValue(right)
  ) {
    return unknownValue;
  }
  const equal = left === right;
  return knownValue(negate ? !equal : equal);
}

function evaluateRelational(
  left: StaticRuntimeValue,
  right: StaticRuntimeValue,
  operator: string,
): StaticValue {
  if (
    !(
      (typeof left === "number" && typeof right === "number") ||
      (typeof left === "string" && typeof right === "string") ||
      (typeof left === "bigint" && typeof right === "bigint")
    )
  ) {
    return unknownValue;
  }

  switch (operator) {
    case "<":
      return knownValue(left < right);
    case "<=":
      return knownValue(left <= right);
    case ">":
      return knownValue(left > right);
    case ">=":
      return knownValue(left >= right);
    default:
      return unknownValue;
  }
}

function evaluateArithmetic(
  left: StaticRuntimeValue,
  right: StaticRuntimeValue,
  operator: string,
): StaticValue {
  if (operator === "+" && typeof left === "string" && typeof right === "string") {
    return knownValue(left + right);
  }

  if (typeof left === "number" && typeof right === "number") {
    switch (operator) {
      case "+":
        return knownValue(left + right);
      case "-":
        return knownValue(left - right);
      case "*":
        return knownValue(left * right);
      case "/":
        return knownValue(left / right);
      case "%":
        return knownValue(left % right);
      case "**":
        return knownValue(left ** right);
      default:
        return unknownValue;
    }
  }

  if (typeof left === "bigint" && typeof right === "bigint") {
    try {
      switch (operator) {
        case "+":
          return knownValue(left + right);
        case "-":
          return knownValue(left - right);
        case "*":
          return knownValue(left * right);
        case "/":
          return right === 0n ? unknownValue : knownValue(left / right);
        case "%":
          return right === 0n ? unknownValue : knownValue(left % right);
        case "**":
          return right < 0n ? unknownValue : knownValue(left ** right);
        default:
          return unknownValue;
      }
    } catch {
      return unknownValue;
    }
  }

  return unknownValue;
}

function evaluateUnaryValue(operand: StaticValue, operator: string): StaticValue {
  if (!operand.known) return unknownValue;
  switch (operator) {
    case "!":
      return knownValue(!operand.value);
    case "+":
      if (typeof operand.value === "bigint" || Array.isArray(operand.value)) return unknownValue;
      return knownValue(Number(operand.value));
    case "-":
      if (typeof operand.value === "bigint") return knownValue(-operand.value);
      if (Array.isArray(operand.value)) return unknownValue;
      return knownValue(-Number(operand.value));
    default:
      return unknownValue;
  }
}

export function evaluateBinaryValues(
  left: StaticValue,
  right: () => StaticValue,
  operator: string,
): StaticValue {
  if (!left.known) return unknownValue;

  if (operator === "&&") return left.value ? right() : left;
  if (operator === "||") return left.value ? left : right();
  if (operator === "??") return isNullish(left.value) ? right() : left;

  const evaluatedRight = right();
  if (!evaluatedRight.known) return unknownValue;

  if (operator === "===") return evaluateStrictEquality(left.value, evaluatedRight.value, false);
  if (operator === "!==") return evaluateStrictEquality(left.value, evaluatedRight.value, true);
  if (["<", "<=", ">", ">="].includes(operator)) {
    return evaluateRelational(left.value, evaluatedRight.value, operator);
  }
  return evaluateArithmetic(left.value, evaluatedRight.value, operator);
}

function evaluateCall(
  expression: Extract<NormalizedExpression, { kind: "call" }>,
  subject: StaticValue,
): StaticValue {
  if (
    expression.callee.kind !== "member" ||
    expression.callee.computed ||
    expression.callee.object.kind !== "free" ||
    expression.callee.object.name !== "Number" ||
    typeof expression.callee.property !== "string" ||
    expression.arguments.length !== 1
  ) {
    return unknownValue;
  }

  const argument = expression.arguments[0];
  if (argument === undefined) return unknownValue;
  const value = evaluateExpression(argument, subject);
  if (!value.known) return unknownValue;

  if (expression.callee.property === "isInteger") {
    return knownValue(typeof value.value === "number" && Number.isInteger(value.value));
  }
  if (expression.callee.property === "isFinite") {
    return knownValue(typeof value.value === "number" && Number.isFinite(value.value));
  }

  return unknownValue;
}

export function evaluateExpression(
  expression: NormalizedExpression,
  subject: StaticValue,
): StaticValue {
  switch (expression.kind) {
    case "array": {
      const values: StaticRuntimeValue[] = [];
      for (const element of expression.elements) {
        const value = evaluateExpression(element, subject);
        if (!value.known) return unknownValue;
        values.push(value.value);
      }
      return knownValue(values);
    }
    case "binary":
      return evaluateBinaryValues(
        evaluateExpression(expression.left, subject),
        () => evaluateExpression(expression.right, subject),
        expression.operator,
      );
    case "call":
      return evaluateCall(expression, subject);
    case "conditional": {
      const condition = evaluateExpression(expression.condition, subject);
      if (!condition.known) return unknownValue;
      return evaluateExpression(
        condition.value ? expression.whenTrue : expression.whenFalse,
        subject,
      );
    }
    case "free":
      if (expression.name === "Infinity") return knownValue(Infinity);
      if (expression.name === "NaN") return knownValue(NaN);
      if (expression.name === "undefined") return knownValue(undefined);
      return unknownValue;
    case "literal":
      return knownValue(expression.value);
    case "function":
    case "local":
    case "opaque":
      return unknownValue;
    case "member": {
      const object = evaluateExpression(expression.object, subject);
      if (!object.known || expression.computed || typeof expression.property !== "string") {
        return unknownValue;
      }
      if (expression.property === "length") {
        if (typeof object.value === "string" || Array.isArray(object.value)) {
          return knownValue(object.value.length);
        }
      }
      if (isStaticObjectValue(object.value) && expression.property in object.value) {
        return knownValue(object.value[expression.property]);
      }
      return unknownValue;
    }
    case "subject":
      return subject;
    case "unary":
      return evaluateUnaryValue(
        evaluateExpression(expression.operand, subject),
        expression.operator,
      );
  }

  return unknownValue;
}

export function provePredicates(
  predicates: readonly NormalizedPredicate[],
  subject: StaticValue,
): Proof {
  let sawUnknown = false;
  for (const predicate of predicates) {
    const value = evaluateExpression(predicate.expression, subject);
    if (!value.known) {
      sawUnknown = true;
    } else if (!value.value) {
      return {
        kind: "false",
        predicate: predicate.source,
        reason: "Predicate evaluated to a falsy value.",
      };
    }
  }

  return sawUnknown ? { kind: "unknown" } : { kind: "true" };
}

export function evaluateSourceExpression(
  tsModule: typeof ts,
  checker: ts.TypeChecker,
  node: ts.Expression,
): StaticValue {
  if (
    tsModule.isParenthesizedExpression(node) ||
    tsModule.isAsExpression(node) ||
    tsModule.isTypeAssertionExpression(node) ||
    tsModule.isNonNullExpression(node) ||
    tsModule.isSatisfiesExpression(node)
  ) {
    return evaluateSourceExpression(tsModule, checker, node.expression);
  }

  if (tsModule.isNumericLiteral(node)) return knownValue(Number(node.text));
  if (tsModule.isBigIntLiteral(node)) return knownValue(BigInt(node.text.slice(0, -1)));
  if (tsModule.isStringLiteral(node) || tsModule.isNoSubstitutionTemplateLiteral(node)) {
    return knownValue(node.text);
  }
  if (node.kind === tsModule.SyntaxKind.TrueKeyword) return knownValue(true);
  if (node.kind === tsModule.SyntaxKind.FalseKeyword) return knownValue(false);
  if (node.kind === tsModule.SyntaxKind.NullKeyword) return knownValue(null);

  if (tsModule.isPrefixUnaryExpression(node)) {
    return evaluateUnaryValue(
      evaluateSourceExpression(tsModule, checker, node.operand),
      tsModule.tokenToString(node.operator) ?? "",
    );
  }

  if (tsModule.isBinaryExpression(node)) {
    return evaluateBinaryValues(
      evaluateSourceExpression(tsModule, checker, node.left),
      () => evaluateSourceExpression(tsModule, checker, node.right),
      tsModule.tokenToString(node.operatorToken.kind) ?? "",
    );
  }

  if (tsModule.isConditionalExpression(node)) {
    const condition = evaluateSourceExpression(tsModule, checker, node.condition);
    if (!condition.known) return unknownValue;
    return evaluateSourceExpression(
      tsModule,
      checker,
      condition.value ? node.whenTrue : node.whenFalse,
    );
  }

  if (tsModule.isArrayLiteralExpression(node)) {
    const values: StaticRuntimeValue[] = [];
    for (const element of node.elements) {
      if (tsModule.isSpreadElement(element)) return unknownValue;
      const value = evaluateSourceExpression(tsModule, checker, element);
      if (!value.known) return unknownValue;
      values.push(value.value);
    }
    return knownValue(values);
  }

  if (tsModule.isObjectLiteralExpression(node)) {
    const value: StaticObjectValue = {};
    for (const property of node.properties) {
      if (!tsModule.isPropertyAssignment(property)) return unknownValue;
      const name =
        tsModule.isIdentifier(property.name) ||
        tsModule.isStringLiteral(property.name) ||
        tsModule.isNumericLiteral(property.name)
          ? property.name.text
          : undefined;
      if (name === undefined) return unknownValue;
      const child = evaluateSourceExpression(tsModule, checker, property.initializer);
      if (!child.known) return unknownValue;
      value[name] = child.value;
    }
    return knownValue(value);
  }

  const type = checker.getTypeAtLocation(node);
  if (type.isNumberLiteral()) return knownValue(type.value);
  if (type.isStringLiteral()) return knownValue(type.value);
  if ((type.flags & tsModule.TypeFlags.BooleanLiteral) !== 0) {
    const display = checker.typeToString(type);
    if (display === "true") return knownValue(true);
    if (display === "false") return knownValue(false);
  }

  return unknownValue;
}
