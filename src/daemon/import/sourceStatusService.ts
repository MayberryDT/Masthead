import type { AdapterDiagnostic, DiscoveredSource, RuntimeKind } from "../../adapters/types.ts";
import { countDistinctSessionsForSource } from "../db/sessionSourceRepository.ts";
import { supportedAdapters, type AdapterImplementationState } from "../sources/supportedAdapters.ts";
import type { SourcePreflightResult } from "../sources/sourcePreflight.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

export type SourceStatusDto = {
  sourceId: string;
  runtime: RuntimeKind;
  sourceKind: string;
  path?: string;
  confidence: "authoritative" | "inferred" | "heuristic";
  discoveredSessions: number;
  importedSessions: number;
  importedRecords: number;
  queuedRecords: number;
  failureCount: number;
  lastSyncAt?: string;
  transcriptImportEnabled: boolean;
  enrichmentEnabled: boolean;
  mcpEnabled: boolean;
  sessionCount?: number;
  importedCount?: number;
  queuedCount?: number;
  failures?: number;
  lastSync?: string;
};

export type AdapterStatusDto = {
  runtime: RuntimeKind;
  name: string;
  label: string;
  description: string;
  state: "connected" | "degraded" | "disabled" | "not_detected" | "planned";
  implementationState: AdapterImplementationState;
  maturity: string;
  discoveredCount: number;
  importedCount: number;
  discoveredSessions: number;
  importedSessions: number;
  lastSyncAt?: string;
  diagnostics: AdapterDiagnostic[];
  failureCount: number;
  sourceLocations: SourceStatusDto[];
  sourceLocationCount: number;
  queuedRecords: number;
  policies: {
    metadataImport: boolean;
    transcriptImport: boolean;
    enrichment: boolean;
    mcpAccess: boolean;
  };
};

type SourceRow = {
  source_id: string;
  adapter: string;
  source_kind: string;
  source_path: string | null;
  confidence: SourceStatusDto["confidence"];
};

type CountsRow = {
  failureCount: number;
  importedRecords: number;
  lastSyncAt: string | null;
  queuedRecords: number;
};

type ImportHealthRow = {
  failure_count: number;
  import_kind: string;
  imported_count: number;
  queued_count: number;
  status: string;
  updated_at: string;
};

export function getSourceStatuses(db: MastheadDatabase, discoveredSources: DiscoveredSource[] = []): SourceStatusDto[] {
  upsertDiscoveredSources(db, discoveredSources);
  const rows = db.prepare("SELECT source_id, adapter, source_kind, source_path, confidence FROM ingest_sources ORDER BY source_id").all() as SourceRow[];
  return rows.filter(isVisibleSourceRow).map((row) => {
    const counts = importCounts(db, row.source_id);
    const importedSessions = countDistinctSessionsForSource(db, row.source_id);
    const discoveredSessions = importedSessions;
    const status = {
      confidence: row.confidence,
      discoveredSessions,
      enrichmentEnabled: policyEnabled(db, row.source_id, "enrichment"),
      failureCount: counts.failureCount ?? 0,
      importedRecords: counts.importedRecords ?? 0,
      importedSessions,
      lastSyncAt: counts.lastSyncAt ?? undefined,
      mcpEnabled: policyEnabled(db, row.source_id, "mcp_access", true),
      path: row.source_path ?? undefined,
      queuedRecords: counts.queuedRecords ?? 0,
      runtime: row.adapter as RuntimeKind,
      sourceId: row.source_id,
      sourceKind: row.source_kind,
      transcriptImportEnabled: policyEnabled(db, row.source_id, "transcript_import")
    } satisfies SourceStatusDto;
    return {
      ...status,
      failures: status.failureCount,
      importedCount: status.importedRecords,
      lastSync: status.lastSyncAt,
      queuedCount: status.queuedRecords,
      sessionCount: status.discoveredSessions
    };
  });
}

function isVisibleSourceRow(row: SourceRow): boolean {
  const path = row.source_path;
  if (!path) return true;
  const lower = path.toLowerCase();
  if (lower.includes("/node_modules/") || lower.includes("\\node_modules\\")) return false;
  if (lower.includes("/.git/") || lower.includes("\\.git\\")) return false;
  if (lower.endsWith("/package.json") || lower.endsWith("\\package.json")) return false;
  return true;
}

export type AdapterStatusInput =
  | DiscoveredSource[]
  | {
      sources?: DiscoveredSource[];
      preflights?: SourcePreflightResult[];
    };

