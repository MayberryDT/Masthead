import { deriveOutcome, type OutcomeResult } from "./outcomes";
import { deriveSessions } from "./sessionReducer";
import type { AppendOnlyStore, LocalStoreSnapshot, ReviewDisposition, StoreRecord } from "./store";
import type { AttentionItem, ConflictCard, DerivedSession, GitSnapshot, NormalizedEvent } from "./types";

export type HistoryInput = StoreRecord[] | LocalStoreSnapshot;

export type HistorySearchFilters = {
  project?: string;
  sessionId?: string;
  filePath?: string;
  command?: string;
  commandId?: string;
  status?: DerivedSession["primaryStatus"];
  branch?: string;
  alertType?: AttentionItem["type"];
  conflictType?: ConflictCard["type"];
  outcome?: OutcomeResult["policyResult"]["label"];
  disposition?: ReviewDisposition["status"];
};

export type HistorySession = {
  sessionId: string;
  project: string;
  title: string;
  objective?: string;
  status: DerivedSession["primaryStatus"];
  lastMeaningfulActivityAt: string;
  branch?: string;
  branches: string[];
  changedPaths: string[];
  commandIds: string[];
  commands: string[];
  alertTypes: AttentionItem["type"][];
  conflictTypes: ConflictCard["type"][];
  outcome: OutcomeResult["policyResult"]["label"];
  dispositionStatuses: ReviewDisposition["status"][];
  recordIds: string[];
  records: StoreRecord[];
};

export type HistorySearchResult = {
  filters: HistorySearchFilters;
  sessions: HistorySession[];
  recordCount: number;
};

export type HistoryRecordCounts = Record<StoreRecord["recordType"], number>;
type StoreRecordValue<T extends StoreRecord["recordType"]> = Extract<StoreRecord, { recordType: T }> extends {
  value: infer TValue;
}
  ? TValue
  : never;

export type HistoryExportMetadata = {
  format: "masthead.history.v1";
  schemaVersion: 1;
  exportedAt: string;
  recordCount: number;
  sessionCount: number;
  recordTypes: HistoryRecordCounts;
  filters?: HistorySearchFilters;
};

export type HistoryExport = {
  contentType: "application/json";
  filename: string;
  metadata: HistoryExportMetadata;
  body: string;
};

export type HistoryExportOptions = {
  exportedAt?: string;
  filters?: HistorySearchFilters;
};

export type HistoryDeletionResult = {
  deletedAt: string;
  removedRecords: number;
  removedRecordIds: string[];
  removedByType: HistoryRecordCounts;
  localRecordsRemaining: number;
  touchedExternalState: false;
  externalState: {
    codexSessions: "untouched";
    gitRepositories: "untouched";
    sourceFiles: "untouched";
    externalServices: "untouched";
  };
};

export type HistoryDeletionOptions = {
  deletedAt?: string;
};

export function searchHistory(input: HistoryInput, filters: HistorySearchFilters = {}): HistorySearchResult {
  const sessions = buildHistorySessions(input).filter((session) => matchesFilters(session, filters));

  return {
    filters,
    sessions,
    recordCount: sessions.reduce((total, session) => total + session.records.length, 0)
  };
}

