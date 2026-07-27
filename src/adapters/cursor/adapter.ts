import type { AdapterRecord, DiscoveredSource, IngestCursor, SessionAdapter } from "../types.ts";
import { adapterPayload, hash } from "../generic/jsonlAdapterKit.ts";
import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { withReadonlySqliteCopy } from "../generic/sqliteAdapterKit.ts";
import { collectAdapterRecords, parsedTranscriptUnit } from "../transcriptUnits.ts";
import { cursorCandidatePaths } from "./discovery.ts";

const fallbackAdapter = createLocalAdapter({
  runtime: "cursor",
  candidatePaths: cursorCandidatePaths,
  jsonlProfile: genericCodingProfile("cursor")
});

/**
 * Cursor's current global state database keeps Composer transcript bubbles in
 * cursorDiskKV. The generic SQLite adapter can see the BLOB JSON, but has no
 * way to derive the composer session id from the storage key.
 */
export const cursorAdapter: SessionAdapter = {
  ...fallbackAdapter,
  async *backfill(source, cursor) {
    if (source.sourceKind !== "sqlite" || !source.path) {
      yield* fallbackAdapter.backfill(source, cursor);
      return;
    }
    const records = await cursorDiskKvRecords(source);
    if (records.length > 0) {
      yield* records;
      return;
    }
    yield* fallbackAdapter.backfill(source, cursor);
  },
  async parseTranscriptUnit(unit, cursor) {
    return parsedTranscriptUnit(unit, await collectAdapterRecords(this.backfill(unit.source, cursor)));
  }
};

async function cursorDiskKvRecords(source: DiscoveredSource): Promise<AdapterRecord[]> {
  if (!source.path) return [];
  try {
    return await withReadonlySqliteCopy(source.path, (db) => {
      const table = db
        .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'cursorDiskKV'")
        .get() as { found: number } | undefined;
      if (!table) return [];
      const rows = db
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' ORDER BY key")
        .all() as Array<{ key: unknown; value: unknown }>;
      return rows.flatMap((row) => cursorBubbleRecord(source, row));
    });
  } catch {
    return [];
  }
}

function cursorBubbleRecord(source: DiscoveredSource, row: { key: unknown; value: unknown }): AdapterRecord[] {
  const key = nonBlankString(row.key);
  if (!key) return [];
  const [, composerId, bubbleId] = key.split(":", 3);
  if (!composerId || !bubbleId) return [];
  const payload = jsonRecord(row.value);
  if (!payload) return [];
  const text = nonBlankString(payload.text);
  const role = cursorBubbleRole(payload.type);
  if (!text || !role) return [];
  const observedAt = cursorObservedAt(payload.createdAt) ?? new Date(0).toISOString();
  return [{
    diagnostics: [],
    normalized: adapterPayload("message", source.confidence, source, {
      observedAt,
      role,
      sessionId: composerId,
      text
    }),
    observedAt,
    payload,
    payloadHash: hash(JSON.stringify(payload)),
    source,
    sourceRecordKey: `${source.path}:cursorDiskKV:${composerId}:${bubbleId}`
  }];
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  const text = value instanceof Uint8Array
    ? new TextDecoder().decode(value)
    : typeof value === "string"
      ? value
      : undefined;
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function cursorBubbleRole(value: unknown): "user" | "assistant" | undefined {
  // Cursor's persisted Composer bubble enum is 1 = user and 2 = assistant.
  if (value === 1 || value === "1" || value === "user") return "user";
  if (value === 2 || value === "2" || value === "assistant") return "assistant";
  return undefined;
}

function cursorObservedAt(value: unknown): string | undefined {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return undefined;
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
