export interface PackagedBundleLayout {
  bundleRoot: string;
  executablePath: string;
  resourcesPath: string;
  nodePath?: string;
}

export interface PackagedBundleManifestFile {
  path: string;
  sha256: string;
  size: number;
}

export interface PackagedBundleManifest {
  algorithm: "sha256";
  bundleDigest: string;
  files: PackagedBundleManifestFile[];
  manifestPath: string;
  release: {
    gitSha: string;
    version: string;
  };
  schemaVersion: 1;
}

export const PACKAGED_BUNDLE_MANIFEST: "release-manifest.json";

export function resolvePackagedBundleLayout(outputPath: string, platform: string): Promise<PackagedBundleLayout>;
export function resolvePackagedExecutableLayout(
  executableOrAppPath: string,
  platform?: string
): Promise<PackagedBundleLayout>;
export function verifyPackagedBundleManifest(input: PackagedBundleLayout): Promise<PackagedBundleManifest>;
export function writeForgePackagedBundleManifests(packageResult: {
  outputPaths: string[];
  platform: string;
}): Promise<PackagedBundleManifest[]>;
export function writePackagedBundleManifest(input: PackagedBundleLayout): Promise<PackagedBundleManifest>;
