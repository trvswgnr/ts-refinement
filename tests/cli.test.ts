import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli, type CommandIO } from "../packages/cli/src/cli.ts";

const fixtureDirectory = resolve(import.meta.dirname, "../fixtures/cli");

function invoke(arguments_: readonly string[], cwd = fixtureDirectory) {
  let stderr = "";
  let stdout = "";
  const io: CommandIO = {
    cwd,
    stderr: {
      write(chunk) {
        stderr += String(chunk);
        return true;
      },
    },
    stdout: {
      write(chunk) {
        stdout += String(chunk);
        return true;
      },
    },
  };
  return { code: runCli(arguments_, io), stderr, stdout };
}

describe("ts-refinement check", () => {
  it("accepts entailed assignments through file, directory, and discovered projects", () => {
    const config = resolve(fixtureDirectory, "valid/tsconfig.json");
    const directory = resolve(fixtureDirectory, "valid");
    const nested = resolve(directory, "nested");

    expect(invoke(["check", "--project", config])).toEqual({ code: 0, stderr: "", stdout: "" });
    expect(invoke(["check", "-p", directory])).toEqual({ code: 0, stderr: "", stdout: "" });
    expect(invoke(["check"], nested)).toEqual({ code: 0, stderr: "", stdout: "" });
  });

  it("preserves inverse, refinement, and unrelated diagnostics deterministically", () => {
    const config = resolve(fixtureDirectory, "invalid/tsconfig.json");
    const first = invoke(["check", "--project", config]);
    const second = invoke(["check", "--project", config]);

    expect(first).toEqual(second);
    expect(first.code).toBe(1);
    expect(first.stderr).toBe("");
    expect(first.stdout).toContain("error TS2322:");
    expect(first.stdout).toContain("error RF1200:");
    expect(first.stdout).toContain("invalid/index.ts(9,26): error RF1200:");
    expect(first.stdout).toContain("invalid/index.ts(10,14): error TS2322:");
  });

  it("reports command and config errors with exit code 2", () => {
    expect(invoke([])).toEqual({ code: 2, stderr: expect.stringContaining("Usage:"), stdout: "" });
    expect(invoke(["check", "--project"])).toEqual({
      code: 2,
      stderr: expect.stringContaining("Usage:"),
      stdout: "",
    });
    expect(invoke(["check", "-p", "missing/tsconfig.json"]).code).toBe(2);

    const malformed = mkdtempSync(resolve(tmpdir(), "ts-refinement-cli-"));
    try {
      writeFileSync(resolve(malformed, "tsconfig.json"), '{ "compilerOptions": { "strict": true }');
      expect(invoke(["check", "-p", malformed]).code).toBe(2);
    } finally {
      rmSync(malformed, { force: true, recursive: true });
    }
  });

  it("formats TypeScript configuration diagnostics with exit code 1", () => {
    const result = invoke(["check", "-p", "config-error"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("error TS5023: Unknown compiler option 'notACompilerOption'.");
  });

  it("never emits output even when the project enables emit", () => {
    const directory = resolve(fixtureDirectory, "no-emit");
    const outputDirectory = resolve(directory, "dist");

    expect(existsSync(outputDirectory)).toBe(false);
    expect(invoke(["check", "-p", directory])).toEqual({ code: 0, stderr: "", stdout: "" });
    expect(existsSync(outputDirectory)).toBe(false);
  });
});
