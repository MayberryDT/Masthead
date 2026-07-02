import {
  renderBoardHeadlineFrame,
  validateBoardHeadlineFrame,
  type BoardHeadlineFrame,
  type BoardHeadlineView
} from "../../core/boardHeadlineFrame.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type UpsertBoardHeadlineFrameInput = {
  sessionId: string;
  sourceSessionId: string;
  provider: string;
  model: string;
  generatedAt: string;
  frame: BoardHeadlineFrame;
};

type BoardHeadlineFrameRow = {
  sessionId: string;
  sourceSessionId: string;
  provider: string;
  model: string;
  generatedAt: string;
  frameJson: string;
};

export type BoardHeadlineFrameScope = {
  sessionId: string;
  sourceSessionId: string;
};

export function upsertBoardHeadlineFrame(db: MastheadDatabase, input: UpsertBoardHeadlineFrameInput): void {
  const validation = validateBoardHeadlineFrame(input.frame);
  if (!validation.ok) {
    throw new Error(`Invalid Board headline frame: ${validation.reason}`);
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO board_headline_frames (
      frame_id,
      session_id,
      source_session_id,
      provider,
      model,
      generated_at,
      frame_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(frame_id) DO UPDATE SET
      session_id = excluded.session_id,
      source_session_id = excluded.source_session_id,
      provider = excluded.provider,
      model = excluded.model,
      generated_at = excluded.generated_at,
      frame_json = excluded.frame_json,
      updated_at = excluded.updated_at`
  ).run(
    `board-headline:${input.sessionId}`,
    input.sessionId,
    input.sourceSessionId,
    input.provider,
    input.model,
    input.generatedAt,
    JSON.stringify(validation.frame),
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
        frame_json AS frameJson
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
      provider: row.provider
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
