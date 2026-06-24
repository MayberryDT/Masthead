import { createHash } from "node:crypto";
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
  "commandOutput",
  "stdout",
  "stderr",
  "screenshot",
  "browserState",
  "shellHistory",
  "databaseContents",
  "toolResponse",
  "lastAssistantMessage"
]);

export type CodexHookDiagnostic = {
  code: "malformed_json" | "invalid_payload";
  message: string;
  receivedAt: string;
  details?: string;
};

export type CodexHookParseResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; diagnostic: CodexHookDiagnostic };

type NormalizeOptions = {
  receivedAt?: string;
};

export function parseCodexHookPayload(raw: string, options: NormalizeOptions = {}): CodexHookParseResult {
  const receivedAt = options.receivedAt ?? new Date().toISOString();
  try {
    return { ok: true, event: normalizeCodexHookPayload(JSON.parse(raw), { receivedAt }) };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        diagnostic: {
          code: "malformed_json",
          message: "Unable to parse Codex hook payload as JSON.",
          receivedAt,
          details: error.message
        }
      };
    }
    return {
      ok: false,
      diagnostic: {
        code: "invalid_payload",
        message: "Codex hook payload must be a JSON object.",
        receivedAt,
        details: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export function normalizeCodexHookPayload(input: unknown, options: NormalizeOptions = {}): NormalizedEvent {
  if (!isRecord(input)) {
    throw new TypeError("expected object payload");
  }

  const receivedAt = options.receivedAt ?? new Date().toISOString();
  const redactedInput = redactValue(input);
  const type = mapEventType(firstString(input, ["event", "type", "hook_event_name", "hookEventName", "event_name", "eventName"]), redactedInput);
  const payload = buildPayload(redactedInput, type);
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
  const stableSourceEventId = sourceEventId ?? payloadHash;
  const occurredAt =
    firstString(input, ["timestamp", "occurred_at", "occurredAt", "time", "created_at", "createdAt"]) ?? receivedAt;
  const eventId = `codex:${stableSourceEventId}`;
  const workspace = workspaceFrom(redactedInput);
  const sensitivity = JSON.stringify(input) === JSON.stringify(redactedInput) ? "metadata" : "redacted";

  return {
    schemaVersion: 1,
    eventId,
    sessionId: firstString(input, ["session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId"]),
    source: {
      adapter: "codex",
      surface: "hook",
      sourceEventId: stableSourceEventId
    },
    occurredAt,
    receivedAt,
    type,
    workspace,
    summary: summaryFrom(redactedInput, payload),
    payload,
    sensitivity: rawPayloadSuppressed(redactedInput) ? "redacted" : sensitivity,
    payloadHash,
    evidence: [
      {
        id: eventId,
        kind: "event",
        observedAt: occurredAt,
        source: "codex.hook"
      }
    ]
  };
}

function mapEventType(value: string | undefined, input: Record<string, unknown>): EventType {
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

function normalizeEventName(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[-\s.]+/g, "_");
}

function workspaceFrom(input: Record<string, unknown>): WorkspaceRef | undefined {
  const workspace = isRecord(input.workspace) ? input.workspace : {};
  const git = isRecord(input.git) ? input.git : {};
  const cwd = firstString(input, ["cwd", "working_directory", "workingDirectory"]) ?? firstString(workspace, ["cwd"]);
  const repoRoot =
    firstString(input, ["repo_root", "repoRoot"]) ??
    firstString(workspace, ["repo_root", "repoRoot"]) ??
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
    firstString(input, ["branch"]) ?? firstString(workspace, ["branch"]) ?? firstString(git, ["branch"]);
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

function buildPayload(input: Record<string, unknown>, eventType: EventType): Record<string, unknown> {
  const excluded = new Set([
    "provider_event_id",
    "providerEventId",
    "event_id",
    "eventId",
    "hook_event_id",
    "hookEventId",
    "id",
    "event",
    "type",
    "hook_event_name",
    "hookEventName",
    "event_name",
    "eventName",
    "timestamp",
    "occurred_at",
    "occurredAt",
    "time",
    "created_at",
    "createdAt",
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
    "thread_id",
    "threadId",
    "cwd",
    "working_directory",
    "workingDirectory",
    "repo_root",
    "repoRoot",
    "worktree_path",
    "worktreePath",
    "git_common_dir",
    "gitCommonDir",
    "branch",
    "head_sha",
    "headSha",
    "workspace",
    "git"
  ]);
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (excluded.has(key) || value === undefined) continue;
    const normalizedKey = toCamelCase(key);
    if (normalizedKey === "lastAssistantMessage" && typeof value === "string") {
      const observedAt =
        firstString(input, ["timestamp", "occurred_at", "occurredAt", "time", "created_at", "createdAt"]) ??
        new Date(0).toISOString();
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

function summaryFrom(input: Record<string, unknown>, payload: Record<string, unknown>): string {
  return (
    firstString(input, ["summary", "message", "title", "objective"]) ??
    firstString(payload, ["summary", "message", "title", "objective", "command"]) ??
    "Codex hook event"
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
