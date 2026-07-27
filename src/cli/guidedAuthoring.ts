import { readFile, writeFile } from "node:fs/promises";
import type { WorkbenchAuthoringV5Draft, WorkbenchAuthoringV5NextAction } from "../shared/workbenchAuthoringV5.ts";
import { MastheadAuthoringClient, MastheadAuthoringClientError } from "./authoringClient.ts";
import { errorResult, jsonResult, textResult, type CliResult } from "./output.ts";

export type GuidedAuthoringCliOptions = {
  env?: NodeJS.ProcessEnv;
};

const guidedCommands = new Set([
  "bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"
]);

export async function runGuidedAuthoringCli(
  args: string[],
  options: GuidedAuthoringCliOptions = {}
): Promise<CliResult> {
  const command = args[0];
  const json = args.includes("--json");
  if (!command || command === "help" || command === "--help") return textResult(guidedAuthoringHelp());
  if (command === "review" || args.some((arg) => arg === "--assignment" || arg.startsWith("--assignment="))) {
    return errorResult("authoring_contract_retired", "V4 assignment mutations are retired; use a V5 request and pack.", json);
  }
  if (!guidedCommands.has(command)) {
    return errorResult("unknown_command", `Unknown guided authoring command: ${command}`, json);
  }
  const allowedOptions = ["bootstrap", "start", "claim", "status", "receipt"].includes(command)
    ? new Set(["--request", "--json"])
    : command === "save" || command === "scaffold"
      ? new Set(["--pack", "--file", "--json"])
      : command === "inspect"
        ? new Set(["--pack", "--session", "--cursor", "--json"])
        : new Set(["--pack", "--json"]);
  const optionFailure = validateOptions(args.slice(1), allowedOptions, json);
  if (optionFailure) return optionFailure;
  if ((command === "start" || command === "claim") && !rawOptionValue(args, "--request")?.startsWith("authoring-v5-request:")) {
    const requestError = requiredOption(args, "--request", json);
    if (isCliResult(requestError)) return requestError;
    return errorResult("authoring_contract_retired", "Legacy guided requests cannot start or resume; create a V5 request.", json);
  }

  const client = new MastheadAuthoringClient({
    baseUrl: options.env?.MASTHEAD_DAEMON_URL,
    instanceManifest: options.env?.MASTHEAD_INSTANCE_MANIFEST
  });

  try {
    let dto: { nextAction: WorkbenchAuthoringV5NextAction; [key: string]: unknown };
    if (["bootstrap", "start", "claim", "status", "receipt"].includes(command)) {
      const requestId = requiredOption(args, "--request", json);
      if (isCliResult(requestId)) return requestId;
      if (command === "bootstrap") dto = await client.authoringV5Bootstrap(requestId) as typeof dto;
      else if (command === "status") dto = await client.authoringV5Status(requestId) as typeof dto;
      else if (command === "receipt") {
        const receipt = await client.authoringV5Receipt(requestId);
        return json ? jsonResult(receipt) : textResult(`${JSON.stringify(receipt, null, 2)}\n`);
      } else dto = await client.authoringV5Start(requestId) as typeof dto;
    } else {
      const packId = requiredOption(args, "--pack", json);
      if (isCliResult(packId)) return packId;
      if (command === "inspect") {
        const sessionId = optionalOption(args, "--session", json);
        if (sessionId && isCliResult(sessionId)) return sessionId;
        const cursor = optionalOption(args, "--cursor", json);
        if (cursor && isCliResult(cursor)) return cursor;
        const inspectionOptions = { ...(cursor ? { cursor } : {}), ...(sessionId ? { sessionId } : {}) };
        dto = await client.authoringV5Inspect(packId, inspectionOptions) as typeof dto;
      } else if (command === "scaffold") {
        const file = requiredOption(args, "--file", json);
        if (isCliResult(file)) return file;
        const scaffold = await client.authoringV5Scaffold(packId);
        await writeFile(file, `${JSON.stringify(scaffold.draft, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        dto = {
          packId: scaffold.packId,
          draftSummary: { sessionCount: scaffold.draft.sessions.length },
          file,
          nextAction: { ...scaffold.nextAction, command: replaceFileArgument(scaffold.nextAction.command, file) }
        };
      } else if (command === "save") {
        const file = requiredOption(args, "--file", json);
        if (isCliResult(file)) return file;
        try {
          const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
          dto = await client.authoringV5Save(packId, parseWorkbenchAuthoringV5Draft(parsed)) as typeof dto;
        } catch (error) {
          if (error instanceof SyntaxError) return errorResult("invalid_json", `Invalid JSON in ${file}`, json);
          if (error instanceof Error && error.message === "invalid_workbench_authoring_v5_bundle") {
            const path = "bundleVersion";
            let authoringCommand = "mastheadctl";
            if (options.env?.MASTHEAD_INSTANCE_MANIFEST) {
              try { authoringCommand = (await client.capabilities()).command; } catch {}
            }
            return errorResult(
              "invalid_workbench_authoring_v5_bundle",
              `Invalid Workbench authoring V5 bundle at ${path} in ${file}`,
              json,
              {
                findings: [{
                  code: "invalid_workbench_authoring_v5_bundle",
                  message: `The bundle does not match the V5 schema at ${path}.`,
                  path,
                  severity: "error"
                }],
                nextAction: {
                  command: `${authoringCommand} workbench author scaffold --pack ${shellQuote(packId)} --file ${shellQuote(`${file}.scaffold.json`)} --json`,
                  kind: "scaffold",
                  reason: "Regenerate the daemon-owned V5 draft scaffold, then author its blank skill fields."
                },
                path
              }
            );
          }
          throw error;
        }
      } else {
        dto = await client.authoringV5Finish(packId) as typeof dto;
      }
    }
    return renderGuidedDto(dto, json);
  } catch (error) {
    if (error instanceof MastheadAuthoringClientError) {
      return errorResult(error.code, error.message, json, { body: error.body, status: error.status });
    }
    throw error;
  }
}

function replaceFileArgument(command: string, file: string): string {
  if (!/\s--file\s+\S+/u.test(command)) return command;
  return command.replace(/(\s--file\s+)\S+/u, `$1${shellQuote(file)}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

export function guidedAuthoringHelp(): string {
  return [
    "Usage: mastheadctl workbench author <command> [options]",
    "",
    "Workbench authoring V5:",
    "  mastheadctl workbench author bootstrap --request <request-id> [--json]",
    "  mastheadctl workbench author start --request <request-id> [--json]",
    "  mastheadctl workbench author claim --request <request-id> [--json]",
    "  mastheadctl workbench author inspect --pack <pack-id> [--session <session-id>] [--cursor <cursor>] [--json]",
    "  mastheadctl workbench author scaffold --pack <pack-id> --file <draft.json> [--json]",
    "  mastheadctl workbench author save --pack <pack-id> --file <draft.json> [--json]",
    "  mastheadctl workbench author finish --pack <pack-id> [--json]",
    "  mastheadctl workbench author status --request <request-id> [--json]",
    "  mastheadctl workbench author receipt --request <request-id> [--json]",
    "",
    "Run one returned nextAction at a time. Masthead owns pack membership and evidence coverage."
  ].join("\n") + "\n";
}

function parseWorkbenchAuthoringV5Draft(value: unknown): WorkbenchAuthoringV5Draft {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (value as Record<string, unknown>).bundleVersion !== "workbench-authoring-v5") {
    throw new Error("invalid_workbench_authoring_v5_bundle");
  }
  return value as WorkbenchAuthoringV5Draft;
}

function renderGuidedDto(
  dto: { nextAction: WorkbenchAuthoringV5NextAction; [key: string]: unknown },
  json: boolean
): CliResult {
  const action = dto.nextAction;
  if (
    !action || typeof action !== "object" ||
    typeof action.kind !== "string" ||
    typeof action.reason !== "string" || !action.reason.trim() ||
    typeof action.command !== "string"
  ) {
    return errorResult("invalid_daemon_response", "Masthead daemon returned no guided next action", json);
  }
  if (json) return jsonResult(dto);
  return textResult(`${action.reason}\n${action.command ? `${action.command}\n` : ""}`);
}

function requiredOption(args: string[], option: string, json: boolean): string | CliResult {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) {
      const candidate = args[index + 1];
      if (!candidate || candidate.startsWith("--") || !candidate.trim()) {
        return errorResult("missing_argument", `Missing value for option: ${option}`, json);
      }
      return candidate.trim();
    }
    if (arg.startsWith(`${option}=`)) {
      const candidate = arg.slice(option.length + 1).trim();
      return candidate || errorResult("missing_argument", `Missing value for option: ${option}`, json);
    }
  }
  return errorResult("missing_argument", `Missing required option: ${option}`, json);
}

function optionalOption(args: string[], option: string, json: boolean): string | undefined | CliResult {
  const present = args.some((arg) => arg === option || arg.startsWith(`${option}=`));
  return present ? requiredOption(args, option, json) : undefined;
}

function rawOptionValue(args: string[], option: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) return args[index + 1]?.trim() || undefined;
    if (arg.startsWith(`${option}=`)) return arg.slice(option.length + 1).trim() || undefined;
  }
  return undefined;
}

function isCliResult(value: string | CliResult): value is CliResult {
  return typeof value !== "string";
}

function isCliResultValue(value: unknown): value is CliResult {
  return typeof value === "object" && value !== null && "exitCode" in value && "stdout" in value && "stderr" in value;
}

function validateOptions(args: string[], allowed: Set<string>, json: boolean): CliResult | undefined {
  const counts = new Map<string, number>();
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const option = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!allowed.has(option)) {
      return errorResult("invalid_argument", `Unsupported guided authoring option: ${option}`, json);
    }
    counts.set(option, (counts.get(option) ?? 0) + 1);
  }
  for (const [option, count] of counts) {
    if (option !== "--json" && count > 1) {
      return errorResult("invalid_argument", `${option} may be provided only once`, json);
    }
  }
  return undefined;
}
