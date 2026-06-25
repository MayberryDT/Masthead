import { createHash } from "node:crypto";
import { applyRetentionPolicy, retentionPruneResult } from "../../core/retention.ts";
import type { ClearLocalDataResult, StoreRecord } from "../../core/store.ts";
import type { PruneLocalDataResult, RetentionPolicy } from "../../core/retention.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type RawEventSource = {
  sourceId: string;
  adapter: string;
  sourceKind: string;
  sourcePath?: string;
  endpoint?: string;
  schemaVersion?: string;
  runtimeVersion?: string;
  confidence: "authoritative" | "inferred" | "heuristic";
};

export type RawEventPageOptions = {
  cursor?: string;
  limit?: number;
};

export type RawEventPage = {
  records: StoreRecord[];
  nextCursor?: string;
};

type RawEventRow = {
  raw_event_id: string;
  observed_at: string;
  payload_json: string;
};

type DecodedCursor = {
  observedAt: string;
  rawEventId: string;
};

export function createRawEventRepository(db: MastheadDatabase, source: RawEventSource) {
  const ensureSource = (): void => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ingest_sources (
        source_id,
        adapter,
        source_kind,
        source_path,
        endpoint,
        schema_version,
        runtime_version,
        confidence,
        discovered_at,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        adapter = excluded.adapter,
        source_kind = excluded.source_kind,
        source_path = excluded.source_path,
        endpoint = excluded.endpoint,
        schema_version = excluded.schema_version,
        runtime_version = excluded.runtime_version,
        confidence = excluded.confidence,
        last_seen_at = excluded.last_seen_at`
    ).run(
      source.sourceId,
      source.adapter,
      source.sourceKind,
      source.sourcePath ?? null,
      source.endpoint ?? null,
      source.schemaVersion ?? null,
      source.runtimeVersion ?? null,
      source.confidence,
      now,
      now
    );
  };

  const appendStoreRecord = (record: StoreRecord): void => {
    ensureSource();
    const payloadJson = JSON.stringify(record);
    db.prepare(
      `INSERT INTO raw_events (
        raw_event_id,
        source_id,
        source_record_key,
        observed_at,
        received_at,
        source_kind,
        source_path,
        payload_hash,
        payload_json,
        adapter_diagnostics_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(source_id, source_record_key) DO NOTHING`
    ).run(
      rawEventId(source.sourceId, record.recordId),
      source.sourceId,
      record.recordId,
      record.observedAt,
      receivedAt(record),
      source.sourceKind,
      source.sourcePath ?? null,
      hash(payloadJson),
      payloadJson
    );
  };

  const pageStoreRecords = (options: RawEventPageOptions = {}): RawEventPage => {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const cursor = decodeCursor(options.cursor);
    const rows = selectRows(cursor, limit + 1);
    const pageRows = rows.slice(0, limit);
    const lastRow = pageRows.at(-1);
    return {
      records: pageRows.map((row) => JSON.parse(row.payload_json) as StoreRecord),
      nextCursor: rows.length > limit && lastRow ? encodeCursor(lastRow) : undefined
    };
  };

  const pruneStoreRecords = (policy: RetentionPolicy): PruneLocalDataResult => {
    const records = selectRows(undefined, Number.MAX_SAFE_INTEGER).map((row) => JSON.parse(row.payload_json) as StoreRecord);
    const { retainedRecords, removedRecords } = applyRetentionPolicy(records, policy);
    if (removedRecords.length > 0) {
      const deleteRecord = db.prepare("DELETE FROM raw_events WHERE source_id = ? AND source_record_key = ?");
      db.exec("BEGIN IMMEDIATE;");
      try {
        for (const record of removedRecords) {
          deleteRecord.run(source.sourceId, record.recordId);
        }
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    }
    return retentionPruneResult(removedRecords, retainedRecords.length);
  };

  const clearStoreRecords = (): ClearLocalDataResult => {
    const removedRecords = (db.prepare("SELECT COUNT(*) AS count FROM raw_events WHERE source_id = ?").get(source.sourceId) as { count: number })
      .count;
    db.prepare("DELETE FROM raw_events WHERE source_id = ?").run(source.sourceId);
    return { removedRecords, touchedExternalState: false };
  };

  const selectRows = (cursor: DecodedCursor | undefined, limit: number): RawEventRow[] => {
    if (cursor) {
      return db
        .prepare(
          `SELECT raw_event_id, observed_at, payload_json
          FROM raw_events
          WHERE source_id = ?
            AND (observed_at > ? OR (observed_at = ? AND raw_event_id > ?))
          ORDER BY observed_at ASC, raw_event_id ASC
          LIMIT ?`
        )
        .all(source.sourceId, cursor.observedAt, cursor.observedAt, cursor.rawEventId, limit) as RawEventRow[];
    }
    return db
      .prepare(
        `SELECT raw_event_id, observed_at, payload_json
        FROM raw_events
        WHERE source_id = ?
        ORDER BY observed_at ASC, raw_event_id ASC
        LIMIT ?`
      )
      .all(source.sourceId, limit) as RawEventRow[];
  };

  return {
    appendStoreRecord,
    clearStoreRecords,
    ensureSource,
    pageStoreRecords,
    pruneStoreRecords
  };
}

export function rawEventId(sourceId: string, sourceRecordKey: string): string {
  return `raw:${hash(`${sourceId}\0${sourceRecordKey}`)}`;
}

function receivedAt(record: StoreRecord): string {
  if (record.recordType === "event") return record.value.receivedAt;
  return record.observedAt;
}

function encodeCursor(row: Pick<RawEventRow, "observed_at" | "raw_event_id">): string {
  return Buffer.from(JSON.stringify({ observedAt: row.observed_at, rawEventId: row.raw_event_id })).toString("base64url");
}

function decodeCursor(cursor: string | undefined): DecodedCursor | undefined {
  if (!cursor) return undefined;
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<DecodedCursor>;
  if (typeof parsed.observedAt !== "string" || typeof parsed.rawEventId !== "string") {
    throw new Error("Invalid raw event cursor");
  }
  return {
    observedAt: parsed.observedAt,
    rawEventId: parsed.rawEventId
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
