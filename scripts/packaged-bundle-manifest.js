import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const PACKAGED_BUNDLE_MANIFEST = "release-manifest.json";
const SCHEMA_VERSION = 1;
const HASH_ALGORITHM = "sha256";

export async function writeForgePackagedBundleManifests(packageResult) {
  const manifests = [];
  for (const outputPath of packageResult.outputPaths) {
    const layout = await resolvePackagedBundleLayout(outputPath, packageResult.platform);
    manifests.push(await writePackagedBundleManifest(layout));
  }
  return manifests;
}

export async function writePackagedBundleManifest(input) {
  const layout = normalizeLayout(input);
  const payload = await buildPayload(layout);
  const manifest = {
    ...payload,
    bundleDigest: digestCanonicalPayload(payload)
  };
  const manifestPath = join(layout.resourcesPath, PACKAGED_BUNDLE_MANIFEST);
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, manifestPath);
  return { ...manifest, manifestPath };
}

export async function verifyPackagedBundleManifest(input) {
  const layout = normalizeLayout(input);
  const manifestPath = join(layout.resourcesPath, PACKAGED_BUNDLE_MANIFEST);
  const manifest = parseManifest(await readFile(manifestPath, "utf8"), manifestPath);
  const release = await readReleaseIdentity(layout);
  if (JSON.stringify(manifest.release) !== JSON.stringify(release)) {
    throw new Error("Packaged release identity does not match its content manifest.");
  }

  const payload = await buildPayload(layout);
  const expectedDigest = digestCanonicalPayload(payload);
  if (
    JSON.stringify(manifest.files) !== JSON.stringify(payload.files) ||
    manifest.bundleDigest !== expectedDigest
  ) {
    throw new Error("Packaged bundle does not match its content manifest.");
  }
  return { ...manifest, manifestPath };
}

export async function resolvePackagedBundleLayout(outputPath, platform) {
  const resolvedOutput = resolve(outputPath);
  if (platform === "darwin" || platform === "mas") {
    const appDirectories = (await readdir(resolvedOutput, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
      .map((entry) => entry.name)
      .sort();
    if (appDirectories.length !== 1) {
      throw new Error(`Expected exactly one packaged .app in ${resolvedOutput}.`);
    }
    const bundleRoot = join(resolvedOutput, appDirectories[0]);
    return {
      bundleRoot,
      executablePath: join(bundleRoot, "Contents", "MacOS", "masthead"),
      nodePath: join(bundleRoot, "Contents", "Resources", "daemon", "node"),
      resourcesPath: join(bundleRoot, "Contents", "Resources")
    };
  }
  const resourcesPath = join(resolvedOutput, "resources");
  return {
    bundleRoot: resolvedOutput,
    executablePath: join(resolvedOutput, platform === "win32" ? "masthead.exe" : "masthead"),
    nodePath: join(resourcesPath, "daemon", platform === "win32" ? "node.exe" : "node"),
    resourcesPath
  };
}

/**
 * Resolve layout from a packaged executable path or a darwin `.app` bundle path.
 * Used by packaged smoke so Linux (`…/masthead` + `resources/`) and macOS
 * (`Masthead.app/Contents/MacOS/masthead` + `Contents/Resources`) share one path.
 */
export async function resolvePackagedExecutableLayout(executableOrAppPath, platform = process.platform) {
  const resolved = resolve(executableOrAppPath);
  if (platform === "darwin" || platform === "mas") {
    let executablePath = resolved;
    if (resolved.endsWith(".app")) {
      executablePath = join(resolved, "Contents", "MacOS", "masthead");
    }
    const macOSDir = dirname(executablePath);
    const contentsDir = dirname(macOSDir);
    const bundleRoot = dirname(contentsDir);
    if (basename(macOSDir) !== "MacOS" || basename(contentsDir) !== "Contents" || !basename(bundleRoot).endsWith(".app")) {
      throw new Error(
        `Expected a darwin packaged executable under Something.app/Contents/MacOS/, got ${executableOrAppPath}`
      );
    }
    return {
      bundleRoot,
      executablePath,
      nodePath: join(bundleRoot, "Contents", "Resources", "daemon", "node"),
      resourcesPath: join(bundleRoot, "Contents", "Resources")
    };
  }
  const executablePath = resolved;
  const bundleRoot = dirname(executablePath);
  const resourcesPath = join(bundleRoot, "resources");
  return {
    bundleRoot,
    executablePath,
    nodePath: join(resourcesPath, "daemon", platform === "win32" ? "node.exe" : "node"),
    resourcesPath
  };
}

function normalizeLayout(input) {
  const bundleRoot = resolve(input.bundleRoot);
  const executablePath = resolve(input.executablePath);
  const resourcesPath = resolve(input.resourcesPath);
  const nodePath = resolve(input.nodePath || join(resourcesPath, "daemon", process.platform === "win32" ? "node.exe" : "node"));
  assertWithin(bundleRoot, executablePath, "executable");
  assertWithin(bundleRoot, resourcesPath, "resources directory");
  assertWithin(bundleRoot, nodePath, "bundled Node runtime");
  return { bundleRoot, executablePath, nodePath, resourcesPath };
}

async function buildPayload(layout) {
  const bundleRoot = await assertCanonicalTreeRoot(layout.bundleRoot, "bundle root");
  const resourcesPath = await assertCanonicalDirectoryInside(layout.resourcesPath, bundleRoot, "resources directory");
  await assertCanonicalRegularFileInside(layout.executablePath, bundleRoot, "executable");
  await assertCanonicalRegularFileInside(layout.nodePath, bundleRoot, "bundled Node runtime");
  await assertCanonicalRegularFileInside(join(resourcesPath, "app.asar"), bundleRoot, "app archive");
  await assertCanonicalRegularFileInside(join(resourcesPath, "daemon", "release.json"), bundleRoot, "release identity");

  const release = await readReleaseIdentity(layout);
  const manifestRelative = manifestRelativePath(bundleRoot, join(resourcesPath, PACKAGED_BUNDLE_MANIFEST));
  const absoluteFiles = await listPackagedRegularFiles(bundleRoot, manifestRelative);
  if (absoluteFiles.length === 0) throw new Error("Packaged bundle tree contains no regular files.");

  const distRoot = join(resourcesPath, "daemon", "dist");
  const distPrefix = `${manifestRelativePath(bundleRoot, distRoot)}/`;
  if (!absoluteFiles.some((filePath) => manifestRelativePath(bundleRoot, filePath).startsWith(distPrefix))) {
    throw new Error("Packaged daemon dist tree is empty.");
  }

  const files = [];
  for (const filePath of absoluteFiles) {
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Packaged manifest payload is not a regular file: ${filePath}`);
    }
    files.push({
      path: manifestRelativePath(bundleRoot, filePath),
      sha256: await hashFile(filePath),
      size: metadata.size
    });
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return {
    schemaVersion: SCHEMA_VERSION,
    algorithm: HASH_ALGORITHM,
    release,
    files
  };
}

async function readReleaseIdentity(layout) {
  const releasePath = join(layout.resourcesPath, "daemon", "release.json");
  let release;
  try {
    release = JSON.parse(await readFile(releasePath, "utf8"));
  } catch (error) {
    throw new Error(`Packaged release identity is unreadable: ${releasePath}`, { cause: error });
  }
  if (
    !release ||
    typeof release.version !== "string" ||
    !release.version.trim() ||
    typeof release.gitSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(release.gitSha)
  ) {
    throw new Error(`Packaged release identity is invalid: ${releasePath}`);
  }
  return { gitSha: release.gitSha, version: release.version };
}

async function listPackagedRegularFiles(bundleRoot, excludeRelativePath) {
  const files = [];

  async function walk(directoryPath) {
    const entries = (await readdir(directoryPath, { withFileTypes: true }))
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const entryPath = join(directoryPath, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Packaged bundle contains a symbolic link: ${entryPath}`);
      }
      if (metadata.isDirectory()) {
        const canonicalDirectory = await realpath(entryPath);
        assertWithin(bundleRoot, canonicalDirectory, "bundle directory");
        await walk(entryPath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(`Packaged bundle contains a non-regular entry: ${entryPath}`);
      }
      const canonicalFile = await realpath(entryPath);
      assertWithin(bundleRoot, canonicalFile, "manifest payload");
      const relativePath = manifestRelativePath(bundleRoot, entryPath);
      if (relativePath === excludeRelativePath) continue;
      files.push(entryPath);
    }
  }

  await walk(bundleRoot);
  return files;
}

