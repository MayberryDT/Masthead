import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { parseCodexTranscript } from "../adapters/codex/transcriptParser.ts";
import type { AdapterRecord, DiscoveredSource } from "../adapters/types.ts";
import type { NormalizedEvent, WorkspaceRef } from "../core/types.ts";

const DEFAULT_RECENT_WINDOW_MS = 30 * 60_000;
const DEFAULT_MAX_FILES = 1;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_TRANSCRIPT_DEPTH = 8;

export type CodexTranscriptLiveScanner = {
  refresh: () => Promise<CodexTranscriptLiveRefresh>;
};

export type CodexTranscriptLiveRefresh = {
  candidates: number;
  events: NormalizedEvent[];
  scanned: number;
  skipped: number;
};

export type CodexTranscriptLiveScannerOptions = {
  homeDir: string;
  maxFiles?: number;
  now?: () => Date;
  pollIntervalMs?: number;
  recentWindowMs?: number;
};

type TranscriptCandidate = {
  modifiedAt: string;
  mtimeMs: number;
  path: string;
  size: number;
  sourceId: string;
};

type TranscriptSummary = {
  cwd?: string;
  inputTokens?: number;
  latestObservedAt?: string;
  model?: string;
  outputTokens?: number;
  sourceSessionId?: string;
  totalTokens?: number;
  usageId?: string;
};

export function createCodexTranscriptLiveScanner(options: CodexTranscriptLiveScannerOptions): CodexTranscriptLiveScanner {
  const signatures = new Map<string, string>();
  let lastPolledAt = 0;

  return {
    async refresh() {
      const now = options.now?.() ?? new Date();
      const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      if (pollIntervalMs > 0 && now.getTime() - lastPolledAt < pollIntervalMs) {
        return { candidates: 0, events: [], scanned: 0, skipped: 0 };
      }
      lastPolledAt = now.getTime();
      return refreshCodexTranscriptLiveEvents(options, signatures, now);
    }
  };
}

async function refreshCodexTranscriptLiveEvents(
  options: CodexTranscriptLiveScannerOptions,
  signatures: Map<string, string>,
  now: Date
): Promise<CodexTranscriptLiveRefresh> {
  const candidates = await recentTranscriptCandidates({
    homeDir: options.homeDir,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    now,
    recentWindowMs: options.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS
  });
  const currentPaths = new Set(candidates.map((candidate) => candidate.path));
  for (const path of signatures.keys()) {
    if (!currentPaths.has(path)) signatures.delete(path);
  }

  const events: NormalizedEvent[] = [];
  let scanned = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const signature = `${candidate.size}:${candidate.mtimeMs}`;
    if (signatures.get(candidate.path) === signature) {
      skipped += 1;
      continue;
    }
    scanned += 1;
    const event = await liveEventForTranscript(candidate, now);
    signatures.set(candidate.path, signature);
    if (event) events.push(event);
  }
  return {
    candidates: candidates.length,
    events,
    scanned,
    skipped
  };
}

async function recentTranscriptCandidates({
  homeDir,
  maxFiles,
  now,
  recentWindowMs
}: {
  homeDir: string;
  maxFiles: number;
  now: Date;
  recentWindowMs: number;
}): Promise<TranscriptCandidate[]> {
  const root = join(homeDir, ".codex", "sessions");
  const files = await jsonlFiles(root);
  const candidates: TranscriptCandidate[] = [];
  const cutoffMs = now.getTime() - recentWindowMs;

  for (const path of files) {
    const info = await safeStat(path);
    if (!info?.isFile()) continue;
    const mtimeMs = Math.trunc(info.mtimeMs);
    if (mtimeMs < cutoffMs) continue;
    candidates.push({
      modifiedAt: info.mtime.toISOString(),
      mtimeMs,
      path,
      size: info.size,
      sourceId: `codex-live-transcript:${relative(root, path).replaceAll("\\", "/")}`
    });
  }

  return candidates.toSorted((a, b) => b.mtimeMs - a.mtimeMs || b.path.localeCompare(a.path)).slice(0, Math.max(1, maxFiles));
}

