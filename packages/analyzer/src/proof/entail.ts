import type { NormalizedExpression, NormalizedPredicate } from "../predicate/ir.ts";
import { serializeExpression } from "../predicate/ir.ts";

type Scalar = bigint | number;
type ScalarKind = "bigint" | "number";

interface Bound {
  readonly inclusive: boolean;
  readonly value: Scalar;
}

interface Congruence {
  readonly modulus: Scalar;
  readonly remainder: Scalar;
}

interface Term {
  readonly key: string;
}

interface Domain {
  bigintTyped: boolean;
  readonly congruences: Congruence[];
  finite: boolean;
  integral: boolean;
  lower: Bound | null;
  upper: Bound | null;
}

interface Comparison {
  readonly bound: Bound;
  readonly kind: ScalarKind;
  readonly relation: "equal" | "lower" | "upper";
  readonly requiresBigInt: boolean;
  readonly requiresIntegral: boolean;
  readonly term: Term;
  readonly wasNegated: boolean;
}

interface CongruenceFact extends Congruence {
  readonly kind: ScalarKind;
  readonly term: Term;
}

interface TypeFact {
  readonly kind: "finite" | "integral";
  readonly term: Term;
}

interface Affine {
  readonly coefficient: Scalar;
  readonly kind: ScalarKind;
  readonly offset: Scalar;
  readonly requiresBigInt: boolean;
  readonly term: Term | null;
  readonly transformed: boolean;
}

const subjectTerm: Term = { key: "subject" };
const lengthTerm: Term = { key: "subject.length" };

function termOf(expression: NormalizedExpression): Term | null {
  if (expression.kind === "subject") return subjectTerm;
  if (
    expression.kind === "member" &&
    !expression.computed &&
    !expression.optional &&
    expression.object.kind === "subject" &&
    expression.property === "length"
  ) {
    return lengthTerm;
  }
  return null;
}

function scalarLiteral(expression: NormalizedExpression): Scalar | null {
  if (
    expression.kind === "literal" &&
    (typeof expression.value === "number" || typeof expression.value === "bigint")
  ) {
    return expression.value;
  }
  if (expression.kind !== "unary" || expression.operator !== "-") return null;
  const operand = scalarLiteral(expression.operand);
  return operand === null ? null : -operand;
}

function emptyAffine(kind: ScalarKind): Affine {
  return kind === "bigint"
    ? {
        coefficient: 0n,
        kind,
        offset: 0n,
        requiresBigInt: false,
        term: null,
        transformed: false,
      }
    : {
        coefficient: 0,
        kind,
        offset: 0,
        requiresBigInt: false,
        term: null,
        transformed: false,
      };
}

function affineConstant(value: Scalar, kind: ScalarKind): Affine | null {
  if (typeof value !== kind) return null;
  const affine = emptyAffine(kind);
  return { ...affine, offset: value, requiresBigInt: kind === "bigint" };
}

function affineTerm(term: Term, kind: ScalarKind): Affine {
  return kind === "bigint"
    ? {
        coefficient: 1n,
        kind,
        offset: 0n,
        requiresBigInt: false,
        term,
        transformed: false,
      }
    : {
        coefficient: 1,
        kind,
        offset: 0,
        requiresBigInt: false,
        term,
        transformed: false,
      };
}

function addAffine(left: Affine, right: Affine, subtract: boolean): Affine | null {
  if (left.term !== null && right.term !== null && left.term.key !== right.term.key) return null;
  if (left.kind === "bigint" && right.kind === "bigint") {
    const leftCoefficient = BigInt(left.coefficient);
    const rightCoefficient = BigInt(right.coefficient);
    const leftOffset = BigInt(left.offset);
    const rightOffset = BigInt(right.offset);
    return {
      coefficient: leftCoefficient + (subtract ? -rightCoefficient : rightCoefficient),
      kind: "bigint",
      offset: leftOffset + (subtract ? -rightOffset : rightOffset),
      requiresBigInt: left.requiresBigInt || right.requiresBigInt,
      term: left.term ?? right.term,
      transformed: true,
    };
  }
  if (left.kind !== "number" || right.kind !== "number") return null;
  const leftCoefficient = Number(left.coefficient);
  const rightCoefficient = Number(right.coefficient);
  const leftOffset = Number(left.offset);
  const rightOffset = Number(right.offset);
  const coefficient = leftCoefficient + (subtract ? -rightCoefficient : rightCoefficient);
  const offset = leftOffset + (subtract ? -rightOffset : rightOffset);
  if (!Number.isFinite(coefficient) || !Number.isFinite(offset)) return null;
  return {
    coefficient,
    kind: "number",
    offset,
    requiresBigInt: false,
    term: left.term ?? right.term,
    transformed: true,
  };
}

