import ts from "typescript";

import type { ProgramState } from "./program.ts";

const refinementAssertionPattern = /\bas\s+|<\s*[A-Za-z_$][\w$]*/u;
const definitelyUnrefinedKinds = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AnyKeyword,
  ts.SyntaxKind.BigIntKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.LiteralType,
  ts.SyntaxKind.NeverKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.ObjectKeyword,
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.SymbolKeyword,
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.UnknownKeyword,
  ts.SyntaxKind.VoidKeyword,
]);

function isDefinitelyUnrefinedType(node: ts.TypeNode): boolean {
  if (definitelyUnrefinedKinds.has(node.kind)) return true;
  if (ts.isTypeReferenceNode(node)) return node.typeName.getText() === "const";
  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) {
    return isDefinitelyUnrefinedType(node.type);
  }
  if (ts.isArrayTypeNode(node)) return isDefinitelyUnrefinedType(node.elementType);
  if (ts.isTupleTypeNode(node)) {
    return node.elements.every((element) => {
      if (ts.isNamedTupleMember(element)) return isDefinitelyUnrefinedType(element.type);
      if (ts.isOptionalTypeNode(element) || ts.isRestTypeNode(element)) {
        return isDefinitelyUnrefinedType(element.type);
      }
      return isDefinitelyUnrefinedType(element);
    });
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    return node.types.every(isDefinitelyUnrefinedType);
  }
  return false;
}

function canContainRefinementAssertion(source: string, fileName: string): boolean {
  if (!refinementAssertionPattern.test(source)) return false;
  const scriptKind = /x$/u.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      !isDefinitelyUnrefinedType(node.type)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

export type TransformCandidate =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "skip" }
  | { readonly kind: "transform"; readonly sourceFile: ts.SourceFile };

export function transformCandidate(
  state: ProgramState,
  fileName: string,
  source: string,
): TransformCandidate {
  const sourceFile = state.program.getSourceFile(fileName);
  if (sourceFile !== undefined && !state.mayContainRefinement(fileName)) {
    return { kind: "skip" };
  }
  if (sourceFile === undefined) {
    if (!canContainRefinementAssertion(source, fileName)) return { kind: "skip" };
    return {
      kind: "error",
      message: `TypeScript module '${fileName}' is not included in the program configured by '${state.configPath}'.`,
    };
  }
  if (sourceFile.text !== source) {
    return {
      kind: "error",
      message: `TypeScript module '${fileName}' was changed before ts-refinement ran. Configure ts-refinement as the first source transform.`,
    };
  }
  if (!canContainRefinementAssertion(source, fileName)) return { kind: "skip" };
  return { kind: "transform", sourceFile };
}
