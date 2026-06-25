#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("src/daemon/db/migrations");
const target = resolve("dist/daemon/src/daemon/db/migrations");

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
