import { describe, expect, it } from "vitest";

import { analyzeSourceFile, getRefinementDefinitionDiagnostics } from "@ts-refinement/analyzer";

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

  it("analyzes angle-bracket and as refinement assertions equivalently", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("angle-bracket.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results).toHaveLength(4);
    const [asKnown, angleKnown, asRuntime, angleRuntime] = results;
    if (
      asKnown === undefined ||
      angleKnown === undefined ||
      asRuntime === undefined ||
      angleRuntime === undefined
    ) {
      throw new Error("expected four refinement assertions");
    }
    expect(results.map((result) => result.proof.kind)).toEqual([
      "true",
      "true",
      "unknown",
      "unknown",
    ]);
    expect(state.context.ts.isAsExpression(asKnown.site.node)).toBe(true);
    expect(state.context.ts.isTypeAssertionExpression(angleKnown.site.node)).toBe(true);
    expect(state.context.ts.isAsExpression(asRuntime.site.node)).toBe(true);
    expect(state.context.ts.isTypeAssertionExpression(angleRuntime.site.node)).toBe(true);
    expect(results.every((result) => result.diagnostics.length === 0)).toBe(true);
    expect(asKnown.site.definition?.predicates).toEqual(angleKnown.site.definition?.predicates);
    expect(asRuntime.site.definition?.predicates).toEqual(angleRuntime.site.definition?.predicates);
  });

  it("diagnoses disproven angle-bracket and as assertions equivalently", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("angle-bracket-invalid.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.proof.kind)).toEqual(["false", "false"]);
    expect(results.map((result) => result.diagnostics[0]?.code)).toEqual([1200, 1200]);
    expect(results[0]?.diagnostics[0]?.message).toBe(results[1]?.diagnostics[0]?.message);
  });

  it("proves assertions from stable branch guards", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("branch-guards.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results.map((result) => result.proof.kind)).toEqual([
      "true",
      "true",
      "true",
      "true",
      "true",
      "true",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "true",
      "true",
    ]);
    expect(results.every((result) => result.diagnostics.length === 0)).toBe(true);
  });

  it("proves refinement re-assertions from source type metadata", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("reassertions.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results.map((result) => result.proof.kind)).toEqual([
      "true",
      "true",
      "true",
      "true",
      "unknown",
      "unknown",
    ]);
    expect(results.every((result) => result.diagnostics.length === 0)).toBe(true);
  });

  it("folds literal captures in their refinement declaration modules", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("capture-runtime.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results).toHaveLength(11);
    expect(results.every((result) => result.diagnostics.length === 0)).toBe(true);
    const predicates = results.map((result) => result.site.definition?.predicates[0]);
    expect(predicates.every((predicate) => predicate !== undefined)).toBe(true);
    expect(predicates[0]?.key).not.toBe(predicates[1]?.key);
    expect(predicates[2]?.key).toBe(predicates[3]?.key);
    expect(predicates.map((predicate) => predicate?.expression)).toMatchObject([
      { right: { kind: "literal", value: 2 } },
      { right: { kind: "literal", value: 5 } },
      { right: { kind: "literal", value: 18 } },
      { right: { kind: "literal", value: 18 } },
      { right: { kind: "literal", value: -3 } },
      { right: { kind: "literal", value: 'line\n"quote' } },
      { right: { kind: "literal", value: true } },
      { right: { kind: "literal", value: 42n } },
      { right: { kind: "literal", value: 7 } },
      { right: { kind: "literal", value: 2 } },
      { right: { kind: "literal", value: 2 } },
    ]);
    expect(results[10]?.site.definition?.predicates).toMatchObject([
      { expression: { right: { kind: "literal", value: 2 } } },
      { expression: { right: { kind: "literal", value: 5 } } },
    ]);
  });

  it("reports invalid captures at their predicate declarations", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("capture-invalid.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = getRefinementDefinitionDiagnostics(state.context, source);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      1003, 1003, 1003, 1003, 1003, 1003, 1003, 1003, 1003, 1002,
    ]);
    expect(diagnostics.slice(0, 9).map((diagnostic) => diagnostic.message)).toEqual(
      [
        "MUTABLE",
        "FUNCTION",
        "OBJECT",
        "ARRAY",
        "BROAD",
        "IMPORTED_BROAD",
        "MISSING_CAPTURE",
        "ASSERTED",
        "AMBIENT",
      ].map(
        (name) =>
          `RF1003: Predicate capture '${name}' must resolve to an immutable primitive literal.`,
      ),
    );
    for (const diagnostic of diagnostics) {
      expect(source.text.slice(diagnostic.start, diagnostic.start + diagnostic.length)).toMatch(
        /^".*"$/u,
      );
    }
  });
});
