import type * as ts from "typescript";

import { disallowedGlobals, standardGlobals } from "./globals.ts";

interface Scope {
  readonly names: Set<string>;
  readonly parent: Scope | null;
}

export interface FreeIdentifierAnalysis {
  readonly disallowedNames: readonly string[];
  readonly freeReferences: ReadonlyMap<string, readonly ts.Identifier[]>;
  readonly unresolvedNames: readonly string[];
}

function addBinding(tsModule: typeof ts, name: ts.BindingName, names: Set<string>): void {
  if (tsModule.isIdentifier(name)) {
    names.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (tsModule.isBindingElement(element)) {
      addBinding(tsModule, element.name, names);
    }
  }
}

function isBound(scope: Scope, name: string): boolean {
  let current: Scope | null = scope;
  while (current !== null) {
    if (current.names.has(name)) return true;
    current = current.parent;
  }
  return false;
}

function isNonReferenceIdentifier(tsModule: typeof ts, node: ts.Identifier): boolean {
  const parent = node.parent;

  if (tsModule.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (tsModule.isPropertyAssignment(parent) && parent.name === node) return true;
  if (tsModule.isMethodDeclaration(parent) && parent.name === node) return true;
  if (tsModule.isPropertyDeclaration(parent) && parent.name === node) return true;
  if (tsModule.isGetAccessorDeclaration(parent) && parent.name === node) return true;
  if (tsModule.isSetAccessorDeclaration(parent) && parent.name === node) return true;
  if (tsModule.isBindingElement(parent) && parent.propertyName === node) return true;
  if (tsModule.isLabeledStatement(parent) && parent.label === node) return true;
  if (tsModule.isBreakOrContinueStatement(parent) && parent.label === node) return true;
  if (tsModule.isVariableDeclaration(parent) && parent.name === node) return true;
  if (tsModule.isParameter(parent) && parent.name === node) return true;
  if (tsModule.isFunctionExpression(parent) && parent.name === node) return true;
  if (tsModule.isFunctionDeclaration(parent) && parent.name === node) return true;
  if (tsModule.isClassExpression(parent) && parent.name === node) return true;
  if (tsModule.isClassDeclaration(parent) && parent.name === node) return true;

  return false;
}

function collectBlockBindings(tsModule: typeof ts, block: ts.Block, names: Set<string>): void {
  for (const statement of block.statements) {
    if (tsModule.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addBinding(tsModule, declaration.name, names);
      }
    } else if (
      (tsModule.isFunctionDeclaration(statement) || tsModule.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    }
  }
}

export function analyzeFreeIdentifiers(
  tsModule: typeof ts,
  expression: ts.Expression,
): FreeIdentifierAnalysis {
  const freeReferences = new Map<string, ts.Identifier[]>();
  const rootScope: Scope = { names: new Set(), parent: null };

  function visitFunction(node: ts.SignatureDeclaration, parentScope: Scope): void {
    const names = new Set<string>();
    if (node.name !== undefined && tsModule.isIdentifier(node.name)) {
      names.add(node.name.text);
    }
    for (const parameter of node.parameters) addBinding(tsModule, parameter.name, names);

    const scope: Scope = { names, parent: parentScope };
    for (const parameter of node.parameters) {
      if (parameter.initializer !== undefined) visit(parameter.initializer, scope);
    }

    if ("body" in node && node.body !== undefined) visit(node.body, scope);
  }

  function visit(node: ts.Node, scope: Scope): void {
    if (tsModule.isFunctionLike(node)) {
      visitFunction(node, scope);
      return;
    }

    if (tsModule.isBlock(node)) {
      const names = new Set<string>();
      collectBlockBindings(tsModule, node, names);
      const blockScope: Scope = { names, parent: scope };
      for (const statement of node.statements) visit(statement, blockScope);
      return;
    }

    if (tsModule.isCatchClause(node)) {
      const names = new Set<string>();
      if (node.variableDeclaration !== undefined) {
        addBinding(tsModule, node.variableDeclaration.name, names);
      }
      visit(node.block, { names, parent: scope });
      return;
    }

    if (tsModule.isVariableDeclaration(node)) {
      addBinding(tsModule, node.name, scope.names);
      if (node.initializer !== undefined) visit(node.initializer, scope);
      return;
    }

    if (tsModule.isIdentifier(node) && !isNonReferenceIdentifier(tsModule, node)) {
      if (!isBound(scope, node.text)) {
        const references = freeReferences.get(node.text) ?? [];
        references.push(node);
        freeReferences.set(node.text, references);
      }
      return;
    }

    tsModule.forEachChild(node, (child) => visit(child, scope));
  }

  visit(expression, rootScope);

  return {
    disallowedNames: [
      ...[...freeReferences.keys()].filter((name) => disallowedGlobals.has(name)),
      ...(freeReferences
        .get("Math")
        ?.some(
          (reference) =>
            tsModule.isPropertyAccessExpression(reference.parent) &&
            reference.parent.expression === reference &&
            reference.parent.name.text === "random",
        )
        ? ["Math.random"]
        : []),
    ].sort(),
    freeReferences,
    unresolvedNames: [...freeReferences.keys()]
      .filter((name) => !standardGlobals.has(name) && !disallowedGlobals.has(name))
      .sort(),
  };
}
