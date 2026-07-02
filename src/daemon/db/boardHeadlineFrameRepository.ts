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
  sourceSessionId: string;
  provider: string;
  model: string;
  generatedAt: string;
  frameJson: string;
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

export function currentBoardHeadlineFrames(db: MastheadDatabase, sourceSessionIds: Iterable<string>): Map<string, BoardHeadlineView> {
  const scopedSourceSessionIds = [...new Set([...sourceSessionIds].map((id) => id.trim()).filter(Boolean))];
  if (scopedSourceSessionIds.length === 0) return new Map();

  const rows = db
    .prepare(
      `SELECT
        source_session_id AS sourceSessionId,
        provider,
        model,
        generated_at AS generatedAt,
        frame_json AS frameJson
      FROM board_headline_frames
      WHERE source_session_id IN (${scopedSourceSessionIds.map(() => "?").join(", ")})
      ORDER BY source_session_id ASC, generated_at DESC, frame_id DESC`
    )
    .all(...scopedSourceSessionIds) as BoardHeadlineFrameRow[];

  const views = new Map<string, BoardHeadlineView>();
  for (const row of rows) {
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

function parseFrame(value: string): BoardHeadlineFrame | undefined {
  try {
    const validation = validateBoardHeadlineFrame(JSON.parse(value) as unknown);
    return validation.ok ? validation.frame : undefined;
  } catch {
    return undefined;
  }
}
