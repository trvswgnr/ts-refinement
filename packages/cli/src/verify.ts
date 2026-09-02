import { createHash } from "node:crypto";
import { constants, accessSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import ts from "typescript";
import * as v from "valibot";

import {
  refinementManifestSchemaVersion,
  refinementSiteMarker,
  type RefinementManifest,
} from "../../analyzer/src/index.ts";

const manifestSchema = v.strictObject({
  assets: v.array(
    v.strictObject({
      file: v.string(),
      sha256: v.string(),
    }),
  ),
  buildId: v.string(),
  project: v.strictObject({ configPath: v.string() }),
  schemaVersion: v.literal(refinementManifestSchemaVersion),
  sites: v.array(
    v.strictObject({
      id: v.string(),
      length: v.number(),
      module: v.string(),
      predicateKeys: v.array(v.string()),
      start: v.number(),
    }),
  ),
});

export function assertReadableOutputDirectory(directory: string): void {
  const statistics = statSync(directory);
  if (!statistics.isDirectory()) throw new Error(`Output path '${directory}' is not a directory.`);
  accessSync(directory, constants.R_OK);
}

type ManifestReadResult =
  | { readonly error: string; readonly ok: false }
  | { readonly manifest: RefinementManifest; readonly ok: true };

function readManifest(manifestPath: string): ManifestReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return { error: `Missing or unreadable refinement manifest '${manifestPath}'.`, ok: false };
  }
  const result = v.safeParse(manifestSchema, parsed);
  return result.success
    ? { manifest: result.output, ok: true }
    : {
        error: `Malformed or unsupported refinement manifest '${manifestPath}'.`,
        ok: false,
      };
}

type AssetPathResult =
  | { readonly error: "missing" | "outside"; readonly ok: false }
  | { readonly ok: true; readonly path: string };

function isOutside(directory: string, candidate: string): boolean {
  const relativeName = relative(directory, candidate);
  return relativeName === ".." || relativeName.startsWith(`..${sep}`) || isAbsolute(relativeName);
}

function containedAssetPath(directory: string, fileName: string): AssetPathResult {
  if (isAbsolute(fileName)) return { error: "outside", ok: false };
  const assetPath = resolve(directory, fileName);
  if (isOutside(directory, assetPath)) return { error: "outside", ok: false };
  try {
    const realDirectory = realpathSync(directory);
    const realAssetPath = realpathSync(assetPath);
    return isOutside(realDirectory, realAssetPath)
      ? { error: "outside", ok: false }
      : { ok: true, path: realAssetPath };
  } catch {
    return { error: "missing", ok: false };
  }
}

function parseMarkers(fileName: string, source: string): Set<string> | null {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { allowJs: true, target: ts.ScriptTarget.Latest },
    fileName,
    reportDiagnostics: true,
  });
  if ((transpiled.diagnostics?.length ?? 0) > 0) return null;

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const markers = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) markers.add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return markers;
}

export function verifyOutput(directory: string, manifestPath: string): readonly string[] {
  const result = readManifest(manifestPath);
  if (!result.ok) return [result.error];
  const { manifest } = result;

  const failures: string[] = [];
  const markers = new Set<string>();
  for (const asset of manifest.assets) {
    const assetPath = containedAssetPath(directory, asset.file);
    if (!assetPath.ok) {
      failures.push(
        assetPath.error === "outside"
          ? `Manifest asset '${asset.file}' is outside output directory '${directory}'.`
          : `Manifest asset '${asset.file}' is missing or unreadable.`,
      );
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = readFileSync(assetPath.path);
    } catch {
      failures.push(`Manifest asset '${asset.file}' is missing or unreadable.`);
      continue;
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) {
      failures.push(`SHA-256 mismatch for manifest asset '${asset.file}'.`);
    }
    const assetMarkers = parseMarkers(asset.file, bytes.toString("utf8"));
    if (assetMarkers === null) {
      failures.push(`Emitted JavaScript asset '${asset.file}' is malformed.`);
    } else {
      for (const marker of assetMarkers) markers.add(marker);
    }
  }

  for (const site of manifest.sites) {
    if (markers.has(refinementSiteMarker(manifest.buildId, site.id))) continue;
    failures.push(
      `Missing runtime marker for '${site.module}' at ${site.start}:${site.length} (site ${site.id}).`,
    );
  }
  return failures;
}
