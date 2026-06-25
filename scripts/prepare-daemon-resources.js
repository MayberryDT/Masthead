#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const resourceRoot = resolve("src-tauri/resources/daemon");
const nodeTarget = resolve(resourceRoot, process.platform === "win32" ? "node.exe" : "node");
const distTarget = resolve(resourceRoot, "dist");

await rm(resourceRoot, { force: true, recursive: true });
await mkdir(resourceRoot, { recursive: true });
await writeFile(resolve(resourceRoot, "README.txt"), "Generated daemon resources are copied here by `npm run prepare:daemon-resources`.\n");
await cp(process.execPath, nodeTarget);
await cp(resolve("dist/daemon"), distTarget, { recursive: true });

console.log(`Prepared daemon resources in ${resourceRoot}`);
console.log(`Bundled Node runtime as ${basename(nodeTarget)}`);
