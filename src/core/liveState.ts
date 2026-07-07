import { ALL_RUNTIME_KINDS, type RuntimeKind } from "../adapters/types.ts";

export type LiveRuntimeSemanticState = "working" | "blocked" | "idle" | "unknown";
export type LiveRuntimeDisplayState = "working" | "blocked" | "done" | "idle" | "unknown";
export type LiveStateAuthority = "hook" | "plugin" | "tailer" | "process" | "inferred";

export type LiveSessionRef = {
  kind: "id" | "path";
  value: string;
};

export type LiveStateReportInput = {
  runtime: RuntimeKind;
  source: string;
  sourceSessionId?: string;
  canonicalSessionId?: string;
  sourceEventId?: string;
  state: LiveRuntimeSemanticState | string;
  authority?: LiveStateAuthority;
  message?: string;
  customStatus?: string;
  seq?: number;
  observedAt?: string;
  ttlMs?: number;
  cwd?: string;
  repoRoot?: string;
  branch?: string;
  pid?: number;
  processName?: string;
  sessionRef?: LiveSessionRef;
  payload?: Record<string, unknown>;
};

export type LiveStateReport = Required<Pick<LiveStateReportInput, "runtime" | "source" | "observedAt">> & {
  reportId: string;
  state: LiveRuntimeSemanticState;
  sourceSessionId?: string;
  canonicalSessionId?: string;
  sourceEventId?: string;
  authority: LiveStateAuthority;
  message?: string;
  customStatus?: string;
  seq?: number;
  expiresAt?: string;
  cwd?: string;
  repoRoot?: string;
  branch?: string;
  pid?: number;
  processName?: string;
  sessionRef?: LiveSessionRef;
  payload?: Record<string, unknown>;
};

const DEFAULT_TTL_BY_STATE: Record<LiveRuntimeSemanticState, number> = {
  working: 30_000,
  blocked: 10 * 60_000,
  idle: 24 * 60 * 60_000,
  unknown: 60_000
};

const WORKING_ALIASES = new Set(["working", "running", "active", "busy", "thinking", "executing"]);
const BLOCKED_ALIASES = new Set([
  "blocked",
  "waiting_for_approval",
  "approval_requested",
  "approval_required",
  "requires_approval",
  "permission_requested"
]);
const IDLE_ALIASES = new Set(["idle", "ready", "waiting", "done", "complete", "completed", "stopped", "ended"]);
const AUTHORITIES = new Set<LiveStateAuthority>(["hook", "plugin", "tailer", "process", "inferred"]);

export function normalizeLiveState(value: unknown): LiveRuntimeSemanticState | undefined {
  const normalized = normalizeToken(value);
  if (!normalized) return undefined;
  if (WORKING_ALIASES.has(normalized)) return "working";
  if (BLOCKED_ALIASES.has(normalized)) return "blocked";
  if (IDLE_ALIASES.has(normalized)) return "idle";
  if (normalized === "unknown") return "unknown";
  return undefined;
}

export function normalizeLiveStateReport(input: unknown, now: Date = new Date()): LiveStateReport {
  if (!isRecord(input)) throw new TypeError("live state report must be an object");
  const runtime = requiredRuntime(input.runtime);
  const source = requiredString(input.source, "source");
  const state = normalizeLiveState(input.state);
  if (!state) throw new TypeError("live state report state is unsupported");
  const observedAt = normalizeInstant(typeof input.observedAt === "string" ? input.observedAt : now.toISOString(), "observedAt");
  const ttlMs = optionalFiniteNumber(input.ttlMs);
  const expiresAt = new Date(Date.parse(observedAt) + (ttlMs ?? DEFAULT_TTL_BY_STATE[state])).toISOString();
  const authority = normalizeAuthority(input.authority);
  const sessionRef = normalizeSessionRef(input.sessionRef);
  const seq = optionalFiniteNumber(input.seq);

  const report: LiveStateReport = {
    reportId: "",
    runtime,
    source,
    state,
    authority,
    observedAt,
    expiresAt
  };
  assignString(report, "sourceSessionId", input.sourceSessionId);
  assignString(report, "canonicalSessionId", input.canonicalSessionId);
  assignString(report, "sourceEventId", input.sourceEventId);
  assignString(report, "message", input.message);
  assignString(report, "customStatus", input.customStatus);
  assignString(report, "cwd", input.cwd);
  assignString(report, "repoRoot", input.repoRoot);
  assignString(report, "branch", input.branch);
  assignString(report, "processName", input.processName);
  if (seq !== undefined) report.seq = seq;
  const pid = optionalFiniteNumber(input.pid);
  if (pid !== undefined) report.pid = pid;
  if (sessionRef) report.sessionRef = sessionRef;
  if (isRecord(input.payload)) report.payload = input.payload;

  report.reportId = `live_state:${hashStable({
    key: liveStateKey(report),
    state: report.state,
    observedAt: report.observedAt,
    seq: report.seq,
    sourceEventId: report.sourceEventId,
    payload: report.payload
  }).slice(0, 32)}`;
  return report;
}

export function liveStateKey(
  report: Pick<LiveStateReport, "runtime" | "source" | "sourceSessionId" | "sessionRef" | "cwd">
): string {
  if (report.sourceSessionId) return `${report.runtime}:${report.source}:source:${report.sourceSessionId}`;
  if (report.sessionRef?.value) return `${report.runtime}:${report.source}:${report.sessionRef.kind}:${report.sessionRef.value}`;
  if (report.cwd) return `${report.runtime}:${report.source}:cwd:${report.cwd}`;
  return `${report.runtime}:${report.source}:unknown`;
}

export function reportIsFresh(report: LiveStateReport, now: Date = new Date()): boolean {
  if (!report.expiresAt) return true;
  return Date.parse(report.expiresAt) >= now.getTime();
}

export function displayStateForLiveState(
  state: LiveRuntimeSemanticState,
  options: { unseenCompletedTurn?: boolean }
): LiveRuntimeDisplayState {
  if (state === "idle" && options.unseenCompletedTurn) return "done";
  return state;
}

function requiredRuntime(value: unknown): RuntimeKind {
  if (typeof value !== "string" || !(ALL_RUNTIME_KINDS as readonly string[]).includes(value)) {
    throw new TypeError("live state report runtime is unsupported");
  }
  return value as RuntimeKind;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`live state report ${field} is required`);
  return value.trim();
}

function normalizeAuthority(value: unknown): LiveStateAuthority {
  return typeof value === "string" && AUTHORITIES.has(value as LiveStateAuthority) ? (value as LiveStateAuthority) : "inferred";
}

function normalizeSessionRef(value: unknown): LiveSessionRef | undefined {
  if (!isRecord(value)) return undefined;
  if ((value.kind === "id" || value.kind === "path") && typeof value.value === "string" && value.value.trim()) {
    return { kind: value.kind, value: value.value.trim() };
  }
  return undefined;
}

function normalizeInstant(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new TypeError(`live state report ${field} is invalid`);
  return new Date(timestamp).toISOString();
}

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function assignString<T extends Record<string, unknown>>(target: T, key: keyof T, value: unknown): void {
  if (typeof value === "string" && value.trim()) target[key] = value.trim() as T[keyof T];
}

function hashStable(value: unknown): string {
  const text = stableStringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + index;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return [h1, h2, h1 ^ h2, Math.imul(h1 + h2, 0xc2b2ae35)]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
