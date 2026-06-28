#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = ["src/electron/preload.ts", "src/electron/window.ts", "src/electron/ipc.ts", "src/electron/protocol.ts"];

const forbidden = [
  { file: "src/electron/preload.ts", pattern: /exposeInMainWorld\([^,]+,\s*ipcRenderer/s, message: "preload must not expose ipcRenderer directly" },
  { file: "src/electron/preload.ts", pattern: /exposeInMainWorld\([^,]+,\s*process/s, message: "preload must not expose process directly" },
  { file: "src/electron/window.ts", pattern: /nodeIntegration:\s*true/, message: "renderer must not enable nodeIntegration" },
  { file: "src/electron/window.ts", pattern: /contextIsolation:\s*false/, message: "renderer must not disable contextIsolation" },
  { file: "src/electron/window.ts", pattern: /webSecurity:\s*false/, message: "renderer must not disable webSecurity" },
  { file: "src/electron/window.ts", pattern: /webviewTag:\s*true/, message: "renderer must not enable webviewTag" },
  { file: "src/electron/window.ts", pattern: /loadURL\(['"]file:\/\//, message: "renderer must not load file protocol" }
];

for (const file of files) {
  await readFile(resolve(file), "utf8");
}

for (const rule of forbidden) {
  const source = await readFile(resolve(rule.file), "utf8");
  if (rule.pattern.test(source)) {
    console.error(`${rule.file}: ${rule.message}`);
    process.exit(1);
  }
}

console.log("Electron security source check passed.");
