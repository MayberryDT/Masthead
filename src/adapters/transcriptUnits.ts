import { stat } from "node:fs/promises";
import type { AdapterDiagnostic, AdapterRecord, DiscoveredSource, IngestCursor, RuntimeKind } from "./types.ts";

export type TranscriptTimestampBasis = "semantic" | "source_path" | "file_modified" | "unknown";
export type TranscriptUnitCompleteness = "complete" | "partial" | "unrecognized";

export type TranscriptUnitPlan = {
  runtime: RuntimeKind;
  source: DiscoveredSource;
  unitId: string;
  sourceSessionId?: string;
  semanticActivityAt?: string;
  timestampBasis: TranscriptTimestampBasis;
  fileSizeBytes?: number;
  modifiedAt?: string;
};

export type ParsedTranscriptUnit = {
  unit: TranscriptUnitPlan;
  completeness: TranscriptUnitCompleteness;
  records: AdapterRecord[];
  diagnostics: AdapterDiagnostic[];
  sourceSessionIds: string[];
  firstActivityAt?: string;
  lastActivityAt?: string;
};

export type TranscriptUnitAdapter = {
  planTranscriptUnits(source: DiscoveredSource): Promise<TranscriptUnitPlan[]>;
  parseTranscriptUnit(unit: TranscriptUnitPlan, cursor?: IngestCursor): Promise<ParsedTranscriptUnit>;
};

export function parsedUnitIsFinalizable(unit: ParsedTranscriptUnit): boolean {
  return unit.completeness === "complete" && unit.sourceSessionIds.length > 0 && unit.records.length > 0;
}

export async function planLocalTranscriptFiles(source: DiscoveredSource): Promise<TranscriptUnitPlan[]> {
  if (!source.path) return [];
  try {
    const info = await stat(source.path);
    return [
      {
        fileSizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        runtime: source.runtime,
        source,
        sourceSessionId: source.sourceSessionId,
        timestampBasis: "file_modified",
        unitId: source.path
      }
    ];
  } catch {
    return [{ runtime: source.runtime, source, sourceSessionId: source.sourceSessionId, timestampBasis: "unknown", unitId: source.path }];
  }
}

export async function collectAdapterRecords(records: AsyncIterable<AdapterRecord>): Promise<AdapterRecord[]> {
  const collected: AdapterRecord[] = [];
  for await (const record of records) collected.push(record);
  return collected;
}

export function parsedTranscriptUnit(unit: TranscriptUnitPlan, records: AdapterRecord[]): ParsedTranscriptUnit {
  const diagnostics = records.flatMap((record) => record.diagnostics);
  return {
    unit,
    completeness: diagnostics.some((item) => item.severity === "error")
      ? "unrecognized"
      : diagnostics.length > 0
        ? "partial"
        : "complete",
    records,
    diagnostics,
    sourceSessionIds: distinctNormalizedSessionIds(records),
    firstActivityAt: minimumObservedAt(records),
    lastActivityAt: maximumObservedAt(records)
  };
}

export function distinctNormalizedSessionIds(records: AdapterRecord[]): string[] {
  const sessionIds = new Set<string>();
  for (const record of records) {
    const value = record.normalized.value;
    if (!isRecord(value)) continue;
    const sessionId = normalizedString(value.sessionId);
    if (sessionId) sessionIds.add(sessionId);
  }
  return [...sessionIds];
}

export function minimumObservedAt(records: AdapterRecord[]): string | undefined {
  return observedAtBoundary(records, "minimum");
}

export function maximumObservedAt(records: AdapterRecord[]): string | undefined {
  return observedAtBoundary(records, "maximum");
}

function observedAtBoundary(records: AdapterRecord[], boundary: "minimum" | "maximum"): string | undefined {
  let selected: { observedAt: string; timestamp: number } | undefined;
  for (const record of records) {
    const timestamp = Date.parse(record.observedAt);
    if (!Number.isFinite(timestamp)) continue;
    if (!selected || (boundary === "minimum" ? timestamp < selected.timestamp : timestamp > selected.timestamp)) {
      selected = { observedAt: record.observedAt, timestamp };
    }
  }
  return selected?.observedAt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
