import type { ReviewDisposition, StoreRecord } from "./store";
import type { AttentionItem, ConflictCard, GitSnapshot, NormalizedEvent } from "./types";

export type HistoryRecordInput = {
  events: NormalizedEvent[];
  gitSnapshots: GitSnapshot[];
  attentionItems: AttentionItem[];
  conflicts: ConflictCard[];
  reviewDispositions: ReviewDisposition[];
  storedRecords?: StoreRecord[];
};

export function buildHistoryRecords(input: HistoryRecordInput): StoreRecord[] {
  return uniqueRecords([
    ...input.events.map((value) => record("event", value.eventId, value.occurredAt, value)),
    ...input.gitSnapshots.map((value) => record("git_snapshot", value.snapshotId, value.observedAt, value)),
    ...input.attentionItems.map((value) => record("attention_item", value.itemId, value.createdAt, value)),
    ...input.conflicts.map((value) =>
      record("conflict_card", value.conflictId, value.evidence[0]?.observedAt ?? new Date(0).toISOString(), value)
    ),
    ...input.reviewDispositions.map((value) =>
      record("review_disposition", value.dispositionId, value.recordedAt, value)
    ),
    ...(input.storedRecords ?? [])
  ]);
}

function record<T extends StoreRecord["recordType"]>(
  recordType: T,
  subjectId: string,
  observedAt: string,
  value: Extract<StoreRecord, { recordType: T }>["value"]
): Extract<StoreRecord, { recordType: T }> {
  return {
    recordId: `record:${recordType}:${subjectId}`,
    recordType,
    observedAt,
    value
  } as Extract<StoreRecord, { recordType: T }>;
}

function uniqueRecords(records: StoreRecord[]): StoreRecord[] {
  const byId = new Map<string, StoreRecord>();
  for (const record of records) {
    byId.set(record.recordId, record);
  }
  return [...byId.values()].toSorted((a, b) => a.observedAt.localeCompare(b.observedAt) || a.recordId.localeCompare(b.recordId));
}
