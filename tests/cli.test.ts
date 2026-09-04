import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";

import type { RefinementManifest } from "../packages/analyzer/src/index.ts";
import { runCli, type CommandIO } from "../packages/cli/src/cli.ts";
import refinementTypes from "../packages/unplugin/src/rolldown.ts";

const fixtureDirectory = resolve(import.meta.dirname, "../fixtures/cli");
const analysisFixtureDirectory = resolve(import.meta.dirname, "../fixtures/analysis");

async function buildVerifiedOutput(): Promise<string> {
  const directory = mkdtempSync(resolve(tmpdir(), "ts-refinement-verify-"));
  const bundle = await rolldown({
    input: resolve(analysisFixtureDirectory, "nested-runtime.ts"),
    plugins: [
      refinementTypes({
        cwd: analysisFixtureDirectory,
        runtimeModule: resolve(import.meta.dirname, "../packages/runtime/src/index.ts"),
        tsconfig: "tsconfig.json",
      }),
    ],
  });
  try {
    await bundle.write({ dir: directory, format: "esm" });
    return directory;
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  } finally {
    await bundle.close();
  }
}

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

describe("ts-refinement verify", () => {
  it("verifies instrumented output and reports marker, digest, build, and syntax failures", async () => {
    const directory = await buildVerifiedOutput();
    const manifestPath = resolve(directory, ".ts-refinement-manifest.json");
    const assetPath = resolve(directory, "nested-runtime.js");
    try {
      const originalManifestSource = readFileSync(manifestPath, "utf8");
      const originalCode = readFileSync(assetPath, "utf8");
      // SAFETY: the build plugin produced this file from the RefinementManifest contract.
      const originalManifest = JSON.parse(originalManifestSource) as RefinementManifest;
      const firstSite = originalManifest.sites[0];
      if (firstSite === undefined) throw new Error("expected a runtime-required site");

      expect(invoke(["verify", directory])).toEqual({ code: 0, stderr: "", stdout: "" });

      const unmanifestedAsset = resolve(directory, "stale.js");
      writeFileSync(unmanifestedAsset, "export const stale = true;\n");
      const staleOutput = invoke(["verify", directory]);
      expect(staleOutput.code).toBe(1);
      expect(staleOutput.stdout).toContain(
        "JavaScript asset 'stale.js' is not listed in the refinement manifest",
      );
      rmSync(unmanifestedAsset);

      const customManifest = resolve(directory, "custom-manifest.json");
      renameSync(manifestPath, customManifest);
      expect(invoke(["verify", directory, "--manifest", customManifest])).toEqual({
        code: 0,
        stderr: "",
        stdout: "",
      });
      renameSync(customManifest, manifestPath);

      const marker = `ts-refinement-site:${originalManifest.buildId}:${firstSite.id}`;
      const markerlessCode = originalCode.replace(marker, "removed-runtime-marker");
      const markerlessManifest = {
        ...originalManifest,
        assets: [
          {
            file: "nested-runtime.js",
            sha256: createHash("sha256").update(markerlessCode).digest("hex"),
          },
        ],
      };
      writeFileSync(assetPath, markerlessCode);
      writeFileSync(manifestPath, JSON.stringify(markerlessManifest));
      const missingMarker = invoke(["verify", directory]);
      expect(missingMarker.code).toBe(1);
      expect(missingMarker.stdout).toContain(
        `'${firstSite.module}' at ${firstSite.start}:${firstSite.length} (site ${firstSite.id})`,
      );
      expect(missingMarker.stdout).not.toContain("SHA-256 mismatch");

      const decoyCode = `
    console.log(${JSON.stringify(marker)});
    export const metadata = { marker: ${JSON.stringify(marker)} };
      const ts_refinement_validator_decoy = { assert() {} };
      ts_refinement_validator_decoy.assert(0, ${JSON.stringify(marker)});
    `;
      writeFileSync(resolve(directory, "decoy.js"), decoyCode);
      writeFileSync(
        manifestPath,
        JSON.stringify({
          ...markerlessManifest,
          assets: [
            ...markerlessManifest.assets,
            {
              file: "decoy.js",
              sha256: createHash("sha256").update(decoyCode).digest("hex"),
            },
          ],
        }),
      );
      expect(invoke(["verify", directory]).stdout).toContain("Missing runtime marker");

      const interpolatedMarkerCode = originalCode.replaceAll(
        JSON.stringify(marker),
        `\`${marker}\${""}\``,
      );
      writeFileSync(assetPath, interpolatedMarkerCode);
      writeFileSync(
        manifestPath,
        JSON.stringify({
          ...originalManifest,
          assets: [
            {
              file: "nested-runtime.js",
              sha256: createHash("sha256").update(interpolatedMarkerCode).digest("hex"),
            },
          ],
        }),
      );
      expect(invoke(["verify", directory]).stdout).toContain("Missing runtime marker");

      writeFileSync(assetPath, `${originalCode}\n`);
      writeFileSync(manifestPath, originalManifestSource);
      expect(invoke(["verify", directory]).stdout).toContain(
        "SHA-256 mismatch for manifest asset 'nested-runtime.js'",
      );

      writeFileSync(assetPath, originalCode);
      writeFileSync(manifestPath, JSON.stringify({ ...originalManifest, buildId: randomUUID() }));
      expect(invoke(["verify", directory]).stdout).toContain("Missing runtime marker");

      const malformedCode = "export {";
      writeFileSync(assetPath, malformedCode);
      writeFileSync(
        manifestPath,
        JSON.stringify({
          ...originalManifest,
          assets: [
            {
              file: "nested-runtime.js",
              sha256: createHash("sha256").update(malformedCode).digest("hex"),
            },
          ],
        }),
      );
      expect(invoke(["verify", directory]).stdout).toContain(
        "Emitted JavaScript asset 'nested-runtime.js' is malformed",
      );

      writeFileSync(manifestPath, JSON.stringify({ ...originalManifest, schemaVersion: 2 }));
      expect(invoke(["verify", directory]).stdout).toContain(
        "Malformed or unsupported refinement manifest",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("fails without integration output and classifies argument/directory errors", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "ts-refinement-plain-build-"));
    const externalDirectory = mkdtempSync(resolve(tmpdir(), "ts-refinement-external-"));
    try {
      writeFileSync(resolve(directory, "index.js"), "export const value = 1;\n");
      writeFileSync(resolve(directory, "index.d.ts"), "export declare const value = 1;\n");
      const missing = invoke(["verify", directory]);
      expect(missing.code).toBe(1);
      expect(missing.stdout).toContain("Missing or unreadable refinement manifest");

      const externalAsset = resolve(externalDirectory, "external.js");
      const linkedAsset = resolve(directory, "linked.js");
      const externalSource = '"ts-refinement-site:outside:site";\n';
      writeFileSync(externalAsset, externalSource);
      symlinkSync(externalAsset, linkedAsset);
      writeFileSync(
        resolve(directory, ".ts-refinement-manifest.json"),
        JSON.stringify({
          assets: [
            {
              file: "linked.js",
              sha256: createHash("sha256").update(externalSource).digest("hex"),
            },
          ],
          buildId: "outside",
          project: { configPath: "tsconfig.json" },
          schemaVersion: 1,
          sites: [],
        }),
      );
      expect(invoke(["verify", directory]).stdout).toContain("is outside output directory");

      rmSync(linkedAsset);
      const invalidBytes = Buffer.from([0x2f, 0x2f, 0x20, 0xff, 0x0a]);
      writeFileSync(resolve(directory, "invalid.js"), invalidBytes);
      writeFileSync(
        resolve(directory, ".ts-refinement-manifest.json"),
        JSON.stringify({
          assets: [
            {
              file: "invalid.js",
              sha256: createHash("sha256").update(invalidBytes.toString("utf8")).digest("hex"),
            },
          ],
          buildId: "bytes",
          project: { configPath: "tsconfig.json" },
          schemaVersion: 1,
          sites: [],
        }),
      );
      expect(invoke(["verify", directory]).stdout).toContain("SHA-256 mismatch");

      expect(invoke(["verify"]).code).toBe(2);
      expect(invoke(["verify", directory, "--manifest"]).code).toBe(2);
      expect(invoke(["verify", resolve(directory, "missing")]).code).toBe(2);
    } finally {
      rmSync(directory, { force: true, recursive: true });
      rmSync(externalDirectory, { force: true, recursive: true });
    }
  });
});
