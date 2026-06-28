import { useEffect, useMemo, useState } from "react";
import type { AdapterStatus, ImportJob, SourceStatus, SourceStatusPage } from "../app/daemonClient";
import { AdapterList } from "./sources/AdapterList";
import { ImportJobsTable } from "./sources/ImportJobsTable";
import { SourcesAdvancedDiagnostics } from "./sources/SourcesAdvancedDiagnostics";
import { SourcesConnectedDashboard } from "./sources/SourcesConnectedDashboard";
import { SourcesEmptyState } from "./sources/SourcesEmptyState";
import { SourcesOnboardingModal } from "./sources/SourcesOnboardingModal";

type Props = {
  adapters?: AdapterStatus[];
  imports?: ImportJob[];
  importLimit?: number;
  importOffset?: number;
  importTotal?: number;
  sources: SourceStatus[];
  busy: boolean;
  status?: string;
  onCancelImport?: (importJobId: string) => void;
  onEnableTranscriptImport?: (runtime: string) => void;
  onExcludePath: (path: string) => void;
  onImportMetadata?: (runtime: string) => void;
  onImportTranscripts?: (runtime: string) => void;
  onLoadAdapterSources?: (runtime: string, page: { limit: number; offset: number }) => Promise<SourceStatusPage>;
  onLoadMoreImports?: (page: { limit: number; offset: number }) => void;
  onPollImports?: () => void;
  onConnectSelected?: (runtimes: string[]) => void;
  onRefresh: () => void;
  onScan?: () => void;
  onRetryImport?: (importJobId: string) => void;
  onSyncAdapter?: (runtime: string) => void;
};

export function SourcesPanel(props: Props) {
  const { adapters, busy, imports = [], sources, status } = props;
  const adapterRows = adapters ?? adaptersFromSources(sources);
  const connectedAdapters = useMemo(() => adapterRows.filter(isConnectedAdapter), [adapterRows]);
  const activeRuntimes = useMemo(() => adapterRows.filter((adapter) => adapter.runtime !== "gemini_cli" && adapter.state !== "planned").map((adapter) => adapter.runtime), [adapterRows]);
  const [selectedRuntimes, setSelectedRuntimes] = useState<Set<string>>(() => new Set());
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeImportCount = imports.filter((job) => job.status === "queued" || job.status === "running").length;

  useEffect(() => {
    setSelectedRuntimes((current) => (current.size > 0 ? current : new Set(activeRuntimes)));
  }, [activeRuntimes]);

  useEffect(() => {
    if (activeImportCount === 0 || !props.onPollImports) return undefined;
    const timer = window.setInterval(() => props.onPollImports?.(), 1_500);
    return () => window.clearInterval(timer);
  }, [activeImportCount, props.onPollImports]);

  const syncConnected = () => {
    for (const adapter of connectedAdapters) props.onSyncAdapter?.(adapter.runtime);
  };

  return (
    <section id="sources" className="sources-panel sources-management surface-panel" aria-label="Session sources">
      {connectedAdapters.length === 0 ? (
        <SourcesEmptyState busy={busy} onConnectSources={() => setOnboardingOpen(true)} onShowAdvanced={() => setAdvancedOpen(true)} status={status} />
      ) : (
        <SourcesConnectedDashboard
          adapters={connectedAdapters}
          busy={busy}
          onAddSource={() => setOnboardingOpen(true)}
          onRepairMissingData={syncConnected}
          onShowAdvanced={() => setAdvancedOpen(true)}
          onSyncSources={syncConnected}
          status={status}
        />
      )}

      {advancedOpen ? (
        <SourcesAdvancedDiagnostics onClose={() => setAdvancedOpen(false)}>
          <AdapterList
            adapters={adapterRows}
            busy={busy}
            onEnableTranscriptImport={props.onEnableTranscriptImport}
            onExcludePath={props.onExcludePath}
            onImportMetadata={props.onImportMetadata}
            onImportTranscripts={props.onImportTranscripts}
            onLoadAdapterSources={props.onLoadAdapterSources}
            onToggleSelected={(runtime, checked) => {
              setSelectedRuntimes((current) => {
                const next = new Set(current);
                if (checked) next.add(runtime);
                else next.delete(runtime);
                return next;
              });
            }}
            onSyncAdapter={props.onSyncAdapter}
            selectedRuntimes={selectedRuntimes}
          />
          <ImportJobsTable
            busy={busy}
            imports={imports}
            limit={props.importLimit}
            offset={props.importOffset}
            onCancelImport={props.onCancelImport}
            onLoadMore={props.onLoadMoreImports}
            onRetryImport={props.onRetryImport}
            total={props.importTotal}
          />
        </SourcesAdvancedDiagnostics>
      ) : null}

      <SourcesOnboardingModal
        adapters={adapterRows}
        busy={busy}
        onClose={() => setOnboardingOpen(false)}
        onConnectSelected={props.onConnectSelected}
        onScan={props.onScan ?? props.onRefresh}
        open={onboardingOpen}
      />
    </section>
  );
}

function adaptersFromSources(sources: SourceStatus[]): AdapterStatus[] {
  const byRuntime = new Map<string, SourceStatus[]>();
  for (const source of sources) byRuntime.set(source.runtime, [...(byRuntime.get(source.runtime) ?? []), source]);
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

function isConnectedAdapter(adapter: AdapterStatus): boolean {
  if ((adapter.importedSessions ?? 0) > 0 || (adapter.importedCount ?? 0) > 0 || adapter.lastSyncAt) return true;
  return adapter.sourceLocations.some((source) => (source.importedSessions ?? 0) > 0 || (source.importedRecords ?? source.importedCount ?? 0) > 0 || Boolean(source.lastSyncAt ?? source.lastSync));
}
