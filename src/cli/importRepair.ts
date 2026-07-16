import { DEFAULT_MASTHEAD_DAEMON_URL } from "./authoringClient.ts";
import { errorResult, jsonResult, type CliResult } from "./output.ts";

export type ImportRepairCliOptions = { env?: NodeJS.ProcessEnv };

export async function runImportRepairCli(args: string[], options: ImportRepairCliOptions = {}): Promise<CliResult> {
  if (args[0] !== "repair") return errorResult("unknown_command", `Unknown import command: ${args[0] ?? ""}`, args.includes("--json"));
  const json = args.includes("--json");
  const command = ["preview", "apply"].includes(args[1] ?? "") ? args[1] : "preview";
  const commandArgs = command === "preview" && args[1] !== "preview" ? args.slice(1) : args.slice(2);
  if (commandArgs.some((arg) => arg === "--job") && missingValue(commandArgs, "--job")) {
    return errorResult("missing_argument", "Missing value for option: --job", json);
  }
  const importJobIds = optionValues(commandArgs, "--job");
  if (importJobIds.length === 0) return errorResult("missing_argument", "Missing required option: --job", json);
  const body: { importJobIds: string[]; planHash?: string } = { importJobIds: [...new Set(importJobIds)] };
  if (command === "apply") {
    const planHash = optionValue(commandArgs, "--plan-hash");
    if (!planHash) return errorResult("missing_argument", "Missing required option: --plan-hash", json);
    if (!/^[a-f0-9]{64}$/.test(planHash)) return errorResult("invalid_argument", "--plan-hash must be a lowercase SHA-256 hash", json);
    body.planHash = planHash;
  }
  const baseUrl = (options.env?.MASTHEAD_DAEMON_URL?.trim() || DEFAULT_MASTHEAD_DAEMON_URL).replace(/\/+$/, "");
  try {
    const response = await fetch(`${baseUrl}/imports/repair/${command}`, {
      body: JSON.stringify(body),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
    const responseBody = await response.json() as Record<string, unknown>;
    if (!response.ok) return errorResult("repair_request_failed", String(responseBody.error ?? `HTTP ${response.status}`), json, { body: responseBody });
    return jsonResult(responseBody);
  } catch (error) {
    return errorResult("daemon_unavailable", error instanceof Error ? error.message : String(error), json);
  }
}

export function importRepairHelp(): string {
  return [
    "Usage: mastheadctl import repair [preview] --job <id> [--job <id>] --json",
    "       mastheadctl import repair apply --job <id> [--job <id>] --plan-hash <sha256> --json"
  ].join("\n") + "\n";
}

function optionValues(args: string[], option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === option) {
      const value = args[index + 1];
      if (value && !value.startsWith("--")) { values.push(value); index += 1; }
    } else if (args[index].startsWith(`${option}=`)) values.push(args[index].slice(option.length + 1));
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function optionValue(args: string[], option: string): string | undefined {
  return optionValues(args, option)[0];
}

function missingValue(args: string[], option: string): boolean {
  return args.some((arg, index) => arg === option && (!args[index + 1] || args[index + 1].startsWith("--")));
}
