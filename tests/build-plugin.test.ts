import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodedMappings, originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { rolldown } from "rolldown";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { refinementTypesPlugin } from "@ts-refinement/rolldown";
import type { RefinementManifest } from "@ts-refinement/analyzer";
import { fixtureDirectory, fixtureFile, fixtureProgram } from "./helpers.ts";

interface RuntimeFixture {
  readonly checkAllPositive: (value: number[]) => number[];
  readonly checkConflicting: (value: number) => number;
  readonly checkEven: (value: number) => number;
  readonly checkFromFactory: (factory: () => number) => number;
  readonly checkOther: (value: number) => number;
  readonly checkParameterNamedA: (value: number[]) => number[];
  readonly checkParameterNamedB: (value: number[]) => number[];
  readonly checkPositive: (value: number) => number;
  readonly checkSlug: (value: string) => string;
  readonly knownGood: number;
  readonly knownNonEmpty: string;
}

interface NestedRuntimeFixture {
  readonly checkAngleThenAs: (value: number) => number;
  readonly checkChained: (value: number) => number;
  readonly checkNested: (value: number) => number;
  readonly checkNestedAngle: (value: number) => number;
}

interface NestedBoxValue {
  readonly value: number;
}

type NestedPairValue = readonly [number, string?, ...number[]];
type NestedResultValue =
  | { readonly kind: "count"; readonly count: number }
  | {
      readonly kind: "user";
      readonly user: { readonly age: number; readonly name?: string };
    };

interface NestedTreeValue {
  readonly children: readonly NestedTreeValue[];
  readonly value: number;
}

interface NestedUserValue {
  readonly age: number;
  readonly name?: string;
}

interface NestedRefinementFixture {
  readonly checkBox: (value: NestedBoxValue) => NestedBoxValue;
  readonly checkPair: (value: NestedPairValue) => NestedPairValue;
  readonly checkResult: (value: NestedResultValue) => NestedResultValue;
  readonly checkScores: (
    value: Readonly<Record<string, number>>,
  ) => Readonly<Record<string, number>>;
  readonly checkTree: (value: NestedTreeValue) => NestedTreeValue;
  readonly checkUser: (value: NestedUserValue) => NestedUserValue;
  readonly checkValues: (value: number[]) => number[];
}

const rebuildTestTimeout = 15_000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function generatedPosition(code: string, offset: number) {
  const precedingLines = code.slice(0, offset).split("\n");
  return {
    column: precedingLines.at(-1)?.length ?? 0,
    line: precedingLines.length,
  };
}

