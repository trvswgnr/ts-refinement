import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

import {
  refinementManifestSchemaVersion,
  refinementManifestFileName,
  refinementSiteMarker,
  type AnalysisResult,
  type RefinementManifest,
  type RefinementManifestAsset,
  type RefinementManifestSite,
} from "@ts-refinement/analyzer";

export interface BuildTracker {
  readonly buildId: string;
  readonly configPath: string;
  readonly sites: readonly RefinementManifestSite[];
  registerSite(analysis: AnalysisResult): string;
  reset(configPath: string): void;
}

interface OutputBundleEntry {
  readonly code?: string;
  readonly fileName: string;
  readonly source?: string | Uint8Array;
  readonly type: string;
}

interface OutputLocation {
  readonly dir?: string;
  readonly file?: string;
}

export interface FinalJavaScriptAsset {
  readonly file: string;
  readonly source: string | Uint8Array;
}

function normalizeModule(configPath: string, fileName: string): string {
  return relative(dirname(configPath), fileName).replaceAll("\\", "/");
}

function siteIdentity(configPath: string, analysis: AnalysisResult): RefinementManifestSite {
  if (analysis.site.checks.length === 0) {
    throw new Error("Cannot register an unresolved refinement site.");
  }
  const identity = {
    length: analysis.site.node.getWidth(),
    module: normalizeModule(configPath, analysis.site.fileName),
    predicateKeys: analysis.site.checks.flatMap((check) =>
      check.definition.predicates.map((predicate) => predicate.key),
    ),
    start: analysis.site.node.getStart(),
  };
  const id = createHash("sha256")
    .update(
      JSON.stringify({
        ...identity,
        checks: analysis.site.checks.map((check) => ({
          path: check.path,
          predicateKeys: check.definition.predicates.map((predicate) => predicate.key),
        })),
        recursions: analysis.site.recursions,
      }),
    )
    .digest("hex");
  return { id, ...identity };
}

export function createBuildTracker(): BuildTracker {
  let buildId = "";
  let configPath = "";
  const byId = new Map<string, RefinementManifestSite>();

  return {
    get buildId() {
      return buildId;
    },
    get configPath() {
      return configPath;
    },
    get sites() {
      return [...byId.values()].sort((left, right) =>
        left.module === right.module
          ? left.start - right.start
          : left.module.localeCompare(right.module),
      );
    },
    registerSite(analysis) {
      if (buildId.length === 0 || configPath.length === 0) {
        throw new Error("Refinement build tracker was not initialized.");
      }
      const site = siteIdentity(configPath, analysis);
      const existing = byId.get(site.id);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(site)) {
        throw new Error(`Refinement runtime site ID collision for '${site.id}'.`);
      }
      byId.set(site.id, site);
      return refinementSiteMarker(buildId, site.id);
    },
    reset(nextConfigPath) {
      buildId = randomUUID();
      configPath = nextConfigPath;
      byId.clear();
    },
  };
}

function optionalOutputDirectory(options: OutputLocation): string | null {
  if (options.dir !== undefined) return resolve(options.dir);
  if (options.file !== undefined) return dirname(resolve(options.file));
  return null;
}

function outputDirectory(options: OutputLocation): string {
  const directory = optionalOutputDirectory(options);
  if (directory === null) {
    throw new Error("Unable to determine build output directory for refinement manifest.");
  }
  return directory;
}

function isJavaScriptFile(fileName: string): boolean {
  return [".cjs", ".js", ".mjs"].includes(extname(fileName));
}

function manifestAssets(assets: readonly FinalJavaScriptAsset[]): RefinementManifestAsset[] {
  return assets
    .map((asset) => ({
      file: asset.file.replaceAll("\\", "/"),
      sha256: createHash("sha256").update(asset.source).digest("hex"),
    }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function buildManifestSource(
  tracker: BuildTracker,
  assets: readonly FinalJavaScriptAsset[],
): string {
  if (tracker.buildId.length === 0 || tracker.configPath.length === 0) {
    throw new Error("Refinement build tracker was not initialized.");
  }
  const manifest: RefinementManifest = {
    assets: manifestAssets(assets),
    buildId: tracker.buildId,
    project: { configPath: tracker.configPath },
    schemaVersion: refinementManifestSchemaVersion,
    sites: tracker.sites,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function writeFinalAssetManifest(
  tracker: BuildTracker,
  directory: string,
  assets: readonly FinalJavaScriptAsset[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, refinementManifestFileName),
    buildManifestSource(tracker, assets),
  );
}

export function writeFinalAssetManifestSync(
  tracker: BuildTracker,
  directory: string,
  assets: readonly FinalJavaScriptAsset[],
): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, refinementManifestFileName),
    buildManifestSource(tracker, assets),
  );
}

export async function finalAssetsFromPaths(
  directory: string,
  paths: readonly string[],
): Promise<readonly FinalJavaScriptAsset[]> {
  return Promise.all(
    paths.map(async (fileName) => ({
      file: relative(directory, fileName).replaceAll("\\", "/"),
      source: await readFile(fileName),
    })),
  );
}

export async function writeBuildManifest(
  tracker: BuildTracker,
  options: OutputLocation,
  bundle: Readonly<Record<string, OutputBundleEntry>>,
): Promise<void> {
  const directory = outputDirectory(options);
  await writeFinalAssetManifest(
    tracker,
    directory,
    Object.values(bundle).flatMap((entry): readonly FinalJavaScriptAsset[] => {
      if (
        entry.type === "chunk" &&
        entry.code !== undefined &&
        !/\.d\.[cm]?ts$/u.test(entry.fileName)
      ) {
        return [{ file: entry.fileName, source: entry.code }];
      }
      if (
        entry.type === "asset" &&
        entry.source !== undefined &&
        isJavaScriptFile(entry.fileName)
      ) {
        return [{ file: entry.fileName, source: entry.source }];
      }
      return [];
    }),
  );
}
