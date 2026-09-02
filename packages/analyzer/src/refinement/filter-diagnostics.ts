import type * as ts from "typescript";

import { entails } from "../proof/entail.ts";
import {
  resolveRefinementMetadata,
  type AnalyzerContext,
  type RefinementDefinition,
} from "./resolve.ts";

interface RefinementTransfer {
  readonly sourceExpression: ts.Expression;
  readonly targetNode: ts.Node;
}

function hasExactSpan(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  start: number,
  length: number,
): boolean {
  return node.getStart(sourceFile) === start && node.getWidth(sourceFile) === length;
}

function declarationTransfer(
  context: AnalyzerContext,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  length: number,
): RefinementTransfer | null {
  if (
    !context.ts.isVariableDeclaration(node) &&
    !context.ts.isPropertyDeclaration(node) &&
    !context.ts.isParameter(node)
  ) {
    return null;
  }
  if (node.type === undefined || node.initializer === undefined) return null;
  if (!hasExactSpan(sourceFile, node.name, start, length)) return null;
  return { sourceExpression: node.initializer, targetNode: node.type };
}

function findTransfers(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): readonly RefinementTransfer[] {
  const start = diagnostic.start;
  const length = diagnostic.length;
  if (diagnostic.file !== sourceFile || start === undefined || length === undefined) return [];
  const diagnosticStart = start;
  const diagnosticLength = length;

  const transfers: RefinementTransfer[] = [];
  function visit(node: ts.Node): void {
    if (diagnostic.code === 2322) {
      const declaration = declarationTransfer(
        context,
        node,
        sourceFile,
        diagnosticStart,
        diagnosticLength,
      );
      if (declaration !== null) transfers.push(declaration);

      if (
        context.ts.isBinaryExpression(node) &&
        node.operatorToken.kind === context.ts.SyntaxKind.EqualsToken &&
        hasExactSpan(sourceFile, node.right, diagnosticStart, diagnosticLength)
      ) {
        transfers.push({ sourceExpression: node.right, targetNode: node.left });
      }
    }

    if (
      diagnostic.code === 2352 &&
      (context.ts.isAsExpression(node) || context.ts.isTypeAssertionExpression(node)) &&
      hasExactSpan(sourceFile, node, diagnosticStart, diagnosticLength)
    ) {
      transfers.push({ sourceExpression: node.expression, targetNode: node.type });
    }
    context.ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return transfers;
}

function basesAreAssignable(
  context: AnalyzerContext,
  source: RefinementDefinition,
  target: RefinementDefinition,
): boolean {
  return target.baseTypes.every((targetBase) =>
    source.baseTypes.some((sourceBase) =>
      context.checker.isTypeAssignableTo(sourceBase, targetBase),
    ),
  );
}

function transferIsEntailed(context: AnalyzerContext, transfer: RefinementTransfer): boolean {
  const sourceType = context.checker.getTypeAtLocation(transfer.sourceExpression);
  const targetType = context.checker.getTypeAtLocation(transfer.targetNode);
  const sourceResolution = resolveRefinementMetadata(context, sourceType);
  const targetResolution = resolveRefinementMetadata(context, targetType);
  if (
    !sourceResolution.isRefinement ||
    sourceResolution.definition === null ||
    !targetResolution.isRefinement ||
    targetResolution.definition === null
  ) {
    return false;
  }

  return (
    basesAreAssignable(context, sourceResolution.definition, targetResolution.definition) &&
    entails(sourceResolution.definition.predicates, targetResolution.definition.predicates)
  );
}

/**
 * Removes only TypeScript brand incompatibility diagnostics made redundant by a
 * proven refinement implication. All retained diagnostics are returned unchanged
 * and in their original order.
 */
export function filterEntailedRefinementDiagnostics(
  context: AnalyzerContext,
  sourceFile: ts.SourceFile,
  diagnostics: readonly ts.Diagnostic[],
): readonly ts.Diagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.code !== 2322 && diagnostic.code !== 2352) return true;
    const transfers = findTransfers(context, sourceFile, diagnostic);
    if (transfers.length !== 1) return true;
    const transfer = transfers[0];
    return transfer === undefined || !transferIsEntailed(context, transfer);
  });
}
