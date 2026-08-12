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

// Permanent Logbook checkboxes are forbidden; temporary Masthead Pages selection mode may use them.
try {
  const row = await readFile("src/ui/logbook/LogbookRow.tsx", "utf8");
  const table = await readFile("src/ui/logbook/LogbookTable.tsx", "utf8");
  const combined = `${row}\n${table}`;

  if (/type=["']checkbox["']/.test(combined) && !/pagesSelectionMode/.test(combined)) {
    failures.push("Logbook checkbox present without pagesSelectionMode gate");
  }

  // Checkbox markup must be gated on temporary Masthead Pages selection mode.
  if (/type=["']checkbox["']/.test(combined)) {
    const checkboxBlocks = combined.split(/type=["']checkbox["']/);
    // Every checkbox occurrence should sit near a pagesSelectionMode condition in the same file.
    if (!/pagesSelectionMode\s*(?:\?|&&|\|\||===|!==)/.test(combined) && !/pagesSelectionMode\s*\)/.test(combined)) {
      failures.push("Logbook checkbox is not gated by pagesSelectionMode");
    }
    void checkboxBlocks;
  }

  // Masthead Pages review surfaces may use checkboxes for acknowledgments.
  const review = await readFile("src/ui/masthead-pages/MastheadPagesReviewDialog.tsx", "utf8");
  if (!/type=["']checkbox["']/.test(review)) {
    failures.push("MastheadPagesReviewDialog missing acknowledgment checkbox");
  }
  if (!/Publish to Masthead Pages/.test(review)) {
    failures.push("MastheadPagesReviewDialog missing qualified Publish to Masthead Pages label");
  }
} catch (error) {
  failures.push(`Logbook/Masthead Pages surface check failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length > 0) {
  console.error("Masthead surface contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Masthead surface contract passed.");
