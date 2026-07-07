import { createHash } from "node:crypto";
import { LIVE_RUNTIME_PROFILES, type LiveRuntimeProfile } from "../adapters/live/runtimeProfiles.ts";
import { ALL_RUNTIME_KINDS, type RuntimeKind } from "../adapters/types.ts";
import { buildLatestFeedbackSnapshot } from "./feedbackSnapshot.ts";
import { liveStateImpliedByEvent } from "./livePermission.ts";
import { normalizeLiveState, type LiveStateAuthority, type LiveStateReportInput } from "./liveState.ts";
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
const MAX_LIVE_HOOK_BYTES = 262_144;
const MAX_LIVE_HOOK_DEPTH = 20;
const MAX_LIVE_HOOK_ARRAY_LENGTH = 500;
const MAX_LIVE_HOOK_OBJECT_KEYS = 200;

export type LiveHookDiagnostic = {
  code: "malformed_json" | "invalid_payload" | "unsupported_runtime";
  message: string;
  receivedAt: string;
  details?: string;
};

export type LiveHookRuntimeDiagnostic = {
  code: "runtime_mismatch" | "source_path_mismatch";
  normalizedRuntime: RuntimeKind;
  reportedRuntime?: string;
  payloadKey?: string;
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
  const runtime = options.runtime;
  if (!runtime) {
    return {
      ok: false,
      diagnostic: {
        code: "unsupported_runtime",
        message: "Live hook runtime is required.",
        receivedAt
      }
    };
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_LIVE_HOOK_BYTES) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid_payload",
        message: `${diagnosticRuntimeLabel(runtime)} hook payload exceeds ${MAX_LIVE_HOOK_BYTES} bytes.`,
        receivedAt
      }
    };
  }
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
          message: `${diagnosticRuntimeLabel(runtime)} hook payload could not be parsed as JSON.`,
          receivedAt,
          details: error.message
        }
      };
    }
    return {
      ok: false,
      diagnostic: {
        code: "invalid_payload",
        message: `${diagnosticRuntimeLabel(runtime)} hook payload must be a JSON object.`,
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
  assertLiveHookShape(input);

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
    sensitivity: rawPayloadSuppressed(redactedInput, profile) ? "redacted" : sensitivity,
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

export function liveStateReportFromHookPayload(input: unknown, options: LiveHookNormalizeOptions = {}): LiveStateReportInput | undefined {
  const event = normalizeLiveHookPayload(input, options);
  const explicitState =
    event.type === "user.question"
      ? undefined
      : normalizeLiveState(event.payload.runtimeLifecycleState) ??
        normalizeLiveState(firstPayloadString(event, ["state", "status", "runtimeState", "lifecycleState"]));
  const impliedState = liveStateImpliedByEvent(event);
  const state = explicitState ?? impliedState;
  if (!state) return undefined;

  return {
    runtime: event.source.adapter as RuntimeKind,
    source: event.evidence[0]?.source ?? `${event.source.adapter}.${event.source.surface}`,
    sourceSessionId: firstPayloadString(event, ["sourceSessionId"]) ?? event.sessionId,
    sourceEventId: event.source.sourceEventId,
    state,
    authority: authorityForSurface(event.source.surface),
    observedAt: event.occurredAt,
    cwd: event.workspace?.cwd,
    repoRoot: event.workspace?.repoRoot,
    branch: event.workspace?.branch
  };
}

function fallbackSourceEventId(
  profile: LiveRuntimeProfile,
  sessionId: string | undefined,
  type: EventType,
  occurredAt: string,
  payloadHash: string
): string {
  return hashStable({
    runtime: profile.runtime,
    sessionId,
    type,
    occurredAt,
    payloadHash
  });
}

function firstPayloadString(event: NormalizedEvent, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event.payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function authorityForSurface(surface: NormalizedEvent["source"]["surface"]): LiveStateAuthority {
  return surface === "plugin" ? "plugin" : surface === "tailer" ? "tailer" : "hook";
}

function profileForRuntime(value: string | undefined): LiveRuntimeProfile {
  if (!value) throw new UnsupportedRuntimeError("required");
  const runtime = value as RuntimeKind;
  if (!(ALL_RUNTIME_KINDS as readonly string[]).includes(runtime)) throw new UnsupportedRuntimeError(value);
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
    case "approval_resolved":
    case "permission_resolved":
      return "approval.resolved";
    case "question":
    case "user_question":
    case "user_input_requested":
      return "user.question";
    case "input":
    case "user_input":
    case "user_response":
    case "user_prompt_submit":
      return "user.response";
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
    case "agent_end":
    case "session_stop":
    case "stop":
      return "turn.completed";
    case "session_shutdown":
    case "session_closed":
    case "session_end":
      return "session.closed";
    case "session_complete":
    case "session_completed":
    case "completed":
      return "turn.completed";
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
  const eventNameKeys = new Set(profile.eventNameKeys.filter((key) => !(profile.runtimeStateKeys ?? []).includes(key)));
  const excluded = new Set([
    "provider_event_id",
    "providerEventId",
    "event_id",
    "eventId",
    "hook_event_id",
    "hookEventId",
    "id",
    ...eventNameKeys,
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
    "git",
    "runtime",
    "harness"
  ]);
  const payload: Record<string, unknown> = {};
  if (profile.includeRuntimePayloadMetadata) {
    payload.runtime = profile.runtime;
    payload.harness = profile.label;
    payload.sourceSessionId = sourceSessionId;
  }
  const runtimeLifecycleState = runtimeLifecycleStateFrom(input, profile);
  if (runtimeLifecycleState) payload.runtimeLifecycleState = runtimeLifecycleState;
  const runtimeDiagnostics = runtimeDiagnosticsFrom(input, profile);
  if (runtimeDiagnostics.length > 0) payload.runtimeDiagnostics = runtimeDiagnostics;

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
    if (normalizedKey === "message") {
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

function runtimeDiagnosticsFrom(input: Record<string, unknown>, profile: LiveRuntimeProfile): LiveHookRuntimeDiagnostic[] {
  const diagnostics: LiveHookRuntimeDiagnostic[] = [];
  const reportedRuntime = firstString(input, ["runtime", "adapter", "harnessRuntime", "sourceRuntime"]);
  if (reportedRuntime && reportedRuntime !== profile.runtime) {
    diagnostics.push({
      code: "runtime_mismatch",
      normalizedRuntime: profile.runtime,
      reportedRuntime
    });
  }

  const pathMismatches = sourcePathMismatches(input, profile.runtime);
  for (const mismatch of pathMismatches) {
    diagnostics.push({
      code: "source_path_mismatch",
      normalizedRuntime: profile.runtime,
      payloadKey: mismatch.key,
      reportedRuntime: mismatch.runtime
    });
  }
  return diagnostics;
}

function sourcePathMismatches(input: Record<string, unknown>, normalizedRuntime: RuntimeKind): Array<{ key: string; runtime: string }> {
  const mismatches: Array<{ key: string; runtime: string }> = [];
  const stack: Array<{ key: string; value: unknown }> = Object.entries(input).map(([key, value]) => ({ key, value }));
  const seen = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (typeof current.value === "string") {
      const runtime = runtimeHintFromPath(current.value);
      if (runtime && runtime !== normalizedRuntime && !seen.has(`${current.key}:${runtime}`)) {
        seen.add(`${current.key}:${runtime}`);
        mismatches.push({ key: current.key, runtime });
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      current.value.forEach((value, index) => stack.push({ key: `${current.key}[${index}]`, value }));
      continue;
    }
    if (isRecord(current.value)) {
      for (const [key, value] of Object.entries(current.value)) stack.push({ key: current.key ? `${current.key}.${key}` : key, value });
    }
  }

  return mismatches;
}

function runtimeHintFromPath(value: string): RuntimeKind | undefined {
  if (/(^|[/\\])\.grok([/\\]|$)/i.test(value)) return "grok";
  if (/(^|[/\\])\.claude([/\\]|$)/i.test(value)) return "claude_code";
  if (/(^|[/\\])\.codex([/\\]|$)/i.test(value)) return "codex";
  if (/(^|[/\\])\.omp([/\\]|$)/i.test(value)) return "omp";
  if (/(^|[/\\])\.pi([/\\]|$)/i.test(value)) return "pi";
  if (/(^|[/\\])\.hermes([/\\]|$)/i.test(value)) return "hermes";
  return undefined;
}

function runtimeLifecycleStateFrom(
  input: Record<string, unknown>,
  profile: LiveRuntimeProfile
): "running" | "idle" | "blocked" | undefined {
  if (!profile.runtimeStateKeys || !profile.runtimeStateMap) return undefined;
  for (const key of profile.runtimeStateKeys) {
    const normalized = normalizeRuntimeStateKey(firstString(input, [key]));
    const mapped = normalized ? profile.runtimeStateMap[normalized] : undefined;
    if (mapped) return mapped;
  }
  return undefined;
}

function normalizeRuntimeStateKey(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function summaryFrom(
  input: Record<string, unknown>,
  payload: Record<string, unknown>,
  profile: LiveRuntimeProfile
): string {
  return (
    firstString(input, ["summary", "title", "objective"]) ??
    firstString(payload, ["summary", "title", "objective", "command", "normalizedCommand"]) ??
    `${profile.label} ${profile.surface} event`
  );
}

function redactValue(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError("expected object payload");
  }
  return redactRecord(value);
}

function rawPayloadSuppressed(input: Record<string, unknown>, profile: LiveRuntimeProfile): boolean {
  return (
    Object.keys(input).some((key) => SUPPRESSED_RAW_PAYLOAD_KEYS.has(toCamelCase(key))) ||
    hasPatchCommand(input.toolInput) ||
    isRecord(input.message) ||
    typeof input.message === "string"
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

function assertLiveHookShape(value: unknown): void {
  const stack: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.depth > MAX_LIVE_HOOK_DEPTH) throw new TypeError("hook payload is too deeply nested");
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_LIVE_HOOK_ARRAY_LENGTH) throw new TypeError("hook payload array is too large");
      for (const item of current.value) stack.push({ depth: current.depth + 1, value: item });
      continue;
    }
    if (isRecord(current.value)) {
      const entries = Object.values(current.value);
      if (entries.length > MAX_LIVE_HOOK_OBJECT_KEYS) throw new TypeError("hook payload object has too many keys");
      for (const item of entries) stack.push({ depth: current.depth + 1, value: item });
    }
  }
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
