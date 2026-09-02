import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const ttsc = resolve(root, "node_modules/.bin/ttsc");
const outputRoot = mkdtempSync(resolve(tmpdir(), "ts-refinement-ttsc-"));

function runTtsc(project: "invalid" | "unrelated-invalid" | "valid", outDir: string) {
  return spawnSync(
    ttsc,
    [
      "build",
      "--project",
      resolve(root, `fixtures/ttsc/${project}/tsconfig.json`),
      "--emit",
      "--outDir",
      outDir,
    ],
    { cwd: root, encoding: "utf8" },
  );
}

beforeAll(() => {
  const build = spawnSync("bun", ["run", "--cwd", "packages/ttsc-plugin", "build"], {
    cwd: root,
    encoding: "utf8",
  });
  if (build.status !== 0) throw new Error(`${build.stdout}${build.stderr}`);
});

afterAll(() => {
  rmSync(outputRoot, { force: true, recursive: true });
});

describe("TypeScript-Go native plugin", () => {
  it("erases proofs, emits runtime checks, and rejects known failures through ttsc", () => {
    const validOutDir = resolve(outputRoot, "valid");
    const valid = runTtsc("valid", validOutDir);
    expect(valid.status, `${valid.stdout}${valid.stderr}`).toBe(0);

    const emitted = readFileSync(resolve(validOutDir, "fixtures/ttsc/valid/index.js"), "utf8");
    expect(emitted).toContain("knownGood = 5;");
    expect(emitted).toContain("new __ts_refinement_error");
    expect(emitted).toContain("runtimeChecked");
    expect(emitted).toContain("Object.keys");
    expect(emitted).toContain("__ts_refinement_validate0");
    expect(emitted).toContain("new WeakSet");
    expect(emitted).toContain('path: ("" + __ts_refinement_path');
    expect(emitted).not.toContain("as Positive");

    const invalid = runTtsc("invalid", resolve(outputRoot, "invalid"));
    const diagnostics = `${invalid.stdout}${invalid.stderr}`;
    expect(invalid.status).toBe(2);
    expect(diagnostics).toContain("error RF90200:");
    expect(diagnostics).toContain("does not satisfy refinement 'Positive'");
    expect(diagnostics).toContain("at '.age'");

    const unrelatedInvalid = runTtsc("unrelated-invalid", resolve(outputRoot, "unrelated-invalid"));
    expect(unrelatedInvalid.status).toBe(2);
    expect(`${unrelatedInvalid.stdout}${unrelatedInvalid.stderr}`).toContain("TS2322:");
  }, 180_000);
});
