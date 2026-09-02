import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createCompiler, NoopLogger, resolveConfig, type JsPlugin } from "@farmfe/core";
import * as rspackCore from "@rspack/core";
import * as esbuild from "esbuild";
import { rolldown } from "rolldown";
import { rollup } from "rollup";
import { describe, expect, it } from "vitest";
import { build as viteBuild } from "vite";
import webpack from "webpack";

import esbuildRefinement from "../packages/unplugin/src/esbuild.ts";
import farmRefinement from "../packages/unplugin/src/farm.ts";
import rolldownRefinement from "../packages/unplugin/src/rolldown.ts";
import rollupRefinement from "../packages/unplugin/src/rollup.ts";
import rspackRefinement from "../packages/unplugin/src/rspack.ts";
import viteRefinement from "../packages/unplugin/src/vite.ts";
import webpackRefinement from "../packages/unplugin/src/webpack.ts";
import type { RefinementTypesPluginOptions } from "../packages/unplugin/src/options.ts";

interface BuiltModule {
  readonly checkDynamic: (value: number) => number;
  readonly checkNested: (value: number) => number;
  readonly knownTrue: number;
}

interface BuildOutput {
  readonly code: string;
  readonly map: string;
  readonly sourceIdentity: boolean;
}

const fixtureDirectory = resolve(import.meta.dirname, "../fixtures/unplugin");
const entry = resolve(fixtureDirectory, "entry.ts");
const knownFalse = resolve(fixtureDirectory, "known-false.ts");
const outsideProgram = resolve(fixtureDirectory, "../unplugin-outside.ts");
const runtimeModule = resolve(fixtureDirectory, "runtime.mjs");
const pluginOptions = { cwd: fixtureDirectory, runtimeModule, tsconfig: "tsconfig.json" };

function outputFromChunk(
  output: readonly { readonly code?: string; readonly map?: unknown; readonly type: string }[],
): BuildOutput {
  const chunk = output.find((item) => item.type === "chunk");
  if (chunk?.code === undefined || chunk.map === undefined || chunk.map === null) {
    throw new Error("build did not emit a mapped JavaScript chunk");
  }
  return { code: chunk.code, map: JSON.stringify(chunk.map), sourceIdentity: true };
}

async function buildRollup(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const bundle = await rollup({ input, plugins: [rollupRefinement(options)] });
  try {
    return outputFromChunk((await bundle.generate({ format: "es", sourcemap: true })).output);
  } finally {
    await bundle.close();
  }
}

async function buildRolldown(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const bundle = await rolldown({ input, plugins: [rolldownRefinement(options)] });
  try {
    return outputFromChunk((await bundle.generate({ format: "esm", sourcemap: true })).output);
  } finally {
    await bundle.close();
  }
}

