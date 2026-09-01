import { describe, expect, it } from "vitest";
import ts from "typescript";

import { transformSource } from "../packages/rolldown-plugin/src/transform.ts";
import { createValidatorRegistry } from "../packages/rolldown-plugin/src/validators.ts";

import { fixtureFile, fixtureProgram } from "./helpers.ts";

describe("source transform", () => {
  it("erases proofs, inserts runtime checks, and deduplicates normalized validators", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("valid.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "ts-refinement-types/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.diagnostics).toEqual([]);
    expect(output.map).not.toBeNull();
    expect(output.code).toContain("export const knownGood = 5;");
    expect(output.code).toContain("export const knownEven = 4;");
    expect(output.code?.match(/refinement-types:validator:/gu)).toHaveLength(2);

    const positiveCalls = [
      ...(output.code?.matchAll(/(__rf_[a-z0-9_]+)\(\(dynamic\), "Positive(?:ByValue)?"\)/gu) ??
        []),
    ];
    expect(positiveCalls).toHaveLength(2);
    expect(new Set(positiveCalls.map((match) => match[1])).size).toBe(1);
  });

  it("returns build-stopping diagnostics without changing the module", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("build-invalid.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "ts-refinement-types/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.code).toBeNull();
    expect(output.diagnostics[0]?.code).toBe(1200);
  });

  it("stops on malformed predicate declarations before they are consumed", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("types.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "ts-refinement-types/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.code).toBeNull();
    expect(output.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1000, 1002]);
  });

  it("keeps module directives ahead of generated imports", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("directives.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "ts-refinement-types/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.diagnostics).toEqual([]);
    expect(output.code?.indexOf('"use client"')).toBeLessThan(
      output.code?.indexOf("refinement-types:validator:") ?? -1,
    );
  });
});
