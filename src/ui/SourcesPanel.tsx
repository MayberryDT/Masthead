import type { AdapterStatus, ImportJob, SourceStatus } from "../app/daemonClient";
import { AppButton } from "./primitives/AppButton";
import { PageHeader } from "./primitives/PageHeader";
import { StatStrip } from "./primitives/StatStrip";
import { StatusBadge } from "./primitives/StatusBadge";
import { AdapterList } from "./sources/AdapterList";
import { ImportJobsTable } from "./sources/ImportJobsTable";

type Props = {
  adapters?: AdapterStatus[];
  imports?: ImportJob[];
  sources: SourceStatus[];
  busy: boolean;
  status?: string;
  onRefresh: () => void;
  onImportCodexMetadata: () => void;
  onExcludePath: (path: string) => void;
};

export function SourcesPanel({
  adapters,
  busy,
  imports = [],
  onExcludePath,
  onImportCodexMetadata,
  onRefresh,
  sources,
  status
}: Props) {
  const adapterRows = adapters ?? adaptersFromSources(sources);
  const totals = sourceTotals(adapterRows);

  return (
    <section id="sources" className="sources-panel sources-management surface-panel" aria-label="Session sources">
      <PageHeader
        eyebrow="Sources"
        title="Connected runtimes and local history stores"
        trailing={<StatusBadge tone={adapterRows.length > 0 ? "active" : "neutral"}>{adapterRows.length} adapters</StatusBadge>}
      />

      <div className="sources-command-row">
        <div className="sources-actions">
          <AppButton type="button" onClick={onRefresh} disabled={busy}>
            Discover sources
          </AppButton>
          <AppButton type="button" variant="primary" onClick={onImportCodexMetadata} disabled={busy}>
            Sync all
          </AppButton>
        </div>
        {status ? <p className="sources-status surface-status">{status}</p> : null}
      </div>

      <StatStrip
        label="Source summary"
        items={[
          { label: "Adapters", value: String(adapterRows.length) },
          { label: "Sessions", value: String(totals.sessions) },
          { label: "Imported", value: String(totals.imported) },
          { label: "Queued", value: String(totals.queued) },
          { label: "Failures", value: String(totals.failures) }
        ]}
      />

      <AdapterList adapters={adapterRows} busy={busy} onExcludePath={onExcludePath} />
      <ImportJobsTable imports={imports} />
    </section>
  );
}

function adaptersFromSources(sources: SourceStatus[]): AdapterStatus[] {
  const byRuntime = new Map<string, SourceStatus[]>();
  for (const source of sources) {
    const current = byRuntime.get(source.runtime) ?? [];
    current.push(source);
    byRuntime.set(source.runtime, current);
  }
  return Array.from(byRuntime.entries()).map(([runtime, sourceLocations]) => ({
    discoveredSessions: sourceLocations.reduce((total, source) => total + (source.sessionCount ?? source.discoveredSessions ?? 0), 0),
    importedSessions: sourceLocations.reduce((total, source) => total + (source.importedSessions ?? 0), 0),
    lastSyncAt: sourceLocations.map((source) => source.lastSyncAt ?? source.lastSync).filter(Boolean).toSorted().at(-1),
    policies: {
      enrichment: sourceLocations.some((source) => source.enrichmentEnabled),
      mcpAccess: sourceLocations.some((source) => source.mcpEnabled),
      metadataImport: true,
      transcriptImport: sourceLocations.some((source) => source.transcriptImportEnabled)
    },
    runtime,
    sourceLocations,
    state: sourceLocations.some((source) => (source.failureCount ?? source.failures ?? 0) > 0) ? "degraded" : "connected"
  }));
}

function sourceTotals(adapters: AdapterStatus[]) {
  return adapters.reduce(
    (totals, adapter) => ({
      failures:
        totals.failures +
        adapter.sourceLocations.reduce((sourceTotal, source) => sourceTotal + (source.failureCount ?? source.failures ?? 0), 0),
      imported:
        totals.imported +
        adapter.sourceLocations.reduce((sourceTotal, source) => sourceTotal + (source.importedRecords ?? source.importedCount ?? 0), 0),
      queued:
        totals.queued +
        adapter.sourceLocations.reduce((sourceTotal, source) => sourceTotal + (source.queuedRecords ?? source.queuedCount ?? 0), 0),
      sessions: totals.sessions + adapter.importedSessions
    }),
    { failures: 0, imported: 0, queued: 0, sessions: 0 }
  );
}
