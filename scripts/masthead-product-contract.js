#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const requiredTerms = ["session data layer", "Logbook", "MCP", "harness-neutral"];
const productLanguageFiles = [
  "README.md",
  "docs/how-to/import-codex-history.md",
  "docs/openwiki/quickstart.md",
  "docs/tutorials/first-run-codex-import.md"
];
const pageLanguageSurfaceContracts = [
  {
    file: "src/cli/mastheadctl.ts",
    label: "top-level Workbench help uses Page language",
    pattern: /mastheadctl workbench\s+Guided local enrichment and Page authoring/
  },
  {
    file: "src/cli/workbenchAuthoring.ts",
    label: "Workbench authoring help uses Page language",
    pattern: /Guided Page authoring:/
  },
  {
    file: "src/mcp/protocol.ts",
    label: "primary MCP descriptions present knowledge as Logbook Pages with an internal artifactId boundary",
    pattern: /Search published Logbook Pages[\s\S]*Browse published Logbook Pages[\s\S]*Get one published Logbook Page with internal stable artifactId[\s\S]*List provenance sessions for a published Logbook Page by internal artifactId[\s\S]*Published Logbook Page counts by kind\/project plus optional session coverage stats/
  },
  {
    file: "docs/openwiki/sources.md",
    label: "Sources boundary presents Workbench output as Pages and states the internal artifact boundary",
    pattern: /Workbench publishes \*\*Pages\*\* into Logbook \(persisted internally as artifacts; ADR 0011\)/
  }
];
const sourceFiles = [
  "docs/archive/prd.md",
  "docs/internal/design.md",
  "docs/internal/CONTEXT.md",
  "docs/internal/AGENTS.md",
  ...productLanguageFiles,
  ...pageLanguageSurfaceContracts.map(({ file }) => file)
];
const requiredDefinitions = [
  {
    term: "Page",
    requirements: [
      { label: "one reusable knowledge unit", pattern: /canonical user-facing term for one reusable unit of engineering knowledge/i },
      { label: "internal artifact boundary", pattern: /`artifact` is the legacy\/internal implementation term for a Page/i }
    ]
  },
  {
    term: "Logbook",
    requirements: [{ label: "collection of Pages", pattern: /collection of (?:published )?Pages/i }]
  },
  {
    term: "Local Logbook",
    requirements: [
      { label: "private and canonical", pattern: /private(?:,| and) canonical Logbook/i },
      { label: "collection of Pages", pattern: /collection of Pages/i }
    ]
  },
  {
    term: "Publication language",
    requirements: [
      { label: "qualified local publication phrase", pattern: /\bPublish to Logbook\b/ },
      { label: "qualified hosted publication phrase", pattern: /\bPublish to Masthead Pages\b/ },
      { label: "bare Publish prohibition", pattern: /Never use a bare (?:\*\*)?Publish(?:\*\*)? action/i }
    ]
  }
];
const forbiddenProductLanguagePatterns = [
  /\bLogbook contains only artifacts\b/i,
  /\bLogbook is an artifact book\b/i,
  /\bLogbook rows are published artifacts\b/i,
  /\bNo published artifacts\b/i,
  /\bPublished artifacts only\b/i,
  /\bpublished knowledge artifacts\b/i,
  /\bPublish artifacts(?: to Logbook)?\b/i,
  /\bSearch (?:the )?published artifacts\b/i
];
const forbiddenOnlyPatterns = [
  /\bprimarily an observability console\b/i,
  /\bonly an observability console\b/i,
  /\bonly a control tower\b/i,
  /\bobservability-first\b/i
];

const failures = [];
const contents = [];
let packageJson;

for (const file of sourceFiles) {
  try {
    const text = await readFile(file, "utf8");
    contents.push({ file, text });
    for (const pattern of forbiddenOnlyPatterns) {
      if (pattern.test(text)) failures.push(`${file} still uses forbidden framing: ${pattern}`);
    }
  } catch (error) {
    failures.push(`${file} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const combined = contents.map((entry) => entry.text).join("\n");
for (const term of requiredTerms) {
  if (!combined.includes(term)) failures.push(`Missing required product term: ${term}`);
}

const context = fileContents("docs/internal/CONTEXT.md");
for (const definition of requiredDefinitions) {
  const text = definitionText(context, definition.term);
  if (!text) {
    failures.push(`docs/internal/CONTEXT.md is missing the ${definition.term} definition`);
    continue;
  }
  for (const requirement of definition.requirements) {
    if (!requirement.pattern.test(text)) {
      failures.push(`docs/internal/CONTEXT.md ${definition.term} definition is missing ${requirement.label}`);
    }
  }
}

const agentGuidance = normalizeWhitespace(fileContents("docs/internal/AGENTS.md"));
if (!/Use (?:\*\*)?Page(?:\*\*)? in user-facing copy/i.test(agentGuidance)) {
  failures.push("docs/internal/AGENTS.md is missing user-facing Page guidance");
}
if (!/Keep `artifact` in technical identifiers/i.test(agentGuidance)) {
  failures.push("docs/internal/AGENTS.md is missing stable artifact identifier guidance");
}

for (const file of productLanguageFiles) {
  const text = normalizeWhitespace(fileContents(file));
  for (const pattern of forbiddenProductLanguagePatterns) {
    if (pattern.test(text)) failures.push(`${file} still uses old product-facing artifact wording: ${pattern}`);
  }
}

for (const contract of pageLanguageSurfaceContracts) {
  if (!contract.pattern.test(fileContents(contract.file))) {
    failures.push(`${contract.file} ${contract.label}`);
  }
}

try {
  packageJson = JSON.parse(await readFile("package.json", "utf8"));
  for (const retiredScript of ["dogfood:durable-artifacts", "canary:guided-agent"]) {
    if (packageJson?.scripts?.[retiredScript]) {
      failures.push(`package.json still exposes retired V4 mutation harness: ${retiredScript}`);
    }
  }
} catch (error) {
  failures.push(`package.json could not be checked: ${error instanceof Error ? error.message : String(error)}`);
}

const readme = contents.find(({ file }) => file === "README.md")?.text ?? "";
for (const retiredCommand of ["npm run dogfood:durable-artifacts", "npm run canary:guided-agent"]) {
  if (readme.includes(retiredCommand)) failures.push(`README.md advertises retired V4 mutation command: ${retiredCommand}`);
}

function fileContents(file) {
  return contents.find((entry) => entry.file === file)?.text ?? "";
}

function definitionText(text, term) {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`\\*\\*${escapedTerm}\\*\\*:\\s*([\\s\\S]*?)(?=\\n\\*\\*[^\\n]+\\*\\*:|$)`));
  return normalizeWhitespace(match?.[1] ?? "");
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

if (failures.length > 0) {
  console.error("Masthead product contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Masthead product contract passed.");
