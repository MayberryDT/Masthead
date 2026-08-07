#!/usr/bin/env node
/**
 * Print a plain-language npm audit split for installers and CI logs.
 *
 * Runtime (production dependencies) is the product gate.
 * Full tree includes Electron Forge / Vite build tooling.
 */
import { spawnSync } from "node:child_process";

function runAudit(args) {
  const result = spawnSync("npm", ["audit", "--json", ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  const stdout = result.stdout || "";
  try {
    return {
      data: JSON.parse(stdout || "{}"),
      status: result.status ?? 1,
      stderr: result.stderr || ""
    };
  } catch {
    return {
      data: null,
      status: result.status ?? 1,
      stderr: `${result.stderr || ""}\n${stdout}`.trim()
    };
  }
}

function summarize(label, audit) {
  const vulns = audit?.data?.metadata?.vulnerabilities || {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    info: 0
  };
  const total =
    (vulns.critical || 0) +
    (vulns.high || 0) +
    (vulns.moderate || 0) +
    (vulns.low || 0) +
    (vulns.info || 0);
  return {
    label,
    vulns,
    total,
    highPlus: (vulns.critical || 0) + (vulns.high || 0),
    parseError: !audit.data,
    stderr: audit.stderr
  };
}

function printSummary(summary) {
  console.log(summary.label);
  if (summary.parseError) {
    console.log(`  could not parse npm audit JSON (exit details may follow)`);
    if (summary.stderr) {
      for (const line of summary.stderr.split("\n").slice(0, 8)) {
        console.log(`  ${line}`);
      }
    }
    return;
  }
  console.log(
    `  critical=${summary.vulns.critical || 0} high=${summary.vulns.high || 0} moderate=${summary.vulns.moderate || 0} low=${summary.vulns.low || 0} info=${summary.vulns.info || 0} total=${summary.total}`
  );
}

const runtime = summarize("Runtime dependencies (npm audit --omit=dev)", runAudit(["--omit=dev"]));
const full = summarize("Full install tree including dev/build tooling", runAudit([]));

console.log("Masthead dependency security report");
console.log("==================================");
console.log("");
printSummary(runtime);
console.log("");
printSummary(full);
console.log("");
console.log("How to read this");
console.log("----------------");
console.log("- Preferred install for end users: GitHub Releases packaged desktop app.");
console.log("- Product gate for source installs: runtime high+ must stay at 0 (`npm run audit:runtime`).");
console.log("- Full-tree findings are usually Electron Forge / Vite build-time transitive deps,");
console.log("  not the production daemon/UI dependency set.");
console.log("- Details: docs/reference/dependency-security.md and SECURITY.md.");
console.log("");

if (runtime.parseError) {
  console.error("FAIL: could not parse runtime npm audit output.");
  process.exit(2);
}

if (runtime.highPlus > 0) {
  console.error("FAIL: runtime high/critical vulnerabilities present.");
  process.exit(1);
}

console.log("OK: runtime audit has no high or critical vulnerabilities.");
process.exit(0);
