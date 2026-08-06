#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { constants } from "node:fs";
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const resourceRoot = resolve(".electron-resources/daemon");
const nodeTarget = resolve(resourceRoot, process.platform === "win32" ? "node.exe" : "node");
const distTarget = resolve(resourceRoot, "dist");
const cliTarget = resolve(distTarget, "src", "cli", "mastheadctl.js");
const maintenanceTarget = resolve(distTarget, "src", "daemon", "productionTransitionMaintenance.js");
const hookScriptTarget = resolve(resourceRoot, "scripts", "masthead-hook.js");
const productionScriptTarget = resolve(resourceRoot, "scripts", "masthead-production.js");
const privateDisplayScriptTarget = resolve(resourceRoot, "scripts", "masthead-private-display.js");
const coldActivationScriptTarget = resolve(resourceRoot, "scripts", "masthead-production-cold-activation.js");
const manifestScriptTarget = resolve(resourceRoot, "scripts", "packaged-bundle-manifest.js");
const devIconTarget = resolve(resourceRoot, "masthead-logo-sail-dev.png");
const releaseTarget = resolve(resourceRoot, "release.json");

const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const gitSha = (process.env.MASTHEAD_BUILD_SHA || execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8"
})).trim();
if (!/^[a-f0-9]{40}$/u.test(gitSha)) throw new Error("Electron release git SHA must be full lowercase 40-hex.");
if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
  throw new Error("Electron release package version is missing.");
}

await rm(resourceRoot, { force: true, recursive: true });
await mkdir(resourceRoot, { recursive: true });
await mkdir(resolve(resourceRoot, "scripts"), { recursive: true });
await writeFile(resolve(resourceRoot, "README.txt"), "Generated daemon resources are copied here by `npm run prepare:electron-resources`.\n");
await bundleRelocatableNode(nodeTarget);
await cp(resolve("dist/daemon"), distTarget, { recursive: true });
await cp(resolve("scripts/masthead-hook.js"), hookScriptTarget);
await cp(resolve("scripts/masthead-production.js"), productionScriptTarget);
await cp(resolve("scripts/masthead-private-display.js"), privateDisplayScriptTarget);
await cp(resolve("scripts/masthead-production-cold-activation.js"), coldActivationScriptTarget);
await cp(resolve("scripts/packaged-bundle-manifest.js"), manifestScriptTarget);
await cp(resolve("scripts/resolve-hook-runtime.js"), resolve(resourceRoot, "scripts", "resolve-hook-runtime.js"));
await cp(resolve("public/assets/masthead-logo-sail-dev.png"), devIconTarget);
await writeFile(releaseTarget, `${JSON.stringify({ gitSha, version: packageJson.version }, null, 2)}\n`, "utf8");
await access(nodeTarget, constants.X_OK);
await access(cliTarget, constants.R_OK);
await access(maintenanceTarget, constants.R_OK);
await access(productionScriptTarget, constants.R_OK);
await access(privateDisplayScriptTarget, constants.R_OK);
await access(coldActivationScriptTarget, constants.R_OK);
await access(manifestScriptTarget, constants.R_OK);
await access(releaseTarget, constants.R_OK);
assertNodeRunsStandalone(nodeTarget);

console.log(`Prepared Electron daemon resources in ${resourceRoot}`);
console.log(`Bundled Node runtime as ${basename(nodeTarget)}`);
console.log(`Bundled hook helper as ${basename(hookScriptTarget)}`);
console.log(`Bundled production lifecycle as ${basename(productionScriptTarget)}`);
console.log(`Bundled private display guard as ${basename(privateDisplayScriptTarget)}`);
console.log(`Bundled content manifest verifier as ${basename(manifestScriptTarget)}`);
console.log(`Bundled release identity ${packageJson.version} ${gitSha}`);
console.log(`Bundled dev icon resource as ${basename(devIconTarget)}`);

/**
 * Prefer copying the build host Node when it is relocatable (typical Linux/official
 * installs). Homebrew Node is a thin stub that needs Cellar dylibs, so on failure
 * (and always when forced) fetch the official Node.js binary for this platform.
 */
async function bundleRelocatableNode(targetPath) {
  await cp(process.execPath, targetPath);
  if (process.platform !== "win32") await chmod(targetPath, 0o755);
  if (nodeRunsStandalone(targetPath)) {
    console.log(`Bundled relocatable Node from process.execPath (${process.version})`);
    return;
  }
  console.log(
    `Host Node at ${process.execPath} is not relocatable (common with Homebrew); downloading official Node ${process.version} for packaging.`
  );
  await rm(targetPath, { force: true });
  await installOfficialNodeBinary(targetPath);
  if (!nodeRunsStandalone(targetPath)) {
    throw new Error(`Bundled Node runtime does not execute standalone: ${targetPath}`);
  }
  console.log(`Bundled official Node binary at ${targetPath}`);
}

function nodeRunsStandalone(nodePath) {
  try {
    assertNodeRunsStandalone(nodePath);
    return true;
  } catch {
    return false;
  }
}

function assertNodeRunsStandalone(nodePath) {
  // Minimal PATH so a copied Homebrew stub cannot silently pick up Cellar libs via luck.
  execFileSync(nodePath, ["-e", "process.exit(0)"], {
    encoding: "utf8",
    env: {
      PATH: "/usr/bin:/bin",
      HOME: process.env.HOME || tmpdir()
    },
    stdio: "ignore",
    timeout: 15_000
  });
}

async function installOfficialNodeBinary(targetPath) {
  const version = process.version;
  if (!/^v\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`Cannot resolve official Node download for process.version=${version}`);
  }
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  if (!arch) throw new Error(`Unsupported arch for official Node packaging: ${process.arch}`);

  if (process.platform === "win32") {
    throw new Error(
      "Host node.exe is not relocatable and automatic official Windows Node fetch is not implemented; install a standalone Node distribution before packaging."
    );
  }

  const platform = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
  if (!platform) throw new Error(`Unsupported platform for official Node packaging: ${process.platform}`);

  const baseName = `node-${version}-${platform}-${arch}`;
  const url = `https://nodejs.org/dist/${version}/${baseName}.tar.gz`;
  const workDir = await mkdtemp(join(tmpdir(), "masthead-node-bundle-"));
  const archivePath = join(workDir, `${baseName}.tar.gz`);
  try {
    await downloadFile(url, archivePath);
    execFileSync("tar", ["-xzf", archivePath, "-C", workDir], { stdio: "ignore" });
    const extractedNode = join(workDir, baseName, "bin", "node");
    await access(extractedNode, constants.R_OK);
    await cp(extractedNode, targetPath);
    await chmod(targetPath, 0o755);
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(destination));
}
