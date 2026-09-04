import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const matrixDirectory = resolve(root, "fixtures/entailment-matrix");
const tspc = resolve(root, "node_modules/.bin/tspc");
const ttsc = resolve(root, "node_modules/.bin/ttsc");
const typescript = resolve(root, "node_modules/typescript/lib/typescript.js");

const validAssignments = [
  "validStringToTemplate",
  "validTemplateToString",
  "validStringToNumber",
  "validNumberToString",
  "validTemplateToNarrowTemplate",
  "validNarrowTemplateToTemplate",
  "validSymbol",
  "validNamedToString",
  "validProperty",
  "validOptional",
  "validArray",
  "validTuple",
  "validOptionalTuple",
  "validRestTuple",
  "validGeneric",
  "validUnion",
  "validParameter",
  "validRecursive",
  "validMutableArray",
  "validRequiredToOptionalTuple",
  "validShortToOptionalTuple",
  "validFixedToRestTuple",
];

const invalidAssignments = [
  "invalidStringToTemplate",
  "invalidTemplateToString",
  "invalidStringToNumber",
  "invalidNumberToString",
  "invalidTemplateToNarrowTemplate",
  "invalidNarrowTemplateToTemplate",
  "invalidSymbol",
  "invalidNamedToString",
  "invalidProperty",
  "invalidOptional",
  "invalidArray",
  "invalidTuple",
  "invalidOptionalTuple",
  "invalidRestTuple",
  "invalidGeneric",
  "invalidUnion",
  "invalidParameter",
  "invalidRecursive",
  "invalidReadonlyArray",
  "invalidOptionalRequired",
  "invalidTupleLength",
  "invalidTupleMember",
  "invalidOptionalToRequiredTuple",
  "invalidRestToFixedTuple",
  "invalidTupleExtra",
  "invalidFixedToRestMember",
];

function expectMatrixDiagnostics(output: string): void {
  for (const name of validAssignments) expect(output).not.toMatch(new RegExp(`\\b${name}\\b`, "u"));
  for (const name of invalidAssignments) expect(output).toMatch(new RegExp(`\\b${name}\\b`, "u"));
}

beforeAll(() => {
  for (const packageName of ["analyzer", "typescript-plugin", "ttsc-plugin"]) {
    const build = spawnSync("bun", ["run", "--cwd", `packages/${packageName}`, "build"], {
      cwd: root,
      encoding: "utf8",
    });
    if (build.status !== 0) throw new Error(`${build.stdout}${build.stderr}`);
  }
});

describe("compiler-generation entailment parity", { timeout: 120_000 }, () => {
  it("reports only invalid matrix assignments through tspc", () => {
    const result = spawnSync(
      tspc,
      ["--project", resolve(matrixDirectory, "tsconfig.legacy.json"), "--pretty", "true"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TSP_COMPILER_TS_PATH: typescript },
      },
    );
    expect(result.status).toBe(2);
    expectMatrixDiagnostics(`${result.stdout}${result.stderr}`);
  });

  it("reports only invalid matrix assignments through ttsc", () => {
    const result = spawnSync(
      ttsc,
      ["check", "--project", resolve(matrixDirectory, "tsconfig.native.json")],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expectMatrixDiagnostics(`${result.stdout}${result.stderr}`);
  });
});
