import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

beforeAll(() => {
  const build = spawnSync("bun", ["run", "--cwd", "packages/unplugin", "build"], {
    cwd: root,
    encoding: "utf8",
  });
  if (build.status !== 0) throw new Error(`${build.stdout}${build.stderr}`);
});

describe("runtime runner adapters", { timeout: 30_000 }, () => {
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

  it("transforms CommonJS refinements through the Node loader", () => {
    const entry = pathToFileURL(resolve(root, "fixtures/unplugin/commonjs/refinement.ts")).href;
    const runtime = pathToFileURL(resolve(root, "fixtures/unplugin/runtime.mjs")).href;
    const result = spawnSync(
      process.execPath,
      [
        "--loader",
        resolve(root, "packages/unplugin/dist/loader.mjs"),
        "--input-type=module",
        "--eval",
        `const module = await import(${JSON.stringify(entry)}); const { RefinementError } = await import(${JSON.stringify(runtime)}); console.log(module.checkPositive(2)); try { module.checkPositive(-1); } catch (error) { console.log(error instanceof RefinementError, error.name, error.value); }`,
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
    expect(result.stdout).toContain("2\ntrue RefinementError -1\n");
  });

  it("loads TypeScript before delegating to Node", async () => {
    const entry = pathToFileURL(resolve(root, "fixtures/unplugin/entry.ts")).href;
    process.env["TS_REFINEMENT_CWD"] = resolve(root, "fixtures/unplugin");
    process.env["TS_REFINEMENT_RUNTIME_MODULE"] = pathToFileURL(
      resolve(root, "fixtures/unplugin/runtime.mjs"),
    ).href;
    process.env["TS_REFINEMENT_TSCONFIG"] = "tsconfig.json";
    const { load, resolve: resolveHook } = await import("../packages/unplugin/src/loader.ts");

    const output = await load(
      entry,
      { conditions: [], format: undefined, importAttributes: {} },
      async () => {
        throw new TypeError("Unknown file extension '.ts'");
      },
    );

    expect(output.format).toBe("module");
    expect(String(output.source)).toContain("function checkDynamic(value = 0)");
    expect(String(output.source)).toContain("return __rf_");
    expect(String(output.source)).not.toContain("value: number");
    const source = String(output.source);
    const validatorCall = source.indexOf("return __rf_") + "return ".length;
    const precedingLines = source.slice(0, validatorCall).split("\n");
    const encodedMap = source.match(
      /sourceMappingURL=data:application\/json;base64,([^\n]+)/u,
    )?.[1];
    if (encodedMap === undefined) throw new Error("loader output has no inline source map");
    expect(
      originalPositionFor(new TraceMap(Buffer.from(encodedMap, "base64").toString("utf8")), {
        column: precedingLines.at(-1)?.length ?? 0,
        line: precedingLines.length,
      }),
    ).toMatchObject({ column: 9, line: 4 });

    const aliasEntry = pathToFileURL(resolve(root, "fixtures/unplugin/alias-entry.ts")).href;
    const alias = await resolveHook(
      "@fixture/alias-value",
      { conditions: [], importAttributes: {}, parentURL: aliasEntry },
      async () => {
        throw new Error("Node could not resolve the TypeScript path alias.");
      },
    );
    expect(alias).toEqual({
      shortCircuit: true,
      url: pathToFileURL(resolve(root, "fixtures/unplugin/alias-value.ts")).href,
    });

    const jsxEntry = pathToFileURL(resolve(root, "fixtures/unplugin/jsx-entry.tsx")).href;
    const jsx = await load(
      jsxEntry,
      { conditions: [], format: undefined, importAttributes: {} },
      async () => {
        throw new TypeError("Unknown file extension '.tsx'");
      },
    );
    expect(String(jsx.source)).not.toContain("<section");
    expect(String(jsx.source)).toContain("react/jsx-runtime");

    const commonjsEntry = pathToFileURL(resolve(root, "fixtures/unplugin/commonjs/value.ts")).href;
    const commonjs = await load(
      commonjsEntry,
      { conditions: [], format: undefined, importAttributes: {} },
      async () => {
        throw new TypeError("Unknown file extension '.ts'");
      },
    );
    expect(commonjs.format).toBe("commonjs");
    expect(String(commonjs.source)).toContain("module.exports = value");

    const irrelevantOutside = pathToFileURL(resolve(root, "fixtures/irrelevant-outside.ts")).href;
    const irrelevant = await load(
      irrelevantOutside,
      { conditions: [], format: undefined, importAttributes: {} },
      async () => {
        throw new TypeError("Unknown file extension '.ts'");
      },
    );
    expect(String(irrelevant.source)).toContain("irrelevant = true");

    const assertionOutside = pathToFileURL(resolve(root, "fixtures/unplugin-outside.ts")).href;
    await expect(
      load(
        assertionOutside,
        { conditions: [], format: undefined, importAttributes: {} },
        async () => {
          throw new TypeError("Unknown file extension '.ts'");
        },
      ),
    ).rejects.toThrow(/not included in the program configured by/u);
  });
});
