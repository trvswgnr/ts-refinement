import { resolve } from "node:path";

import { refinementManifestFileName } from "@ts-refinement/analyzer";
import { assertReadableOutputDirectory, verifyOutput } from "./verify.ts";

const usage = `Usage:
  ts-refinement verify OUTDIR [--manifest MANIFEST]`;

interface CliCommand {
  readonly directory: string;
  readonly kind: "verify";
  readonly manifest: string | undefined;
}

export interface CommandIO {
  readonly cwd: string;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
  readonly stdout: Pick<NodeJS.WriteStream, "write">;
}

function defaultIO(): CommandIO {
  return { cwd: process.cwd(), stderr: process.stderr, stdout: process.stdout };
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
  if (arguments_[0] === "verify") return parseVerifyArguments(arguments_);
  throw new Error(usage);
}

export function runCli(arguments_: readonly string[], io: CommandIO = defaultIO()): number {
  try {
    const command = parseArguments(arguments_);
    const directory = resolve(io.cwd, command.directory);
    assertReadableOutputDirectory(directory);
    const manifestPath =
      command.manifest === undefined
        ? resolve(directory, refinementManifestFileName)
        : resolve(io.cwd, command.manifest);
    const failures = verifyOutput(directory, manifestPath);
    if (failures.length > 0) io.stdout.write(`${failures.join("\n")}\n`);
    return failures.length > 0 ? 1 : 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
