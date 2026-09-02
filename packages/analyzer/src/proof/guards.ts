import type * as ts from "typescript";

import { normalizePredicate } from "../predicate/normalize.ts";
import { parsePredicate } from "../predicate/parse.ts";
import type { NormalizedPredicate } from "../predicate/ir.ts";
import type { AnalyzerContext } from "../refinement/resolve.ts";

interface GuardSource {
  readonly condition: ts.Expression;
  readonly negated: boolean;
  readonly region: ts.Node;
}

function enclosingGuardSources(
  context: AnalyzerContext,
  assertion: ts.AsExpression | ts.TypeAssertion,
): readonly GuardSource[] {
  const sources: GuardSource[] = [];
  let current: ts.Node = assertion;

  for (let parent = current.parent; parent !== undefined; parent = parent.parent) {
    if (
      context.ts.isFunctionLike(parent) ||
      context.ts.isPropertyDeclaration(parent) ||
      context.ts.isClassStaticBlockDeclaration(parent) ||
      context.ts.isClassLike(parent)
    ) {
      break;
    }
    if (context.ts.isIfStatement(parent)) {
      if (parent.thenStatement === current) {
        sources.push({ condition: parent.expression, negated: false, region: current });
      } else if (parent.elseStatement === current) {
        sources.push({ condition: parent.expression, negated: true, region: current });
      }
    } else if (context.ts.isConditionalExpression(parent)) {
      if (parent.whenTrue === current) {
        sources.push({ condition: parent.condition, negated: false, region: current });
      } else if (parent.whenFalse === current) {
        sources.push({ condition: parent.condition, negated: true, region: current });
      }
    } else if (
      context.ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === context.ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === current
    ) {
      sources.push({ condition: parent.left, negated: false, region: current });
    }
    current = parent;
  }

  return sources;
}

