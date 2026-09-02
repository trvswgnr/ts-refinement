import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const tspc = resolve(import.meta.dirname, "../node_modules/.bin/tspc");
const typescript = resolve(import.meta.dirname, "../node_modules/typescript/lib/typescript.js");
const fixture = (name: string) =>
  resolve(import.meta.dirname, `../fixtures/cli/${name}/tsconfig.json`);

function runTspc(project: string) {
  return spawnSync(tspc, ["--project", project], {
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
  it("owns refinement diagnostics through tspc", () => {
    const valid = runTspc(fixture("valid"));
    expect({ status: valid.status, stderr: valid.stderr, stdout: valid.stdout }).toEqual({
      status: 0,
      stderr: "",
      stdout: "",
    });

    const invalid = runTspc(fixture("invalid"));
    const output = `${invalid.stdout}${invalid.stderr}`;
    expect(invalid.status).toBe(2);
    expect(output).toContain("error TS2322:");
    expect(output).toContain("RF90200:");
  });
});
