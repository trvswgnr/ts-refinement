import { dirname, resolve } from "node:path";

import type * as ts from "typescript";

import type { AnalyzerContext } from "../../analyzer/src/index.ts";

export interface ProgramState {
  readonly configPath: string;
  readonly context: AnalyzerContext;
  readonly program: ts.Program;
  getScriptVersion(fileName: string): number;
  updateSource(fileName: string, source: string): void;
}

export interface ProgramOptions {
  readonly cwd?: string;
  readonly tsconfig?: string;
}

export function createProgramState(
  tsModule: typeof ts,
  options: ProgramOptions = {},
): ProgramState {
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

  const read = tsModule.readConfigFile(configPath, (fileName) => tsModule.sys.readFile(fileName));
  if (read.error !== undefined) {
    throw new Error(tsModule.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  }

  const parsed = tsModule.parseJsonConfigFileContent(
    read.config,
    tsModule.sys,
    dirname(configPath),
    undefined,
    configPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((diagnostic) => tsModule.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("\n"),
    );
  }

  interface ScriptState {
    readonly snapshot: ts.IScriptSnapshot;
    readonly source: string;
    readonly version: number;
  }

  const diskScripts = new Map<string, ScriptState>();
  const overlays = new Map<string, ScriptState>();
  const normalizeFileName = (fileName: string) => resolve(fileName);

  function readDiskScript(fileName: string): ScriptState | undefined {
    const normalizedFileName = normalizeFileName(fileName);
    const source = tsModule.sys.readFile(normalizedFileName);
    if (source === undefined) {
      diskScripts.delete(normalizedFileName);
      return undefined;
    }

    const previous = diskScripts.get(normalizedFileName);
    if (previous?.source === source) return previous;

    const script = {
      snapshot: tsModule.ScriptSnapshot.fromString(source),
      source,
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

  function getProgram(): ts.Program {
    const program = languageService.getProgram();
    if (program === undefined) {
      throw new Error(`Unable to create a TypeScript program from '${configPath}'.`);
    }
    return program;
  }

  return {
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
    },
  };
}