function multiplyAffine(left: Affine, right: Affine): Affine | null {
  if (left.term !== null && right.term !== null) return null;
  if (left.kind === "bigint" && right.kind === "bigint") {
    const constant = BigInt(left.term === null ? left.offset : right.offset);
    const expression = left.term === null ? right : left;
    return {
      coefficient: BigInt(expression.coefficient) * constant,
      kind: "bigint",
      offset: BigInt(expression.offset) * constant,
      requiresBigInt: left.requiresBigInt || right.requiresBigInt,
      term: expression.term,
      transformed: true,
    };
  }
  if (left.kind !== "number" || right.kind !== "number") return null;
  const constant = Number(left.term === null ? left.offset : right.offset);
  const expression = left.term === null ? right : left;
  const coefficient = Number(expression.coefficient) * constant;
  const offset = Number(expression.offset) * constant;
  if (!Number.isFinite(coefficient) || !Number.isFinite(offset)) return null;
  return {
    coefficient,
    kind: "number",
    offset,
    requiresBigInt: false,
    term: expression.term,
    transformed: true,
  };
}

function negateAffine(operand: Affine): Affine {
  if (operand.kind === "bigint") {
    return {
      ...operand,
      coefficient: -BigInt(operand.coefficient),
      offset: -BigInt(operand.offset),
      transformed: true,
    };
  }
  return {
    ...operand,
    coefficient: -Number(operand.coefficient),
    offset: -Number(operand.offset),
    transformed: true,
  };
}

function parseAffine(expression: NormalizedExpression, kind: ScalarKind): Affine | null {
  const term = termOf(expression);
  if (term !== null) return affineTerm(term, kind);

  const literal = scalarLiteral(expression);
  if (literal !== null) return affineConstant(literal, kind);

  if (expression.kind === "unary" && expression.operator === "+") {
    if (kind !== "number") return null;
    const operand = parseAffine(expression.operand, kind);
    return operand === null ? null : { ...operand, transformed: true };
  }
  if (expression.kind === "unary" && expression.operator === "-") {
    const operand = parseAffine(expression.operand, kind);
    return operand === null ? null : negateAffine(operand);
  }
  if (expression.kind !== "binary") return null;
  if (!["+", "-", "*"].includes(expression.operator)) return null;
  const left = parseAffine(expression.left, kind);
  const right = parseAffine(expression.right, kind);
  if (left === null || right === null) return null;
  if (expression.operator === "+") return addAffine(left, right, false);
  if (expression.operator === "-") return addAffine(left, right, true);
  return multiplyAffine(left, right);
}

function reverseOperator(operator: string): string {
  switch (operator) {
    case "<":
      return ">";
    case "<=":
      return ">=";
    case ">":
      return "<";
    case ">=":
      return "<=";
    default:
      return operator;
  }
}

function negateOperator(operator: string): string | null {
  switch (operator) {
    case "<":
      return ">=";
    case "<=":
      return ">";
    case ">":
      return "<=";
    case ">=":
      return "<";
    case "!==":
      return "===";
    default:
      return null;
  }
}

