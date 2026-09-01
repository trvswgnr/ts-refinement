import { dirname, resolve } from "node:path";

import type * as ts from "typescript";

import type { AnalyzerContext } from "../../analyzer/src/index.ts";

export interface ProgramState {
  readonly configPath: string;
  readonly context: AnalyzerContext;
  readonly program: ts.Program;
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

  const program = tsModule.createProgram({
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    rootNames: parsed.fileNames,
  });

  return {
    configPath,
    context: { checker: program.getTypeChecker(), program, ts: tsModule },
    program,
  };
}
