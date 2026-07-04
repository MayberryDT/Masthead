#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const resourceRoot = resolve(".electron-resources/daemon");
const nodeTarget = resolve(resourceRoot, process.platform === "win32" ? "node.exe" : "node");
const distTarget = resolve(resourceRoot, "dist");
const devIconTarget = resolve(resourceRoot, "masthead-logo-sail-dev.svg");

await rm(resourceRoot, { force: true, recursive: true });
await mkdir(resourceRoot, { recursive: true });
await writeFile(resolve(resourceRoot, "README.txt"), "Generated daemon resources are copied here by `npm run prepare:electron-resources`.\n");
await cp(process.execPath, nodeTarget);
await cp(resolve("dist/daemon"), distTarget, { recursive: true });
await cp(resolve("public/assets/masthead-logo-sail-dev.svg"), devIconTarget);

console.log(`Prepared Electron daemon resources in ${resourceRoot}`);
console.log(`Bundled Node runtime as ${basename(nodeTarget)}`);
console.log(`Bundled dev icon resource as ${basename(devIconTarget)}`);
