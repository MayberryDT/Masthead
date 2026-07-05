import { createHash } from "node:crypto";
import { LIVE_RUNTIME_PROFILES, type LiveRuntimeProfile } from "../adapters/live/runtimeProfiles.ts";
import { RUNTIME_KINDS, type RuntimeKind } from "../adapters/types.ts";
import { buildLatestFeedbackSnapshot } from "./feedbackSnapshot.ts";
import { redactPath, redactText } from "./redaction.ts";
import type { EventType, NormalizedEvent, WorkspaceRef } from "./types";

const SUPPRESSED_RAW_PAYLOAD_KEYS = new Set([
  "rawPrompt",
  "prompt",
  "transcript",
  "fullTranscript",
  "fullDiff",
  "diff",
  "patch",
  "message",
  "messages",
  "commandOutput",
  "stdout",
  "stderr",
  "output",
  "outputs",
  "rawOutput",
  "rawOutputs",
  "terminalOutput",
  "terminalOutputs",
  "screenshot",
  "screenshots",
  "browserState",
  "shellHistory",
  "databaseContents",
  "toolOutput",
  "toolOutputs",
  "toolResponse",
  "toolResult",
  "toolResults",
  "lastAssistantMessage"
]);

export type LiveHookDiagnostic = {
  code: "malformed_json" | "invalid_payload" | "unsupported_runtime";
  message: string;
  receivedAt: string;
  details?: string;
};

export type LiveHookParseResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; diagnostic: LiveHookDiagnostic };

export type LiveHookNormalizeOptions = {
  receivedAt?: string;
  runtime?: string;
};

