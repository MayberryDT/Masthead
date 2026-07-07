import {
  renderBoardHeadlineFrame,
  validateBoardHeadlineFrame,
  type BoardHeadlineFrame,
  type BoardHeadlineView
} from "../../core/boardHeadlineFrame.ts";
import { createHash, randomUUID } from "node:crypto";
import type { MastheadDatabase } from "./sqlite.ts";

export type UpsertBoardHeadlineFrameInput = {
  sessionId: string;
  sourceSessionId: string;
  provider: string;
  model: string;
  generatedAt: string;
  frame: BoardHeadlineFrame;
  refreshKey?: string;
};

type BoardHeadlineFrameRow = {
  sessionId: string;
  sourceSessionId: string;
  provider: string;
  model: string;
  generatedAt: string;
  frameJson: string;
  refreshKeyHash: string | null;
};

export type BoardHeadlineGenerationStatus =
  | "llm"
  | "disabled"
  | "not_configured"
  | "timeout"
  | "api_error"
  | "invalid_output"
  | "success";

export type BoardHeadlineGenerationTranscriptMessage = {
  role: "user" | "assistant";
  text: string;
  observedAt?: string;
};

export type InsertBoardHeadlineGenerationInput = {
  sessionId: string;
  sourceSessionId: string;
  provider: string;
  model: string;
  status: BoardHeadlineGenerationStatus;
  requestedAt: string;
  completedAt: string;
  latencyMs?: number;
  refreshKey: string;
  transcriptExcerpt: BoardHeadlineGenerationTranscriptMessage[];
  frame?: BoardHeadlineFrame;
  failureMessage?: string;
};

export type BoardHeadlineGenerationRow = {
  generationId: string;
  sessionId: string;
  sourceSessionId: string;
  provider: string;
  model: string;
  status: BoardHeadlineGenerationStatus;
  requestedAt: string;
  completedAt: string;
  latencyMs?: number;
  refreshKeyHash: string;
  transcriptExcerptCount: number;
  transcriptExcerptSample: BoardHeadlineGenerationTranscriptMessage[];
  headline?: string;
  frame?: BoardHeadlineFrame;
  failureMessage?: string;
};

type BoardHeadlineGenerationDbRow = {
  generationId: string;
  sessionId: string;
  sourceSessionId: string;
  provider: string;
  model: string;
  status: BoardHeadlineGenerationStatus;
  requestedAt: string;
  completedAt: string;
  latencyMs: number | null;
  refreshKeyHash: string;
  transcriptExcerptCount: number;
  transcriptExcerptSampleJson: string;
  headline: string | null;
  frameJson: string | null;
  failureMessage: string | null;
};

export type BoardHeadlineFrameScope = {
  sessionId: string;
  sourceSessionId: string;
};

export function insertBoardHeadlineGeneration(db: MastheadDatabase, input: InsertBoardHeadlineGenerationInput): void {
  const validation = input.frame ? validateBoardHeadlineFrame(input.frame) : undefined;
  if (validation && !validation.ok) {
    throw new Error(`Invalid Board headline generation frame: ${validation.reason}`);
  }
  const frame = validation?.ok ? validation.frame : undefined;
  const headline = frame ? renderBoardHeadlineFrame(frame) : undefined;
  const sample = transcriptExcerptSample(input.transcriptExcerpt);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO board_headline_generations (
      generation_id,
      session_id,
      source_session_id,
      provider,
      model,
      status,
      requested_at,
      completed_at,
      latency_ms,
      refresh_key_hash,
      transcript_excerpt_count,
      transcript_excerpt_sample_json,
      headline,
      frame_json,
      failure_message,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `board-headline-generation:${randomUUID()}`,
    input.sessionId,
    input.sourceSessionId,
    input.provider,
    input.model,
    input.status,
    input.requestedAt,
    input.completedAt,
    input.latencyMs ?? null,
    hashText(input.refreshKey),
    input.transcriptExcerpt.length,
    JSON.stringify(sample),
    headline ?? null,
    frame ? JSON.stringify(frame) : null,
    input.failureMessage ?? null,
    now
  );
}

export function recentBoardHeadlineGenerations(
  db: MastheadDatabase,
  options: { limit?: number; sourceSessionId?: string } = {}
): BoardHeadlineGenerationRow[] {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const rows = db
    .prepare(
      `SELECT
        generation_id AS generationId,
        session_id AS sessionId,
        source_session_id AS sourceSessionId,
        provider,
        model,
        status,
        requested_at AS requestedAt,
        completed_at AS completedAt,
        latency_ms AS latencyMs,
        refresh_key_hash AS refreshKeyHash,
        transcript_excerpt_count AS transcriptExcerptCount,
        transcript_excerpt_sample_json AS transcriptExcerptSampleJson,
        headline,
        frame_json AS frameJson,
        failure_message AS failureMessage
      FROM board_headline_generations
      ${options.sourceSessionId ? "WHERE source_session_id = ?" : ""}
      ORDER BY completed_at DESC, generation_id DESC
      LIMIT ?`
    )
    .all(...(options.sourceSessionId ? [options.sourceSessionId, limit] : [limit])) as BoardHeadlineGenerationDbRow[];

  return rows.map((row) => ({
    completedAt: row.completedAt,
    failureMessage: row.failureMessage ?? undefined,
    frame: row.frameJson ? parseFrame(row.frameJson) : undefined,
    generationId: row.generationId,
    headline: row.headline ?? undefined,
    latencyMs: row.latencyMs ?? undefined,
    model: row.model,
    provider: row.provider,
    refreshKeyHash: row.refreshKeyHash,
    requestedAt: row.requestedAt,
    sessionId: row.sessionId,
    sourceSessionId: row.sourceSessionId,
    status: row.status,
    transcriptExcerptCount: row.transcriptExcerptCount,
    transcriptExcerptSample: parseTranscriptExcerptSample(row.transcriptExcerptSampleJson)
  }));
}

