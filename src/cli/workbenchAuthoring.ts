import { readFile } from "node:fs/promises";
import type { WorkbenchAuthoringBundle } from "../shared/workbenchAuthoring.ts";
import { MastheadAuthoringClient, MastheadAuthoringClientError } from "./authoringClient.ts";
import { errorResult, jsonResult, textResult, type CliResult } from "./output.ts";

export type WorkbenchCliOptions = {
  env?: NodeJS.ProcessEnv;
};

const authoringCommands = new Set(["capabilities", "open", "status", "evidence", "submit", "finish"]);
const evidenceKinds = new Set(["all", "user", "assistant", "tools", "checkpoints", "files", "signals"]);

export async function runWorkbenchAuthoringCli(args: string[], options: WorkbenchCliOptions = {}): Promise<CliResult> {
  const command = args[0];
  const json = args.includes("--json");
  if (!command || command === "--help" || command === "help") return textResult(workbenchHelp());

  if (command === "wipe-published") {
    const { runWipePublishedMaintenance } = await import("./workbenchMaintenance.ts");
    return runWipePublishedMaintenance(args, options, json);
  }
  if (!authoringCommands.has(command)) {
    return errorResult("unknown_command", `Unknown workbench command: ${command}`, json);
  }

  const client = new MastheadAuthoringClient(options.env?.MASTHEAD_DAEMON_URL);
  try {
    if (command === "capabilities") {
      return jsonResult({ ok: true, ...(await client.capabilities()) });
    }

    if (command === "open") {
      const databaseId = requiredOption(args, "--database-id", json);
      if (isCliResult(databaseId)) return databaseId;
      if (optionHasMissingValue(args, "--session")) return missingOptionValue("--session", json);
      const sessionIds = optionValues(args, "--session");
      if (sessionIds.length === 0) return missingArgument("--session", json);
      const capabilities = await client.capabilities();
      if (databaseId !== capabilities.databaseId) {
        return errorResult(
          "database_identity_mismatch",
          `Requested database ${databaseId} does not match daemon database ${capabilities.databaseId}`,
          json,
          { actualDatabaseId: capabilities.databaseId, requestedDatabaseId: databaseId }
        );
      }
      return jsonResult(
        await client.open({
          actorId: options.env?.MASTHEAD_ACTOR_ID?.trim() || "mastheadctl",
          databaseId,
          sessionIds
        })
      );
    }

    const runId = requiredOption(args, "--run", json);
    if (isCliResult(runId)) return runId;
    if (command === "status") return jsonResult(await client.status(runId));

    if (command === "evidence") {
      const sessionId = requiredOption(args, "--session", json);
      if (isCliResult(sessionId)) return sessionId;
      for (const option of ["--cursor", "--limit", "--order", "--kind", "--query"]) {
        if (optionHasMissingValue(args, option)) return missingOptionValue(option, json);
      }
      const query = new URLSearchParams({ sessionId });
      const cursor = optionValue(args, "--cursor");
      const queryText = optionValue(args, "--query");
      const kind = optionValue(args, "--kind");
      const order = optionValue(args, "--order");
      const limit = optionValue(args, "--limit");
      if (kind && !evidenceKinds.has(kind)) return errorResult("invalid_argument", `Invalid --kind: ${kind}`, json);
      if (order && order !== "asc" && order !== "desc") {
        return errorResult("invalid_argument", `Invalid --order: ${order}`, json);
      }
      if (limit && (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 250)) {
        return errorResult("invalid_argument", "--limit must be between 1 and 250", json);
      }
      if (cursor) query.set("cursor", cursor);
      if (queryText) query.set("query", queryText);
      if (kind) query.set("kind", kind);
      if (order) query.set("order", order);
      if (limit) query.set("limit", limit);
      return jsonResult({ ok: true, ...(await client.evidence(runId, query)) });
    }

    if (command === "submit") {
      const file = requiredOption(args, "--file", json);
      if (isCliResult(file)) return file;
      let bundle: WorkbenchAuthoringBundle;
      try {
        bundle = JSON.parse(await readFile(file, "utf8")) as WorkbenchAuthoringBundle;
      } catch (error) {
        if (error instanceof SyntaxError) return errorResult("invalid_json", `Invalid JSON in ${file}`, json);
        throw error;
      }
      return jsonResult(await client.submit(runId, bundle));
    }

    return jsonResult(await client.finish(runId));
  } catch (error) {
    if (error instanceof MastheadAuthoringClientError) {
      const code = error.code === "authoring_run_not_ready" ? "run_not_ready" : error.code;
      return errorResult(code, error.message, json, { body: error.body, status: error.status });
    }
    throw error;
  }
}

export function workbenchHelp(): string {
  return [
    "Usage: mastheadctl workbench <command> [options]",
    "",
    "Daemon-owned artifact authoring:",
    "  mastheadctl workbench capabilities --json",
    "  mastheadctl workbench open --database-id <id> --session <id> [--session <id>] --json",
    "  mastheadctl workbench status --run <run-id> --json",
    "  mastheadctl workbench evidence --run <run-id> --session <id> [--cursor <cursor>] [--limit 100] [--order asc|desc] [--kind all|user|assistant|tools|checkpoints|files|signals] [--query <text>] --json",
    "  mastheadctl workbench submit --run <run-id> --file <bundle.json> --json",
    "  mastheadctl workbench finish --run <run-id> --json",
    "",
    "Maintenance:",
    "  mastheadctl workbench wipe-published --db <path> --confirm --json",
    "",
    "The daemon owns evidence, validation, claims, publication, and database identity checks."
  ].join("\n") + "\n";
}

function requiredOption(args: string[], option: string, json: boolean): string | CliResult {
  if (optionHasMissingValue(args, option)) return missingOptionValue(option, json);
  return optionValue(args, option) ?? missingArgument(option, json);
}

function missingArgument(option: string, json: boolean): CliResult {
  return errorResult("missing_argument", `Missing required option: ${option}`, json);
}

function missingOptionValue(option: string, json: boolean): CliResult {
  return errorResult("missing_argument", `Missing value for option: ${option}`, json);
}

function optionValue(args: string[], option: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) {
      const candidate = args[index + 1];
      return candidate && !candidate.startsWith("--") ? candidate.trim() || undefined : undefined;
    }
    if (arg.startsWith(`${option}=`)) return arg.slice(option.length + 1).trim() || undefined;
  }
  return undefined;
}

function optionValues(args: string[], option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) {
      const candidate = args[index + 1];
      const value = candidate && !candidate.startsWith("--") ? candidate.trim() : undefined;
      if (value) values.push(value);
      if (value) index += 1;
    } else if (arg.startsWith(`${option}=`)) {
      const value = arg.slice(option.length + 1).trim();
      if (value) values.push(value);
    }
  }
  return [...new Set(values)];
}

function optionHasMissingValue(args: string[], option: string): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) {
      const candidate = args[index + 1];
      if (!candidate || candidate.startsWith("--") || !candidate.trim()) return true;
    } else if (arg.startsWith(`${option}=`) && !arg.slice(option.length + 1).trim()) {
      return true;
    }
  }
  return false;
}

function isCliResult(value: string | CliResult): value is CliResult {
  return typeof value !== "string";
}
