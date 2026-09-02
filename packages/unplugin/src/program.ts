import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type * as ts from "typescript";

import type { AnalyzerContext } from "@ts-refinement/analyzer";

export interface ProgramState {
  readonly configFiles: readonly string[];
  readonly configPath: string;
  readonly context: AnalyzerContext;
  readonly program: ts.Program;
  getScriptVersion(fileName: string): number;
  invalidateSource(fileName: string): void;
  updateSource(fileName: string, source: string): void;
}

export interface ProgramOptions {
  readonly cwd?: string;
  readonly tsconfig?: string;
}

interface ProgramConfig {
  readonly configFiles: readonly string[];
  readonly configPath: string;
  readonly parsed: ts.ParsedCommandLine;
}

interface ParsedCompilerOptions extends ts.CompilerOptions {
  readonly configFile?: ts.TsConfigSourceFile;
}

function readProgramConfig(tsModule: typeof ts, options: ProgramOptions): ProgramConfig {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath =
    options.tsconfig === undefined
      ? tsModule.findConfigFile(
          cwd,
          (fileName) => tsModule.sys.fileExists(fileName),
          "tsconfig.json",
        )
      : resolve(cwd, options.tsconfig);

  if (configPath === undefined) {
    throw new Error(`Unable to find tsconfig.json from '${cwd}'.`);
  }

  const parsed = tsModule.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...tsModule.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(tsModule.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  if (parsed === undefined) {
    throw new Error(`Unable to parse TypeScript config '${configPath}'.`);
  }
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((diagnostic) => tsModule.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("\n"),
    );
  }
  // SAFETY: getParsedCommandLineOfConfigFile attaches its parsed source to this internal option
  // in every supported TypeScript version; the named extension preserves the public option shape.
  const configSource = (parsed.options as ParsedCompilerOptions).configFile;
  const configFiles = [
    configPath,
    ...(configSource?.extendedSourceFiles ?? []).map((fileName) =>
      resolve(dirname(configPath), fileName),
    ),
  ];
  return {
    configFiles: [...new Set(configFiles)],
    configPath,
    parsed,
  };
}

export function createProgramState(
  tsModule: typeof ts,
  options: ProgramOptions = {},
): ProgramState {
  const initialConfig = readProgramConfig(tsModule, options);
  const { configPath, parsed } = initialConfig;

  interface ScriptState {
    readonly snapshot: ts.IScriptSnapshot;
    readonly source: string;
    readonly version: number;
  }

  interface DiskScriptState extends ScriptState {
    readonly mtimeMs: number;
    readonly size: number;
  }

  const diskScripts = new Map<string, DiskScriptState>();
  const overlays = new Map<string, ScriptState>();
  const normalizeFileName = (fileName: string) => resolve(fileName);
  function readDiskScript(fileName: string): ScriptState | undefined {
    const normalizedFileName = normalizeFileName(fileName);
    const stats = statSync(normalizedFileName, { throwIfNoEntry: false });
    if (stats === undefined) {
      diskScripts.delete(normalizedFileName);
      return undefined;
    }

    const previous = diskScripts.get(normalizedFileName);
    if (previous?.mtimeMs === stats.mtimeMs && previous.size === stats.size) return previous;

    const source = tsModule.sys.readFile(normalizedFileName);
    if (source === undefined) {
      diskScripts.delete(normalizedFileName);
      return undefined;
    }

    if (previous?.source === source) {
      const script = { ...previous, mtimeMs: stats.mtimeMs, size: stats.size };
      diskScripts.set(normalizedFileName, script);
      return script;
    }

    const script = {
      mtimeMs: stats.mtimeMs,
      snapshot: tsModule.ScriptSnapshot.fromString(source),
      source,
      size: stats.size,
      version: (previous?.version ?? -1) + 1,
    };
    diskScripts.set(normalizedFileName, script);
    return script;
  }

  function getScript(fileName: string): ScriptState | undefined {
    const normalizedFileName = normalizeFileName(fileName);
    return overlays.get(normalizedFileName) ?? readDiskScript(normalizedFileName);
  }

  const host: ts.LanguageServiceHost = {
    fileExists: (fileName) => tsModule.sys.fileExists(fileName),
    getCompilationSettings: () => parsed.options,
    getCurrentDirectory: () => dirname(configPath),
    getDefaultLibFileName: (compilerOptions) => tsModule.getDefaultLibFilePath(compilerOptions),
    getDirectories: (directoryName) => tsModule.sys.getDirectories(directoryName),
    getNewLine: () => tsModule.sys.newLine,
    getProjectReferences: () => parsed.projectReferences,
    getScriptFileNames: () => parsed.fileNames,
    getScriptSnapshot: (fileName) => getScript(fileName)?.snapshot,
    getScriptVersion: (fileName) => String(getScript(fileName)?.version ?? 0),
    readDirectory: (path, extensions, exclude, include, depth) =>
      tsModule.sys.readDirectory(path, extensions, exclude, include, depth),
    readFile: (fileName) =>
      overlays.get(normalizeFileName(fileName))?.source ?? tsModule.sys.readFile(fileName),
    realpath: (path) => tsModule.sys.realpath?.(path) ?? path,
    useCaseSensitiveFileNames: () => tsModule.sys.useCaseSensitiveFileNames,
  };
  const languageService = tsModule.createLanguageService(host, tsModule.createDocumentRegistry());
  let currentProgram: ts.Program | undefined;

  function getProgram(): ts.Program {
    if (currentProgram !== undefined) return currentProgram;
    const program = languageService.getProgram();
    if (program === undefined) {
      throw new Error(`Unable to create a TypeScript program from '${configPath}'.`);
    }
    currentProgram = program;
    return currentProgram;
  }

  return {
    configFiles: initialConfig.configFiles,
    configPath,
    get context() {
      const program = getProgram();
      return { checker: program.getTypeChecker(), program, ts: tsModule };
    },
    get program() {
      return getProgram();
    },
    getScriptVersion(fileName) {
      return getScript(fileName)?.version ?? 0;
    },
    invalidateSource(fileName) {
      overlays.delete(normalizeFileName(fileName));
      currentProgram = undefined;
    },
    updateSource(fileName, source) {
      const normalizedFileName = normalizeFileName(fileName);
      const previous = getScript(normalizedFileName);
      if (previous?.source === source) {
        if (!overlays.has(normalizedFileName) && previous !== undefined) {
          overlays.set(normalizedFileName, previous);
        }
        return;
      }

      overlays.set(normalizedFileName, {
        snapshot: tsModule.ScriptSnapshot.fromString(source),
        source,
        version: (previous?.version ?? -1) + 1,
      });
      currentProgram = undefined;
    },
  };
}
