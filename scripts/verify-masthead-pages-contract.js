#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = join(root, "schemas/masthead-pages/v1");
const manifestPath = join(bundleRoot, "manifest.json");

function fail(message) {
  console.error(`masthead-pages-contract: ${message}`);
  process.exit(1);
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (!existsSync(manifestPath)) {
  fail(`missing manifest at ${relative(root, manifestPath)}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.files)) {
  fail("manifest.json must contain a files array");
}
if (manifest.name !== "masthead-pages-publish-v1") {
  fail(`unexpected manifest name ${JSON.stringify(manifest.name)}`);
}

const expected = new Map();
for (const entry of manifest.files) {
  if (!entry || typeof entry.path !== "string" || typeof entry.sha256 !== "string") {
    fail("manifest entry missing path or sha256");
  }
  if (expected.has(entry.path)) {
    fail(`duplicate manifest path ${entry.path}`);
  }
  expected.set(entry.path, entry);
}

const onDisk = listFiles(bundleRoot)
  .map((path) => relative(bundleRoot, path).split("\\").join("/"))
  .filter((path) => path !== "manifest.json");

for (const path of onDisk) {
  if (!expected.has(path)) {
    fail(`unlisted file present in bundle: ${path}`);
  }
}

for (const [path, entry] of expected) {
  const full = join(bundleRoot, path);
  if (!existsSync(full)) {
    fail(`missing listed file: ${path}`);
  }
  const bytes = statSync(full).size;
  const sha256 = sha256File(full);
  if (typeof entry.bytes === "number" && entry.bytes !== bytes) {
    fail(`${path}: byte length ${bytes} != manifest ${entry.bytes}`);
  }
  if (sha256 !== entry.sha256) {
    fail(`${path}: sha256 ${sha256} != manifest ${entry.sha256}`);
  }
}

console.log(
  `masthead-pages-contract: ok (${expected.size} files, ${manifest.name})`,
);
