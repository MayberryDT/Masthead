import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, rename, writeFile } from "node:fs/promises";
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
  const daemonPath = join(layout.resourcesPath, "daemon");
  const distPath = join(daemonPath, "dist");
  const distFiles = await listRegularFiles(distPath);
  if (distFiles.length === 0) throw new Error("Packaged daemon dist tree is empty.");

  const absoluteFiles = [
    layout.executablePath,
    join(layout.resourcesPath, "app.asar"),
    ...distFiles,
    layout.nodePath,
    join(daemonPath, "release.json"),
    join(daemonPath, "scripts", "packaged-bundle-manifest.js"),
    join(daemonPath, "scripts", "masthead-production.js"),
    join(daemonPath, "scripts", "masthead-hook.js"),
    join(daemonPath, "scripts", "resolve-hook-runtime.js")
  ];
  const files = [];
  for (const filePath of absoluteFiles) {
    const metadata = await lstat(filePath);
    if (!metadata.isFile()) throw new Error(`Packaged manifest payload is not a regular file: ${filePath}`);
    files.push({
      path: manifestRelativePath(layout.bundleRoot, filePath),
      sha256: await hashFile(filePath),
      size: metadata.size
    });
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return {
    schemaVersion: SCHEMA_VERSION,
    algorithm: HASH_ALGORITHM,
    release: await readReleaseIdentity(layout),
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

async function listRegularFiles(root) {
  const files = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((left, right) => compareText(left.name, right.name))) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listRegularFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
    else throw new Error(`Packaged daemon dist tree contains a non-regular entry: ${entryPath}`);
  }
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

function assertWithin(root, candidate, label) {
  const childPath = relative(root, candidate);
  if (!childPath || childPath === ".." || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) {
    throw new Error(`Packaged ${label} must be inside ${basename(root)}.`);
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
