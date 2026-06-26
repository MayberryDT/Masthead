#!/usr/bin/env node
// Sync authoritative version from package.json (source of truth) into:
// - src-tauri/tauri.conf.json (top-level "version")
// - src-tauri/Cargo.toml ([package] version)
// Run after `npm version patch|minor|major --no-git-tag-version` or manually.
// Do NOT edit those files directly.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const pkgPath = resolve(root, 'package.json');
const tauriPath = resolve(root, 'src-tauri/tauri.conf.json');
const cargoPath = resolve(root, 'src-tauri/Cargo.toml');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
if (!version) {
  console.error('No version found in package.json');
  process.exit(1);
}

// Tauri (top-level)
const tauri = JSON.parse(readFileSync(tauriPath, 'utf8'));
if (tauri.version !== version) {
  tauri.version = version;
  writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n');
  console.log(`Synced version ${version} to src-tauri/tauri.conf.json (top-level)`);
} else {
  console.log(`tauri.conf.json already at ${version}`);
}

// Cargo.toml ([package] version)
let cargo = readFileSync(cargoPath, 'utf8');
const cargoVersionRe = /^version = "([^"]+)"/m;
const cargoMatch = cargo.match(cargoVersionRe);
if (cargoMatch && cargoMatch[1] !== version) {
  cargo = cargo.replace(cargoVersionRe, `version = "${version}"`);
  writeFileSync(cargoPath, cargo);
  console.log(`Synced version ${version} to src-tauri/Cargo.toml ([package])`);
} else if (cargoMatch) {
  console.log(`Cargo.toml already at ${version}`);
}
// Cargo.lock - patch ONLY the root "masthead" crate (the one without "source =")
const lockPath = resolve(root, 'src-tauri/Cargo.lock');
let lock = readFileSync(lockPath, 'utf8');
// Match the first [[package]] block for name = "masthead" that is the local crate
const lockRe = /(\[\[package\]\]\r?\nname = "masthead"\r?\nversion = ")[^"]+(")/;
if (lockRe.test(lock)) {
  lock = lock.replace(lockRe, `$1${version}$2`);
  writeFileSync(lockPath, lock);
  console.log(`Synced version ${version} to src-tauri/Cargo.lock (root masthead package)`);
} else {
  console.log(`Cargo.lock root masthead entry not found or already at ${version}`);
}

console.log('Version sync complete. Source of truth remains package.json.');