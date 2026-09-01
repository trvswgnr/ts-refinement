import { dirname, matchesGlob, relative, resolve } from "node:path";

import type { Plugin } from "rolldown";
import ts from "typescript";

import { createProgramState, type ProgramState } from "./program.ts";
import { transformSource } from "./transform.ts";
import { createValidatorRegistry } from "./validators.ts";

export interface RefinementTypesPluginOptions {
  readonly cwd?: string;
  readonly ignore?: readonly string[];
  readonly runtimeModule?: string;
  readonly tsconfig?: string;
}

function cleanModuleId(id: string): string {
  return id.split(/[?#]/u, 1)[0] ?? id;
}

function isTransformableTypeScript(fileName: string): boolean {
  return /\.[cm]?tsx?$/u.test(fileName) && !/\.d\.[cm]?ts$/u.test(fileName);
}

export function refinementTypesPlugin(options: RefinementTypesPluginOptions = {}): Plugin {
  const ignore = options.ignore ?? [];
  const runtimeModule = options.runtimeModule ?? "@ts-refinement/runtime";
  const registry = createValidatorRegistry(ts, runtimeModule);
  let state: ProgramState | null = null;

  return {
    name: "ts-refinement",

    buildStart() {
      registry.clear();
      if (state === null || !state.isConfigCurrent()) {
        state = createProgramState(ts, options);
      }
      this.addWatchFile(state.configPath);
      for (const sourceFile of state.program.getSourceFiles()) {
        this.addWatchFile(sourceFile.fileName);
      }
    },

    load(id) {
      return registry.getByResolvedId(id)?.moduleCode ?? null;
    },

    resolveId(id) {
      return registry.isPublicId(id) ? registry.resolvePublicId(id) : null;
    },

    transform: {
      order: "pre",
      handler(code, id) {
        const fileName = resolve(cleanModuleId(id));
        if (!isTransformableTypeScript(fileName)) return null;
        if (state === null) state = createProgramState(ts, options);

        const relativeFileName = relative(dirname(state.configPath), fileName).replaceAll(
          "\\",
          "/",
        );
        if (ignore.some((pattern) => matchesGlob(relativeFileName, pattern))) return null;

        state.updateSource(fileName, code);
        const context = state.context;
        const sourceFile = context.program.getSourceFile(fileName);
        if (sourceFile === undefined) {
          this.error({
            id: fileName,
            message: `TypeScript module '${fileName}' is not included in the program configured by '${state.configPath}'.`,
          });
        }
        const output = transformSource(context, sourceFile, code, registry);
        const diagnostic = output.diagnostics[0];
        if (diagnostic !== undefined) {
          this.error({
            code: `RF${diagnostic.code}`,
            id: fileName,
            message: diagnostic.message,
            pos: diagnostic.start,
          });
        }
        if (output.code === null) return null;
        return { code: output.code, map: output.map };
      },
    },
  };
}

export default refinementTypesPlugin;
