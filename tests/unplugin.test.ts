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

import { verifyOutput } from "../packages/cli/src/verify.ts";
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
  readonly manifest: string;
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
  manifest: string,
): BuildOutput {
  const chunk = output.find((item) => item.type === "chunk");
  if (chunk?.code === undefined || chunk.map === undefined || chunk.map === null) {
    throw new Error("build did not emit a mapped JavaScript chunk");
  }
  return { code: chunk.code, manifest, map: JSON.stringify(chunk.map), sourceIdentity: true };
}

async function buildRollup(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const directory = await mkdtemp(join(tmpdir(), "ts-refinement-rollup-"));
  const bundle = await rollup({ input, plugins: [rollupRefinement(options)] });
  try {
    const output = await bundle.write({ dir: directory, format: "es", sourcemap: true });
    const manifestPath = join(directory, ".ts-refinement-manifest.json");
    expect(verifyOutput(directory, manifestPath)).toEqual([]);
    return outputFromChunk(output.output, await readFile(manifestPath, "utf8"));
  } finally {
    await bundle.close();
    await rm(directory, { force: true, recursive: true });
  }
}

async function buildRolldown(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const directory = await mkdtemp(join(tmpdir(), "ts-refinement-rolldown-"));
  const bundle = await rolldown({ input, plugins: [rolldownRefinement(options)] });
  try {
    const output = await bundle.write({ dir: directory, format: "esm", sourcemap: true });
    const manifestPath = join(directory, ".ts-refinement-manifest.json");
    expect(verifyOutput(directory, manifestPath)).toEqual([]);
    return outputFromChunk(output.output, await readFile(manifestPath, "utf8"));
  } finally {
    await bundle.close();
    await rm(directory, { force: true, recursive: true });
  }
}

