import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

beforeAll(() => {
  const build = spawnSync("bun", ["run", "--cwd", "packages/unplugin", "build"], {
    cwd: root,
    encoding: "utf8",
  });
  if (build.status !== 0) throw new Error(`${build.stdout}${build.stderr}`);
});

describe("runtime runner adapters", () => {
  it("transforms refinements through Vitest", () => {
    const result = spawnSync(
      resolve(root, "node_modules/.bin/vitest"),
      ["run", "--config", "fixtures/vitest/vitest.config.ts"],
      { cwd: root, encoding: "utf8" },
    );
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  });

  it("transforms refinements through the Node loader", () => {
    const entry = pathToFileURL(resolve(root, "fixtures/unplugin/entry.ts")).href;
    const runtime = pathToFileURL(resolve(root, "fixtures/unplugin/runtime.mjs")).href;
    const result = spawnSync(
      process.execPath,
      [
        "--loader",
        resolve(root, "packages/unplugin/dist/loader.mjs"),
        "--input-type=module",
        "--eval",
        `const module = await import(${JSON.stringify(entry)}); console.log(module.checkDynamic(2)); try { module.checkDynamic(-1); } catch (error) { console.log(error.name, error.value); }`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          TS_REFINEMENT_CWD: resolve(root, "fixtures/unplugin"),
          TS_REFINEMENT_RUNTIME_MODULE: runtime,
          TS_REFINEMENT_TSCONFIG: "tsconfig.json",
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("2\nRefinementError -1\n");
  });
});