async function buildVite(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const result = await viteBuild({
    build: {
      lib: { entry: input, fileName: "bundle", formats: ["es"] },
      minify: false,
      sourcemap: true,
      write: false,
    },
    configFile: false,
    logLevel: "silent",
    plugins: [viteRefinement(options)],
    root: fixtureDirectory,
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !("output" in output)) throw new Error("Vite build had no output");
  return outputFromChunk(output.output);
}

async function buildEsbuild(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const result = await esbuild.build({
    absWorkingDir: fixtureDirectory,
    bundle: true,
    entryPoints: [input],
    format: "esm",
    logLevel: "silent",
    outfile: "bundle.mjs",
    platform: "node",
    plugins: [esbuildRefinement(options)],
    sourcemap: "external",
    write: false,
  });
  const javascript = result.outputFiles.find((file) => file.path.endsWith(".mjs"));
  const map = result.outputFiles.find((file) => file.path.endsWith(".mjs.map"));
  if (javascript === undefined || map === undefined)
    throw new Error("esbuild output was incomplete");
  return { code: javascript.text, map: map.text, sourceIdentity: true };
}

async function buildWebpack(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const directory = await mkdtemp(join(tmpdir(), "ts-refinement-webpack-"));
  const compiler = webpack({
    context: fixtureDirectory,
    devtool: "source-map",
    entry: input,
    experiments: { outputModule: true },
    mode: "development",
    module: {
      rules: [
        {
          test: /\.ts$/u,
          use: [
            {
              loader: "ts-loader",
              options: {
                compilerOptions: { module: "ESNext", noEmit: false },
                configFile: resolve(fixtureDirectory, "tsconfig.json"),
                transpileOnly: true,
              },
            },
          ],
        },
      ],
    },
    optimization: { minimize: false },
    output: { filename: "bundle.mjs", library: { type: "module" }, module: true, path: directory },
    plugins: [webpackRefinement(options)],
    target: "node",
  });
  try {
    const stats = await new Promise<webpack.Stats>((accept, reject) => {
      compiler.run((error, result) => {
        if (error !== null && error !== undefined) reject(error);
        else if (result === undefined) reject(new Error("webpack returned no stats"));
        else accept(result);
      });
    });
    if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
    return {
      code: await readFile(join(directory, "bundle.mjs"), "utf8"),
      map: await readFile(join(directory, "bundle.mjs.map"), "utf8"),
      sourceIdentity: true,
    };
  } finally {
    await new Promise<void>((accept, reject) => {
      compiler.close((error) => (error === null || error === undefined ? accept() : reject(error)));
    });
    await rm(directory, { force: true, recursive: true });
  }
}

async function buildRspack(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const directory = await mkdtemp(join(tmpdir(), "ts-refinement-rspack-"));
  const config = {
    context: fixtureDirectory,
    devtool: "source-map",
    entry: input,
    mode: "development",
    module: {
      rules: [
        {
          test: /\.ts$/u,
          use: [
            {
              loader: "builtin:swc-loader",
              options: { jsc: { parser: { syntax: "typescript" } } },
            },
          ],
        },
      ],
    },
    optimization: { minimize: false },
    output: { filename: "bundle.mjs", library: { type: "module" }, module: true, path: directory },
    plugins: [rspackRefinement(options)],
    target: "node",
  } satisfies rspackCore.Configuration;
  const compiler = rspackCore.rspack(config);
  try {
    const stats = await new Promise<rspackCore.Stats>((accept, reject) => {
      compiler.run((error, result) => {
        if (error !== null && error !== undefined) reject(error);
        else if (result === undefined) reject(new Error("Rspack returned no stats"));
        else accept(result);
      });
    });
    if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
    return {
      code: await readFile(join(directory, "bundle.mjs"), "utf8"),
      map: await readFile(join(directory, "bundle.mjs.map"), "utf8"),
      sourceIdentity: true,
    };
  } finally {
    await new Promise<void>((accept, reject) => {
      compiler.close((error) => (error === null || error === undefined ? accept() : reject(error)));
    });
    await rm(directory, { force: true, recursive: true });
  }
}

async function buildFarm(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const directory = await mkdtemp(join(tmpdir(), "ts-refinement-farm-"));
  try {
    const logger = new NoopLogger();
    const config = await resolveConfig(
      {
        compilation: {
          input: { index: input },
          output: { clean: true, format: "esm", path: directory, targetEnv: "node" },
          sourcemap: true,
        },
        plugins: [farmRefinement(options)],
        root: fixtureDirectory,
      },
      "production",
      logger,
    );
    const compiler = await createCompiler(config, logger);
    await compiler.compile();
    const resources = compiler.resources();
    const javascript = Object.entries(resources).find(([name]) => name.endsWith(".js"));
    const map = Object.entries(resources).find(([name]) => name.endsWith(".js.map"));
    if (javascript === undefined || map === undefined)
      throw new Error("Farm output was incomplete");
    return { code: javascript[1].toString(), map: map[1].toString(), sourceIdentity: false };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

const builders = [
  ["rollup", buildRollup],
  ["rolldown", buildRolldown],
  ["vite", buildVite],
  ["esbuild", buildEsbuild],
  ["webpack", buildWebpack],
  ["rspack", buildRspack],
  ["farm", buildFarm],
] as const;

async function failureMessage(build: Promise<BuildOutput>): Promise<string> {
  const [result] = await Promise.allSettled([build]);
  return result?.status === "rejected" ? String(result.reason) : "";
}

describe("unplugin adapter conformance", () => {
  it.each(builders)("builds working validators with %s", async (_name, build) => {
    const output = await build();
    expect(output.code).not.toContain("as Positive");
    expect(output.code).toContain("RefinementError");
    expect(() => JSON.parse(output.map)).not.toThrow();
    if (output.sourceIdentity) expect(output.map).toContain("entry.ts");

    const directory = await mkdtemp(join(tmpdir(), "ts-refinement-adapter-"));
    try {
      const outputFile = join(directory, "bundle.mjs");
      await writeFile(outputFile, output.code.replace(/^\/\/# sourceMappingURL=.*$/gmu, ""));
      // SAFETY: every builder emitted this module from the typed conformance fixture above.
      const module = (await import(
        `${pathToFileURL(outputFile).href}?${Date.now()}`
      )) as BuiltModule;
      expect(module.knownTrue).toBe(1);
      expect(module.checkDynamic(2)).toBe(2);
      expect(() => module.checkDynamic(-1)).toThrowError(
        expect.objectContaining({ name: "RefinementError", value: -1 }),
      );
      expect(module.checkNested(2)).toBe(2);
      expect(() => module.checkNested(2.5)).toThrowError(
        expect.objectContaining({ refinement: "Integer" }),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("fails every adapter with positioned RF diagnostics", async () => {
    for (const [_name, build] of builders) {
      const failure = await failureMessage(build(knownFalse));
      expect(failure).toMatch(/RF1200/u);
      expect(failure).toMatch(/known-false\.ts/u);
      expect(failure).toMatch(/1:\d+/u);
    }
  });

  it("enforces configured program membership and ignore globs across adapters", async () => {
    for (const [_name, build] of builders) {
      const failure = await failureMessage(build(outsideProgram));
      expect(failure).toContain("unplugin-outside.ts");
      expect(failure).toContain("not included in the program configured by");

      const output = await build(outsideProgram, {
        ...pluginOptions,
        ignore: ["../unplugin-outside.ts"],
      });
      expect(output.code).toContain("outside");
    }
  });

  it("documents Farm 1.7 dropping passthrough transform mappings", async () => {
    const sentinel = "farm-source-map-sentinel.ts";
    const passthrough: JsPlugin = {
      name: "source-map-passthrough",
      transform: {
        filters: { moduleTypes: ["ts"], resolvedPaths: ["entry\\.ts$"] },
        executor(parameters) {
          return {
            content: parameters.content,
            moduleType: parameters.moduleType,
            sourceMap: JSON.stringify({
              mappings: "AAAA",
              names: [],
              sources: [sentinel],
              sourcesContent: [parameters.content],
              version: 3,
            }),
          };
        },
      },
    };
    const logger = new NoopLogger();
    const config = await resolveConfig(
      {
        compilation: {
          input: { index: entry },
          output: { format: "esm", targetEnv: "node" },
          sourcemap: "all",
        },
        plugins: [passthrough],
        root: fixtureDirectory,
      },
      "production",
      logger,
    );
    const compiler = await createCompiler(config, logger);
    await compiler.compile();
    const map = compiler.resources()["index.js.map"]?.toString();

    expect(map).toBeDefined();
    expect(map).not.toContain(sentinel);
    expect(JSON.parse(map ?? "")).toEqual({ mappings: "", names: [], sources: [], version: 3 });
  });
});
