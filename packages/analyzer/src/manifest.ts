export const refinementManifestSchemaVersion = 1;
export const refinementManifestFileName = ".ts-refinement-manifest.json";
export const refinementMarkerPrefix = "ts-refinement-site:";

export interface RefinementManifestAsset {
  readonly file: string;
  readonly sha256: string;
}

export interface RefinementManifestSite {
  readonly id: string;
  readonly length: number;
  readonly module: string;
  readonly predicateKeys: readonly string[];
  readonly start: number;
}

export interface RefinementManifest {
  readonly assets: readonly RefinementManifestAsset[];
  readonly buildId: string;
  readonly project: {
    readonly configPath: string;
  };
  readonly schemaVersion: typeof refinementManifestSchemaVersion;
  readonly sites: readonly RefinementManifestSite[];
}

export function refinementSiteMarker(buildId: string, siteId: string): string {
  return `${refinementMarkerPrefix}${buildId}:${siteId}`;
}
