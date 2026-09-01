import { describe, expect, it } from "vitest";

import {
  analyzeSourceFile,
  getRefinementDefinitionDiagnostics,
} from "ts-refinement-types/analyzer";

import { fixtureFile, fixtureProgram } from "./helpers.ts";

describe("TypeScript refinement analysis", () => {
  it("diagnoses invalid predicates at their declarations", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("types.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = getRefinementDefinitionDiagnostics(state.context, source);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1000, 1002]);
    expect(diagnostics.every((diagnostic) => diagnostic.length > 1)).toBe(true);
  });

  it("resolves aliases, composition, and proof states", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("valid.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(analyzeSourceFile(state.context, source)[0]).toBe(results[0]);
    expect(results.map((result) => result.proof.kind)).toEqual([
      "true",
      "true",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(results[1]?.site.definition?.predicates.map((predicate) => predicate.source)).toEqual([
      "Number.isInteger(n)",
      "n % 2 === 0",
    ]);
    expect(results.every((result) => result.diagnostics.length === 0)).toBe(true);
  });

  it("reports static failures and unsafe base conversions", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("invalid.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = analyzeSourceFile(state.context, source).flatMap(
      (result) => result.diagnostics,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      1200, 1200, 1101, 1101, 1101,
    ]);
    expect(diagnostics[0]?.message).toContain("Value '-5'");
    expect(diagnostics[1]?.message).toContain("n % 2 === 0");
  });

  it("reports predicate errors at assertion sites", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("predicate-errors.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = analyzeSourceFile(state.context, source).flatMap(
      (result) => result.diagnostics,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1002, 1000]);
  });

  it("rejects a generic predicate that cannot be materialized", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("generic.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = analyzeSourceFile(state.context, source).flatMap(
      (result) => result.diagnostics,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1001]);
  });

  it("evaluates arithmetic through nested refinement assertions", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("nested-static.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results.map((result) => result.proof.kind)).toEqual(["false", "true"]);
    expect(
      results.flatMap((result) => result.diagnostics).map((diagnostic) => diagnostic.code),
    ).toEqual([1200]);
  });
});