function floorDiv(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function ceilDiv(dividend: bigint, divisor: bigint): bigint {
  return -floorDiv(-dividend, divisor);
}

function bigintComparison(
  affine: Affine,
  literal: bigint,
  operator: string,
  wasNegated: boolean,
): Comparison | null {
  if (affine.term === null || affine.kind !== "bigint") return null;
  if (!affine.requiresBigInt) {
    return bareBigintComparison(affine, literal, operator, wasNegated);
  }
  let coefficient = BigInt(affine.coefficient);
  if (coefficient === 0n) return null;
  let difference = literal - BigInt(affine.offset);
  let normalizedOperator = operator;
  if (coefficient < 0n) {
    coefficient = -coefficient;
    difference = -difference;
    normalizedOperator = reverseOperator(normalizedOperator);
  }

  switch (normalizedOperator) {
    case ">":
      return {
        bound: { inclusive: true, value: floorDiv(difference, coefficient) + 1n },
        kind: "bigint",
        relation: "lower",
        requiresBigInt: true,
        requiresIntegral: false,
        term: affine.term,
        wasNegated,
      };
    case ">=":
      return {
        bound: { inclusive: true, value: ceilDiv(difference, coefficient) },
        kind: "bigint",
        relation: "lower",
        requiresBigInt: true,
        requiresIntegral: false,
        term: affine.term,
        wasNegated,
      };
    case "<":
      return {
        bound: { inclusive: true, value: ceilDiv(difference, coefficient) - 1n },
        kind: "bigint",
        relation: "upper",
        requiresBigInt: true,
        requiresIntegral: false,
        term: affine.term,
        wasNegated,
      };
    case "<=":
      return {
        bound: { inclusive: true, value: floorDiv(difference, coefficient) },
        kind: "bigint",
        relation: "upper",
        requiresBigInt: true,
        requiresIntegral: false,
        term: affine.term,
        wasNegated,
      };
    case "===": {
      if (difference % coefficient !== 0n) return null;
      return {
        bound: { inclusive: true, value: difference / coefficient },
        kind: "bigint",
        relation: "equal",
        requiresBigInt: true,
        requiresIntegral: false,
        term: affine.term,
        wasNegated,
      };
    }
    default:
      return null;
  }
}

function bareBigintComparison(
  affine: Affine,
  literal: bigint,
  operator: string,
  wasNegated: boolean,
): Comparison | null {
  if (
    affine.term === null ||
    affine.transformed ||
    affine.coefficient !== 1n ||
    affine.offset !== 0n
  ) {
    return null;
  }
  if ([">", ">="].includes(operator)) {
    return {
      bound: { inclusive: operator === ">=", value: literal },
      kind: "bigint",
      relation: "lower",
      requiresBigInt: false,
      requiresIntegral: false,
      term: affine.term,
      wasNegated,
    };
  }
  if (["<", "<="].includes(operator)) {
    return {
      bound: { inclusive: operator === "<=", value: literal },
      kind: "bigint",
      relation: "upper",
      requiresBigInt: false,
      requiresIntegral: false,
      term: affine.term,
      wasNegated,
    };
  }
  if (operator !== "===") return null;
  return {
    bound: { inclusive: true, value: literal },
    kind: "bigint",
    relation: "equal",
    requiresBigInt: false,
    requiresIntegral: false,
    term: affine.term,
    wasNegated,
  };
}

function numberComparison(
  affine: Affine,
  literal: number,
  operator: string,
  wasNegated: boolean,
): Comparison | null {
  const coefficient = Number(affine.coefficient);
  const offset = Number(affine.offset);
  if (affine.term === null || affine.kind !== "number" || !Number.isFinite(literal)) {
    return null;
  }
  if (affine.transformed || offset !== 0 || (coefficient !== 1 && coefficient !== -1)) {
    return integerNumberComparison(affine.term, coefficient, offset, literal, operator, wasNegated);
  }
  const normalizedOperator = coefficient === -1 ? reverseOperator(operator) : operator;
  const bound = coefficient === -1 ? -literal : literal;
  if (!Number.isFinite(bound)) return null;
  switch (normalizedOperator) {
    case ">":
    case ">=":
      return {
        bound: { inclusive: normalizedOperator === ">=", value: bound },
        kind: "number",
        relation: "lower",
        requiresBigInt: false,
        requiresIntegral: false,
        term: affine.term,
        wasNegated,
      };
    case "<":
    case "<=":
      return {
        bound: { inclusive: normalizedOperator === "<=", value: bound },
        kind: "number",
        relation: "upper",
        requiresBigInt: false,
        requiresIntegral: false,
        term: affine.term,
        wasNegated,
      };
    case "===":
      return {
        bound: { inclusive: true, value: bound },
        kind: "number",
        relation: "equal",
        requiresBigInt: false,
        requiresIntegral: false,
        term: affine.term,
        wasNegated,
      };
    default:
      return null;
  }
}

function integerNumberComparison(
  term: Term,
  inputCoefficient: number,
  offset: number,
  literal: number,
  operator: string,
  wasNegated: boolean,
): Comparison | null {
  if (
    inputCoefficient === 0 ||
    !Number.isSafeInteger(inputCoefficient) ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(literal)
  ) {
    return null;
  }
  let coefficient = inputCoefficient;
  let difference = literal - offset;
  let normalizedOperator = operator;
  if (!Number.isSafeInteger(difference)) return null;
  if (coefficient < 0) {
    coefficient = -coefficient;
    difference = -difference;
    normalizedOperator = reverseOperator(normalizedOperator);
  }

  let relation: Comparison["relation"];
  let value: number;
  switch (normalizedOperator) {
    case ">":
      relation = "lower";
      value = Math.floor(difference / coefficient) + 1;
      break;
    case ">=":
      relation = "lower";
      value = Math.ceil(difference / coefficient);
      break;
    case "<":
      relation = "upper";
      value = Math.ceil(difference / coefficient) - 1;
      break;
    case "<=":
      relation = "upper";
      value = Math.floor(difference / coefficient);
      break;
    case "===":
      if (difference % coefficient !== 0) return null;
      relation = "equal";
      value = difference / coefficient;
      break;
    default:
      return null;
  }
  if (!Number.isSafeInteger(value)) return null;
  return {
    bound: { inclusive: true, value },
    kind: "number",
    relation,
    requiresBigInt: false,
    requiresIntegral: true,
    term,
    wasNegated,
  };
}

function parseComparison(expression: NormalizedExpression): Comparison | null {
  let atom = expression;
  let wasNegated = false;
  if (atom.kind === "unary" && atom.operator === "!") {
    atom = atom.operand;
    wasNegated = true;
  }
  if (atom.kind !== "binary") return null;

  let operator = wasNegated ? negateOperator(atom.operator) : atom.operator;
  if (operator === null || !["<", "<=", ">", ">=", "==="].includes(operator)) return null;

  let literal = scalarLiteral(atom.right);
  let affineExpression = atom.left;
  if (literal === null) {
    literal = scalarLiteral(atom.left);
    if (literal === null) return null;
    affineExpression = atom.right;
    operator = reverseOperator(operator);
  }
  const kind: ScalarKind = typeof literal === "bigint" ? "bigint" : "number";
  const affine = parseAffine(affineExpression, kind);
  if (affine === null) return null;
  return kind === "bigint"
    ? bigintComparison(affine, BigInt(literal), operator, wasNegated)
    : numberComparison(affine, Number(literal), operator, wasNegated);
}

function typeFact(expression: NormalizedExpression): TypeFact | null {
  if (
    expression.kind !== "call" ||
    expression.optional ||
    expression.arguments.length !== 1 ||
    expression.callee.kind !== "member" ||
    expression.callee.computed ||
    expression.callee.optional ||
    expression.callee.object.kind !== "free" ||
    expression.callee.object.name !== "Number" ||
    typeof expression.callee.property !== "string"
  ) {
    return null;
  }
  const argument = expression.arguments[0];
  if (argument === undefined) return null;
  const term = termOf(argument);
  if (term === null) return null;
  if (expression.callee.property === "isInteger") return { kind: "integral", term };
  if (expression.callee.property === "isFinite") return { kind: "finite", term };
  return null;
}

function hasLengthTypeEvidence(expression: NormalizedExpression): boolean {
  if (
    expression.kind === "call" &&
    !expression.optional &&
    expression.arguments.length === 1 &&
    expression.arguments[0]?.kind === "subject" &&
    expression.callee.kind === "member" &&
    !expression.callee.computed &&
    !expression.callee.optional &&
    expression.callee.object.kind === "free" &&
    expression.callee.object.name === "Array" &&
    expression.callee.property === "isArray"
  ) {
    return true;
  }
  if (expression.kind !== "binary" || expression.operator !== "===") return false;
  const pairs = [
    [expression.left, expression.right],
    [expression.right, expression.left],
  ] as const;
  return pairs.some(
    ([left, right]) =>
      left.kind === "unary" &&
      left.operator === "typeof" &&
      left.operand.kind === "subject" &&
      right.kind === "literal" &&
      right.value === "string",
  );
}

function absolute(value: Scalar): Scalar {
  return value < 0 ? -value : value;
}

function modulo(value: Scalar, modulus: Scalar): Scalar | null {
  if (typeof value === "bigint" && typeof modulus === "bigint") {
    return ((value % modulus) + modulus) % modulus;
  }
  if (typeof value === "number" && typeof modulus === "number") {
    return ((value % modulus) + modulus) % modulus;
  }
  return null;
}

function parseCongruence(expression: NormalizedExpression): CongruenceFact | null {
  if (expression.kind !== "binary" || expression.operator !== "===") return null;
  let remainderExpression = expression.left;
  let remainder = scalarLiteral(expression.right);
  if (remainder === null) {
    remainderExpression = expression.right;
    remainder = scalarLiteral(expression.left);
  }
  if (
    remainder === null ||
    remainderExpression.kind !== "binary" ||
    remainderExpression.operator !== "%"
  ) {
    return null;
  }
  const modulus = scalarLiteral(remainderExpression.right);
  if (modulus === null || typeof modulus !== typeof remainder) return null;
  const kind: ScalarKind = typeof modulus === "bigint" ? "bigint" : "number";
  if (kind === "number") {
    if (
      !Number.isSafeInteger(modulus) ||
      !Number.isSafeInteger(remainder) ||
      Object.is(modulus, -0) ||
      modulus === 0
    ) {
      return null;
    }
  } else if (modulus === 0n) {
    return null;
  }
  const positiveModulus = absolute(modulus);
  if (absolute(remainder) >= positiveModulus) return null;
  const term = termOf(remainderExpression.left);
  if (term === null || (kind === "bigint" && term.key === lengthTerm.key)) return null;
  return {
    kind,
    modulus: positiveModulus,
    remainder,
    term,
  };
}

function flattenConjunction(expression: NormalizedExpression): readonly NormalizedExpression[] {
  if (expression.kind === "binary" && expression.operator === "&&") {
    return [...flattenConjunction(expression.left), ...flattenConjunction(expression.right)];
  }
  return [expression];
}

function domainKey(term: Term, kind: ScalarKind): string {
  return `${kind}:${term.key}`;
}

function createDomain(kind: ScalarKind): Domain {
  return {
    bigintTyped: false,
    congruences: [],
    finite: false,
    integral: kind === "bigint",
    lower: null,
    upper: null,
  };
}

function compareScalars(left: Scalar, right: Scalar): number | null {
  if (typeof left !== typeof right) return null;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function strongerLower(current: Bound | null, next: Bound): Bound {
  if (current === null) return next;
  const order = compareScalars(current.value, next.value);
  if (order === null || order < 0) return next;
  if (order > 0) return current;
  return { inclusive: current.inclusive && next.inclusive, value: current.value };
}

function strongerUpper(current: Bound | null, next: Bound): Bound {
  if (current === null) return next;
  const order = compareScalars(current.value, next.value);
  if (order === null || order > 0) return next;
  if (order < 0) return current;
  return { inclusive: current.inclusive && next.inclusive, value: current.value };
}

function lowerEntails(source: Bound | null, target: Bound): boolean {
  if (source === null) return false;
  const order = compareScalars(source.value, target.value);
  if (order === null || order < 0) return false;
  return order > 0 || target.inclusive || !source.inclusive;
}

function upperEntails(source: Bound | null, target: Bound): boolean {
  if (source === null) return false;
  const order = compareScalars(source.value, target.value);
  if (order === null || order > 0) return false;
  return order < 0 || target.inclusive || !source.inclusive;
}

function addComparison(domain: Domain, comparison: Comparison): void {
  if (comparison.relation === "lower" || comparison.relation === "equal") {
    domain.lower = strongerLower(domain.lower, comparison.bound);
  }
  if (comparison.relation === "upper" || comparison.relation === "equal") {
    domain.upper = strongerUpper(domain.upper, comparison.bound);
  }
}

function isNonnegative(domain: Domain): boolean {
  if (domain.lower === null) return false;
  const zero = typeof domain.lower.value === "bigint" ? 0n : 0;
  return (compareScalars(domain.lower.value, zero) ?? -1) >= 0;
}

function isNonpositive(domain: Domain): boolean {
  if (domain.upper === null) return false;
  const zero = typeof domain.upper.value === "bigint" ? 0n : 0;
  return (compareScalars(domain.upper.value, zero) ?? 1) <= 0;
}

function congruenceEntails(domain: Domain, target: CongruenceFact): boolean {
  for (const source of domain.congruences) {
    if (typeof source.modulus !== typeof target.modulus) continue;
    if (modulo(source.modulus, target.modulus) !== (typeof target.modulus === "bigint" ? 0n : 0)) {
      continue;
    }
    if (modulo(source.remainder, target.modulus) !== modulo(target.remainder, target.modulus)) {
      continue;
    }
    if (target.remainder === (typeof target.remainder === "bigint" ? 0n : 0)) return true;
    if (target.remainder > 0 && isNonnegative(domain)) return true;
    if (target.remainder < 0 && isNonpositive(domain)) return true;
  }
  return false;
}

/**
 * Conservatively proves implication between conjunctions of normalized predicates.
 *
 * `true` means every value satisfying all `source` predicates also satisfies every
 * `target` predicate. `false` means only that implication was not proven. This
 * decision procedure interprets normalized IR and never executes predicate JavaScript.
 */
export function entails(
  source: readonly NormalizedPredicate[],
  target: readonly NormalizedPredicate[],
): boolean {
  const sourceAtoms = source.flatMap((predicate) => flattenConjunction(predicate.expression));
  const exactAtoms = new Set(sourceAtoms.map(serializeExpression));
  const domains = new Map<string, Domain>();

  function getDomain(term: Term, kind: ScalarKind): Domain {
    const key = domainKey(term, kind);
    let domain = domains.get(key);
    if (domain === undefined) {
      domain = createDomain(kind);
      domains.set(key, domain);
    }
    return domain;
  }

  for (const atom of sourceAtoms) {
    const fact = typeFact(atom);
    if (fact === null) continue;
    const domain = getDomain(fact.term, "number");
    domain.finite = true;
    if (fact.kind === "integral") domain.integral = true;
  }

  for (const atom of sourceAtoms) {
    if (!hasLengthTypeEvidence(atom)) continue;
    const domain = getDomain(lengthTerm, "number");
    domain.finite = true;
    domain.integral = true;
    domain.lower = strongerLower(domain.lower, { inclusive: true, value: 0 });
  }

  for (const atom of sourceAtoms) {
    const comparison = parseComparison(atom);
    if (comparison === null) continue;
    const domain = getDomain(comparison.term, comparison.kind);
    if (comparison.requiresIntegral && !domain.integral) continue;
    if (comparison.wasNegated && comparison.kind === "number" && !domain.finite) continue;
    if (comparison.wasNegated && comparison.kind === "bigint" && !comparison.requiresBigInt) {
      continue;
    }
    if (
      comparison.kind === "bigint" &&
      (comparison.requiresBigInt || comparison.relation === "equal")
    ) {
      domain.bigintTyped = true;
    }
    addComparison(domain, comparison);
  }

  for (const atom of sourceAtoms) {
    const fact = parseCongruence(atom);
    if (fact === null) continue;
    const domain = getDomain(fact.term, fact.kind);
    if (fact.kind === "number" && !domain.integral) continue;
    if (fact.kind === "bigint") domain.bigintTyped = true;
    domain.congruences.push({ modulus: fact.modulus, remainder: fact.remainder });
    const zero = fact.kind === "bigint" ? 0n : 0;
    if (fact.remainder > zero) {
      domain.lower = strongerLower(domain.lower, { inclusive: false, value: zero });
    } else if (fact.remainder < zero) {
      domain.upper = strongerUpper(domain.upper, { inclusive: false, value: zero });
    }
  }

  const targetAtoms = target.flatMap((predicate) => flattenConjunction(predicate.expression));
  return targetAtoms.every((atom) => {
    if (exactAtoms.has(serializeExpression(atom))) return true;
    if (atom.kind === "literal" && atom.value === true) return true;

    const requestedType = typeFact(atom);
    if (requestedType !== null) {
      const domain = getDomain(requestedType.term, "number");
      return requestedType.kind === "integral" ? domain.integral : domain.finite;
    }

    const requestedComparison = parseComparison(atom);
    if (requestedComparison !== null) {
      const domain = getDomain(requestedComparison.term, requestedComparison.kind);
      if (requestedComparison.requiresIntegral && !domain.integral) return false;
      if (requestedComparison.requiresBigInt && !domain.bigintTyped) return false;
      if (
        requestedComparison.wasNegated &&
        requestedComparison.kind === "number" &&
        !domain.finite &&
        domain.lower === null &&
        domain.upper === null
      ) {
        return false;
      }
      if (requestedComparison.relation === "lower") {
        return lowerEntails(domain.lower, requestedComparison.bound);
      }
      if (requestedComparison.relation === "upper") {
        return upperEntails(domain.upper, requestedComparison.bound);
      }
      return false;
    }

    const requestedCongruence = parseCongruence(atom);
    if (requestedCongruence !== null) {
      const domain = getDomain(requestedCongruence.term, requestedCongruence.kind);
      return (
        (requestedCongruence.kind === "bigint" || domain.integral) &&
        congruenceEntails(domain, requestedCongruence)
      );
    }

    return false;
  });
}
