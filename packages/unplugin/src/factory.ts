import { dirname, extname, matchesGlob, relative, resolve } from "node:path";

import ts from "typescript";
import { createUnplugin, type UnpluginFactory } from "unplugin";

import type { RefinementTypesPluginOptions } from "./options.ts";
import { createProgramState, type ProgramState } from "./program.ts";
import {
  createBuildTracker,
  finalAssetsFromPaths,
  writeBuildManifest,
  writeFinalAssetManifest,
  writeFinalAssetManifestSync,
} from "./manifest.ts";
import { transformSource } from "./transform.ts";
import { createValidatorRegistry } from "./validators.ts";

function cleanModuleId(id: string): string {
  return id.split(/[?#]/u, 1)[0] ?? id;
}

function isTransformableTypeScript(fileName: string): boolean {
  return /\.[cm]?tsx?$/u.test(fileName) && !/\.d\.[cm]?ts$/u.test(fileName);
}

const refinementAssertionPattern = /\bas\s+|<\s*[A-Za-z_$][\w$]*/u;

function canContainRefinementAssertion(source: string): boolean {
  return refinementAssertionPattern.test(source);
}

function isJavaScriptAsset(fileName: string): boolean {
  return [".cjs", ".js", ".mjs"].includes(extname(fileName));
}

function isScriptModule(fileName: string): boolean {
  return /\.[cm]?[jt]sx?$/u.test(fileName);
}

const factory: UnpluginFactory<RefinementTypesPluginOptions | undefined, false> = (
  options = {},
  meta,
) => {
  const ignore = options.ignore ?? [];
  const runtimeModule = options.runtimeModule ?? "@ts-refinement/runtime";
  const registry = createValidatorRegistry(ts, runtimeModule);
  const tracker = createBuildTracker();
  let state: ProgramState | null = null;
  const rollupManifestHooks = {
    writeBundle(outputOptions, bundle) {
      return writeBuildManifest(tracker, outputOptions, bundle);
    },
  } satisfies Partial<import("rollup").Plugin>;
  const rolldownManifestHooks = {
    writeBundle(outputOptions, bundle) {
      return writeBuildManifest(tracker, outputOptions, bundle);
    },
  } satisfies Partial<import("rolldown").Plugin>;
  const viteManifestHooks = {
    writeBundle(outputOptions, bundle) {
      return writeBuildManifest(tracker, outputOptions, bundle);
    },
  } satisfies Partial<import("vite").Plugin>;

  return {
    name: "ts-refinement",
    enforce: "pre",
    esbuild: {
      setup(build) {
        build.initialOptions.metafile = true;
        build.onEnd(async (result) => {
          if (result.errors.length > 0 || build.initialOptions.write === false) return;
          const workingDirectory = resolve(build.initialOptions.absWorkingDir ?? process.cwd());
          const directory = build.initialOptions.outfile
            ? dirname(resolve(workingDirectory, build.initialOptions.outfile))
            : build.initialOptions.outdir
              ? resolve(workingDirectory, build.initialOptions.outdir)
              : null;
          if (directory === null) {
            throw new Error("esbuild requires outfile or outdir to write a refinement manifest.");
          }
          const paths = Object.entries(result.metafile?.outputs ?? {})
            .filter(([, output]) => Object.keys(output.inputs).some(isScriptModule))
            .map(([fileName]) => resolve(workingDirectory, fileName));
          await writeFinalAssetManifest(
            tracker,
            directory,
            await finalAssetsFromPaths(directory, paths),
          );
        });
      },
    },
    farm: {
      writeResources: {
        executor(parameters) {
          const assets = Object.entries(parameters.resourcesMap)
            .filter(([, resource]) => resource.resourceType === "js")
            .map(([file, resource]) => ({ file, source: Uint8Array.from(resource.bytes) }));
          const outputPath = parameters.config?.output?.path;
          if (outputPath === undefined) {
            throw new Error("Farm requires an output path to write a refinement manifest.");
          }
          writeFinalAssetManifestSync(tracker, resolve(outputPath), assets);
        },
      },
    },
    rolldown: rolldownManifestHooks,
    rollup: rollupManifestHooks,
    vite: viteManifestHooks,
    webpack(compiler) {
      compiler.hooks.afterEmit.tapPromise("ts-refinement-manifest", async (compilation) => {
        if (compilation.errors.length > 0) return;
        const chunkFiles = new Set([...compilation.chunks].flatMap((chunk) => [...chunk.files]));
        const paths = compilation
          .getAssets()
          .filter((asset) => chunkFiles.has(asset.name) || isJavaScriptAsset(asset.name))
          .map((asset) => resolve(compiler.outputPath, asset.name));
        await writeFinalAssetManifest(
          tracker,
          compiler.outputPath,
          await finalAssetsFromPaths(compiler.outputPath, paths),
        );
      });
    },
    rspack(compiler) {
      compiler.hooks.afterEmit.tapPromise("ts-refinement-manifest", async (compilation) => {
        if (compilation.errors.length > 0) return;
        const chunkFiles = new Set([...compilation.chunks].flatMap((chunk) => [...chunk.files]));
        const paths = compilation
          .getAssets()
          .filter((asset) => chunkFiles.has(asset.name) || isJavaScriptAsset(asset.name))
          .map((asset) => resolve(compiler.outputPath, asset.name));
        await writeFinalAssetManifest(
          tracker,
          compiler.outputPath,
          await finalAssetsFromPaths(compiler.outputPath, paths),
        );
      });
    },

    buildStart() {
      registry.clear();
      if (state === null || !state.isConfigCurrent()) {
        state = createProgramState(ts, options);
      }
      tracker.reset(state.configPath);
      if (meta.framework !== "esbuild") {
        for (const configFile of state.configFiles) this.addWatchFile(configFile);
        for (const sourceFile of state.program.getSourceFiles()) {
          this.addWatchFile(sourceFile.fileName);
        }
      }
    },

    watchChange(id) {
      if (state === null) return;
      const fileName = resolve(cleanModuleId(id));
      if (state.configFiles.includes(fileName)) state = null;
      else state.invalidateSource(fileName);
    },

    load: {
      filter: { id: /ts-refinement-validator-/u },
      handler(id) {
        return registry.getByResolvedId(id)?.moduleCode ?? null;
      },
    },

    resolveId: {
      filter: { id: /ts-refinement-validator-/u },
      handler(id) {
        return registry.isPublicId(id) ? registry.resolvePublicId(id) : null;
      },
    },

    transform: {
      filter: {
        code: refinementAssertionPattern,
        id: /\.[cm]?tsx?(?:[?#].*)?$/u,
      },
      handler(code, id) {
        const fileName = resolve(cleanModuleId(id));
        if (!isTransformableTypeScript(fileName)) return null;
        if (!canContainRefinementAssertion(code)) return null;
        if (state === null) state = createProgramState(ts, options);
        if (meta.framework === "esbuild") {
          for (const configFile of state.configFiles) this.addWatchFile(configFile);
          for (const sourceFile of state.program.getSourceFiles()) {
            this.addWatchFile(sourceFile.fileName);
          }
        }

        const relativeFileName = relative(dirname(state.configPath), fileName).replaceAll(
          "\\",
          "/",
        );
        if (ignore.some((pattern) => matchesGlob(relativeFileName, pattern))) return null;

        if (state.program.getSourceFile(fileName) === undefined) {
          const message = `TypeScript module '${fileName}' is not included in the program configured by '${state.configPath}'.`;
          if (meta.framework === "farm") throw new Error(message);
          else this.error({ id: fileName, message });
          return null;
        }

        state.updateSource(fileName, code);
        const context = state.context;
        const sourceFile = context.program.getSourceFile(fileName);
        if (sourceFile === undefined) {
          const message = `TypeScript module '${fileName}' is not included in the program configured by '${state.configPath}'.`;
          if (meta.framework === "farm") throw new Error(message);
          else this.error({ id: fileName, message });
          return null;
        }
        const output = transformSource(context, sourceFile, code, registry, tracker);
        const diagnostic = output.diagnostics[0];
        if (diagnostic !== undefined) {
          const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
          const message = `${fileName}:${position.line + 1}:${position.character + 1}: ${diagnostic.message}`;
          if (meta.framework === "farm") throw new Error(message);
          else {
            this.error({
              code: `RF${diagnostic.code}`,
              id: fileName,
              loc: { column: position.character, file: fileName, line: position.line + 1 },
              message,
            });
          }
          return null;
        }
        if (output.code === null) return null;
        return { code: output.code, map: output.map };
      },
    },
  };
};

export const refinementTypes = createUnplugin(factory);