function containsSymbol(context: AnalyzerContext, node: ts.Node, subject: ts.Symbol): boolean {
  let found = false;
  function visit(child: ts.Node): void {
    if (found) return;
    if (context.ts.isIdentifier(child) && context.checker.getSymbolAtLocation(child) === subject) {
      found = true;
      return;
    }
    context.ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}

function isWriteToSubject(context: AnalyzerContext, node: ts.Node, subject: ts.Symbol): boolean {
  if (
    context.ts.isVariableDeclaration(node) &&
    node.initializer !== undefined &&
    containsSymbol(context, node.name, subject)
  ) {
    return true;
  }

  if (context.ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (
      operator >= context.ts.SyntaxKind.FirstAssignment &&
      operator <= context.ts.SyntaxKind.LastAssignment
    ) {
      return containsSymbol(context, node.left, subject);
    }
  }

  if (
    (context.ts.isPrefixUnaryExpression(node) || context.ts.isPostfixUnaryExpression(node)) &&
    (node.operator === context.ts.SyntaxKind.PlusPlusToken ||
      node.operator === context.ts.SyntaxKind.MinusMinusToken)
  ) {
    return containsSymbol(context, node.operand, subject);
  }

  if (context.ts.isDeleteExpression(node)) {
    return containsSymbol(context, node.expression, subject);
  }

  if (context.ts.isForInStatement(node) || context.ts.isForOfStatement(node)) {
    return containsSymbol(context, node.initializer, subject);
  }

  return false;
}

function isIterationStatement(context: AnalyzerContext, node: ts.Node): boolean {
  return (
    context.ts.isDoStatement(node) ||
    context.ts.isForInStatement(node) ||
    context.ts.isForOfStatement(node) ||
    context.ts.isForStatement(node) ||
    context.ts.isWhileStatement(node)
  );
}

function crossesLoopBoundary(
  context: AnalyzerContext,
  source: GuardSource,
  assertion: ts.AsExpression | ts.TypeAssertion,
): boolean {
  for (
    let current: ts.Node | undefined = assertion;
    current !== undefined;
    current = current.parent
  ) {
    if (isIterationStatement(context, current)) return true;
    if (current === source.region) return false;
  }
  return true;
}

function hasUnsafeEvaluationContext(
  context: AnalyzerContext,
  source: GuardSource,
  assertion: ts.AsExpression | ts.TypeAssertion,
): boolean {
  for (
    let current: ts.Node | undefined = assertion.parent;
    current !== undefined;
    current = current.parent
  ) {
    if (
      context.ts.isArrayBindingPattern(current) ||
      context.ts.isArrayLiteralExpression(current) ||
      context.ts.isBindingElement(current) ||
      context.ts.isObjectBindingPattern(current) ||
      context.ts.isObjectLiteralExpression(current) ||
      context.ts.isTemplateExpression(current)
    ) {
      return true;
    }
    if (current === source.region) return false;
  }
  return true;
}

function isDefinitelyPrimitive(context: AnalyzerContext, expression: ts.Expression): boolean {
  const type = context.checker.getTypeAtLocation(expression);
  if (type.isUnion()) {
    return type.types.every((constituent) => isDefinitelyPrimitiveType(context, constituent));
  }
  return isDefinitelyPrimitiveType(context, type);
}

function isDefinitelyPrimitiveType(context: AnalyzerContext, type: ts.Type): boolean {
  if (type.isUnion()) {
    return type.types.every((constituent) => isDefinitelyPrimitiveType(context, constituent));
  }
  if (type.isIntersection()) {
    return type.types.some((constituent) => isDefinitelyPrimitiveType(context, constituent));
  }
  const primitive =
    context.ts.TypeFlags.BigIntLike |
    context.ts.TypeFlags.BooleanLike |
    context.ts.TypeFlags.ESSymbolLike |
    context.ts.TypeFlags.Never |
    context.ts.TypeFlags.Null |
    context.ts.TypeFlags.NumberLike |
    context.ts.TypeFlags.StringLike |
    context.ts.TypeFlags.Undefined;
  return (type.flags & primitive) !== 0;
}

function isPureLiteral(context: AnalyzerContext, expression: ts.Expression): boolean {
  return (
    context.ts.isIdentifier(expression) ||
    context.ts.isLiteralExpression(expression) ||
    context.ts.isBigIntLiteral(expression) ||
    [
      context.ts.SyntaxKind.TrueKeyword,
      context.ts.SyntaxKind.FalseKeyword,
      context.ts.SyntaxKind.NullKeyword,
    ].includes(expression.kind)
  );
}

function transparentOperand(
  context: AnalyzerContext,
  expression: ts.Expression,
): ts.Expression | null {
  if (context.ts.isParenthesizedExpression(expression)) return expression.expression;
  if (context.ts.isAsExpression(expression)) return expression.expression;
  if (context.ts.isTypeAssertionExpression(expression)) return expression.expression;
  if (context.ts.isNonNullExpression(expression)) return expression.expression;
  if (context.ts.isSatisfiesExpression(expression)) return expression.expression;
  return null;
}

function isDefinitelyPureBinary(
  context: AnalyzerContext,
  expression: ts.BinaryExpression,
): boolean {
  if (
    !isDefinitelyPureExpression(context, expression.left) ||
    !isDefinitelyPureExpression(context, expression.right)
  ) {
    return false;
  }
  const operator = expression.operatorToken.kind;
  const safeWithoutCoercion = [
    context.ts.SyntaxKind.AmpersandAmpersandToken,
    context.ts.SyntaxKind.BarBarToken,
    context.ts.SyntaxKind.EqualsEqualsEqualsToken,
    context.ts.SyntaxKind.ExclamationEqualsEqualsToken,
    context.ts.SyntaxKind.QuestionQuestionToken,
  ];
  if (safeWithoutCoercion.includes(operator)) return true;
  if (
    operator >= context.ts.SyntaxKind.FirstAssignment &&
    operator <= context.ts.SyntaxKind.LastAssignment
  ) {
    return false;
  }
  const canInvokeUserCode = [
    context.ts.SyntaxKind.InKeyword,
    context.ts.SyntaxKind.InstanceOfKeyword,
    context.ts.SyntaxKind.EqualsEqualsToken,
    context.ts.SyntaxKind.ExclamationEqualsToken,
  ];
  return (
    !canInvokeUserCode.includes(operator) &&
    isDefinitelyPrimitive(context, expression.left) &&
    isDefinitelyPrimitive(context, expression.right)
  );
}

function isDefinitelyPureExpression(context: AnalyzerContext, expression: ts.Expression): boolean {
  if (isPureLiteral(context, expression)) return true;
  const operand = transparentOperand(context, expression);
  if (operand !== null) return isDefinitelyPureExpression(context, operand);
  if (context.ts.isTypeOfExpression(expression) || context.ts.isVoidExpression(expression)) {
    return isDefinitelyPureExpression(context, expression.expression);
  }
  if (context.ts.isPrefixUnaryExpression(expression)) {
    return (
      expression.operator === context.ts.SyntaxKind.ExclamationToken &&
      isDefinitelyPureExpression(context, expression.operand)
    );
  }
  if (context.ts.isBinaryExpression(expression)) {
    return isDefinitelyPureBinary(context, expression);
  }
  if (context.ts.isConditionalExpression(expression)) {
    return (
      isDefinitelyPureExpression(context, expression.condition) &&
      isDefinitelyPureExpression(context, expression.whenTrue) &&
      isDefinitelyPureExpression(context, expression.whenFalse)
    );
  }
  return context.ts.isArrowFunction(expression) || context.ts.isFunctionExpression(expression);
}

function hasImplicitEffect(context: AnalyzerContext, node: ts.Node): boolean {
  if (context.ts.isClassLike(node)) return true;
  if (context.ts.isSpreadElement(node) || context.ts.isSpreadAssignment(node)) return true;
  if (
    context.ts.isVariableDeclaration(node) &&
    node.initializer !== undefined &&
    !context.ts.isIdentifier(node.name)
  ) {
    return true;
  }
  return context.ts.isExpression(node) && !isDefinitelyPureExpression(context, node);
}

function hasInterveningWrite(
  context: AnalyzerContext,
  source: GuardSource,
  assertion: ts.AsExpression | ts.TypeAssertion,
  subject: ts.Symbol,
): boolean {
  if (
    crossesLoopBoundary(context, source, assertion) ||
    hasUnsafeEvaluationContext(context, source, assertion)
  ) {
    return true;
  }
  const assertionStart = assertion.getStart();
  let found = false;

  function visit(node: ts.Node): void {
    if (found || node.getStart() >= assertionStart) return;
    if (node !== source.region && context.ts.isFunctionLike(node)) return;
    if (
      node.getEnd() <= assertionStart &&
      (hasImplicitEffect(context, node) || isWriteToSubject(context, node, subject))
    ) {
      found = true;
      return;
    }
    context.ts.forEachChild(node, visit);
  }
  visit(source.region);
  return found;
}

function normalizeGuard(
  context: AnalyzerContext,
  source: GuardSource,
  subject: ts.Symbol,
): NormalizedPredicate | null {
  const sourceFile = source.condition.getSourceFile();
  const expressionStart = source.condition.getStart(sourceFile);
  const expressionText = source.condition.getText(sourceFile);
  const references: ts.Identifier[] = [];
  let supported = true;

  function visit(node: ts.Node): void {
    if (!supported) return;
    if (
      context.ts.isPropertyAccessExpression(node) ||
      context.ts.isElementAccessExpression(node) ||
      context.ts.isCallExpression(node) ||
      context.ts.isNewExpression(node)
    ) {
      supported = false;
      return;
    }
    if (context.ts.isIdentifier(node)) {
      if (context.checker.getSymbolAtLocation(node) !== subject) {
        supported = false;
        return;
      }
      references.push(node);
    }
    context.ts.forEachChild(node, visit);
  }
  visit(source.condition);
  if (!supported || references.length === 0) return null;

  let marker = "__ts_refinement_guard_subject__";
  while (expressionText.includes(marker)) marker = `_${marker}`;
  let emitted = expressionText;
  for (const reference of references.sort((left, right) => right.getStart() - left.getStart())) {
    const start = reference.getStart(sourceFile) - expressionStart;
    const end = reference.getEnd() - expressionStart;
    emitted = `${emitted.slice(0, start)}${marker}${emitted.slice(end)}`;
  }
  const predicateSource = source.negated ? `!(${emitted})` : emitted;
  const parsed = parsePredicate(context.ts, predicateSource);
  if (!parsed.ok || parsed.predicate.subject !== marker) return null;
  return normalizePredicate(context.ts, parsed.predicate);
}

export function collectGuardPredicates(
  context: AnalyzerContext,
  assertion: ts.AsExpression | ts.TypeAssertion,
): readonly NormalizedPredicate[] {
  if (!context.ts.isIdentifier(assertion.expression)) return [];
  const subject = context.checker.getSymbolAtLocation(assertion.expression);
  if (subject === undefined) return [];

  const predicates: NormalizedPredicate[] = [];
  for (const source of enclosingGuardSources(context, assertion)) {
    if (hasInterveningWrite(context, source, assertion, subject)) continue;
    const predicate = normalizeGuard(context, source, subject);
    if (predicate !== null) predicates.push(predicate);
  }
  return predicates;
}
