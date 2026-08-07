#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const requiredTerms = ["session data layer", "Logbook", "MCP", "harness-neutral"];
const sourceFiles = ["docs/archive/prd.md", "design.md", "README.md", "AGENTS.md"];
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

if (failures.length > 0) {
  console.error("Masthead product contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Masthead product contract passed.");