function parseManifest(source, manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`Packaged content manifest is unreadable: ${manifestPath}`, { cause: error });
  }
  if (
    !manifest ||
    manifest.schemaVersion !== SCHEMA_VERSION ||
    manifest.algorithm !== HASH_ALGORITHM ||
    !Array.isArray(manifest.files) ||
    !manifest.release ||
    typeof manifest.release.version !== "string" ||
    !/^[a-f0-9]{40}$/u.test(manifest.release.gitSha) ||
    !/^[a-f0-9]{64}$/u.test(manifest.bundleDigest)
  ) {
    throw new Error(`Packaged content manifest is invalid: ${manifestPath}`);
  }
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      isAbsolute(entry.path) ||
      entry.path.split("/").includes("..") ||
      typeof entry.size !== "number" ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256)
    ) {
      throw new Error(`Packaged content manifest has an invalid file entry: ${manifestPath}`);
    }
  }
  return manifest;
}

function digestCanonicalPayload(payload) {
  return createHash(HASH_ALGORITHM).update(JSON.stringify(payload), "utf8").digest("hex");
}

async function hashFile(filePath) {
  const hash = createHash(HASH_ALGORITHM);
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function manifestRelativePath(bundleRoot, filePath) {
  assertWithin(bundleRoot, filePath, "manifest payload");
  return relative(bundleRoot, filePath).split(sep).join("/");
}

async function assertCanonicalTreeRoot(path, label) {
  const resolved = resolve(path);
  const metadata = await lstat(resolved);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Packaged ${label} must not be a symbolic link: ${resolved}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Packaged ${label} must be a directory: ${resolved}`);
  }
  const canonical = await realpath(resolved);
  if (canonical !== resolved) {
    throw new Error(`Packaged ${label} must be a canonical real path: ${resolved}`);
  }
  return canonical;
}

async function assertCanonicalDirectoryInside(path, bundleRoot, label) {
  const resolved = resolve(path);
  assertWithin(bundleRoot, resolved, label);
  const metadata = await lstat(resolved);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Packaged ${label} must not be a symbolic link: ${resolved}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Packaged ${label} must be a directory: ${resolved}`);
  }
  const canonical = await realpath(resolved);
  assertWithin(bundleRoot, canonical, label);
  return canonical;
}

async function assertCanonicalRegularFileInside(path, bundleRoot, label) {
  const resolved = resolve(path);
  assertWithin(bundleRoot, resolved, label);
  const metadata = await lstat(resolved);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Packaged ${label} must not be a symbolic link: ${resolved}`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Packaged ${label} must be a regular file: ${resolved}`);
  }
  const canonical = await realpath(resolved);
  assertWithin(bundleRoot, canonical, label);
  return canonical;
}

function assertWithin(root, candidate, label) {
  const childPath = relative(root, candidate);
  if (!childPath || childPath === ".." || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) {
    throw new Error(`Packaged ${label} must be inside ${basename(root)}.`);
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
