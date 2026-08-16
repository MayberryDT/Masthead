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

// Logbook Page selection is permanent: row and filtered-scope checkboxes stay visible.
try {
  const row = await readFile("src/ui/logbook/LogbookRow.tsx", "utf8");
  const toolbar = await readFile("src/ui/logbook/LogbookToolbar.tsx", "utf8");

  if (!/type=["']checkbox["']/.test(row)) {
    failures.push("LogbookRow missing permanent Page selection checkbox");
  }
  if (!/type=["']checkbox["']/.test(toolbar) || !/Select all/.test(toolbar)) {
    failures.push("LogbookToolbar missing filtered Select all checkbox");
  }
  if (/pagesSelectionMode/.test(`${row}\n${toolbar}`)) {
    failures.push("Logbook Page selection is still gated by temporary selection mode");
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
