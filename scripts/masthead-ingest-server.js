#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const builtEntry = resolve(scriptDir, "../dist/daemon/src/daemon/main.js");

if (!existsSync(builtEntry)) {
  console.error("Masthead daemon build not found. Run `npm run build:daemon` first.");
  process.exit(1);
}

await import(builtEntry);