async function liveEventForTranscript(candidate: TranscriptCandidate, receivedAt: Date): Promise<NormalizedEvent | undefined> {
  const source: DiscoveredSource = {
    confidence: "authoritative",
    path: candidate.path,
    runtime: "codex",
    runtimeVersion: "file",
    schemaVersion: "codex-transcript-jsonl",
    sourceId: candidate.sourceId,
    sourceKind: "jsonl"
  };
  const summary = await summarizeTranscript(source);
  const sourceSessionId = summary.sourceSessionId ?? fallbackSessionId(candidate.path);
  const cwd = summary.cwd;
  const occurredAt = summary.latestObservedAt ?? candidate.modifiedAt;
  const project = cwd ? basename(cwd) : undefined;
  const workspace = workspaceForCwd(cwd);
  const payload = compactRecord({
    cwd,
    harness: "Codex",
    inputTokens: summary.inputTokens,
    model: summary.model,
    outputTokens: summary.outputTokens,
    project,
    runtime: "codex",
    sourceSessionId,
    totalTokens: summary.totalTokens,
    transcriptBytes: candidate.size,
    transcriptModifiedAt: candidate.modifiedAt,
    transcriptPath: candidate.path,
    usageId: summary.usageId
  });
  const payloadHash = hash(JSON.stringify(payload));
  const sourceEventId = `transcript:${hash(`${candidate.path}:${candidate.mtimeMs}:${candidate.size}`).slice(0, 24)}`;
  const eventId = `codex-transcript:${hash(`${sourceSessionId}:${sourceEventId}:${payloadHash}`).slice(0, 32)}`;

  return {
    schemaVersion: 1,
    eventId,
    sessionId: sourceSessionId,
    source: {
      adapter: "codex",
      sourceEventId,
      surface: "tailer"
    },
    occurredAt,
    receivedAt: receivedAt.toISOString(),
    type: "session.started",
    workspace,
    summary: "Codex desktop transcript activity",
    payload,
    sensitivity: "metadata",
    payloadHash,
    evidence: [
      {
        id: eventId,
        kind: "event",
        observedAt: occurredAt,
        source: "codex.transcript"
      }
    ]
  };
}

async function summarizeTranscript(source: DiscoveredSource): Promise<TranscriptSummary> {
  const summary: TranscriptSummary = {};
  for await (const record of parseCodexTranscript(source)) {
    mergeRecord(summary, record);
  }
  return summary;
}

function mergeRecord(summary: TranscriptSummary, record: AdapterRecord): void {
  const value = objectRecord(record.normalized.value);
  if (!value) return;
  summary.sourceSessionId = stringValue(value, ["sessionId", "session_id", "conversationId", "conversation_id"]) ?? summary.sourceSessionId;
  summary.cwd = stringValue(value, ["cwd", "repoRoot", "repo_root", "worktreePath", "worktree_path"]) ?? summary.cwd;
  summary.model = stringValue(value, ["model", "modelName", "modelId"]) ?? summary.model;
  const observedAt = validTimestamp(record.observedAt);
  if (observedAt && (!summary.latestObservedAt || observedAt > summary.latestObservedAt)) summary.latestObservedAt = observedAt;

  if (record.normalized.kind !== "usage") return;
  summary.inputTokens = numberValue(value, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]) ?? summary.inputTokens;
  summary.outputTokens = numberValue(value, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]) ?? summary.outputTokens;
  summary.totalTokens =
    numberValue(value, ["totalTokens", "total_tokens"]) ??
    sum(summary.inputTokens, summary.outputTokens) ??
    summary.totalTokens;
  summary.usageId = `codex-transcript:${record.sourceRecordKey}`;
}

async function jsonlFiles(directory: string, depth = 0): Promise<string[]> {
  if (depth > MAX_TRANSCRIPT_DEPTH) return [];
  const entries = await safeReaddir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await jsonlFiles(path, depth + 1)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

async function safeReaddir(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function workspaceForCwd(cwd: string | undefined): WorkspaceRef | undefined {
  if (!cwd) return undefined;
  return {
    cwd,
    repoRoot: cwd,
    worktreePath: cwd
  };
}

function fallbackSessionId(path: string): string {
  const filename = basename(path, ".jsonl");
  return filename || `transcript:${hash(path).slice(0, 16)}`;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function numberValue(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function validTimestamp(value: string): string | undefined {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || millis <= 0) return undefined;
  return new Date(millis).toISOString();
}

function sum(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  return (left ?? 0) + (right ?? 0);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