export function buildHistorySessions(input: HistoryInput): HistorySession[] {
  const records = recordsFrom(input);
  const events = valuesFor(records, "event");
  const snapshots = valuesFor(records, "git_snapshot");
  const attentionItems = valuesFor(records, "attention_item");
  const conflicts = valuesFor(records, "conflict_card");
  const dispositions = valuesFor(records, "review_disposition");
  const context = buildRecordContext(attentionItems, conflicts);
  const derivedBySession = new Map(deriveSessions(events, snapshots).map((session) => [session.sessionId, session]));
  const sessionIds = new Set<string>();

  for (const record of records) {
    for (const sessionId of sessionIdsForRecord(record, context)) {
      sessionIds.add(sessionId);
    }
  }

  return [...sessionIds]
    .map((sessionId) => {
      const session = derivedBySession.get(sessionId) ?? fallbackSession(sessionId, snapshots, attentionItems, conflicts);
      const sessionRecords = records.filter((record) => sessionIdsForRecord(record, context).includes(sessionId));
      const sessionEvents = events.filter((event) => event.sessionId === sessionId);
      const sessionSnapshots = snapshots.filter((snapshot) => snapshot.sessionId === sessionId);
      const sessionAttentionItems = attentionItems.filter((item) => item.sessionId === sessionId);
      const sessionConflicts = conflicts.filter((conflict) => conflict.sessionIds.includes(sessionId));
      const sessionDispositions = dispositions.filter((disposition) =>
        dispositionSessionIds(disposition, context).includes(sessionId)
      );
      const branches = unique([
        ...stringValues([session.workspace?.branch]),
        ...sessionEvents.flatMap((event) => stringValues([event.workspace?.branch])),
        ...sessionSnapshots.flatMap((snapshot) => stringValues([snapshot.branch]))
      ]);
      const changedPaths = unique([
        ...sessionSnapshots.flatMap((snapshot) => snapshot.changedPaths.map((changedPath) => changedPath.path)),
        ...sessionAttentionItems.flatMap((item) => item.affectedPaths),
        ...sessionConflicts.flatMap((conflict) => conflict.sharedPaths)
      ]);
      const commandIds = unique([
        ...sessionEvents.flatMap(commandIdsForEvent),
        ...sessionAttentionItems.flatMap((item) => item.affectedCommandIds)
      ]);
      const commands = unique(sessionEvents.flatMap(commandTextsForEvent));
      const outcome = deriveOutcome(session, sessionEvents);

      return {
        sessionId,
        project: session.project,
        title: session.title,
        objective: session.objective,
        status: session.primaryStatus,
        lastMeaningfulActivityAt: session.lastMeaningfulActivityAt,
        branch: branches[0],
        branches,
        changedPaths,
        commandIds,
        commands,
        alertTypes: unique(sessionAttentionItems.map((item) => item.type)),
        conflictTypes: unique(sessionConflicts.map((conflict) => conflict.type)),
        outcome: outcome.policyResult.label,
        dispositionStatuses: unique(sessionDispositions.map((disposition) => disposition.status)),
        recordIds: sessionRecords.map((record) => record.recordId),
        records: sessionRecords
      };
    })
    .toSorted(
      (a, b) =>
        b.lastMeaningfulActivityAt.localeCompare(a.lastMeaningfulActivityAt) || a.sessionId.localeCompare(b.sessionId)
    );
}

export function exportHistory(input: HistoryInput, options: HistoryExportOptions = {}): HistoryExport {
  const records = recordsFrom(input);
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const metadata: HistoryExportMetadata = {
    format: "masthead.history.v1",
    schemaVersion: 1,
    exportedAt,
    recordCount: records.length,
    sessionCount: buildHistorySessions(records).length,
    recordTypes: countRecordsByType(records),
    ...(options.filters ? { filters: options.filters } : {})
  };

  return {
    contentType: "application/json",
    filename: `masthead-history-${exportTimestamp(exportedAt)}.json`,
    metadata,
    body: JSON.stringify({ metadata, records }, null, 2)
  };
}

export async function deleteLocalHistory(
  store: AppendOnlyStore,
  options: HistoryDeletionOptions = {}
): Promise<HistoryDeletionResult> {
  const records = store.readAll();
  const clearResult = await store.clearLocalData();

  return {
    deletedAt: options.deletedAt ?? new Date().toISOString(),
    removedRecords: clearResult.removedRecords,
    removedRecordIds: records.map((record) => record.recordId),
    removedByType: countRecordsByType(records),
    localRecordsRemaining: store.readAll().length,
    touchedExternalState: false,
    externalState: {
      codexSessions: "untouched",
      gitRepositories: "untouched",
      sourceFiles: "untouched",
      externalServices: "untouched"
    }
  };
}

function matchesFilters(session: HistorySession, filters: HistorySearchFilters): boolean {
  if (filters.project && !containsAny(filters.project, [session.project])) return false;
  if (filters.sessionId && !containsAny(filters.sessionId, [session.sessionId])) return false;
  if (filters.filePath && !containsAny(filters.filePath, session.changedPaths)) return false;
  if (filters.command && !containsAny(filters.command, [...session.commands, ...session.commandIds])) return false;
  if (filters.commandId && !containsAny(filters.commandId, session.commandIds)) return false;
  if (filters.status && !equalsAny(filters.status, [session.status])) return false;
  if (filters.branch && !containsAny(filters.branch, session.branches)) return false;
  if (filters.alertType && !equalsAny(filters.alertType, session.alertTypes)) return false;
  if (filters.conflictType && !equalsAny(filters.conflictType, session.conflictTypes)) return false;
  if (filters.outcome && !equalsAny(filters.outcome, [session.outcome])) return false;
  if (filters.disposition && !equalsAny(filters.disposition, session.dispositionStatuses)) return false;
  return true;
}

function recordsFrom(input: HistoryInput): StoreRecord[] {
  return Array.isArray(input) ? [...input] : [...input.records];
}

function valuesFor<T extends StoreRecord["recordType"]>(records: StoreRecord[], recordType: T): StoreRecordValue<T>[] {
  const values: StoreRecordValue<T>[] = [];
  for (const record of records) {
    if (record.recordType === recordType) {
      values.push(record.value as StoreRecordValue<T>);
    }
  }
  return values;
}

