#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const forbiddenPairs = [
  {
    file: "src/ui/SourcesPanel.tsx",
    label: "SourcesPanel + surface-card-grid",
    patterns: [/SourcesPanel/, /surface-card-grid/]
  },
  {
    file: "src/ui/HistoryPanel.tsx",
    label: "HistoryPanel + surface-card-grid",
    patterns: [/HistoryPanel/, /surface-card-grid/]
  },
  {
    file: "src/ui/OperationsPanel.tsx",
    label: "OperationsPanel + native <select>",
    patterns: [/OperationsPanel/, /<select\b/]
  }
];

const failures = [];

for (const check of forbiddenPairs) {
  try {
    const text = await readFile(check.file, "utf8");
    if (check.patterns.every((pattern) => pattern.test(text))) {
      failures.push(`${check.file} uses forbidden surface pattern: ${check.label}`);
    }
  } catch (error) {
    failures.push(`${check.file} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error("Masthead surface contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Masthead surface contract passed.");
