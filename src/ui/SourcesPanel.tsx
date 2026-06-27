import { useEffect, useMemo, useState } from "react";
import type { AdapterStatus, ImportJob, SourceStatus } from "../app/daemonClient";
import { AppButton } from "./primitives/AppButton";
import { StatStrip } from "./primitives/StatStrip";
import { AdapterList } from "./sources/AdapterList";
import { ImportJobsTable } from "./sources/ImportJobsTable";

type Props = {
  adapters?: AdapterStatus[];
  imports?: ImportJob[];
  sources: SourceStatus[];
  busy: boolean;
  status?: string;
  onCancelImport?: (importJobId: string) => void;
  onEnableTranscriptImport?: (runtime: string) => void;
  onExcludePath: (path: string) => void;
  onImportMetadata?: (runtime: string) => void;
  onImportTranscripts?: (runtime: string) => void;
  onPollImports?: () => void;
  onConnectSelected?: (runtimes: string[]) => void;
  onRefresh: () => void;
  onScan?: () => void;
  onRetryImport?: (importJobId: string) => void;
  onSyncAdapter?: (runtime: string) => void;
};

export function SourcesPanel({
  adapters,
  busy,
  imports = [],
  onCancelImport,
  onEnableTranscriptImport,
  onExcludePath,
  onImportMetadata,
  onImportTranscripts,
  onPollImports,
  onConnectSelected,
  onRefresh,
  onScan,
  onRetryImport,
  onSyncAdapter,
  sources,
  status
}: Props) {
  const adapterRows = adapters ?? adaptersFromSources(sources);
  const activeRuntimes = useMemo(() => adapterRows.filter((adapter) => adapter.runtime !== "gemini_cli" && adapter.state !== "planned").map((adapter) => adapter.runtime), [adapterRows]);
  const [selectedRuntimes, setSelectedRuntimes] = useState<Set<string>>(() => new Set());
  const totals = sourceTotals(adapterRows);
  const activeImportCount = imports.filter((job) => job.status === "queued" || job.status === "running").length;
  const selectedList = Array.from(selectedRuntimes).filter((runtime) => activeRuntimes.includes(runtime));

  useEffect(() => {
    setSelectedRuntimes((current) => {
      if (current.size > 0) return current;
      return new Set(activeRuntimes);
    });
  }, [activeRuntimes]);

  useEffect(() => {
    if (activeImportCount === 0 || !onPollImports) return undefined;
    const timer = window.setInterval(() => {
      onPollImports();
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [activeImportCount, onPollImports]);

  return (
    <section id="sources" className="sources-panel sources-management surface-panel" aria-label="Session sources">
      <div className="sources-command-row">
        <div className="sources-actions">
          <AppButton type="button" onClick={onRefresh} disabled={busy}>
            Discover sources
          </AppButton>
          <AppButton type="button" onClick={onScan ?? onRefresh} disabled={busy}>
            Scan this computer
          </AppButton>
          <AppButton type="button" variant="primary" onClick={() => onConnectSelected?.(selectedList)} disabled={busy || !onConnectSelected || selectedList.length === 0}>
            Connect selected
          </AppButton>
          <AppButton type="button" variant="quiet" onClick={() => selectedList.forEach((runtime) => onSyncAdapter?.(runtime))} disabled={busy || !onSyncAdapter || selectedList.length === 0}>
            Sync connected
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

      <AdapterList
        adapters={adapterRows}
        busy={busy}
        onEnableTranscriptImport={onEnableTranscriptImport}
        onExcludePath={onExcludePath}
        onImportMetadata={onImportMetadata}
        onImportTranscripts={onImportTranscripts}
        onToggleSelected={(runtime, checked) => {
          setSelectedRuntimes((current) => {
            const next = new Set(current);
            if (checked) next.add(runtime);
            else next.delete(runtime);
            return next;
          });
        }}
        onSyncAdapter={onSyncAdapter}
        selectedRuntimes={selectedRuntimes}
      />
      <ImportJobsTable busy={busy} imports={imports} onCancelImport={onCancelImport} onRetryImport={onRetryImport} />
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

type AdapterTotalsStatus = AdapterStatus & {
  diagnostics?: { severity?: string }[];
  importedCount?: number;
};

function sourceTotals(adapters: AdapterStatus[]) {
  return adapters.reduce(
    (totals, adapter) => {
      const row = adapter as AdapterTotalsStatus;
      const sourceFailures = row.sourceLocations.reduce(
        (sourceTotal, source) => sourceTotal + (source.failureCount ?? source.failures ?? 0),
        0
      );
      const diagnosticFailures = row.diagnostics?.filter((diagnostic) => diagnostic.severity === "error").length ?? 0;
      const importedRecords = row.sourceLocations.reduce(
        (sourceTotal, source) => sourceTotal + (source.importedRecords ?? source.importedCount ?? 0),
        0
      );
      const queuedRecords = row.sourceLocations.reduce(
        (sourceTotal, source) => sourceTotal + (source.queuedRecords ?? source.queuedCount ?? 0),
        0
      );

      return {
        failures: totals.failures + sourceFailures + diagnosticFailures,
        imported: totals.imported + (row.importedCount ?? importedRecords),
        queued: totals.queued + queuedRecords,
        sessions: totals.sessions + row.importedSessions
      };
    },
    { failures: 0, imported: 0, queued: 0, sessions: 0 }
  );
}
