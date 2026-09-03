import { readFile } from "node:fs/promises";
import type { LoadFnOutput, LoadHook, ResolveFnOutput, ResolveHook } from "node:module";
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

function transpileSource(fileName: string, source: string, current: ProgramState): string {
  const options = current.context.program.getCompilerOptions();
  const jsx =
    options.jsx === undefined || options.jsx === ts.JsxEmit.Preserve
      ? ts.JsxEmit.ReactJSX
      : options.jsx;
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      ...options,
      declaration: false,
      declarationMap: false,
      emitDeclarationOnly: false,
      inlineSourceMap: true,
      inlineSources: true,
      jsx,
      module: fileName.endsWith(".cts") ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
      moduleResolution: fileName.endsWith(".cts")
        ? ts.ModuleResolutionKind.Node10
        : ts.ModuleResolutionKind.Bundler,
      noEmit: false,
      noEmitOnError: false,
      sourceMap: false,
    },
    fileName,
    reportDiagnostics: true,
  });
  const diagnostic = transpiled.diagnostics?.find(
    (candidate) => candidate.category === ts.DiagnosticCategory.Error,
  );
  if (diagnostic !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }
  return transpiled.outputText;
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
  if (context.parentURL?.startsWith("file:") === true) {
    const parentFile = fileURLToPath(context.parentURL);
    if (/\.[cm]?tsx?$/u.test(parentFile)) {
      const current = programState();
      const resolved = ts.resolveModuleName(
        specifier,
        parentFile,
        current.context.program.getCompilerOptions(),
        ts.sys,
      ).resolvedModule?.resolvedFileName;
      if (
        resolved !== undefined &&
        /\.[cm]?tsx?$/u.test(resolved) &&
        !/\.d\.[cm]?ts$/u.test(resolved)
      ) {
        return { shortCircuit: true, url: pathToFileURL(resolved).href };
      }
    }
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

  if (!url.startsWith("file:") || !/\.[cm]?tsx?$/u.test(new URL(url).pathname)) {
    return nextLoad(url, context);
  }
  const fileName = fileURLToPath(url);
  const source = await readFile(fileName, "utf8");
  const current = programState();
  const sourceFile = current.context.program.getSourceFile(fileName);
  if (sourceFile === undefined) {
    throw new Error(
      `TypeScript module '${fileName}' is not included in the program configured by '${current.configPath}'.`,
    );
  }
  if (sourceFile.text !== source) {
    throw new Error(
      `TypeScript module '${fileName}' was changed before ts-refinement ran. Configure ts-refinement as the first source transform.`,
    );
  }
  const output = transformSource(current.context, sourceFile, source, registry);
  const diagnostic = output.diagnostics[0];
  if (diagnostic !== undefined) throw new Error(diagnostic.message);
  return {
    format: fileName.endsWith(".cts") ? "commonjs" : "module",
    shortCircuit: true,
    source: transpileSource(fileName, output.code ?? source, current),
  };
}

export const loaderUrl = pathToFileURL(import.meta.filename).href;