function countRecordsByType(records: StoreRecord[]): HistoryRecordCounts {
  const counts = emptyRecordCounts();
  for (const record of records) {
    counts[record.recordType] += 1;
  }
  return counts;
}

function emptyRecordCounts(): HistoryRecordCounts {
  return {
    event: 0,
    git_snapshot: 0,
    attention_item: 0,
    conflict_card: 0,
    review_disposition: 0
  };
}

function buildRecordContext(attentionItems: AttentionItem[], conflicts: ConflictCard[]): RecordContext {
  return {
    attentionById: new Map(attentionItems.map((item) => [item.itemId, item])),
    conflictById: new Map(conflicts.map((conflict) => [conflict.conflictId, conflict]))
  };
}

type RecordContext = {
  attentionById: Map<string, AttentionItem>;
  conflictById: Map<string, ConflictCard>;
};

function sessionIdsForRecord(record: StoreRecord, context: RecordContext): string[] {
  switch (record.recordType) {
    case "event":
      return stringValues([record.value.sessionId]);
    case "git_snapshot":
      return [record.value.sessionId];
    case "attention_item":
      return [record.value.sessionId];
    case "conflict_card":
      return record.value.sessionIds;
    case "review_disposition":
      return dispositionSessionIds(record.value, context);
  }
}

function dispositionSessionIds(disposition: ReviewDisposition, context: RecordContext): string[] {
  if (disposition.subjectType === "session") return [disposition.subjectId];
  if (disposition.subjectType === "attention_item") {
    return stringValues([context.attentionById.get(disposition.subjectId)?.sessionId]);
  }
  return context.conflictById.get(disposition.subjectId)?.sessionIds ?? [];
}

function fallbackSession(
  sessionId: string,
  snapshots: GitSnapshot[],
  attentionItems: AttentionItem[],
  conflicts: ConflictCard[]
): DerivedSession {
  const sessionSnapshots = snapshots.filter((snapshot) => snapshot.sessionId === sessionId);
  const latestSnapshot = sessionSnapshots.toSorted((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
  const sessionAttention = attentionItems.filter((item) => item.sessionId === sessionId);
  const sessionConflicts = conflicts.filter((conflict) => conflict.sessionIds.includes(sessionId));
  const activityTimes = [
    ...stringValues([latestSnapshot?.observedAt]),
    ...sessionAttention.map((item) => item.createdAt),
    ...sessionConflicts.flatMap((conflict) => conflict.evidence.map((ref) => ref.observedAt))
  ];

  return {
    sessionId,
    project: sessionAttention[0]?.project ?? projectFromSnapshot(latestSnapshot) ?? "Unknown project",
    title: sessionAttention[0]?.title ?? "Untitled session",
    primaryStatus: "unknown",
    lifecycle: "idle",
    lastEventType: undefined,
    flags: [],
    lastMeaningfulActivityAt: activityTimes.toSorted().at(-1) ?? new Date(0).toISOString(),
    attribution: "direct",
    workspace: latestSnapshot,
    changedFileCount: latestSnapshot?.changedPaths.length ?? 0,
    evidence: [
      ...(latestSnapshot
        ? [{ id: latestSnapshot.snapshotId, kind: "git_snapshot" as const, observedAt: latestSnapshot.observedAt, source: "git" }]
        : []),
      ...sessionAttention.flatMap((item) => item.evidence),
      ...sessionConflicts.flatMap((conflict) => conflict.evidence)
    ]
  };
}

function projectFromSnapshot(snapshot: GitSnapshot | undefined): string | undefined {
  return snapshot?.repoRoot.split("/").filter(Boolean).at(-1);
}

function commandIdsForEvent(event: NormalizedEvent): string[] {
  const commandId = event.payload.commandId;
  return typeof commandId === "string" ? [commandId] : [];
}

function commandTextsForEvent(event: NormalizedEvent): string[] {
  if (event.type !== "command.started" && event.type !== "command.finished") return [];

  return stringValues([
    event.payload.normalizedCommand,
    event.payload.command,
    event.summary === event.type ? undefined : event.summary
  ]);
}

function stringValues(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function containsAny(needle: string, haystack: string[]): boolean {
  const normalizedNeedle = normalize(needle);
  return haystack.some((value) => normalize(value).includes(normalizedNeedle));
}

function equalsAny<T extends string>(needle: T, haystack: T[]): boolean {
  const normalizedNeedle = normalize(needle);
  return haystack.some((value) => normalize(value) === normalizedNeedle);
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function exportTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replace(/[-:.]/g, "");
}