export function parseLiveHookPayload(raw: string, options: LiveHookNormalizeOptions = {}): LiveHookParseResult {
  const receivedAt = options.receivedAt ?? new Date().toISOString();
  const runtime = options.runtime ?? "codex";
  try {
    profileForRuntime(runtime);
  } catch (error) {
    if (error instanceof UnsupportedRuntimeError) {
      return {
        ok: false,
        diagnostic: {
          code: "unsupported_runtime",
          message: `Unsupported live hook runtime: ${error.runtime}.`,
          receivedAt
        }
      };
    }
    throw error;
  }
  try {
    return { ok: true, event: normalizeLiveHookPayload(JSON.parse(raw), { receivedAt, runtime }) };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        diagnostic: {
          code: "malformed_json",
          message:
            runtime === "codex"
              ? "Unable to parse Codex hook payload as JSON."
              : `${diagnosticRuntimeLabel(runtime)} hook payload could not be parsed as JSON.`,
          receivedAt,
          details: error.message
        }
      };
    }
    return {
      ok: false,
      diagnostic: {
        code: "invalid_payload",
        message:
          runtime === "codex"
            ? "Codex hook payload must be a JSON object."
            : `${diagnosticRuntimeLabel(runtime)} hook payload must be a JSON object.`,
        receivedAt,
        details: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export function normalizeLiveHookPayload(input: unknown, options: LiveHookNormalizeOptions = {}): NormalizedEvent {
  if (!isRecord(input)) {
    throw new TypeError("expected object payload");
  }

  const receivedAt = options.receivedAt ?? new Date().toISOString();
  const profile = profileForRuntime(options.runtime);
  const redactedInput = redactValue(input);
  const type = mapEventType(firstString(input, profile.eventNameKeys), redactedInput, profile);
  const sessionId = firstString(input, profile.sessionIdKeys);
  const payload = buildPayload(redactedInput, type, profile, sessionId);
  const sourceEventId = firstString(input, [
    "provider_event_id",
    "providerEventId",
    "event_id",
    "eventId",
    "hook_event_id",
    "hookEventId",
    "id"
  ]);
  const payloadHash = hashStable(payload);
  const occurredAt = firstString(input, profile.timestampKeys) ?? receivedAt;
  const stableSourceEventId = sourceEventId ?? fallbackSourceEventId(profile, sessionId, type, occurredAt, payloadHash);
  const eventId = `${profile.runtime}:${stableSourceEventId}`;
  const workspace = workspaceFrom(redactedInput, profile);
  const sensitivity = JSON.stringify(input) === JSON.stringify(redactedInput) ? "metadata" : "redacted";

  return {
    schemaVersion: 1,
    eventId,
    sessionId,
    source: {
      adapter: profile.runtime,
      surface: profile.surface,
      sourceEventId: stableSourceEventId
    },
    occurredAt,
    receivedAt,
    type,
    workspace,
    summary: summaryFrom(redactedInput, payload, profile),
    payload,
    sensitivity: rawPayloadSuppressed(redactedInput) ? "redacted" : sensitivity,
    payloadHash,
    evidence: [
      {
        id: eventId,
        kind: "event",
        observedAt: occurredAt,
        source: profile.sourceName
      }
    ]
  };
}

function fallbackSourceEventId(
  profile: LiveRuntimeProfile,
  sessionId: string | undefined,
  type: EventType,
  occurredAt: string,
  payloadHash: string
): string {
  if (profile.runtime === "codex") return payloadHash;
  return hashStable({
    runtime: profile.runtime,
    sessionId,
    type,
    occurredAt,
    payloadHash
  });
}

function profileForRuntime(value: string | undefined): LiveRuntimeProfile {
  const runtime = (value ?? "codex") as RuntimeKind;
  if (!RUNTIME_KINDS.includes(runtime)) throw new UnsupportedRuntimeError(value ?? "codex");
  const profile = LIVE_RUNTIME_PROFILES[runtime];
  if (!profile) throw new UnsupportedRuntimeError(runtime);
  return profile;
}

function diagnosticRuntimeLabel(runtime: string): string {
  const profile = LIVE_RUNTIME_PROFILES[runtime as RuntimeKind];
  return profile?.label ?? runtime;
}

class UnsupportedRuntimeError extends Error {
  constructor(readonly runtime: string) {
    super(`Unsupported live hook runtime: ${runtime}`);
  }
}

function mapEventType(value: string | undefined, input: Record<string, unknown>, profile: LiveRuntimeProfile): EventType {
  const normalizedKey = normalizeEventMapKey(value);
  const mapped = profile.eventMap[normalizedKey];
  if (mapped) {
    return mapped === "command.finished" && isFileMutationTool(input) ? "file.changed" : mapped;
  }

  const normalized = normalizeEventName(value);
  switch (normalized) {
    case "approval":
    case "approval_requested":
    case "requires_approval":
    case "permission_request":
      return "approval.requested";
    case "question":
    case "user_question":
    case "user_input_requested":
      return "user.question";
    case "command_start":
    case "command_started":
    case "command_running":
      return "command.started";
    case "command_finish":
    case "command_finished":
    case "command_completed":
      return "command.finished";
    case "file_change":
    case "file_changed":
    case "files_changed":
      return "file.changed";
    case "post_tool_use":
      return isFileMutationTool(input) ? "file.changed" : "command.finished";
    case "pre_tool_use":
      return "command.started";
    case "session_complete":
    case "session_completed":
    case "completed":
    case "stop":
      return "session.completed";
    case "session_start":
    case "session_started":
    case "start":
    case "session_start_hook":
    default:
      return "session.started";
  }
}

function normalizeEventMapKey(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeEventName(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[-\s.]+/g, "_");
}

function workspaceFrom(input: Record<string, unknown>, profile: LiveRuntimeProfile): WorkspaceRef | undefined {
  const workspace = isRecord(input.workspace) ? input.workspace : {};
  const git = isRecord(input.git) ? input.git : {};
  const cwd =
    firstString(input, ["cwd", "working_directory", "workingDirectory", ...profile.workspaceKeys.cwd]) ??
    firstString(workspace, ["cwd"]);
  const repoRoot =
    firstString(input, ["repo_root", "repoRoot", ...profile.workspaceKeys.repoRoot]) ??
    firstString(workspace, ["repo_root", "repoRoot", ...profile.workspaceKeys.repoRoot]) ??
    firstString(git, ["repo_root", "repoRoot"]);
  const worktreePath =
    firstString(input, ["worktree_path", "worktreePath"]) ??
    firstString(workspace, ["worktree_path", "worktreePath"]) ??
    firstString(git, ["worktree_path", "worktreePath"]);
  const gitCommonDir =
    firstString(input, ["git_common_dir", "gitCommonDir"]) ??
    firstString(workspace, ["git_common_dir", "gitCommonDir"]) ??
    firstString(git, ["common_dir", "commonDir", "git_common_dir", "gitCommonDir"]);
  const branch =
    firstString(input, ["branch", ...profile.workspaceKeys.branch]) ??
    firstString(workspace, ["branch", ...profile.workspaceKeys.branch]) ??
    firstString(git, ["branch"]);
  const headSha =
    firstString(input, ["head_sha", "headSha"]) ??
    firstString(workspace, ["head_sha", "headSha"]) ??
    firstString(git, ["head_sha", "headSha", "sha"]);

  const result: WorkspaceRef = {};
  if (cwd) result.cwd = redactPath(cwd).path;
  if (repoRoot) result.repoRoot = redactPath(repoRoot).path;
  if (worktreePath) result.worktreePath = redactPath(worktreePath).path;
  if (gitCommonDir) result.gitCommonDir = redactPath(gitCommonDir).path;
  if (branch) result.branch = branch;
  if (headSha) result.headSha = headSha;

  return Object.keys(result).length > 0 ? result : undefined;
}

function buildPayload(
  input: Record<string, unknown>,
  eventType: EventType,
  profile: LiveRuntimeProfile,
  sourceSessionId: string | undefined
): Record<string, unknown> {
  const excluded = new Set([
    "provider_event_id",
    "providerEventId",
    "event_id",
    "eventId",
    "hook_event_id",
    "hookEventId",
    "id",
    ...profile.eventNameKeys,
    ...profile.timestampKeys,
    ...profile.sessionIdKeys,
    "cwd",
    "working_directory",
    "workingDirectory",
    "directory",
    "repo_root",
    "repoRoot",
    "workspaceRoot",
    "worktree_path",
    "worktreePath",
    "git_common_dir",
    "gitCommonDir",
    "branch",
    "gitBranch",
    "head_sha",
    "headSha",
    "workspace",
    "git"
  ]);
  const payload: Record<string, unknown> = {};
  if (profile.includeRuntimePayloadMetadata) {
    payload.runtime = profile.runtime;
    payload.harness = profile.label;
    payload.sourceSessionId = sourceSessionId;
  }

  for (const [key, value] of Object.entries(input)) {
    if (excluded.has(key) || value === undefined) continue;
    const normalizedKey = toCamelCase(key);
    if (normalizedKey === "lastAssistantMessage" && typeof value === "string") {
      const observedAt = firstString(input, profile.timestampKeys) ?? new Date(0).toISOString();
      const snapshot = buildLatestFeedbackSnapshot(value, { observedAt });
      if (snapshot) payload.latestFeedbackSnapshot = snapshot;
      payload.lastAssistantMessageSummary = summarizeSuppressedValue(value);
      continue;
    }
    if (SUPPRESSED_RAW_PAYLOAD_KEYS.has(normalizedKey)) {
      payload[`${normalizedKey}Summary`] = summarizeSuppressedValue(value);
      continue;
    }
    if (key === "toolInput") {
      addToolInputMetadata(payload, value);
      continue;
    }
    if (normalizedKey === "message" && isRecord(value)) {
      payload.messageSummary = summarizeSuppressedValue(value);
      continue;
    }
    payload[normalizedKey] = value;
  }

  const toolName = firstString(input, ["toolName", "tool_name"]);
  const toolUseId = firstString(input, ["toolUseId", "tool_use_id"]);
  const exitCode = firstNumber(input, ["exit_code", "exitCode"]);

  if (toolUseId && !payload.commandId) payload.commandId = toolUseId;
  if (toolName && !payload.category) payload.category = categoryForTool(toolName);
  if (eventType === "command.finished" && exitCode !== undefined) payload.exitCode = exitCode;

  return payload;
}

function summaryFrom(
  input: Record<string, unknown>,
  payload: Record<string, unknown>,
  profile: LiveRuntimeProfile
): string {
  return (
    firstString(input, ["summary", "title", "objective"]) ??
    firstString(payload, ["summary", "title", "objective", "command", "normalizedCommand"]) ??
    (profile.runtime === "codex" ? "Codex hook event" : `${profile.label} ${profile.surface} event`)
  );
}

function redactValue(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError("expected object payload");
  }
  return redactRecord(value);
}

function rawPayloadSuppressed(input: Record<string, unknown>): boolean {
  return (
    Object.keys(input).some((key) => SUPPRESSED_RAW_PAYLOAD_KEYS.has(toCamelCase(key))) ||
    hasPatchCommand(input.toolInput)
  );
}

function addToolInputMetadata(payload: Record<string, unknown>, value: unknown): void {
  if (!isRecord(value)) {
    payload.toolInputSummary = summarizeSuppressedValue(value);
    return;
  }

  const command = typeof value.command === "string" ? value.command : undefined;
  if (!command) {
    payload.toolInputSummary = summarizeSuppressedValue(value);
    return;
  }

  if (looksLikePatch(command)) {
    payload.toolInputSummary = {
      stored: false,
      redacted: true,
      kind: "patch",
      bytes: Buffer.byteLength(command)
    };
    return;
  }

  payload.normalizedCommand = redactText(command);
}

function summarizeSuppressedValue(value: unknown): Record<string, unknown> {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return {
    stored: false,
    redacted: true,
    bytes: Buffer.byteLength(text ?? "")
  };
}

function isFileMutationTool(input: Record<string, unknown>): boolean {
  const toolName = firstString(input, ["toolName", "tool_name"])?.toLowerCase();
  if (!toolName) return false;
  return toolName === "apply_patch" || toolName === "edit" || toolName === "file_change";
}

function hasPatchCommand(value: unknown): boolean {
  return isRecord(value) && typeof value.command === "string" && looksLikePatch(value.command);
}

function looksLikePatch(value: string): boolean {
  return value.trimStart().startsWith("*** Begin Patch");
}

function categoryForTool(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (normalized === "bash" || normalized === "shell") return "shell";
  if (normalized === "apply_patch" || normalized === "edit" || normalized === "file_change") return "file_edit";
  return normalized;
}

function firstNumber(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function redactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = redactUnknown(value);
  }
  return output;
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (isRecord(value)) return redactRecord(value);
  return value;
}

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toCamelCase(key: string): string {
  return key.replace(/[_-]([a-z0-9])/gi, (_, char: string) => char.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
