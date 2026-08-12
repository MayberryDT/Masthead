#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const migrationsSource = resolve("src/daemon/db/migrations");
const migrationsTarget = resolve("dist/daemon/src/daemon/db/migrations");
await mkdir(migrationsTarget, { recursive: true });
await cp(migrationsSource, migrationsTarget, { recursive: true });

// mastheadPages/contract.js resolves schemas via ../../schemas from
// dist/daemon/src/mastheadPages → dist/daemon/schemas/masthead-pages/v1
const pagesSource = resolve("schemas/masthead-pages");
const pagesTarget = resolve("dist/daemon/schemas/masthead-pages");
await mkdir(resolve("dist/daemon/schemas"), { recursive: true });
await cp(pagesSource, pagesTarget, { recursive: true });