export function getAdapterStatuses(db: MastheadDatabase, input: AdapterStatusInput = []): AdapterStatusDto[] {
  const { sources: discoveredSources, preflights } = normalizeAdapterStatusInput(input);
  const sources = getSourceStatuses(db, discoveredSources);
  const byRuntime = new Map<RuntimeKind, SourceStatusDto[]>();
  for (const source of sources) {
    const current = byRuntime.get(source.runtime) ?? [];
    current.push(source);
    byRuntime.set(source.runtime, current);
  }

  return supportedAdapters.map((adapter) => {
    const sourceLocations = byRuntime.get(adapter.runtime) ?? [];
    const failureCount = sourceLocations.reduce((total, source) => total + source.failureCount, 0);
    const importedSessions = sourceLocations.reduce((total, source) => total + source.importedSessions, 0);
    const lastSyncAt = latestDate(sourceLocations.map((source) => source.lastSyncAt));
    const preflight = preflights.find((result) => result.runtime === adapter.runtime);
    const diagnostics = groupDiagnostics(preflight?.diagnostics ?? []);
    if (failureCount > 0) {
      diagnostics.push({
        count: failureCount,
        code: "adapter_import_failures",
        message: `${failureCount} import failure${failureCount === 1 ? "" : "s"} recorded for ${adapter.name}.`,
        observedAt: lastSyncAt ?? new Date().toISOString(),
        severity: "warning"
      });
    }
    const discoveredCount =
      preflight?.discoveredCount ?? sourceLocations.reduce((total, source) => total + source.discoveredSessions, 0);
    const state =
      adapter.implementationState === "planned"
        ? "planned"
        : failureCount > 0 || preflight?.state === "degraded"
          ? "degraded"
          : discoveredCount > 0
            ? "connected"
            : "not_detected";
    return {
      description: adapter.description,
      diagnostics,
      discoveredCount,
      discoveredSessions: discoveredCount,
      failureCount,
      implementationState: adapter.implementationState,
      importedCount: importedSessions,
      importedSessions,
      lastSyncAt,
      name: adapter.name,
      label: adapter.label,
      maturity: adapter.maturity,
      policies: {
        enrichment: sourceLocations.some((source) => source.enrichmentEnabled),
        mcpAccess: sourceLocations.some((source) => source.mcpEnabled),
        metadataImport: adapter.supportsMetadataImport,
        transcriptImport: sourceLocations.some((source) => source.transcriptImportEnabled)
      },
      runtime: adapter.runtime,
      sourceLocations,
      sourceLocationCount: sourceLocations.length,
      queuedRecords: sourceLocations.reduce((total, source) => total + source.queuedRecords, 0),
      state
    } satisfies AdapterStatusDto;
  });
}

function normalizeAdapterStatusInput(input: AdapterStatusInput): { sources: DiscoveredSource[]; preflights: SourcePreflightResult[] } {
  if (Array.isArray(input)) return { preflights: [], sources: input };
  return { preflights: input.preflights ?? [], sources: input.sources ?? [] };
}

function groupDiagnostics(diagnostics: AdapterDiagnostic[]): AdapterDiagnostic[] {
  const groups = new Map<string, AdapterDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = [diagnostic.code, diagnostic.message, diagnostic.severity].join("\0");
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...diagnostic, count: diagnostic.count ?? 1 });
      continue;
    }
    groups.set(key, {
      ...current,
      count: (current.count ?? 1) + (diagnostic.count ?? 1),
      observedAt: latestDate([current.observedAt, diagnostic.observedAt]) ?? diagnostic.observedAt
    });
  }
  return Array.from(groups.values());
}

function upsertDiscoveredSources(db: MastheadDatabase, sources: DiscoveredSource[]): void {
  if (sources.length === 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, endpoint, schema_version, runtime_version, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      source_path = excluded.source_path,
      endpoint = excluded.endpoint,
      schema_version = excluded.schema_version,
      runtime_version = excluded.runtime_version,
      confidence = excluded.confidence,
      last_seen_at = excluded.last_seen_at`
  );
  for (const source of sources) {
    insert.run(
      source.sourceId,
      source.runtime,
      source.sourceKind,
      source.path ?? null,
      source.endpoint ?? null,
      source.schemaVersion ?? null,
      source.runtimeVersion ?? null,
      source.confidence,
      now,
      now
    );
  }
}

function importCounts(db: MastheadDatabase, sourceId: string): CountsRow {
  const rows = db
    .prepare(
      `SELECT import_kind, status, imported_count, queued_count, failure_count, updated_at
      FROM import_jobs
      WHERE source_id = ?
      ORDER BY updated_at DESC, import_job_id DESC`
    )
    .all(sourceId) as ImportHealthRow[];
  const latestTerminalByKind = new Map<string, ImportHealthRow>();
  let queuedRecords = 0;
  let lastSyncAt: string | null = null;
  for (const row of rows) {
    lastSyncAt = latestDate([lastSyncAt ?? undefined, row.updated_at]) ?? null;
    if (row.status === "queued" || row.status === "running" || row.status === "cancelling") {
      queuedRecords += row.queued_count;
      continue;
    }
    if (!latestTerminalByKind.has(row.import_kind)) {
      latestTerminalByKind.set(row.import_kind, row);
    }
  }
  let importedRecords = 0;
  let failureCount = 0;
  for (const row of latestTerminalByKind.values()) {
    importedRecords += row.imported_count;
    queuedRecords += row.queued_count;
    failureCount += row.failure_count;
  }
  return {
    failureCount,
    importedRecords,
    lastSyncAt,
    queuedRecords
  };
}

function policyEnabled(db: MastheadDatabase, sourceId: string, policyKind: string, defaultValue = false): boolean {
  const row = db
    .prepare(
      `SELECT enabled
      FROM source_policies
      WHERE policy_kind = ?
        AND (source_id = ? OR source_id IS NULL)
      ORDER BY source_id IS NOT NULL DESC, decided_at DESC
      LIMIT 1`
    )
    .get(policyKind, sourceId) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : defaultValue;
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).toSorted().at(-1);
}
