import { useEffect, useMemo, useState } from "react";
import type { AdapterStatus, ImportJob, SourceStatus, SourceStatusPage } from "../app/daemonClient";
import type { SourcesOnboardingScanDto, SourcesSetupDto, SourcesSetupRunInput } from "../shared/sourcesSetup";
import { ImportJobsTable } from "./sources/ImportJobsTable";
import { SourcesConnectedDashboard } from "./sources/SourcesConnectedDashboard";
import { SourcesEmptyState } from "./sources/SourcesEmptyState";
import { SourcesImportModal } from "./sources/SourcesImportModal";
import { SourcesOnboardingModal } from "./sources/SourcesOnboardingModal";
import type { SourcesImportPreview } from "../app/daemonClient";
import { SourceDiagnosticPanel } from "./sources/SourceDiagnosticPanel";

type Props = {
  adapters?: AdapterStatus[];
  imports?: ImportJob[];
  importTotal?: number;
  lastRefreshAt?: string;
  readOnly?: boolean;
  setup?: SourcesSetupDto;
  sources: SourceStatus[];
  busy: boolean;
  status?: string;
  onCancelImport?: (importJobId: string) => void;
  onEnableTranscriptImport?: (runtime: string) => void;
  onExcludePath: (path: string) => void;
  onImportMetadata?: (runtime: string) => void;
  onImportTranscripts?: (runtime: string) => void;
  onLoadAdapterSources?: (runtime: string, page: { limit: number; offset: number }) => Promise<SourceStatusPage>;
  onPollImports?: () => void;
  onPreviewImport?: (input: SourcesSetupRunInput) => Promise<SourcesImportPreview[]> | SourcesImportPreview[];
  onConnectSelected?: (runtimes: string[]) => void;
  onRefresh: () => void;
  onRepairSources?: () => void;
  onRunSetup?: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
  onScan?: () => void;
  onScanSetup?: () => Promise<SourcesOnboardingScanDto | undefined> | SourcesOnboardingScanDto | undefined | void;
  onRetryImport?: (importJobId: string) => void;
  onSyncAdapter?: (runtime: string) => void;
  onSyncSources?: () => void;
};

export function SourcesPanel(props: Props) {
  const { adapters, busy, imports = [], lastRefreshAt, readOnly = false, setup, sources, status } = props;
  const adapterRows = (setup?.advanced.adapters.length ? setup.advanced.adapters : adapters ?? adaptersFromSources(sources)) as AdapterStatus[];
  const diagnosticImports = (setup ? setup.advanced.imports : imports) as ImportJob[];
  const connectedAdapters = useMemo(() => adapterRows.filter(isConnectedAdapter), [adapterRows]);
  const connectedSources = setup?.connectedSources ?? [];
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const activeImportCount = diagnosticImports.filter((job) => job.status === "queued" || job.status === "running").length;
  const diagnosticCount = diagnosticCountForAdapters(adapterRows) + diagnosticImports.reduce((total, job) => total + (job.failureCount > 0 || job.failureMessage ? 1 : 0), 0);

  useEffect(() => {
    if (activeImportCount === 0 || !props.onPollImports) return undefined;
    const timer = window.setInterval(() => props.onPollImports?.(), 1_500);
    return () => window.clearInterval(timer);
  }, [activeImportCount, props.onPollImports]);

  const hasConnectedSetup = connectedSources.length > 0;
  const hasConnectedAdapters = connectedAdapters.length > 0;
  const showConnectedDashboard = hasConnectedSetup || hasConnectedAdapters;

  return (
    <section id="sources" className="sources-panel sources-management surface-panel" aria-label="Session sources">
      {!showConnectedDashboard ? (
        <SourcesEmptyState
          busy={busy}
          onConnectSources={() => setOnboardingOpen(true)}
          readOnly={readOnly}
          status={status}
        />
      ) : (
        <SourcesConnectedDashboard
          adapters={connectedAdapters}
          busy={busy}
          connectedSources={hasConnectedSetup ? connectedSources : undefined}
          coverage={setup?.coverage}
          diagnosticCount={diagnosticCount}
          imports={diagnosticImports}
          lastRefreshAt={lastRefreshAt ?? setup?.updatedAt}
          onImportHistory={() => setImportOpen(true)}
          onRefreshDetection={props.onRefresh}
          onViewDiagnostics={() => setDiagnosticsOpen((current) => !current)}
          readOnly={readOnly}
          showDiagnostics={diagnosticsOpen}
          status={status}
        />
      )}

      {showConnectedDashboard ? (
        <ImportJobsTable
          busy={busy}
          imports={diagnosticImports}
          onCancelImport={props.onCancelImport}
          onRetryImport={props.onRetryImport}
          total={props.importTotal}
        />
      ) : null}

      {showConnectedDashboard && diagnosticsOpen ? (
        <section className="sources-diagnostics-section" aria-label="Sources diagnostics">
          <div className="source-detail-section-head">
            <div>
              <p className="mono-label">Diagnostics</p>
              <h2>Adapter and import details</h2>
            </div>
          </div>
          {adapterRows.map((adapter) => (
            <SourceDiagnosticPanel
              busy={busy}
              checkedPaths={adapter.checkedPaths}
              diagnostics={adapter.diagnostics}
              key={adapter.runtime}
              runtime={adapter.runtime}
              sources={adapter.sourceLocations}
              state={adapter.state}
            />
          ))}
          {diagnosticImports.some((job) => job.failureMessage || job.currentPath) ? (
            <ul className="source-diagnostic-list source-import-diagnostic-list" aria-label="Import diagnostics">
              {diagnosticImports
                .filter((job) => job.failureMessage || job.currentPath)
                .map((job) => (
                  <li key={job.importJobId}>
                    <span className="source-state">{job.status.replaceAll("_", " ")}</span>
                    <div>
                      <strong>{job.failureMessage ?? `${job.importKind} import ${job.stage ?? job.status}`}</strong>
                      <p>{[job.sourceId, job.currentPath].filter(Boolean).join(" · ")}</p>
                    </div>
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <SourcesOnboardingModal
        adapters={adapterRows}
        busy={busy || readOnly}
        onClose={() => setOnboardingOpen(false)}
        onConnectSelected={props.onConnectSelected}
        onRunSetup={props.onRunSetup}
        onScan={props.onScan ?? props.onRefresh}
        onScanSetup={props.onScanSetup}
        open={onboardingOpen}
        scan={setup?.latestScan}
      />
      <SourcesImportModal
        adapters={adapterRows}
        busy={busy || readOnly}
        onClose={() => setImportOpen(false)}
        onPreviewImport={props.onPreviewImport}
        onRunSetup={props.onRunSetup}
        open={importOpen}
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

function diagnosticCountForAdapters(adapters: AdapterStatus[]): number {
  return adapters.reduce((total, adapter) => {
    const adapterDiagnostics = (adapter.diagnostics ?? []).reduce((count, diagnostic) => count + (diagnostic.count ?? 1), 0);
    const sourceDiagnostics = adapter.sourceLocations.reduce(
      (count, source) => count + (source.diagnostics ?? []).reduce((sourceCount, diagnostic) => sourceCount + (diagnostic.count ?? 1), 0),
      0
    );
    return total + adapterDiagnostics + sourceDiagnostics + (adapter.failureCount ?? 0);
  }, 0);
}
