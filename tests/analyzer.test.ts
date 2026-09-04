import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import ts from "typescript";

import {
  analyzeSourceFile,
  DiagnosticCode,
  getPublishVerificationDiagnostics,
  getRefinementDefinitionDiagnostics,
  hasConfiguredPublishVerification,
} from "@ts-refinement/analyzer";

import { fixtureFile, fixtureProgram, projectProgram } from "./helpers.ts";

const publishFixtureDirectory = resolve(import.meta.dirname, "../fixtures/publish");

describe("TypeScript refinement analysis", () => {
  it("uses diagnostic codes outside TypeScript's namespace", () => {
    // SAFETY: Supported TypeScript runtimes expose the complete diagnostic table under this key.
    const runtimeTypeScript = ts as typeof ts & {
      readonly Diagnostics: Readonly<Record<string, { readonly code: number }>>;
    };
    const typeScriptCodes = new Set(
      Object.values(runtimeTypeScript.Diagnostics).map((diagnostic) => diagnostic.code),
    );

    expect(Object.values(DiagnosticCode).every((code) => !typeScriptCodes.has(code))).toBe(true);
  });

  it("diagnoses invalid predicates at their declarations", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("types.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = getRefinementDefinitionDiagnostics(state.context, source);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1000000, 1000002]);
    expect(diagnostics.every((diagnostic) => diagnostic.length > 1)).toBe(true);
  });

  it("ignores unrelated local aliases named Refined", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("unrelated-refined-alias.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    expect(getRefinementDefinitionDiagnostics(state.context, source)).toEqual([]);
    expect(analyzeSourceFile(state.context, source)).toEqual([]);
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
      1000200, 1000200, 1000101, 1000101, 1000101,
    ]);
    expect(diagnostics[0]?.message).toContain("Value '-5'");
    expect(diagnostics[1]?.message).toContain("n % 2 === 0");
  });

  it("rejects unsafe sources for nested refinement targets", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("nested-unsafe.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = analyzeSourceFile(state.context, source).flatMap(
      (result) => result.diagnostics,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1000101, 1000101]);
  });

  it("reports predicate errors at assertion sites", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("predicate-errors.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = analyzeSourceFile(state.context, source).flatMap(
      (result) => result.diagnostics,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1000002, 1000000]);
  });

  it("rejects a generic predicate that cannot be materialized", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("generic.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = analyzeSourceFile(state.context, source).flatMap(
      (result) => result.diagnostics,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([1000001]);
  });

  it("collects nested object and array refinements with access paths", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("nested-refinements.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results).toHaveLength(7);
    expect(results[0]?.site.checks.map((check) => check.path)).toEqual([
      [{ kind: "property", name: "age", optional: false }],
      [{ kind: "property", name: "name", optional: true }],
    ]);
    expect(results[1]?.site.checks.map((check) => check.path)).toEqual([[{ kind: "array" }]]);
  });

  it("collects tuple, generic, index, and discriminated-union refinements", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("nested-refinements.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results).toHaveLength(7);
    expect(results[2]?.site.checks.map((check) => check.path)).toEqual([
      [{ kind: "property", name: "value", optional: false }],
    ]);
    expect(results[3]?.site.checks.map((check) => check.path)).toEqual([
      [{ index: 0, kind: "tuple", optional: false }],
      [{ index: 1, kind: "tuple", optional: true }],
      [{ end: 0, kind: "tupleRest", start: 2 }],
    ]);
    expect(results[4]?.site.checks.map((check) => check.path)).toEqual([
      [
        { kind: "union", property: "kind", value: "count" },
        { kind: "property", name: "count", optional: false },
      ],
      [
        { kind: "union", property: "kind", value: "user" },
        { kind: "property", name: "user", optional: false },
        { kind: "property", name: "age", optional: false },
      ],
      [
        { kind: "union", property: "kind", value: "user" },
        { kind: "property", name: "user", optional: false },
        { kind: "property", name: "name", optional: true },
      ],
    ]);
    expect(results[5]?.site.checks.map((check) => check.path)).toEqual([
      [{ key: "string", kind: "index" }],
    ]);
    expect(results[6]?.site.checks.map((check) => check.path)).toEqual([
      [{ kind: "property", name: "value", optional: false }],
    ]);
    expect(results[6]?.site.recursions).toEqual([
      {
        path: [{ kind: "property", name: "children", optional: false }, { kind: "array" }],
        targetPath: [],
      },
    ]);
    expect(results.every((result) => result.diagnostics.length === 0)).toBe(true);
  });

  it("rejects statically invalid nested object and array values", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("nested-invalid.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results.map((result) => result.proof.kind)).toEqual(["false", "false", "false"]);
    expect(results.map((result) => result.diagnostics[0]?.code)).toEqual([
      1000200, 1000200, 1000200,
    ]);
    expect(results[0]?.diagnostics[0]?.message).toContain("at '.age'");
    expect(results[1]?.diagnostics[0]?.message).toContain("at '[0]'");
    expect(results[2]?.diagnostics[0]?.message).toContain("at '[3]'");
  });

  it("matches numeric, symbol, and template-literal index domains", () => {
    const state = fixtureProgram();
    const invalidSource = state.program.getSourceFile(fixtureFile("index-signatures-invalid.ts"));
    const runtimeSource = state.program.getSourceFile(fixtureFile("index-signatures.ts"));
    if (invalidSource === undefined || runtimeSource === undefined) {
      throw new Error("fixture was not loaded");
    }

    const invalidResults = analyzeSourceFile(state.context, invalidSource);
    expect(invalidResults.map((result) => result.proof.kind)).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(invalidResults.map((result) => result.diagnostics[0]?.code)).toEqual([
      1000200,
      1000200,
      1000200,
      undefined,
    ]);

    const runtimeResults = analyzeSourceFile(state.context, runtimeSource);
    expect(runtimeResults).toHaveLength(5);
    expect(runtimeResults[0]?.site.checks[0]?.path).toEqual([{ key: "number", kind: "index" }]);
    expect(runtimeResults[1]?.site.checks[0]?.path).toEqual([{ key: "symbol", kind: "index" }]);
    expect(runtimeResults[2]?.site.checks[0]?.path).toEqual([
      {
        key: "template",
        kind: "index",
        pattern: { placeholders: ["string"], texts: ["data-", ""] },
      },
    ]);
    expect(runtimeResults[3]?.site.checks[0]?.path).toEqual([
      {
        key: "template",
        kind: "index",
        pattern: { placeholders: ["number"], texts: ["number-", ""] },
      },
    ]);
    expect(runtimeResults[4]?.site.checks[0]?.path).toEqual([
      {
        key: "template",
        kind: "index",
        pattern: { placeholders: ["bigint"], texts: ["bigint-", ""] },
      },
    ]);
  });

  it("evaluates arithmetic through nested refinement assertions", () => {
    const state = fixtureProgram();
    const source = state.program.getSourceFile(fixtureFile("nested-static.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const results = analyzeSourceFile(state.context, source);
    expect(results.map((result) => result.proof.kind)).toEqual(["false", "true"]);
    expect(
      results.flatMap((result) => result.diagnostics).map((diagnostic) => diagnostic.code),
    ).toEqual([1000200]);
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
    expect(results.map((result) => result.diagnostics[0]?.code)).toEqual([1000200, 1000200]);
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
      1000003, 1000003, 1000003, 1000003, 1000003, 1000003, 1000003, 1000003, 1000003, 1000002,
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
          `RF1000003: Predicate capture '${name}' must resolve to an immutable primitive literal.`,
      ),
    );
    for (const diagnostic of diagnostics) {
      expect(source.text.slice(diagnostic.start, diagnostic.start + diagnostic.length)).toMatch(
        /^".*"$/u,
      );
    }
  });

  it("warns once per exported declaration whose public type contains refinements", () => {
    const directory = resolve(publishFixtureDirectory, "unconfigured");
    const state = projectProgram(directory);
    const source = state.program.getSourceFile(resolve(directory, "index.ts"));
    if (source === undefined) throw new Error("fixture was not loaded");

    const diagnostics = getPublishVerificationDiagnostics(state.context, source);
    expect(diagnostics).toHaveLength(8);
    expect(diagnostics.every((diagnostic) => diagnostic.code === 1000500)).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining(
        [
          "Direct",
          "Nested",
          "Accumulated",
          "PublicAlias",
          "StarRefined",
          "inferred",
          "accepts",
          "default",
        ].map((name) => expect.stringContaining(`Exported declaration '${name}'`)),
      ),
    );
    expect(diagnostics.every((diagnostic) => diagnostic.message.includes("package.json"))).toBe(
      true,
    );
  });

  it("suppresses publish warnings for configured and private packages", () => {
    for (const name of ["configured", "private"]) {
      const directory = resolve(publishFixtureDirectory, name);
      const state = projectProgram(directory);
      const source = state.program.getSourceFile(resolve(directory, "index.ts"));
      if (source === undefined) throw new Error("fixture was not loaded");
      expect(getPublishVerificationDiagnostics(state.context, source)).toEqual([]);
    }
  });

  it("recognizes only matching direct verifier commands", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "ts-refinement-package-"));
    const packagePath = resolve(directory, "package.json");
    const cases = [
      ["ts-refinement verify dist", "dist", true],
      ["npm run build && ./node_modules/.bin/ts-refinement verify './dist'", "dist", true],
      ["ts-refinement verify other", "dist", false],
      ["npm run verify", "dist", false],
      ["echo ts-refinement verify dist", "dist", false],
      ["tool --argument 'ts-refinement verify dist'", "dist", false],
      ["ts-refinement verify dist && echo verified", "dist", true],
      ["ts-refinement verify dist || true", "dist", false],
      ["true || ts-refinement verify dist", "dist", false],
      ["false && ts-refinement verify dist", "dist", false],
      ["exit 1 && ts-refinement verify dist", "dist", false],
      ["ts-refinement verify dist; echo done", "dist", false],
    ] as const;
    try {
      for (const [prepack, outDir, expected] of cases) {
        writeFileSync(
          packagePath,
          JSON.stringify({
            name: "temporary-package",
            scripts: { prepack },
            "ts-refinement": { verify: { outDir } },
          }),
        );
        expect(hasConfiguredPublishVerification(ts, packagePath), prepack).toBe(expected);
      }
      writeFileSync(
        packagePath,
        JSON.stringify({
          name: "temporary-package",
          scripts: { prepack: "ts-refinement verify dist" },
        }),
      );
      expect(hasConfiguredPublishVerification(ts, packagePath)).toBe(false);
      writeFileSync(
        packagePath,
        JSON.stringify({
          name: "temporary-package",
          "ts-refinement": { verify: { outDir: "dist" } },
        }),
      );
      expect(hasConfiguredPublishVerification(ts, packagePath)).toBe(false);
      writeFileSync(
        packagePath,
        '{"scripts":{"prepack":"ts-refinement verify dist"},"scripts":{"prepack":"echo skipped"},"ts-refinement":{"verify":{"outDir":"dist"}}}',
      );
      expect(hasConfiguredPublishVerification(ts, packagePath)).toBe(false);
      writeFileSync(
        packagePath,
        '{"scripts":{"prepack":"ts-refinement verify dist"},"ts-refinement":{"verify":{"outDir":"dist"},"verify":{"outDir":"other"}}}',
      );
      expect(hasConfiguredPublishVerification(ts, packagePath)).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
