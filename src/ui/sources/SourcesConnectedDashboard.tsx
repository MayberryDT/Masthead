import type { AdapterStatus } from "../../app/daemonClient";
import { harnessForRuntime } from "../../adapters/harnessCatalog";
import type { RuntimeKind } from "../../adapters/types";
import type { SourcesSetupConnectedSourceDto, SourcesSetupCoverageDto } from "../../shared/sourcesSetup";
import { AppButton } from "../primitives/AppButton";

type Props = {
  adapters: AdapterStatus[];
  connectedSources?: SourcesSetupConnectedSourceDto[];
  coverage?: SourcesSetupCoverageDto;
  busy?: boolean;
  status?: string;
  onAddSource: () => void;
  onOpenLogbook?: () => void;
  onRepairMissingData: () => void;
  onSyncSources: () => void;
};

export function SourcesConnectedDashboard({
  adapters,
  busy = false,
  connectedSources,
  coverage: setupCoverage,
  onAddSource,
  onOpenLogbook,
  onRepairMissingData,
  onSyncSources
}: Props) {
  const rows = (connectedSources?.length ? sourceFamiliesFromSetup(connectedSources) : adapters.map(sourceRowFromAdapter)).filter(isVisibleSourceRow);
  const coverage = setupCoverage ? normalizeSetupCoverage(setupCoverage) : coverageFromAdapters(adapters);
  const locationCount = rows.reduce((total, row) => total + row.locations, 0);
  const hasSyncTarget = adapters.length > 0 || rows.length > 0;
  return (
    <section className="sources-connected-dashboard" aria-label="Connected sources">
      <div className="sources-action-bar sources-toolbar observability-toolbar metal-toolbar">
        <div className="sources-toolbar-context" aria-label="Source inventory status">
          <span className="source-state connected">Inventory</span>
          <span>{rows.length} source {rows.length === 1 ? "family" : "families"} indexed</span>
        </div>
        <div className="toolbar-select-row sources-action-group" aria-label="Source actions">
          <AppButton type="button" onClick={onAddSource} disabled={busy}>
            Set up more sources
          </AppButton>
          <AppButton type="button" variant="primary" onClick={onSyncSources} disabled={busy || !hasSyncTarget}>
            Sync sources
          </AppButton>
          <AppButton type="button" variant="quiet" onClick={onRepairMissingData} disabled={busy || !hasSyncTarget}>
            Repair missing data
          </AppButton>
          {onOpenLogbook ? (
            <AppButton type="button" variant="quiet" onClick={onOpenLogbook}>
              Open Logbook
            </AppButton>
          ) : null}
        </div>
      </div>

      <dl className="usage-summary-strip sources-summary-strip" aria-label="Source coverage summary">
        <SourceMetric label="Sources" tone="sessions" value={rows.length} />
        <SourceMetric label="Locations" tone="tokens" value={locationCount} />
        <SourceMetric label="Sessions" tone="rate" value={coverage.sessions} />
        <SourceMetric label="Transcripts" tone="tools" value={coverage.transcripts} />
        <SourceMetric label="Enriched" tone="enriched" value={coverage.enriched} />
        <SourceMetric label="Queued" tone="files" value={coverage.queued} />
        <SourceMetric label="Issues" tone="mcp" value={coverage.failures} />
      </dl>

      <div className="connected-source-list" aria-label="Source inventory">
        {rows.map((source) => (
          <article className="connected-source-row" key={source.key}>
            <div className="connected-source-main">
              <div>
                <p className="mono-label">{source.runtime}</p>
                <h3>{source.label}</h3>
              </div>
              <span className={`source-state ${source.state}`}>{source.state.replaceAll("_", " ")}</span>
            </div>
            <dl className="source-proof-list" aria-label={`${source.label} source proof`}>
              {proofRows(source).map((row) => (
                <div className={`source-proof source-proof-${row.tone}`} key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function SourceMetric({ label, tone, value }: { label: string; tone: string; value: number }) {
  return (
    <div className={`usage-metric ${tone}`}>
      <span className="usage-metric-accent" aria-hidden="true" />
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

type SourceRow = {
  enrichmentEnabled: boolean;
  failures: number;
  key: string;
  label: string;
  lastSyncAt?: string;
  locations: number;
  queued: number;
  runtime: string;
  sessions: number;
  state: string;
  transcriptImportEnabled: boolean;
};

type ProofRow = {
  label: string;
  value: string;
  tone: "good" | "warn" | "neutral";
};

function coverageFromAdapters(adapters: AdapterStatus[]) {
  return adapters.reduce(
    (totals, adapter) => ({
      enriched: totals.enriched + (adapter.policies.enrichment ? adapter.importedSessions : 0),
      failures: totals.failures + (adapter.failureCount ?? 0),
      queued: totals.queued + (adapter.queuedRecords ?? 0),
      sessions: totals.sessions + (adapter.importedSessions || adapter.discoveredSessions || 0),
      transcripts: totals.transcripts + (adapter.policies.transcriptImport ? adapter.importedSessions : 0)
    }),
    { enriched: 0, failures: 0, queued: 0, sessions: 0, transcripts: 0 }
  );
}

function sourceFamiliesFromSetup(sources: SourcesSetupConnectedSourceDto[]): SourceRow[] {
  const byRuntime = new Map<string, SourcesSetupConnectedSourceDto[]>();
  for (const source of sources) byRuntime.set(source.runtime, [...(byRuntime.get(source.runtime) ?? []), source]);
  return Array.from(byRuntime.entries()).map(([runtime, runtimeSources]) => sourceRowFromSetupFamily(runtime, runtimeSources));
}

function normalizeSetupCoverage(coverage: SourcesSetupCoverageDto) {
  return {
    enriched: coverage.enriched ?? coverage.enrichedSessions ?? 0,
    failures: coverage.failures ?? coverage.failedImports ?? 0,
    queued: coverage.queued ?? 0,
    sessions: coverage.sessions,
    transcripts: coverage.transcripts ?? coverage.transcriptSessions ?? 0
  };
}

function sourceRowFromAdapter(adapter: AdapterStatus): SourceRow {
  return {
    enrichmentEnabled: adapter.policies.enrichment,
    failures: adapter.failureCount ?? 0,
    key: adapter.runtime,
    label: adapter.name ?? harnessForRuntime(adapter.runtime as RuntimeKind)?.label ?? adapter.runtime,
    lastSyncAt: adapter.lastSyncAt,
    locations: adapter.sourceLocationCount ?? adapter.sourceLocations.length,
    queued: adapter.queuedRecords ?? 0,
    runtime: adapter.runtime,
    sessions: adapter.importedSessions || adapter.discoveredSessions || 0,
    state: adapter.state,
    transcriptImportEnabled: adapter.policies.transcriptImport
  };
}

function sourceRowFromSetupFamily(runtime: string, sources: SourcesSetupConnectedSourceDto[]): SourceRow {
  const single = sources.length === 1 ? sources[0] : undefined;
  const sessions = sources.reduce(
    (total, source) => total + (source.importedSessions ?? source.metadataSessions ?? source.discoveredSessions ?? source.sessions ?? source.sessionCount ?? source.importedCount ?? 0),
    0
  );
  const queued = sources.reduce((total, source) => total + (source.queuedRecords ?? source.queuedCount ?? 0), 0);
  const failures = sources.reduce((total, source) => total + (source.failureCount ?? source.failures ?? 0), 0);
  const lastSyncAt = sources.map((source) => source.lastSyncAt ?? source.lastSync).filter(Boolean).toSorted().at(-1);
  const harnessLabel = harnessForRuntime(runtime as RuntimeKind)?.label ?? runtime;
  const state = failures > 0 ? "needs_attention" : queued > 0 ? "importing" : single?.state ?? single?.status ?? "connected";
  return {
    enrichmentEnabled: sources.some((source) => Boolean(source.enrichmentEnabled)),
    failures,
    key: runtime,
    label: single?.label ?? harnessLabel,
    lastSyncAt,
    locations: sources.length,
    queued,
    runtime,
    sessions,
    state,
    transcriptImportEnabled: sources.some((source) => Boolean(source.transcriptImportEnabled))
  };
}

function isVisibleSourceRow(source: SourceRow): boolean {
  return source.runtime !== "masthead" && source.key !== "masthead-git-observer";
}

function proofRows(source: SourceRow): ProofRow[] {
  return [
    { label: "Locations", value: `${source.locations} ${source.locations === 1 ? "location" : "locations"}`, tone: source.locations > 0 ? "good" : "neutral" },
    { label: "History", value: `${source.sessions} sessions`, tone: source.sessions > 0 ? "good" : "neutral" },
    { label: "Live capture", value: source.lastSyncAt ? "Observed" : "No recent activity", tone: source.lastSyncAt ? "good" : "warn" },
    { label: "Transcripts", value: source.transcriptImportEnabled ? "Enabled" : "Needs transcript import", tone: source.transcriptImportEnabled ? "good" : "warn" },
    { label: "Enrichment", value: source.enrichmentEnabled ? "Enabled" : "Needs enrichment", tone: source.enrichmentEnabled ? "good" : "warn" },
    { label: "Queued", value: `${source.queued}`, tone: source.queued > 0 ? "warn" : "neutral" },
    { label: "Issues", value: `${source.failures}`, tone: source.failures > 0 ? "warn" : "neutral" },
    { label: "Last activity", value: source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString() : "Not observed", tone: source.lastSyncAt ? "good" : "neutral" }
  ];
}
