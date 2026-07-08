#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const resourceRoot = resolve(".electron-resources/daemon");
const nodeTarget = resolve(resourceRoot, process.platform === "win32" ? "node.exe" : "node");
const distTarget = resolve(resourceRoot, "dist");
const hookScriptTarget = resolve(resourceRoot, "scripts", "masthead-hook.js");
const devIconTarget = resolve(resourceRoot, "masthead-logo-sail-dev.png");

await rm(resourceRoot, { force: true, recursive: true });
await mkdir(resourceRoot, { recursive: true });
await mkdir(resolve(resourceRoot, "scripts"), { recursive: true });
await writeFile(resolve(resourceRoot, "README.txt"), "Generated daemon resources are copied here by `npm run prepare:electron-resources`.\n");
await cp(process.execPath, nodeTarget);
await cp(resolve("dist/daemon"), distTarget, { recursive: true });
await cp(resolve("scripts/masthead-hook.js"), hookScriptTarget);
await cp(resolve("scripts/resolve-hook-runtime.js"), resolve(resourceRoot, "scripts", "resolve-hook-runtime.js"));
await cp(resolve("public/assets/masthead-logo-sail-dev.png"), devIconTarget);

console.log(`Prepared Electron daemon resources in ${resourceRoot}`);
console.log(`Bundled Node runtime as ${basename(nodeTarget)}`);
console.log(`Bundled hook helper as ${basename(hookScriptTarget)}`);
console.log(`Bundled dev icon resource as ${basename(devIconTarget)}`);
