import { dirname, relative, resolve } from "node:path";

import ts from "typescript";

import {
  filterEntailedRefinementDiagnostics,
  formatDiagnosticCode,
  getRefinementDiagnostics,
  refinementManifestFileName,
  type AnalyzerContext,
} from "../../analyzer/src/index.ts";
import { assertReadableOutputDirectory, verifyOutput } from "./verify.ts";

const refinementSource = "ts-refinement";
const usage = `Usage:
  ts-refinement check [--project PROJECT]
  ts-refinement verify OUTDIR [--manifest MANIFEST]`;

type CliCommand =
  | { readonly kind: "check"; readonly project: string | undefined }
  | { readonly directory: string; readonly kind: "verify"; readonly manifest: string | undefined };

export interface CommandIO {
  readonly cwd: string;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
  readonly stdout: Pick<NodeJS.WriteStream, "write">;
}

function defaultIO(): CommandIO {
  return { cwd: process.cwd(), stderr: process.stderr, stdout: process.stdout };
}

function parseCheckArguments(arguments_: readonly string[]): CliCommand {
  if (arguments_[0] !== "check") throw new Error(usage);

  let project: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--project" && argument !== "-p") throw new Error(usage);
    if (project !== undefined || index + 1 >= arguments_.length) throw new Error(usage);
    project = arguments_[index + 1];
    index += 1;
  }
  return { kind: "check", project };
}

function parseVerifyArguments(arguments_: readonly string[]): CliCommand {
  const directory = arguments_[1];
  if (arguments_[0] !== "verify" || directory === undefined) throw new Error(usage);

  let manifest: string | undefined;
  for (let index = 2; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--manifest" || manifest !== undefined) throw new Error(usage);
    manifest = arguments_[index + 1];
    if (manifest === undefined) throw new Error(usage);
    index += 1;
  }
  return { directory, kind: "verify", manifest };
}

function parseArguments(arguments_: readonly string[]): CliCommand {
  if (arguments_[0] === "check") return parseCheckArguments(arguments_);
  if (arguments_[0] === "verify") return parseVerifyArguments(arguments_);
  throw new Error(usage);
}

function resolveConfigPath(cwd: string, project: string | undefined): string {
  if (project === undefined) {
    const discovered = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
    if (discovered === undefined) throw new Error(`Unable to find tsconfig.json from '${cwd}'.`);
    return discovered;
  }

  const candidate = resolve(cwd, project);
  return ts.sys.directoryExists(candidate) ? resolve(candidate, "tsconfig.json") : candidate;
}

function parseConfig(configPath: string): ts.ParsedCommandLine {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }
  return ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
    { noEmit: true },
    configPath,
  );
}

function filterSemanticDiagnostics(
  context: AnalyzerContext,
  diagnostics: readonly ts.Diagnostic[],
): readonly ts.Diagnostic[] {
  const byFile = new Map<ts.SourceFile, ts.Diagnostic[]>();
  const filtered = diagnostics.filter((diagnostic) => diagnostic.file === undefined);
  for (const diagnostic of diagnostics) {
    if (diagnostic.file === undefined) continue;
    const fileDiagnostics = byFile.get(diagnostic.file) ?? [];
    fileDiagnostics.push(diagnostic);
    byFile.set(diagnostic.file, fileDiagnostics);
  }
  for (const [sourceFile, fileDiagnostics] of byFile) {
    filtered.push(...filterEntailedRefinementDiagnostics(context, sourceFile, fileDiagnostics));
  }
  return filtered;
}

function refinementDiagnostics(
  context: AnalyzerContext,
  rootNames: readonly string[],
): readonly ts.Diagnostic[] {
  return rootNames.flatMap((fileName) => {
    const sourceFile = context.program.getSourceFile(fileName);
    if (sourceFile === undefined || sourceFile.isDeclarationFile) return [];
    return getRefinementDiagnostics(context, sourceFile).map((diagnostic): ts.Diagnostic => ({
      category:
        diagnostic.severity === "warning"
          ? ts.DiagnosticCategory.Warning
          : ts.DiagnosticCategory.Error,
      code: diagnostic.code,
      file: sourceFile,
      length: diagnostic.length,
      messageText: diagnostic.message,
      source: refinementSource,
      start: diagnostic.start,
    }));
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareDiagnostics(left: ts.Diagnostic, right: ts.Diagnostic): number {
  return (
    compareText(left.file?.fileName ?? "", right.file?.fileName ?? "") ||
    (left.start ?? -1) - (right.start ?? -1) ||
    compareText(left.source ?? "typescript", right.source ?? "typescript") ||
    left.code - right.code ||
    compareText(
      ts.flattenDiagnosticMessageText(left.messageText, "\n"),
      ts.flattenDiagnosticMessageText(right.messageText, "\n"),
    )
  );
}

function formatDiagnostic(diagnostic: ts.Diagnostic, cwd: string): string {
  const category = ts.DiagnosticCategory[diagnostic.category]?.toLowerCase() ?? "error";
  const code =
    diagnostic.source === refinementSource
      ? formatDiagnosticCode(diagnostic.code)
      : `TS${diagnostic.code}`;
  const rawMessage = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const message = rawMessage.replace(new RegExp(`^${code}:\\s*`, "u"), "");
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return `${category} ${code}: ${message}`;
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const fileName = relative(cwd, diagnostic.file.fileName) || diagnostic.file.fileName;
  return `${fileName}(${position.line + 1},${position.character + 1}): ${category} ${code}: ${message}`;
}

function collectDiagnostics(parsed: ts.ParsedCommandLine): readonly ts.Diagnostic[] {
  const program = ts.createProgram({
    configFileParsingDiagnostics: parsed.errors,
    options: { ...parsed.options, noEmit: true },
    projectReferences: parsed.projectReferences,
    rootNames: parsed.fileNames,
  });
  const context = { checker: program.getTypeChecker(), program, ts };
  const semantic = filterSemanticDiagnostics(context, program.getSemanticDiagnostics());
  return [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getDeclarationDiagnostics(),
    ...semantic,
    ...refinementDiagnostics(context, parsed.fileNames),
  ].sort(compareDiagnostics);
}

export function runCli(arguments_: readonly string[], io: CommandIO = defaultIO()): number {
  try {
    const command = parseArguments(arguments_);
    if (command.kind === "verify") {
      const directory = resolve(io.cwd, command.directory);
      assertReadableOutputDirectory(directory);
      const manifestPath =
        command.manifest === undefined
          ? resolve(directory, refinementManifestFileName)
          : resolve(io.cwd, command.manifest);
      const failures = verifyOutput(directory, manifestPath);
      if (failures.length > 0) io.stdout.write(`${failures.join("\n")}\n`);
      return failures.length > 0 ? 1 : 0;
    }

    const configPath = resolveConfigPath(resolve(io.cwd), command.project);
    const parsed = parseConfig(configPath);
    const diagnostics = collectDiagnostics(parsed);
    if (diagnostics.length > 0) {
      io.stdout.write(
        `${diagnostics.map((diagnostic) => formatDiagnostic(diagnostic, io.cwd)).join("\n")}\n`,
      );
    }
    return diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      ? 1
      : 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
