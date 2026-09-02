import { describe, expect, it, vi } from "vitest";
import ts from "typescript";

import { transformSource } from "../packages/rolldown-plugin/src/transform.ts";
import { createValidatorRegistry } from "../packages/rolldown-plugin/src/validators.ts";

import { fixtureFile, fixtureProgram } from "./helpers.ts";

describe("source transform", () => {
  it("rejects a stale source file as an invariant violation", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("valid.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const register = vi.spyOn(registry, "register");
    const source = `// prepended by an earlier plugin\n${sourceFile.text}`;

    expect(() => transformSource(state.context, sourceFile, source, registry)).toThrowError(
      /Source text invariant failed/u,
    );
    expect(register).not.toHaveBeenCalled();
  });

  it("erases proofs, inserts runtime checks, and deduplicates normalized validators", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("valid.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.diagnostics).toEqual([]);
    expect(output.map).not.toBeNull();
    expect(output.code).toContain("export const knownGood = 5;");
    expect(output.code).toContain("export const knownEven = 4;");
    expect(output.code?.match(/refinement-types:validator:/gu)).toHaveLength(3);

    const positiveCalls = [
      ...(output.code?.matchAll(/(__rf_[a-z0-9_]+)\(\(dynamic\), "Positive(?:ByValue)?"\)/gu) ??
        []),
    ];
    expect(positiveCalls).toHaveLength(2);
    expect(new Set(positiveCalls.map((match) => match[1])).size).toBe(1);

    const allPositiveCalls = [
      ...(output.code?.matchAll(
        /(__rf_[a-z0-9_]+)\(\(dynamicValues\), "AllPositive(?:ByItem)?"\)/gu,
      ) ?? []),
    ];
    expect(allPositiveCalls).toHaveLength(2);
    expect(new Set(allPositiveCalls.map((match) => match[1])).size).toBe(1);
  });

  it("returns build-stopping diagnostics without changing the module", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("build-invalid.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.code).toBeNull();
    expect(output.diagnostics[0]?.code).toBe(1200);
  });

  it("stops on malformed predicate declarations before they are consumed", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("types.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.code).toBeNull();
    expect(output.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1000, 1002]);
  });

  it("rejects code-execution globals before registering a validator", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("unsafe-predicate.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const register = vi.spyOn(registry, "register");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.code).toBeNull();
    expect(output.diagnostics.map((diagnostic) => diagnostic.code)).toContain(1002);
    expect(register).not.toHaveBeenCalled();
    expect(output.code ?? "").not.toContain("globalThis.PWNED");
  });

  it("rejects opaque normalized syntax before registering a validator", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("opaque-predicate.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const register = vi.spyOn(registry, "register");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.code).toBeNull();
    expect(output.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1004]);
    expect(output.diagnostics[0]?.message).toContain("ObjectLiteralExpression");
    expect(register).not.toHaveBeenCalled();
  });

  it("keeps module directives ahead of generated imports", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("directives.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.diagnostics).toEqual([]);
    expect(output.code?.indexOf('"use client"')).toBeLessThan(
      output.code?.indexOf("refinement-types:validator:") ?? -1,
    );
  });

  it("transforms angle-bracket and as refinement assertions equivalently", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("angle-bracket.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.diagnostics).toEqual([]);
    expect(output.code).toContain("export const asKnownEven = 4;");
    expect(output.code).toContain("export const angleKnownEven = 4;");

    const asRuntimeCall = output.code?.match(
      /export const asRuntimeEven = (__rf_[a-z0-9_]+)\(\(dynamic\), "Even"\);/u,
    );
    const angleRuntimeCall = output.code?.match(
      /export const angleRuntimeEven = (__rf_[a-z0-9_]+)\(\(dynamic\), "Even"\);/u,
    );
    expect(asRuntimeCall?.[1]).toBeDefined();
    expect(angleRuntimeCall?.[1]).toBe(asRuntimeCall?.[1]);
  });

  it("erases stable guard proofs and retains validators after uncertain control flow", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("branch-guards.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.diagnostics).toEqual([]);
    expect(output.code).toContain("if (n > 0) return n;");
    expect(output.code?.match(/if \(n < 10\) return n;/gu)).toHaveLength(2);
    expect(output.code).toContain("return n > 0 && (n);");
    expect(output.code).toContain("return n > 0 ? (n) : null;");
    expect(output.code).toContain("else return n;");
    expect(output.code).toContain("return n !== 5 ? null : (n);");
    expect(output.code).toContain("export const staticLiteral = 5;");
    expect(output.code?.match(/refinement-types:validator:/gu)).toHaveLength(2);
    expect(output.code?.match(/__rf_[a-z0-9_]+\(\(n\), "Positive"\)/gu)).toHaveLength(16);
    expect(output.code?.match(/__rf_[a-z0-9_]+\(\(n\), "NonPositive"\)/gu)).toHaveLength(1);
  });

  it("erases entailed re-assertions without registering unused validators", () => {
    const state = fixtureProgram();
    const sourceFile = state.program.getSourceFile(fixtureFile("reassertions.ts"));
    if (sourceFile === undefined) throw new Error("fixture was not loaded");
    const registry = createValidatorRegistry(ts, "@ts-refinement/runtime");
    const register = vi.spyOn(registry, "register");
    const output = transformSource(state.context, sourceFile, sourceFile.text, registry);

    expect(output.diagnostics).toEqual([]);
    expect(output.code).toContain("export const exact = positive;");
    expect(output.code).toContain("export const stronger = greaterThanFive;");
    expect(output.code).toContain("export const accumulated = bounded;");
    expect(output.code).toContain("export const unsupportedIdentity = startsWithA;");
    expect(output.code?.match(/refinement-types:validator:/gu)).toHaveLength(2);
    expect(register).toHaveBeenCalledTimes(2);
  });
});
