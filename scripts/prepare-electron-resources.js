#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const resourceRoot = resolve(".electron-resources/daemon");
const nodeTarget = resolve(resourceRoot, process.platform === "win32" ? "node.exe" : "node");
const distTarget = resolve(resourceRoot, "dist");
const cliTarget = resolve(distTarget, "src", "cli", "mastheadctl.js");
const hookScriptTarget = resolve(resourceRoot, "scripts", "masthead-hook.js");
const productionScriptTarget = resolve(resourceRoot, "scripts", "masthead-production.js");
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
await cp(process.execPath, nodeTarget);
await cp(resolve("dist/daemon"), distTarget, { recursive: true });
await cp(resolve("scripts/masthead-hook.js"), hookScriptTarget);
await cp(resolve("scripts/masthead-production.js"), productionScriptTarget);
await cp(resolve("scripts/packaged-bundle-manifest.js"), manifestScriptTarget);
await cp(resolve("scripts/resolve-hook-runtime.js"), resolve(resourceRoot, "scripts", "resolve-hook-runtime.js"));
await cp(resolve("public/assets/masthead-logo-sail-dev.png"), devIconTarget);
await writeFile(releaseTarget, `${JSON.stringify({ gitSha, version: packageJson.version }, null, 2)}\n`, "utf8");
await access(nodeTarget, constants.X_OK);
await access(cliTarget, constants.R_OK);
await access(productionScriptTarget, constants.R_OK);
await access(manifestScriptTarget, constants.R_OK);
await access(releaseTarget, constants.R_OK);

console.log(`Prepared Electron daemon resources in ${resourceRoot}`);
console.log(`Bundled Node runtime as ${basename(nodeTarget)}`);
console.log(`Bundled hook helper as ${basename(hookScriptTarget)}`);
console.log(`Bundled production lifecycle as ${basename(productionScriptTarget)}`);
console.log(`Bundled content manifest verifier as ${basename(manifestScriptTarget)}`);
console.log(`Bundled release identity ${packageJson.version} ${gitSha}`);
console.log(`Bundled dev icon resource as ${basename(devIconTarget)}`);
