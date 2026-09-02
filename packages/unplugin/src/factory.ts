import { dirname, matchesGlob, relative, resolve } from "node:path";

import ts from "typescript";
import { createUnplugin, type UnpluginFactory } from "unplugin";

import type { RefinementTypesPluginOptions } from "./options.ts";
import { createProgramState, type ProgramState } from "./program.ts";
import { transformSource } from "./transform.ts";
import { createValidatorRegistry } from "./validators.ts";

function cleanModuleId(id: string): string {
  return id.split(/[?#]/u, 1)[0] ?? id;
}

function isTransformableTypeScript(fileName: string): boolean {
  return /\.[cm]?tsx?$/u.test(fileName) && !/\.d\.[cm]?ts$/u.test(fileName);
}

const factory: UnpluginFactory<RefinementTypesPluginOptions | undefined, false> = (
  options = {},
  meta,
) => {
  const ignore = options.ignore ?? [];
  const runtimeModule = options.runtimeModule ?? "@ts-refinement/runtime";
  const registry = createValidatorRegistry(ts, runtimeModule);
  let state: ProgramState | null = null;

  return {
    name: "ts-refinement",
    enforce: "pre",

    buildStart() {
      registry.clear();
      if (state === null || !state.isConfigCurrent()) {
        state = createProgramState(ts, options);
      }
      if (meta.framework !== "esbuild") {
        for (const configFile of state.configFiles) this.addWatchFile(configFile);
        for (const sourceFile of state.program.getSourceFiles()) {
          this.addWatchFile(sourceFile.fileName);
        }
      }
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
      filter: { id: /\.[cm]?tsx?(?:[?#].*)?$/u },
      handler(code, id) {
        const fileName = resolve(cleanModuleId(id));
        if (!isTransformableTypeScript(fileName)) return null;
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

        state.updateSource(fileName, code);
        const context = state.context;
        const sourceFile = context.program.getSourceFile(fileName);
        if (sourceFile === undefined) {
          const message = `TypeScript module '${fileName}' is not included in the program configured by '${state.configPath}'.`;
          if (meta.framework === "farm") throw new Error(message);
          else this.error({ id: fileName, message });
          return null;
        }
        const output = transformSource(context, sourceFile, code, registry);
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
