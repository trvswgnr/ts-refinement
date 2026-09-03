import { readFile } from "node:fs/promises";
import type {
  LoadFnOutput,
  LoadHook,
  ModuleSource,
  ResolveFnOutput,
  ResolveHook,
} from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { createProgramState, type ProgramState } from "./program.ts";
import { transformSource } from "./transform.ts";
import { createValidatorRegistry } from "./validators.ts";

type NextResolve = Parameters<ResolveHook>[2];
type NextLoad = Parameters<LoadHook>[2];

const validatorProtocol = "ts-refinement:";
const runtimeModule = process.env["TS_REFINEMENT_RUNTIME_MODULE"] ?? "@ts-refinement/runtime";
const registry = createValidatorRegistry(ts, runtimeModule);
let state: ProgramState | null = null;

function programState(): ProgramState {
  state ??= createProgramState(ts, {
    cwd: process.env["TS_REFINEMENT_CWD"],
    tsconfig: process.env["TS_REFINEMENT_TSCONFIG"],
  });
  return state;
}

async function sourceText(fileName: string, source: ModuleSource | undefined): Promise<string> {
  if (source === undefined) return readFile(fileName, "utf8");
  if (source instanceof ArrayBuffer) return Buffer.from(source).toString("utf8");
  if (ArrayBuffer.isView(source)) {
    return Buffer.from(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    ).toString("utf8");
  }
  return source;
}

export async function resolve(
  specifier: string,
  context: Parameters<ResolveHook>[1],
  nextResolve: NextResolve,
): Promise<ResolveFnOutput> {
  if (registry.isPublicId(specifier)) {
    return { shortCircuit: true, url: `${validatorProtocol}${specifier}` };
  }
  if (context.parentURL?.startsWith(validatorProtocol) === true) {
    return nextResolve(specifier, { ...context, parentURL: loaderUrl });
  }
  return nextResolve(specifier, context);
}

export async function load(
  url: string,
  context: Parameters<LoadHook>[1],
  nextLoad: NextLoad,
): Promise<LoadFnOutput> {
  if (url.startsWith(validatorProtocol)) {
    const id = url.slice(validatorProtocol.length);
    const entry = registry.getByResolvedId(registry.resolvePublicId(id));
    if (entry === undefined) throw new Error(`Unknown refinement validator '${id}'.`);
    return { format: "module", shortCircuit: true, source: entry.moduleCode };
  }

  const loaded = await nextLoad(url, context);
  if (!url.startsWith("file:") || !/\.[cm]?tsx?$/u.test(new URL(url).pathname)) return loaded;
  const fileName = fileURLToPath(url);
  const source = await sourceText(fileName, loaded.source);
  const current = programState();
  current.updateSource(fileName, source);
  const sourceFile = current.context.program.getSourceFile(fileName);
  if (sourceFile === undefined) {
    throw new Error(
      `TypeScript module '${fileName}' is not included in the program configured by '${current.configPath}'.`,
    );
  }
  const output = transformSource(current.context, sourceFile, source, registry);
  const diagnostic = output.diagnostics[0];
  if (diagnostic !== undefined) throw new Error(diagnostic.message);
  return output.code === null ? loaded : { ...loaded, source: output.code };
}

export const loaderUrl = pathToFileURL(import.meta.filename).href;
