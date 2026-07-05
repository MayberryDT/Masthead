import type { StoreRecord } from "../core/store.ts";
import type { NormalizedEvent } from "../core/types.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";

type HookTranscriptRow = {
  payloadJson: string;
};

export function recentHookEventsWithTranscriptPathsForSessions(
  db: MastheadDatabase,
  sourceId: string,
  sourceSessionIds: Set<string>,
  limit: number
): NormalizedEvent[] {
  const sessionIds = [...sourceSessionIds].filter(Boolean);
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `WITH candidates AS (
        SELECT
          raw_event_id AS rawEventId,
          observed_at AS observedAt,
          payload_json AS payloadJson,
          COALESCE(
            json_extract(payload_json, '$.value.sessionId'),
            json_extract(payload_json, '$.value.sourceSessionId'),
            json_extract(payload_json, '$.sessionId'),
            json_extract(payload_json, '$.sourceSessionId')
          ) AS sourceSessionId,
          COALESCE(
            json_extract(payload_json, '$.value.payload.transcriptPath'),
            json_extract(payload_json, '$.value.payload.transcript_path'),
            json_extract(payload_json, '$.payload.transcriptPath'),
            json_extract(payload_json, '$.payload.transcript_path')
          ) AS transcriptPath
        FROM raw_events
        WHERE source_id = ?
          AND source_kind = 'hook'
          AND json_valid(payload_json)
          AND COALESCE(
            json_extract(payload_json, '$.value.source.surface'),
            json_extract(payload_json, '$.source.surface')
          ) = 'hook'
          AND (payload_json LIKE '%"transcriptPath"%' OR payload_json LIKE '%"transcript_path"%')
      ),
      ranked AS (
        SELECT
          rawEventId,
          observedAt,
          payloadJson,
          ROW_NUMBER() OVER (
            PARTITION BY sourceSessionId, transcriptPath
            ORDER BY observedAt DESC, rawEventId DESC
          ) AS rowRank
        FROM candidates
        WHERE sourceSessionId IN (${placeholders})
          AND transcriptPath IS NOT NULL
      )
      SELECT payloadJson
      FROM ranked
      WHERE rowRank = 1
      ORDER BY observedAt DESC, rawEventId DESC
      LIMIT ?`
    )
    .all(sourceId, ...sessionIds, Math.max(1, limit)) as HookTranscriptRow[];

  return rows
    .map((row) => parseNormalizedHookEvent(row.payloadJson))
    .filter((event): event is NormalizedEvent => Boolean(event));
}

function parseNormalizedHookEvent(payloadJson: string): NormalizedEvent | undefined {
  const record = parseStoreRecord(payloadJson);
  if (!record || record.recordType !== "event") return undefined;
  const event = record.value;
  if (!isRecord(event) || !isRecord(event.payload) || typeof event.eventId !== "string" || typeof event.occurredAt !== "string") return undefined;
  if (!isRecord(event.source) || event.source.adapter !== "codex" || event.source.surface !== "hook") return undefined;
  if (!stringFromPayload(event.payload, ["transcriptPath", "transcript_path"])) return undefined;
  return event;
}

function parseStoreRecord(payloadJson: string): StoreRecord | undefined {
  try {
    const parsed = JSON.parse(payloadJson) as Partial<StoreRecord>;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (
      parsed.recordType === "event" ||
      parsed.recordType === "git_snapshot" ||
      parsed.recordType === "attention_item" ||
      parsed.recordType === "conflict_card" ||
      parsed.recordType === "review_disposition"
    ) {
      return parsed as StoreRecord;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function stringFromPayload(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
