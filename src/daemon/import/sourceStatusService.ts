import { ALL_RUNTIME_KINDS, type AdapterDiagnostic, type DiscoveredSource, type RuntimeKind } from "../../adapters/types.ts";
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

type ImportCountsRow = {
  failure_count: number;
  imported_records: number;
  last_sync_at: string;
  queued_records: number;
  source_id: string;
};

type SessionCountsRow = {
  session_count: number;
  source_id: string;
};

type SourcePolicyRow = {
  decided_at: string;
  enabled: number;
  policy_kind: string;
  source_id: string | null;
};

export function getSourceStatuses(db: MastheadDatabase, discoveredSources: DiscoveredSource[] = []): SourceStatusDto[] {
  upsertDiscoveredSources(db, discoveredSources);
  const rows = db.prepare("SELECT source_id, adapter, source_kind, source_path, confidence FROM ingest_sources ORDER BY source_id").all() as SourceRow[];
  const importCountsBySource = loadImportCountsBySource(db);
  const sessionCountsBySource = loadSessionCountsBySource(db);
  const policies = loadSourcePolicies(db);
  return rows.filter(isVisibleSourceRow).map((row) => {
    const counts = importCountsBySource.get(row.source_id) ?? EMPTY_COUNTS;
    const importedSessions = sessionCountsBySource.get(row.source_id) ?? 0;
    const discoveredSessions = importedSessions;
    const status = {
      confidence: row.confidence,
      discoveredSessions,
      enrichmentEnabled: policyEnabled(policies, row.source_id, "enrichment"),
      failureCount: counts.failureCount ?? 0,
      importedRecords: counts.importedRecords ?? 0,
      importedSessions,
      lastSyncAt: counts.lastSyncAt ?? undefined,
      mcpEnabled: policyEnabled(policies, row.source_id, "mcp_access", true),
      path: row.source_path ?? undefined,
      queuedRecords: counts.queuedRecords ?? 0,
      runtime: row.adapter as RuntimeKind,
      sourceId: row.source_id,
      sourceKind: row.source_kind,
      transcriptImportEnabled: policyEnabled(policies, row.source_id, "transcript_import")
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
  if (!(ALL_RUNTIME_KINDS as readonly string[]).includes(row.adapter)) return false;
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
  return adapterStatusesFromSources(sources, preflights);
}

export function adapterStatusesFromSources(
  sources: SourceStatusDto[],
  preflights: SourcePreflightResult[] = []
): AdapterStatusDto[] {
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

const EMPTY_COUNTS: CountsRow = {
  failureCount: 0,
  importedRecords: 0,
  lastSyncAt: null,
  queuedRecords: 0
};

function loadImportCountsBySource(db: MastheadDatabase): Map<string, CountsRow> {
  const rows = db
    .prepare(
      `WITH latest_terminal AS (
        SELECT
          source_id,
          import_kind,
          imported_count,
          queued_count,
          failure_count,
          ROW_NUMBER() OVER (
            PARTITION BY source_id, import_kind
            ORDER BY updated_at DESC, import_job_id DESC
          ) AS terminal_rank
        FROM import_jobs
        WHERE status NOT IN ('queued', 'running', 'cancelling')
      ),
      terminal_totals AS (
        SELECT
          source_id,
          SUM(imported_count) AS imported_records,
          SUM(queued_count) AS queued_records,
          SUM(failure_count) AS failure_count
        FROM latest_terminal
        WHERE terminal_rank = 1
        GROUP BY source_id
      ),
      active_totals AS (
        SELECT source_id, SUM(queued_count) AS queued_records
        FROM import_jobs
        WHERE status IN ('queued', 'running', 'cancelling')
        GROUP BY source_id
      ),
      latest_sync AS (
        SELECT source_id, MAX(updated_at) AS last_sync_at
        FROM import_jobs
        GROUP BY source_id
      )
      SELECT
        latest_sync.source_id,
        COALESCE(terminal_totals.failure_count, 0) AS failure_count,
        COALESCE(terminal_totals.imported_records, 0) AS imported_records,
        latest_sync.last_sync_at,
        COALESCE(terminal_totals.queued_records, 0) + COALESCE(active_totals.queued_records, 0) AS queued_records
      FROM latest_sync
      LEFT JOIN terminal_totals ON terminal_totals.source_id = latest_sync.source_id
      LEFT JOIN active_totals ON active_totals.source_id = latest_sync.source_id`
    )
    .all() as ImportCountsRow[];
  const countsBySource = new Map<string, CountsRow>();
  for (const row of rows) {
    countsBySource.set(row.source_id, {
      failureCount: row.failure_count,
      importedRecords: row.imported_records,
      lastSyncAt: row.last_sync_at,
      queuedRecords: row.queued_records
    });
  }
  return countsBySource;
}

function loadSessionCountsBySource(db: MastheadDatabase): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT source_id, COUNT(DISTINCT session_id) AS session_count
      FROM session_sources
      GROUP BY source_id`
    )
    .all() as SessionCountsRow[];
  return new Map(rows.map((row) => [row.source_id, row.session_count]));
}

type LoadedSourcePolicies = {
  globals: Map<string, boolean>;
  sourceSpecific: Map<string, boolean>;
};

function loadSourcePolicies(db: MastheadDatabase): LoadedSourcePolicies {
  const rows = db
    .prepare(
      `SELECT source_id, policy_kind, enabled, decided_at
      FROM source_policies
      WHERE policy_kind IN ('transcript_import', 'enrichment', 'mcp_access')
      ORDER BY decided_at DESC`
    )
    .all() as SourcePolicyRow[];
  const globals = new Map<string, boolean>();
  const sourceSpecific = new Map<string, boolean>();
  for (const row of rows) {
    if (row.source_id === null) {
      if (!globals.has(row.policy_kind)) globals.set(row.policy_kind, row.enabled === 1);
      continue;
    }
    const key = sourcePolicyKey(row.source_id, row.policy_kind);
    if (!sourceSpecific.has(key)) sourceSpecific.set(key, row.enabled === 1);
  }
  return { globals, sourceSpecific };
}

function policyEnabled(policies: LoadedSourcePolicies, sourceId: string, policyKind: string, defaultValue = false): boolean {
  const sourceSpecific = policies.sourceSpecific.get(sourcePolicyKey(sourceId, policyKind));
  if (sourceSpecific !== undefined) return sourceSpecific;
  return policies.globals.get(policyKind) ?? defaultValue;
}

function sourcePolicyKey(sourceId: string, policyKind: string): string {
  return `${sourceId}\0${policyKind}`;
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).toSorted().at(-1);
}
