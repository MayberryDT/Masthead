#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runWorkbenchCli } from "./workbench.ts";
import { importRepairHelp, runImportRepairCli } from "./importRepair.ts";
import { errorResult, textResult, type CliResult } from "./output.ts";

export type MastheadCliOptions = {
  env?: NodeJS.ProcessEnv;
};

export async function runMastheadCli(args: string[], options: MastheadCliOptions = {}): Promise<CliResult> {
  const command = args[0];
  if (!command || command === "--help" || command === "help") return textResult(topLevelHelp());
  if (command === "workbench") return runWorkbenchCli(args.slice(1), options);
  if (command === "import") return runImportRepairCli(args.slice(1), options);
  return errorResult("unknown_command", `Unknown command: ${command}`, args.includes("--json"));
}

function topLevelHelp(): string {
  return [
    "Usage: mastheadctl <command>",
    "",
    "Commands:",
    "  mastheadctl workbench    Guided local enrichment and artifact authoring",
    "  mastheadctl import repair Preview or apply provenance-scoped import repair",
    "",
    "Try:",
    "  mastheadctl workbench author start --request <request-id> --json",
    `  ${importRepairHelp().trim()}`
  ].join("\n") + "\n";
}

async function main(): Promise<void> {
  try {
    const result = await runMastheadCli(process.argv.slice(2), { env: process.env });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: { code: "unhandled_cli_error", message } })}\n`);
    process.exitCode = 1;
  }
}

if (isCliEntrypoint()) {
  void main();
}

function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
}
