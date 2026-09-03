import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
    expect(emitted).toContain("runtimeCaptured");
    expect(emitted).toContain("runtimeImportedCapture");
    expect(emitted).toMatch(/if \(value > 0\)\s+return value;/u);
    expect(emitted).toMatch(/else\s+return value;/u);
    expect(emitted).toContain("return value > 0 ? (value) : null;");
    expect(emitted).toMatch(/value = dynamic;\s+return \(\(__ts_refinement_value\)/u);
    expect(emitted).not.toContain("__ts_refinement_value > LIMIT");
    expect(emitted).not.toContain("__ts_refinement_value > IMPORTED_LIMIT");
    expect(emitted).toContain("Object.keys");
    expect(emitted).toContain("__ts_refinement_validate0");
    expect(emitted).toContain("new WeakSet");
    expect(emitted).toContain('path: ("" + __ts_refinement_path');
    expect(emitted).not.toContain("as Positive");

    const manifest = JSON.parse(
      readFileSync(resolve(validOutDir, ".ts-refinement-manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({ schemaVersion: 1 });
    expect(manifest.sites).toHaveLength(12);
    expect(manifest.sites.every((site: { module: string }) => site.module === "index.ts")).toBe(
      true,
    );
    expect(
      manifest.sites.every((site: { id: string }) =>
        emitted.includes(`ts-refinement-site:${manifest.buildId}:${site.id}`),
      ),
    ).toBe(true);
    const emittedAsset = manifest.assets.find(
      (asset: { file: string }) => asset.file === "fixtures/ttsc/valid/index.js",
    );
    expect(emittedAsset?.sha256).toBe(createHash("sha256").update(emitted).digest("hex"));

    const invalid = runTtsc("invalid", resolve(outputRoot, "invalid"));
    const diagnostics = `${invalid.stdout}${invalid.stderr}`;
    expect(invalid.status).toBe(2);
    expect(diagnostics).toContain("error RF90200:");
    expect(diagnostics).toContain("error RF90101:");
    expect(diagnostics).toContain("error RF90003:");
    expect(diagnostics).toContain("Predicate capture 'MUTABLE_LIMIT'");
    expect(diagnostics).toContain("does not satisfy refinement 'Positive'");
    expect(diagnostics).toContain("at '.age'");

    const unrelatedInvalid = runTtsc("unrelated-invalid", resolve(outputRoot, "unrelated-invalid"));
    expect(unrelatedInvalid.status).toBe(2);
    expect(`${unrelatedInvalid.stdout}${unrelatedInvalid.stderr}`).toContain("TS2322:");
  }, 180_000);
});
