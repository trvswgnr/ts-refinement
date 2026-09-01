import { resolve } from "node:path";

import type { Plugin } from "rolldown";
import ts from "typescript";

import { createProgramState, type ProgramState } from "./program.ts";
import { transformSource } from "./transform.ts";
import { createValidatorRegistry } from "./validators.ts";

export interface RefinementTypesPluginOptions {
  readonly cwd?: string;
  readonly runtimeModule?: string;
  readonly tsconfig?: string;
}

function cleanModuleId(id: string): string {
  return id.split("?", 1)[0] ?? id;
}

function isTransformableTypeScript(fileName: string): boolean {
  return /\.[cm]?tsx?$/u.test(fileName) && !/\.d\.[cm]?ts$/u.test(fileName);
}

export function refinementTypesPlugin(options: RefinementTypesPluginOptions = {}): Plugin {
  const runtimeModule = options.runtimeModule ?? "ts-refinement-types/runtime";
  const registry = createValidatorRegistry(ts, runtimeModule);
  let state: ProgramState | null = null;

  return {
    name: "typescript-refinement-types",

    buildStart() {
      registry.clear();
      state = createProgramState(ts, options);
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

        const sourceFile = state.program.getSourceFile(fileName);
        if (sourceFile === undefined) return null;
        const output = transformSource(state.context, sourceFile, code, registry);
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