async function buildVite(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const directory = await mkdtemp(join(tmpdir(), "ts-refinement-vite-"));
  try {
    const result = await viteBuild({
      build: {
        emptyOutDir: true,
        lib: { entry: input, fileName: "bundle", formats: ["es"] },
        minify: false,
        outDir: directory,
        sourcemap: true,
      },
      configFile: false,
      logLevel: "silent",
      plugins: [viteRefinement(options)],
      root: fixtureDirectory,
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (output === undefined || !("output" in output)) throw new Error("Vite build had no output");
    const manifestPath = join(directory, ".ts-refinement-manifest.json");
    expect(verifyOutput(directory, manifestPath)).toEqual([]);
    return outputFromChunk(output.output, await readFile(manifestPath, "utf8"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function buildEsbuild(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
): Promise<BuildOutput> {
  const directory = await mkdtemp(join(tmpdir(), "ts-refinement-esbuild-"));
  try {
    await esbuild.build({
      absWorkingDir: fixtureDirectory,
      bundle: true,
      entryPoints: [input],
      format: "esm",
      logLevel: "silent",
      outfile: join(directory, "bundle.mjs"),
      platform: "node",
      plugins: [esbuildRefinement(options)],
      sourcemap: "external",
    });
    const manifestPath = join(directory, ".ts-refinement-manifest.json");
    expect(verifyOutput(directory, manifestPath)).toEqual([]);
    return {
      code: await readFile(join(directory, "bundle.mjs"), "utf8"),
      manifest: await readFile(manifestPath, "utf8"),
      map: await readFile(join(directory, "bundle.mjs.map"), "utf8"),
      sourceIdentity: true,
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function buildWebpack(
  input = entry,
  options: RefinementTypesPluginOptions = pluginOptions,
  fileName = "bundle.mjs",
): Promise<BuildOutput> {
  const directory = await mkdtemp(join(tmpdir(), "ts-refinement-webpack-"));
  const compiler = webpack({
    context: fixtureDirectory,
    devtool: fileName.endsWith(".mjs") ? "source-map" : false,
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
    output: { filename: fileName, library: { type: "module" }, module: true, path: directory },
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
    const manifestPath = join(directory, ".ts-refinement-manifest.json");
    expect(verifyOutput(directory, manifestPath)).toEqual([]);
    return {
      code: await readFile(join(directory, fileName), "utf8"),
      manifest: await readFile(manifestPath, "utf8"),
      map: fileName.endsWith(".mjs")
        ? await readFile(join(directory, `${fileName}.map`), "utf8")
        : "{}",
      sourceIdentity: fileName.endsWith(".mjs"),
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
  fileName = "bundle.mjs",
): Promise<BuildOutput> {
  const directory = await mkdtemp(join(tmpdir(), "ts-refinement-rspack-"));
  const config = {
    context: fixtureDirectory,
    devtool: fileName.endsWith(".mjs") ? "source-map" : false,
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
    output: { filename: fileName, library: { type: "module" }, module: true, path: directory },
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
    const manifestPath = join(directory, ".ts-refinement-manifest.json");
    expect(verifyOutput(directory, manifestPath)).toEqual([]);
    return {
      code: await readFile(join(directory, fileName), "utf8"),
      manifest: await readFile(manifestPath, "utf8"),
      map: fileName.endsWith(".mjs")
        ? await readFile(join(directory, `${fileName}.map`), "utf8")
        : "{}",
      sourceIdentity: fileName.endsWith(".mjs"),
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
    compiler.writeResourcesToDisk();
    const resources = compiler.resources();
    const javascript = Object.entries(resources).find(([name]) => name.endsWith(".js"));
    const map = Object.entries(resources).find(([name]) => name.endsWith(".js.map"));
    if (javascript === undefined || map === undefined)
      throw new Error("Farm output was incomplete");
    const manifestPath = join(directory, ".ts-refinement-manifest.json");
    expect(verifyOutput(directory, manifestPath)).toEqual([]);
    const manifest = await readFile(manifestPath, "utf8");
    return {
      code: javascript[1].toString(),
      manifest,
      map: map[1].toString(),
      sourceIdentity: false,
    };
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

describe("unplugin adapter conformance", { timeout: 30_000 }, () => {
  it.each(builders)("builds working validators with %s", async (_name, build) => {
    const output = await build();
    expect(output.code).not.toContain("as Positive");
    expect(output.code).toContain("RefinementError");
    expect(() => JSON.parse(output.map)).not.toThrow();
    if (output.sourceIdentity) expect(output.map).toContain("entry.ts");
    expect(JSON.parse(output.manifest)).toMatchObject({ schemaVersion: 1 });
    expect(output.manifest).toContain("entry.ts");

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
      expect(failure).toMatch(/RF1000200/u);
      expect(failure).toMatch(/known-false\.ts/u);
      expect(failure).toMatch(/1:\d+/u);
    }
  });

  it("enforces configured program membership across adapters", async () => {
    for (const [_name, build] of builders) {
      const failure = await failureMessage(build(outsideProgram));
      expect(failure).toContain("unplugin-outside.ts");
      expect(failure).toContain("not included in the program configured by");
    }
  });

  it("leaves existing manifests untouched during memory-only builds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ts-refinement-memory-build-"));
    const manifestPath = join(directory, ".ts-refinement-manifest.json");
    const sentinel = "existing manifest\n";
    async function expectSentinel(): Promise<void> {
      expect(await readFile(manifestPath, "utf8")).toBe(sentinel);
    }

    try {
      await writeFile(manifestPath, sentinel);
      const rollupBundle = await rollup({
        input: entry,
        plugins: [rollupRefinement(pluginOptions)],
      });
      try {
        await rollupBundle.generate({ dir: directory, format: "es" });
      } finally {
        await rollupBundle.close();
      }
      await expectSentinel();

      const rolldownBundle = await rolldown({
        input: entry,
        plugins: [rolldownRefinement(pluginOptions)],
      });
      try {
        await rolldownBundle.generate({ dir: directory, format: "esm" });
      } finally {
        await rolldownBundle.close();
      }
      await expectSentinel();

      await viteBuild({
        build: { lib: { entry, formats: ["es"] }, outDir: directory, write: false },
        configFile: false,
        logLevel: "silent",
        plugins: [viteRefinement(pluginOptions)],
        root: fixtureDirectory,
      });
      await expectSentinel();

      await esbuild.build({
        bundle: true,
        entryPoints: [entry],
        outdir: directory,
        plugins: [esbuildRefinement(pluginOptions)],
        write: false,
      });
      await expectSentinel();

      const logger = new NoopLogger();
      const config = await resolveConfig(
        {
          compilation: {
            input: { index: entry },
            output: { format: "esm", path: directory, targetEnv: "node" },
          },
          plugins: [farmRefinement(pluginOptions)],
          root: fixtureDirectory,
        },
        "production",
        logger,
      );
      const compiler = await createCompiler(config, logger);
      await compiler.compile();
      await expectSentinel();
    } finally {
      await rm(directory, { force: true, recursive: true });
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

  it("verifies extensionless webpack and Rspack JavaScript chunks", async () => {
    const outputs = await Promise.all([
      buildWebpack(entry, pluginOptions, "bundle"),
      buildRspack(entry, pluginOptions, "bundle"),
    ]);
    for (const output of outputs) {
      expect(JSON.parse(output.manifest)).toMatchObject({ assets: [{ file: "bundle" }] });
    }
  });

  it("writes an esbuild manifest accepted by the CLI verifier", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ts-refinement-esbuild-manifest-"));
    try {
      await esbuild.build({
        absWorkingDir: fixtureDirectory,
        bundle: true,
        entryPoints: [entry],
        format: "esm",
        logLevel: "silent",
        minify: true,
        outfile: join(directory, "bundle"),
        platform: "node",
        plugins: [esbuildRefinement(pluginOptions)],
      });
      expect(verifyOutput(directory, join(directory, ".ts-refinement-manifest.json"))).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
