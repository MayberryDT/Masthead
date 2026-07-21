import { readFile, writeFile } from "node:fs/promises";
import type { GuidedAuthoringNextAction } from "../shared/guidedAuthoring.ts";
import { parseGuidedAuthoringBundleV4 } from "../workbench/authoring/authoringSchemas.ts";
import { MastheadAuthoringClient, MastheadAuthoringClientError } from "./authoringClient.ts";
import { errorResult, jsonResult, textResult, type CliResult } from "./output.ts";

export type GuidedAuthoringCliOptions = {
  env?: NodeJS.ProcessEnv;
};

const guidedCommands = new Set(["start", "inspect", "scaffold", "save", "review", "finish"]);

export async function runGuidedAuthoringCli(
  args: string[],
  options: GuidedAuthoringCliOptions = {}
): Promise<CliResult> {
  const command = args[0];
  const json = args.includes("--json");
  if (!command || command === "help" || command === "--help") return textResult(guidedAuthoringHelp());
  if (!guidedCommands.has(command)) {
    return errorResult("unknown_command", `Unknown guided authoring command: ${command}`, json);
  }
  const allowedOptions = command === "start"
    ? new Set(["--request", "--json"])
    : command === "save" || command === "scaffold"
      ? new Set(["--assignment", "--file", "--json"])
      : command === "inspect"
        ? new Set(["--assignment", "--session", "--cursor", "--json"])
        : new Set(["--assignment", "--json"]);
  const optionFailure = validateOptions(args.slice(1), allowedOptions, json);
  if (optionFailure) return optionFailure;

  const client = new MastheadAuthoringClient({
    baseUrl: options.env?.MASTHEAD_DAEMON_URL,
    instanceManifest: options.env?.MASTHEAD_INSTANCE_MANIFEST
  });

  try {
    let dto: { nextAction: GuidedAuthoringNextAction; [key: string]: unknown };
    if (command === "start") {
      const requestId = requiredOption(args, "--request", json);
      if (isCliResult(requestId)) return requestId;
      dto = compactStartDto(await client.guidedStart(requestId));
    } else {
      const assignmentId = requiredOption(args, "--assignment", json);
      if (isCliResult(assignmentId)) return assignmentId;
      if (command === "inspect") {
        const sessionId = optionalOption(args, "--session", json);
        if (sessionId && isCliResult(sessionId)) return sessionId;
        const cursor = optionalOption(args, "--cursor", json);
        if (cursor && isCliResult(cursor)) return cursor;
        dto = compactInspectDto(await client.guidedInspect(assignmentId, {
          ...(cursor ? { cursor } : {}),
          ...(sessionId ? { sessionId } : {})
        }));
      } else if (command === "review") {
        dto = compactReviewDto(await client.guidedReview(assignmentId));
      } else if (command === "scaffold") {
        const file = requiredOption(args, "--file", json);
        if (isCliResult(file)) return file;
        const scaffold = await client.guidedScaffold(assignmentId);
        await writeFile(file, `${JSON.stringify(scaffold.draft, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        dto = {
          assignmentId: scaffold.assignmentId,
          draftSummary: {
            artifactCount: scaffold.draft.artifacts.length,
            opportunityDispositionCount: scaffold.draft.opportunityDispositions.length,
            sessionEnrichmentCount: scaffold.draft.sessionEnrichments.length
          },
          file,
          nextAction: {
            ...scaffold.nextAction,
            command: replaceFileArgument(scaffold.nextAction.command, file)
          }
        };
      } else if (command === "save") {
        const file = requiredOption(args, "--file", json);
        if (isCliResult(file)) return file;
        try {
          const saved = await client.guidedSave(
            assignmentId,
            parseGuidedAuthoringBundleV4(JSON.parse(await readFile(file, "utf8")) as unknown)
          );
          const { draft: _localFileAlreadyContainsDraft, ...saveSummary } = saved;
          dto = saveSummary;
        } catch (error) {
          if (error instanceof SyntaxError) return errorResult("invalid_json", `Invalid JSON in ${file}`, json);
          if (error instanceof Error && (
            error.message === "invalid_guided_authoring_bundle" ||
            error.message.startsWith("invalid_guided_authoring_bundle:") ||
            error.message === "unsupported_authoring_bundle_version"
          )) {
            const unsupportedVersion = error.message === "unsupported_authoring_bundle_version";
            const path = unsupportedVersion
              ? "bundleVersion"
              : error.message.slice("invalid_guided_authoring_bundle:".length) || "bundle";
            let authoringCommand = "mastheadctl";
            if (options.env?.MASTHEAD_INSTANCE_MANIFEST) {
              try { authoringCommand = (await client.capabilities()).command; } catch {}
            }
            return errorResult(
              "invalid_guided_authoring_bundle",
              `Invalid guided authoring V4 bundle at ${path} in ${file}`,
              json,
              {
                findings: [{
                  code: "invalid_guided_authoring_bundle",
                  message: `The bundle does not match the V4 schema at ${path}.`,
                  path,
                  severity: "error"
                }],
                nextAction: unsupportedVersion
                  ? {
                      command: `${authoringCommand} workbench author scaffold --assignment ${shellQuote(assignmentId)} --file ${shellQuote(`${file}.scaffold.json`)} --json`,
                      kind: "scaffold",
                      reason: "Regenerate the daemon-owned V4 draft scaffold, then edit only its authored content and evidence support."
                    }
                  : {
                      command: `${authoringCommand} workbench author save --assignment ${shellQuote(assignmentId)} --file ${shellQuote(file)} --json`,
                      kind: "revise",
                      reason: `Edit the invalid field at ${path} in the existing V4 draft, then re-save the same file.`
                    },
                path
              }
            );
          }
          throw error;
        }
      } else {
        dto = await client.guidedFinish(assignmentId);
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

function compactStartDto(
  dto: { nextAction: GuidedAuthoringNextAction; [key: string]: unknown }
): { nextAction: GuidedAuthoringNextAction; [key: string]: unknown } {
  const editorialBrief = compactEditorialBrief(dto.editorialBrief);
  const authoringContract = compactAuthoringContract(dto.authoringContract);
  return {
    ...dto,
    ...(editorialBrief ? { editorialBrief } : {}),
    ...(authoringContract ? { authoringContract } : {})
  };
}

function compactInspectDto(
  dto: { nextAction: GuidedAuthoringNextAction; [key: string]: unknown }
): { nextAction: GuidedAuthoringNextAction; [key: string]: unknown } {
  const authoringContract = compactAuthoringContract(dto.authoringContract);
  return { ...dto, ...(authoringContract ? { authoringContract } : {}) };
}

function compactReviewDto(
  dto: { nextAction: GuidedAuthoringNextAction; [key: string]: unknown }
): { nextAction: GuidedAuthoringNextAction; [key: string]: unknown } {
  const { draft: _draftAlreadyPersistedInTheAgentFile, ...summary } = dto;
  return summary;
}

function compactAuthoringContract(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { bundleSchema: _schemaAvailableThroughTheDaemonScaffold, ...guidance } = value as Record<string, unknown>;
  return guidance;
}

function compactEditorialBrief(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { sessions: _canonicalDossiersAvailableThroughInspection, ...brief } = value as Record<string, unknown>;
  return brief;
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
    "Guided authoring:",
    "  mastheadctl workbench author start --request <request-id> [--json]",
    "  mastheadctl workbench author inspect --assignment <assignment-id> [--session <session-id>] [--cursor <cursor>] [--json]",
    "  mastheadctl workbench author scaffold --assignment <assignment-id> --file <draft.json> [--json]",
    "  mastheadctl workbench author save --assignment <assignment-id> --file <draft.json> [--json]",
    "  mastheadctl workbench author review --assignment <assignment-id> [--json]",
    "  mastheadctl workbench author finish --assignment <assignment-id> [--json]",
    "",
    "Run one returned nextAction at a time. Masthead owns assignment membership and evidence coverage."
  ].join("\n") + "\n";
}

function renderGuidedDto(
  dto: { nextAction: GuidedAuthoringNextAction; [key: string]: unknown },
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

function isCliResult(value: string | CliResult): value is CliResult {
  return typeof value !== "string";
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
