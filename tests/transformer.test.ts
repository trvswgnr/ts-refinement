import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { expectEntailmentMatrixDiagnostics } from "./entailment-matrix.ts";

const tspc = resolve(import.meta.dirname, "../node_modules/.bin/tspc");
const typescript = resolve(import.meta.dirname, "../node_modules/typescript/lib/typescript.js");
const fixture = (name: string) =>
  resolve(import.meta.dirname, `../fixtures/cli/${name}/tsconfig.json`);

function runTspc(project: string) {
  return spawnSync(tspc, ["--project", project, "--noEmit", "--pretty", "true"], {
    encoding: "utf8",
    env: { ...process.env, TSP_COMPILER_TS_PATH: typescript },
  });
}

beforeAll(() => {
  const build = spawnSync("bun", ["run", "--cwd", "packages/typescript-plugin", "build"], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
  });
  if (build.status !== 0) throw new Error(`${build.stdout}${build.stderr}`);
});

describe("ts-patch Program Transformer", () => {
  it("owns refinement diagnostics through tspc", { timeout: 30_000 }, () => {
    const valid = runTspc(fixture("valid"));
    expect({ status: valid.status, stderr: valid.stderr, stdout: valid.stdout }).toEqual({
      status: 0,
      stderr: "",
      stdout: "",
    });

    const invalid = runTspc(fixture("invalid"));
    const output = `${invalid.stdout}${invalid.stderr}`;
    expect(invalid.status).toBe(2);
    expect(output).toContain("TS2322:");
    expect(output).toContain("RF1000200:");

    const importedInvalid = runTspc(fixture("imported-invalid"));
    expect(importedInvalid.status).toBe(2);
    expect(`${importedInvalid.stdout}${importedInvalid.stderr}`).toMatch(
      /imported\.ts.*RF1000200/su,
    );
  });

  it("filters only valid entailment matrix assignments through tspc", () => {
    const result = runTspc(
      resolve(import.meta.dirname, "../fixtures/entailment-matrix/tsconfig.legacy.json"),
    );
    expect(result.status).toBe(2);
    expectEntailmentMatrixDiagnostics(`${result.stdout}${result.stderr}`);
  });
});
