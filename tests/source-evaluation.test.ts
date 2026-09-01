import { describe, expect, it } from "vitest";

import { evaluateSourceExpression } from "@ts-refinement/analyzer";

import { fixtureFile, fixtureProgram } from "./helpers.ts";

describe("source expression evaluation", () => {
  it("extracts only values established by syntax or literal types", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("source-values.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");

    const values = new Map(
      sourceFile.statements.flatMap((statement) => {
        if (!state.context.ts.isVariableStatement(statement)) return [];
        return statement.declarationList.declarations.flatMap((declaration) => {
          if (
            !state.context.ts.isIdentifier(declaration.name) ||
            declaration.initializer === undefined
          ) {
            return [];
          }
          return [
            [
              declaration.name.text,
              evaluateSourceExpression(
                state.context.ts,
                state.context.checker,
                declaration.initializer,
              ),
            ] as const,
          ];
        });
      }),
    );

    expect(values.get("numberLiteral")).toEqual({ known: true, value: 5 });
    expect(values.get("negativeLiteral")).toEqual({ known: true, value: -5 });
    expect(values.get("stringLiteral")).toEqual({ known: true, value: "value" });
    expect(values.get("trueLiteral")).toEqual({ known: true, value: true });
    expect(values.get("falseLiteral")).toEqual({ known: true, value: false });
    expect(values.get("nullLiteral")).toEqual({ known: true, value: null });
    expect(values.get("unaryLiteral")).toEqual({ known: true, value: true });
    expect(values.get("arithmetic")).toEqual({ known: true, value: 5 });
    expect(values.get("conditional")).toEqual({ known: true, value: 1 });
    expect(values.get("arrayLiteral")).toEqual({ known: true, value: [1, -2] });
    expect(values.get("asserted")).toEqual({ known: true, value: 3 });
    expect(values.get("satisfied")).toEqual({ known: true, value: 4 });
    expect(values.get("fromLiteralType")).toEqual({ known: true, value: 6 });
    expect(values.get("fromWidenedType")).toEqual({ known: false });
    expect(values.get("spreadArray")).toEqual({ known: false });
  });
});
