#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
const version = pkg.version;

if (!version || typeof version !== "string") {
  console.error("No version found in package.json");
  process.exit(1);
}

console.log(`Version sync complete. Source of truth remains package.json (${version}).`);