function validatorCalls(code: string, functionName: string): readonly number[] {
  const functionStart = code.indexOf(`function ${functionName}`);
  const functionEnd = code.indexOf("\n}", functionStart);
  return [...code.slice(functionStart, functionEnd).matchAll(/\bassert(?:\$\d+)?\(/gu)].map(
    (match) => functionStart + (match.index ?? 0),
  );
}

function createRefinementPlugin() {
  return refinementTypesPlugin({
    cwd: fixtureDirectory,
    runtimeModule: fixtureFile("../../packages/runtime/src/index.ts"),
    tsconfig: "tsconfig.json",
  });
}

async function buildWithPriorTransform(
  input: string,
  transformSource: (source: string) => string,
  refinementPlugin = createRefinementPlugin(),
) {
  return rolldown({
    input,
    plugins: [
      {
        name: "prior-source-transform",
        transform: {
          order: "pre",
          handler(code, id) {
            const cleanId = id.split(/[?#]/u, 1)[0] ?? id;
            return cleanId === input ? { code: transformSource(code), map: null } : null;
          },
        },
      },
      refinementPlugin,
    ],
  });
}

async function build(input: string, ignore: readonly string[] = [], source?: string) {
  return rolldown({
    input,
    plugins: [
      ...(source === undefined
        ? []
        : [
            {
              name: "outside-program-loader",
              load(id: string) {
                return id === input ? source : null;
              },
              resolveId(id: string) {
                return id === input ? id : null;
              },
            },
          ]),
      refinementTypesPlugin({
        cwd: fixtureDirectory,
        ignore,
        runtimeModule: fixtureFile("../../packages/runtime/src/index.ts"),
        tsconfig: "tsconfig.json",
      }),
    ],
  });
}

describe("Rolldown plugin", () => {
  it("updates the in-memory program only when source text changes", () => {
    const readFileSpy = vi.spyOn(ts.sys, "readFile");
    const state = fixtureProgram();
    const fileName = fixtureFile("valid.ts");
    const initialProgram = state.program;
    const source = initialProgram.getSourceFile(fileName)?.text;
    if (source === undefined) throw new Error("fixture was not loaded");
    const initialVersion = state.getScriptVersion(fileName);
    const initialReadCount = readFileSpy.mock.calls.filter(([readFileName]) =>
      readFileName.endsWith("valid.ts"),
    ).length;

    expect(state.getScriptVersion(fileName)).toBe(initialVersion);
    expect(
      readFileSpy.mock.calls.filter(([readFileName]) => readFileName.endsWith("valid.ts")),
    ).toHaveLength(initialReadCount);

    state.updateSource(fileName, source);
    expect(state.getScriptVersion(fileName)).toBe(initialVersion);
    expect(state.program).toBe(initialProgram);

    const changedSource = `// prepended by an earlier plugin\n${source}`;
    state.updateSource(fileName, changedSource);
    const changedVersion = state.getScriptVersion(fileName);
    const changedProgram = state.program;
    expect(changedVersion).toBe(initialVersion + 1);
    expect(changedProgram).not.toBe(initialProgram);
    expect(changedProgram.getSourceFile(fileName)?.text).toBe(changedSource);

    state.updateSource(fileName, changedSource);
    expect(state.getScriptVersion(fileName)).toBe(changedVersion);
    expect(state.program).toBe(changedProgram);
  });

  it("runs the full static/runtime pipeline and evaluates sources once", async () => {
    const bundle = await build(fixtureFile("runtime-entry.ts"));
    const generated = await bundle.generate({ format: "esm", sourcemap: true });
    const chunk = generated.output.find((output) => output.type === "chunk");
    if (chunk === undefined) throw new Error("bundle did not emit a chunk");

    if (chunk.map === null) throw new Error("bundle did not emit a source map");
    expect(chunk.map.sources.some((source) => source.endsWith("runtime-entry.ts"))).toBe(true);
    expect(chunk.map.sourcesContent?.some((source) => source?.includes("checkPositive"))).toBe(
      true,
    );
    const checkPositiveStart = chunk.code.indexOf("function checkPositive");
    const validationCall = chunk.code.indexOf("return ", checkPositiveStart) + "return ".length;
    const original = originalPositionFor(
      new TraceMap(JSON.stringify(chunk.map)),
      generatedPosition(chunk.code, validationCall),
    );
    expect(original.source?.endsWith("runtime-entry.ts")).toBe(true);
    expect(original.line).toBe(18);
    expect(original.column).toBe(9);
    expect(chunk.code.match(/function assert/gu)).toHaveLength(6);
    expect(chunk.code).not.toContain("5 as Positive");

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}#${Date.now()}`;
    // SAFETY: Rolldown generated this module from the typed runtime fixture declared above.
    const fixture = (await import(moduleUrl)) as RuntimeFixture;
    expect(fixture.knownGood).toBe(5);
    expect(fixture.knownNonEmpty).toBe("a");
    expect(fixture.checkPositive(2)).toBe(2);
    expect(fixture.checkOther(3)).toBe(3);
    expect(() => fixture.checkOther(-3)).toThrowError(
      expect.objectContaining({ refinement: "PositiveByValue", value: -3 }),
    );
    expect(() => fixture.checkPositive(-1)).toThrowError(
      expect.objectContaining({ name: "RefinementError", predicate: "n > 0", value: -1 }),
    );
    expect(fixture.checkEven(4)).toBe(4);
    expect(() => fixture.checkEven(5)).toThrowError(
      expect.objectContaining({ name: "RefinementError", value: 5 }),
    );
    expect(fixture.checkSlug("valid-slug")).toBe("valid-slug");
    expect(() => fixture.checkSlug("Not a slug")).toThrowError(
      expect.objectContaining({ name: "RefinementError", value: "Not a slug" }),
    );
    expect(fixture.checkAllPositive([1, 2, 3])).toEqual([1, 2, 3]);
    expect(() => fixture.checkAllPositive([1, -2, 3])).toThrowError(
      expect.objectContaining({ name: "RefinementError" }),
    );
    expect(fixture.checkParameterNamedA([1])).toEqual([1]);
    expect(fixture.checkParameterNamedB([1])).toEqual([1]);
    expect(() => fixture.checkParameterNamedA([10])).toThrowError(
      expect.objectContaining({ name: "RefinementError" }),
    );
    expect(() => fixture.checkParameterNamedB([10])).toThrowError(
      expect.objectContaining({ name: "RefinementError" }),
    );
    expect(() => fixture.checkConflicting(2)).toThrowError(
      expect.objectContaining({ refinement: "Negative" }),
    );
    expect(() => fixture.checkConflicting(-2)).toThrowError(
      expect.objectContaining({ refinement: "Positive" }),
    );

    let calls = 0;
    expect(
      fixture.checkFromFactory(() => {
        calls += 1;
        return 6;
      }),
    ).toBe(6);
    expect(calls).toBe(1);
  });

  it("validates nested object and array refinements with failing paths", async () => {
    const bundle = await build(fixtureFile("nested-refinements.ts"));
    const generated = await bundle.generate({ format: "esm" });
    const chunk = generated.output.find((output) => output.type === "chunk");
    if (chunk === undefined) throw new Error("bundle did not emit a chunk");
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}#${Date.now()}`;
    // SAFETY: Rolldown generated this module from the typed nested refinement fixture.
    const nested = (await import(moduleUrl)) as NestedRefinementFixture;

    expect(nested.checkUser({ age: 1 })).toEqual({ age: 1 });
    expect(nested.checkUser({ age: 1, name: "Ada" })).toEqual({ age: 1, name: "Ada" });
    expect(() => nested.checkUser({ age: -1 })).toThrowError(
      expect.objectContaining({ path: ".age", value: -1 }),
    );
    expect(() => nested.checkUser({ age: 1, name: "" })).toThrowError(
      expect.objectContaining({ path: ".name", value: "" }),
    );
    expect(nested.checkValues([1, 2])).toEqual([1, 2]);
    expect(() => nested.checkValues([1, -2, -3])).toThrowError(
      expect.objectContaining({ path: "[1]", value: -2 }),
    );
    expect(nested.checkBox({ value: 1 })).toEqual({ value: 1 });
    expect(() => nested.checkBox({ value: 0 })).toThrowError(
      expect.objectContaining({ path: ".value", value: 0 }),
    );
    expect(nested.checkPair([1, "x", 2, 3])).toEqual([1, "x", 2, 3]);
    expect(() => nested.checkPair([1, "", 2])).toThrowError(
      expect.objectContaining({ path: "[1]", value: "" }),
    );
    expect(() => nested.checkPair([1, "x", 0])).toThrowError(
      expect.objectContaining({ path: "[2]", value: 0 }),
    );
    expect(nested.checkResult({ count: 1, kind: "count" })).toEqual({ count: 1, kind: "count" });
    expect(() => nested.checkResult({ count: -1, kind: "count" })).toThrowError(
      expect.objectContaining({ path: ".count", value: -1 }),
    );
    expect(() => nested.checkResult({ kind: "user", user: { age: 0 } })).toThrowError(
      expect.objectContaining({ path: ".user.age", value: 0 }),
    );
    expect(nested.checkScores({ alice: 1, bob: 2 })).toEqual({ alice: 1, bob: 2 });
    expect(() => nested.checkScores({ alice: 1, bob: -2 })).toThrowError(
      expect.objectContaining({ path: ".bob", value: -2 }),
    );
    const tree = { children: [{ children: [{ children: [], value: 0 }], value: 2 }], value: 1 };
    expect(() => nested.checkTree(tree)).toThrowError(
      expect.objectContaining({ path: ".children[0].children[0].value", value: 0 }),
    );
    const cyclicTree: { children: NestedTreeValue[]; value: number } = {
      children: [],
      value: 1,
    };
    cyclicTree.children.push(cyclicTree);
    expect(nested.checkTree(cyclicTree)).toBe(cyclicTree);
  });

  it("analyzes and maps the exact source supplied by a prior plugin", async () => {
    const banner = "// prepended by an earlier plugin";
    const bundle = await buildWithPriorTransform(
      fixtureFile("runtime-entry.ts"),
      (source) => `${banner}\n${source}`,
    );
    const generated = await bundle.generate({ format: "esm", sourcemap: true });
    const chunk = generated.output.find((output) => output.type === "chunk");
    if (chunk === undefined) throw new Error("bundle did not emit a chunk");
    if (chunk.map === null) throw new Error("bundle did not emit a source map");

    const checkPositiveStart = chunk.code.indexOf("function checkPositive");
    const validationCall = chunk.code.indexOf("return ", checkPositiveStart) + "return ".length;
    const original = originalPositionFor(
      new TraceMap(JSON.stringify(chunk.map)),
      generatedPosition(chunk.code, validationCall),
    );
    expect(original).toMatchObject({ column: 9, line: 19 });
    expect(chunk.map.sourcesContent?.some((source) => source?.startsWith(banner))).toBe(true);
  });

  it("updates validators and diagnostics across incremental source changes", async () => {
    const input = fixtureFile("runtime-entry.ts");
    const refinementPlugin = createRefinementPlugin();
    let assertion = "5 as Positive";
    const rewriteAssertion = (source: string) => source.replace("5 as Positive", assertion);

    const initialBundle = await buildWithPriorTransform(input, rewriteAssertion, refinementPlugin);
    const initialGenerated = await initialBundle.generate({ format: "esm" });
    const initialChunk = initialGenerated.output.find((output) => output.type === "chunk");
    expect(initialChunk?.code).toContain("const knownGood = 5;");

    assertion = "Math.random() as Positive";
    const changedBundle = await buildWithPriorTransform(input, rewriteAssertion, refinementPlugin);
    const changedGenerated = await changedBundle.generate({ format: "esm", sourcemap: true });
    const changedChunk = changedGenerated.output.find((output) => output.type === "chunk");
    if (changedChunk === undefined) throw new Error("bundle did not emit a chunk");
    expect(changedChunk.code).toMatch(
      /const knownGood = assert(?:\$\d+)?\(Math\.random\(\), "Positive", "ts-refinement-site:[^"]+"\);/u,
    );
    expect(
      changedChunk.map?.sourcesContent?.some((source) =>
        source?.includes("Math.random() as Positive"),
      ),
    ).toBe(true);

    assertion = "-5 as Positive";
    const invalidBundle = await buildWithPriorTransform(input, rewriteAssertion, refinementPlugin);
    await expect(invalidBundle.generate({ format: "esm" })).rejects.toThrow(/RF90200/u);
  });

  it("refreshes inherited config watches", { timeout: rebuildTestTimeout }, async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "ts-refinement-config-")));
    const initialInput = join(directory, "initial.ts");
    const changedInput = join(directory, "changed.ts");
    const configPath = join(directory, "tsconfig.json");
    const firstBaseConfigPath = join(directory, "tsconfig.base-a.json");
    const secondBaseConfigPath = join(directory, "tsconfig.base-b.json");
    const compilerOptions = {
      module: "Preserve",
      strict: true,
      target: "ESNext",
    };

    try {
      await Promise.all([
        writeFile(initialInput, "export const initial = true;\n"),
        writeFile(changedInput, "export const changed = true;\n"),
        writeFile(configPath, JSON.stringify({ extends: "./tsconfig.base-a.json" })),
        writeFile(
          firstBaseConfigPath,
          JSON.stringify({ compilerOptions, include: ["initial.ts"] }),
        ),
        writeFile(
          secondBaseConfigPath,
          JSON.stringify({ compilerOptions, include: ["initial.ts"] }),
        ),
      ]);
      const refinementPlugin = refinementTypesPlugin({ cwd: directory });
      const initialBundle = await rolldown({ input: initialInput, plugins: [refinementPlugin] });
      const initialGenerated = await initialBundle.generate({ format: "esm" });
      expect(initialGenerated.output[0]?.type).toBe("chunk");
      expect(await initialBundle.watchFiles).toContain(firstBaseConfigPath);

      await writeFile(configPath, JSON.stringify({ extends: "./tsconfig.base-b.json" }));
      const equivalentBundle = await rolldown({
        input: initialInput,
        plugins: [refinementPlugin],
      });
      await equivalentBundle.generate({ format: "esm" });
      expect(await equivalentBundle.watchFiles).toContain(secondBaseConfigPath);
      expect(await equivalentBundle.watchFiles).not.toContain(firstBaseConfigPath);

      await writeFile(
        secondBaseConfigPath,
        JSON.stringify({ compilerOptions, include: ["changed.ts"] }),
      );
      const changedBundle = await rolldown({ input: changedInput, plugins: [refinementPlugin] });
      const changedGenerated = await changedBundle.generate({ format: "esm" });
      const changedChunk = changedGenerated.output.find((output) => output.type === "chunk");
      expect(changedChunk?.code).toContain("changed = true");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reruns implicit tsconfig discovery", { timeout: rebuildTestTimeout }, async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "ts-refinement-discovery-")));
    const projectDirectory = join(directory, "project");
    const initialInput = join(projectDirectory, "initial.ts");
    const changedInput = join(projectDirectory, "changed.ts");
    const compilerOptions = {
      module: "Preserve",
      strict: true,
      target: "ESNext",
    };

    try {
      await mkdir(projectDirectory);
      await Promise.all([
        writeFile(initialInput, "export const initial = true;\n"),
        writeFile(changedInput, "export const changed = true;\n"),
        writeFile(
          join(directory, "tsconfig.json"),
          JSON.stringify({ compilerOptions, include: ["project/initial.ts"] }),
        ),
      ]);
      const refinementPlugin = refinementTypesPlugin({ cwd: projectDirectory });
      const initialBundle = await rolldown({ input: initialInput, plugins: [refinementPlugin] });
      await initialBundle.generate({ format: "esm" });

      await writeFile(
        join(projectDirectory, "tsconfig.json"),
        JSON.stringify({ compilerOptions, include: ["changed.ts"] }),
      );
      const changedBundle = await rolldown({ input: changedInput, plugins: [refinementPlugin] });
      const changedGenerated = await changedBundle.generate({ format: "esm" });
      const changedChunk = changedGenerated.output.find((output) => output.type === "chunk");
      expect(changedChunk?.code).toContain("changed = true");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("maps nested validators to their independent assertion locations", async () => {
    const bundle = await build(fixtureFile("nested-runtime.ts"));
    const generated = await bundle.generate({ format: "esm", sourcemap: true });
    const chunk = generated.output.find((output) => output.type === "chunk");
    if (chunk === undefined) throw new Error("bundle did not emit a chunk");
    if (chunk.map === null) throw new Error("bundle did not emit a source map");

    const calls = validatorCalls(chunk.code, "checkNested");
    expect(calls).toHaveLength(2);
    const [outerCall, innerCall] = calls;
    if (outerCall === undefined || innerCall === undefined) {
      throw new Error("expected nested validator calls");
    }

    const traceMap = new TraceMap(JSON.stringify(chunk.map));
    const decoded = decodedMappings(traceMap);
    const outerOriginal = originalPositionFor(traceMap, generatedPosition(chunk.code, outerCall));
    const innerOriginal = originalPositionFor(traceMap, generatedPosition(chunk.code, innerCall));
    expect(outerOriginal).toMatchObject({ column: 9, line: 4 });
    expect(innerOriginal).toMatchObject({ column: 11, line: 4 });
    expect(outerOriginal.source?.endsWith("nested-runtime.ts")).toBe(true);
    expect(innerOriginal.source?.endsWith("nested-runtime.ts")).toBe(true);
    for (const call of calls) {
      const callPosition = generatedPosition(chunk.code, call);
      expect(
        decoded[callPosition.line - 1]?.some((segment) => segment[0] === callPosition.column),
      ).toBe(true);
    }
    expect(
      chunk.map.sourcesContent?.some((source) => source?.includes("dynamicValue as Int")),
    ).toBe(true);

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}#${Date.now()}`;
    // SAFETY: Rolldown generated this module from the typed nested runtime fixture above.
    const fixture = (await import(moduleUrl)) as NestedRuntimeFixture;
    expect(fixture.checkNested(2)).toBe(4);
    expect(() => fixture.checkNested(1)).toThrowError(
      expect.objectContaining({ refinement: "Even" }),
    );
    expect(() => fixture.checkNested(2.5)).toThrowError(
      expect.objectContaining({ refinement: "Int" }),
    );

    const chainedCalls = validatorCalls(chunk.code, "checkChained");
    expect(chainedCalls).toHaveLength(2);
    for (const call of chainedCalls) {
      const callPosition = generatedPosition(chunk.code, call);
      expect(originalPositionFor(traceMap, callPosition)).toMatchObject({ column: 9, line: 8 });
      expect(
        decoded[callPosition.line - 1]?.some((segment) => segment[0] === callPosition.column),
      ).toBe(true);
    }
    expect(fixture.checkChained(4)).toBe(4);
    expect(() => fixture.checkChained(3)).toThrowError(
      expect.objectContaining({ refinement: "Even" }),
    );
    expect(() => fixture.checkChained(2.5)).toThrowError(
      expect.objectContaining({ refinement: "Int" }),
    );

    expect(fixture.checkNestedAngle(4)).toBe(4);
    expect(() => fixture.checkNestedAngle(3)).toThrowError(
      expect.objectContaining({ refinement: "Even" }),
    );
    expect(() => fixture.checkNestedAngle(2.5)).toThrowError(
      expect.objectContaining({ refinement: "Int" }),
    );
    expect(fixture.checkAngleThenAs(4)).toBe(4);
    expect(() => fixture.checkAngleThenAs(2.5)).toThrowError(
      expect.objectContaining({ refinement: "Int" }),
    );
  });

  it("fails the build for a statically false assertion", async () => {
    const bundle = await build(fixtureFile("build-invalid.ts"));
    await expect(bundle.generate({ format: "esm" })).rejects.toThrow(/RF90200/u);
  });

  it("writes a hashed manifest for distinct nested runtime sites only", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "ts-refinement-manifest-")));
    try {
      const bundle = await rolldown({
        input: fixtureFile("nested-runtime.ts"),
        plugins: [
          createRefinementPlugin(),
          {
            name: "javascript-asset",
            buildStart() {
              this.emitFile({
                fileName: "loader.js",
                source: "export const loaded = true;\n",
                type: "asset",
              });
            },
          },
        ],
      });
      await bundle.write({ dir: directory, format: "esm", sourcemap: true });
      const code = await readFile(join(directory, "nested-runtime.js"), "utf8");
      const loader = await readFile(join(directory, "loader.js"), "utf8");
      // SAFETY: the plugin produced this JSON file from the RefinementManifest contract.
      const manifest = JSON.parse(
        await readFile(join(directory, ".ts-refinement-manifest.json"), "utf8"),
      ) as RefinementManifest;

      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.project.configPath).toBe(fixtureFile("tsconfig.json"));
      expect(manifest.sites).toHaveLength(8);
      expect(new Set(manifest.sites.map((site) => site.id)).size).toBe(8);
      expect(manifest.assets).toEqual([
        {
          file: "loader.js",
          sha256: createHash("sha256").update(loader).digest("hex"),
        },
        {
          file: "nested-runtime.js",
          sha256: createHash("sha256").update(code).digest("hex"),
        },
      ]);
      for (const site of manifest.sites) {
        expect(code).toContain(`ts-refinement-site:${manifest.buildId}:${site.id}`);
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("does not create a manifest when a static failure aborts the build", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "ts-refinement-manifest-")));
    try {
      const bundle = await build(fixtureFile("build-invalid.ts"));
      await expect(bundle.write({ dir: directory, format: "esm" })).rejects.toThrow(/RF90200/u);
      expect(existsSync(join(directory, ".ts-refinement-manifest.json"))).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("fails before loading a validator for opaque normalized syntax", async () => {
    const bundle = await build(fixtureFile("opaque-predicate.ts"));
    await expect(bundle.generate({ format: "esm" })).rejects.toThrow(/RF90004.*ObjectLiteral/u);
  });

  it("fails when a TypeScript module is outside the configured program", async () => {
    const input = fixtureFile("../outside-program.ts");
    const bundle = await build(input);

    await expect(bundle.generate({ format: "esm" })).rejects.toThrow(
      new RegExp(`${escapeRegExp(input)}.*${escapeRegExp(fixtureFile("tsconfig.json"))}`, "u"),
    );
  });

  it("skips an outside-program module that matches an ignore glob", async () => {
    const bundle = await build(fixtureFile("../outside-program.ts"), ["../outside-*.ts"]);
    const generated = await bundle.generate({ format: "esm" });
    const chunk = generated.output.find((output) => output.type === "chunk");

    expect(chunk?.code).toContain("outsideProgram = true");
  });

  it("skips irrelevant modules before checking program membership", async () => {
    const bundle = await build(fixtureFile("../irrelevant-outside.ts"));
    const generated = await bundle.generate({ format: "esm" });
    const chunk = generated.output.find((output) => output.type === "chunk");

    expect(chunk?.code).toContain("irrelevant = true");
  });

  it("still fails outside-program modules that do not match an ignore glob", async () => {
    const bundle = await build(fixtureFile("../outside-program.ts"), ["../other-*.ts"]);

    await expect(bundle.generate({ format: "esm" })).rejects.toThrow(/outside-program\.ts/u);
  });

  it.each(["?raw", "#fragment", "?raw#fragment"])(
    "normalizes %s suffixes before checking the program and ignore globs",
    async (suffix) => {
      const input = `${fixtureFile("../outside-program.ts")}${suffix}`;
      const bundle = await build(
        input,
        ["../other-*.ts"],
        "export const outsideProgram = true as boolean;",
      );

      await expect(bundle.generate({ format: "esm" })).rejects.toThrow(/outside-program\.ts/u);
    },
  );
});
