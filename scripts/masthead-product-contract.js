#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const requiredTerms = ["session data layer", "Logbook", "MCP", "harness-neutral"];

export const activeProductFiles = [
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTEXT.md",
  "README.md",
  "design.md",
  "package.json",
  "prd.md",
  "openwiki/quickstart.md",
  "openwiki/logbook-and-workbench.md",
  "docs/tutorials/first-run-codex-import.md",
  "docs/how-to/import-codex-history.md",
  "docs/reference/enrichment.md",
  "docs/reference/session-dossier.md",
  "docs/reference/live-connectors.md",
  "docs/reference/mcp-tools.md",
  "docs/reference/daemon-api.md",
  "docs/reference/sources-v2.md",
  "docs/acceptance/product-release-gate.md"
];

const activeProductDirectories = ["openwiki", "docs/reference", "docs/how-to", "docs/tutorials"];

const obsoletePatterns = [
  {
    description: "Masthead is primarily an observability product",
    pattern: /\b(?:primarily|only) an observability console\b|\bobservability-first\b/i
  },
  {
    description: "Masthead is a control tower",
    pattern: /\bMasthead is (?:a|the) [^.\n]*control tower\b|^#{1,2} .*Control Tower/im
  },
  {
    description: "imported sessions become Logbook rows",
    pattern: /\bimported sessions (?:should|must|will) appear in Logbook\b/i
  },
  {
    description: "sessions are the Logbook search unit",
    pattern: /\bLogbook (?:shows|returns|contains) (?:only )?(?:published |imported )?sessions\b/i
  },
  {
    description: "Logbook shares the canonical session dossier detail",
    pattern: /\b(?:Board|Now) and Logbook use the same `?SessionDossier`?|\bLogbook detail uses the same dossier component\b|\bThe session dossier is the shared detail surface for (?:Board|Now) and Logbook sessions\b/i
  },
  {
    description: "bug_fix_trace is a current output kind",
    pattern: /For `bug_fix_trace`|`bug_fix_trace` creates|(?:^|\n)\s*bug_fix_trace\s*(?:\n|$)/i
  }
];

export function findProductContractFailures(documents) {
  const failures = [];
  const activeContents = [];

  for (const file of activeProductFiles) {
    if (typeof documents[file] !== "string") failures.push(`${file} could not be read`);
  }

  for (const file of Object.keys(documents).filter(isActiveProductFile).sort()) {
    const text = documents[file];
    activeContents.push(text);
    for (const { description, pattern } of obsoletePatterns) {
      if (pattern.test(text)) {
        failures.push(`${file} still uses obsolete product framing: ${description}`);
      }
    }
  }

  const combined = activeContents.join("\n");
  for (const term of requiredTerms) {
    if (!combined.includes(term)) failures.push(`Missing required product term: ${term}`);
  }

  return failures;
}

async function runProductContractCheck() {
  const documents = {};
  const readFailures = [];

  for (const file of await discoverActiveProductFiles()) {
    try {
      documents[file] = await readFile(file, "utf8");
    } catch (error) {
      readFailures.push(`${file} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const failures = [...readFailures, ...findProductContractFailures(documents).filter((failure) => !failure.endsWith("could not be read"))];
  if (failures.length > 0) {
    console.error("Masthead product contract failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("Masthead product contract passed.");
}

function isActiveProductFile(file) {
  if (activeProductFiles.includes(file)) return true;
  return activeProductDirectories.some((directory) => file.startsWith(`${directory}/`) && file.endsWith(".md"));
}

async function discoverActiveProductFiles() {
  const files = new Set(activeProductFiles);
  for (const directory of activeProductDirectories) {
    const entries = await readdir(directory, { recursive: true });
    for (const entry of entries) {
      if (entry.endsWith(".md")) files.add(join(directory, entry));
    }
  }
  return [...files].sort();
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entryPath === import.meta.url) {
  await runProductContractCheck();
}