export function upsertBoardHeadlineFrame(db: MastheadDatabase, input: UpsertBoardHeadlineFrameInput): void {
  const validation = validateBoardHeadlineFrame(input.frame);
  if (!validation.ok) {
    throw new Error(`Invalid Board headline frame: ${validation.reason}`);
  }

  const now = new Date().toISOString();
  const refreshKeyHash = input.refreshKey ? hashText(input.refreshKey) : null;
  db.prepare(
    `INSERT INTO board_headline_frames (
      frame_id,
      session_id,
      source_session_id,
      provider,
      model,
      generated_at,
      frame_json,
      refresh_key_hash,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(frame_id) DO UPDATE SET
      session_id = excluded.session_id,
      source_session_id = excluded.source_session_id,
      provider = excluded.provider,
      model = excluded.model,
      generated_at = excluded.generated_at,
      frame_json = excluded.frame_json,
      refresh_key_hash = COALESCE(excluded.refresh_key_hash, board_headline_frames.refresh_key_hash),
      updated_at = excluded.updated_at`
  ).run(
    `board-headline:${input.sessionId}`,
    input.sessionId,
    input.sourceSessionId,
    input.provider,
    input.model,
    input.generatedAt,
    JSON.stringify(validation.frame),
    refreshKeyHash,
    now,
    now
  );
}

export function currentBoardHeadlineFrames(db: MastheadDatabase, sessions: Iterable<BoardHeadlineFrameScope>): Map<string, BoardHeadlineView> {
  const scopedSessions = [...sessions]
    .map((session) => ({
      sessionId: session.sessionId.trim(),
      sourceSessionId: session.sourceSessionId.trim()
    }))
    .filter((session) => session.sessionId && session.sourceSessionId)
    .filter((session, index, all) => all.findIndex((candidate) => candidate.sessionId === session.sessionId) === index);
  if (scopedSessions.length === 0) return new Map();
  const scopedSessionKeys = new Set(scopedSessions.map((session) => scopedSessionKey(session)));

  const rows = db
    .prepare(
      `SELECT
        session_id AS sessionId,
        source_session_id AS sourceSessionId,
        provider,
        model,
        generated_at AS generatedAt,
        frame_json AS frameJson,
        refresh_key_hash AS refreshKeyHash
      FROM board_headline_frames
      WHERE session_id IN (${scopedSessions.map(() => "?").join(", ")})
      ORDER BY session_id ASC, generated_at DESC, frame_id DESC`
    )
    .all(...scopedSessions.map((session) => session.sessionId)) as BoardHeadlineFrameRow[];

  const views = new Map<string, BoardHeadlineView>();
  for (const row of rows) {
    if (!scopedSessionKeys.has(scopedSessionKey(row))) continue;
    if (views.has(row.sourceSessionId)) continue;

    const frame = parseFrame(row.frameJson);
    if (!frame) continue;

    views.set(row.sourceSessionId, {
      headline: renderBoardHeadlineFrame(frame),
      frame,
      source: "llm",
      status: "ready",
      generatedAt: row.generatedAt,
      model: row.model,
      provider: row.provider,
      ...(row.refreshKeyHash ? { refreshKeyHash: row.refreshKeyHash, freshness: "fresh" as const } : {})
    });
  }
  return views;
}

function scopedSessionKey(session: BoardHeadlineFrameScope): string {
  return `${session.sessionId}\u0000${session.sourceSessionId}`;
}

function parseFrame(value: string): BoardHeadlineFrame | undefined {
  try {
    const validation = validateBoardHeadlineFrame(JSON.parse(value) as unknown);
    return validation.ok ? validation.frame : undefined;
  } catch {
    return undefined;
  }
}

function transcriptExcerptSample(messages: BoardHeadlineGenerationTranscriptMessage[]): BoardHeadlineGenerationTranscriptMessage[] {
  return messages.slice(-4).map((message) => ({
    ...(message.observedAt ? { observedAt: message.observedAt } : {}),
    role: message.role,
    text: message.text.slice(0, 500)
  }));
}

function parseTranscriptExcerptSample(value: string): BoardHeadlineGenerationTranscriptMessage[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((message): message is Record<string, unknown> => typeof message === "object" && message !== null)
      .map((message): BoardHeadlineGenerationTranscriptMessage => {
        const role: BoardHeadlineGenerationTranscriptMessage["role"] = message.role === "user" ? "user" : "assistant";
        return {
          ...(typeof message.observedAt === "string" ? { observedAt: message.observedAt } : {}),
          role,
          text: typeof message.text === "string" ? message.text : ""
        };
      })
      .filter((message) => message.text);
  } catch {
    return [];
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
