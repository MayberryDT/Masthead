import { useEffect, useMemo, useState } from "react";
import type {
  AdapterStatus,
  CodexHookSettingsDto,
  ImportJob,
  SourceStatus,
  SourceStatusPage,
  SettingsStateDto,
  UpdateLlmProviderSettingsInput
} from "../app/daemonClient";
import type { SourcesOnboardingScanDto, SourcesSetupDto, SourcesSetupRunInput } from "../shared/sourcesSetup";
import { runtimeLabel } from "./sources/AdapterRow";
import { AdapterList } from "./sources/AdapterList";
import { ImportJobsTable } from "./sources/ImportJobsTable";
import { ImportProgressPanel } from "./sources/ImportProgressPanel";
import { SourcesConnectedDashboard } from "./sources/SourcesConnectedDashboard";
import { SourcesEmptyState } from "./sources/SourcesEmptyState";
import { SourcesImportModal } from "./sources/SourcesImportModal";
import { SourcesOnboardingModal } from "./sources/SourcesOnboardingModal";
import type { SourcesImportPreview } from "../app/daemonClient";
import { SourceDiagnosticPanel } from "./sources/SourceDiagnosticPanel";
import { AppButton } from "./primitives/AppButton";

type HookAction = "install" | "test" | "uninstall";

type Props = {
  adapters?: AdapterStatus[];
  imports?: ImportJob[];
  importFilterRuntime?: string;
  importTotal?: number;
  lastRefreshAt?: string;
  hooks?: CodexHookSettingsDto;
  hookActionBusy?: boolean;
  enrichment?: SettingsStateDto["enrichment"];
  llm?: SettingsStateDto["llm"];
  settingsBaseUrl?: string;
  onboardingOpen?: boolean;
  readOnly?: boolean;
  setup?: SourcesSetupDto;
  sources: SourceStatus[];
  busy: boolean;
  status?: string;
  onCancelImport?: (importJobId: string) => void;
  onCloseOnboarding?: () => void;
  onRuntimeHookAction?: (runtime: string, action: HookAction) => Promise<void> | void;
  onEnableTranscriptImport?: (runtime: string) => void;
  onExcludePath: (path: string) => void;
  onOpenOnboarding?: () => void;
  onImportMetadata?: (runtime: string) => void;
  onImportTranscripts?: (runtime: string) => void;
  onLoadAdapterSources?: (runtime: string, page: { limit: number; offset: number }) => Promise<SourceStatusPage>;
  onClearImportJobsFilter?: () => void;
  onOpenImportJobsForRuntime?: (runtime: string) => void;
  onPollImports?: () => void;
  onPreviewImport?: (input: SourcesSetupRunInput) => Promise<SourcesImportPreview[]> | SourcesImportPreview[];
  onConnectSelected?: (runtimes: string[]) => void;
  onRefresh: () => void;
  onRepairSources?: () => void;
  onRunSetup?: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
  onSaveLlmProvider?: (input: UpdateLlmProviderSettingsInput) => Promise<void> | void;
  onScan?: () => void;
  onScanSetup?: () => Promise<SourcesOnboardingScanDto | undefined> | SourcesOnboardingScanDto | undefined | void;
  onSkipOnboarding?: () => void;
  onRetryImport?: (importJobId: string) => void;
  onSyncAdapter?: (runtime: string) => void;
  onSyncSources?: () => void;
};

export function SourcesPanel(props: Props) {
  const { adapters, busy, imports = [], lastRefreshAt, readOnly = false, setup, sources, status } = props;
  const adapterRows = (setup?.advanced.adapters.length ? setup.advanced.adapters : adapters ?? adaptersFromSources(sources)) as AdapterStatus[];
  const diagnosticImports = imports as ImportJob[];
  const visibleDiagnosticImports = diagnosticImports;
  const activeProgressImports = visibleDiagnosticImports.filter((job) => job.status === "queued" || job.status === "running" || job.status === "cancelling");
  const connectedAdapters = useMemo(() => adapterRows.filter(isConnectedAdapter), [adapterRows]);
  const visibleAdapterRows = useMemo(() => adapterRows.filter(isDetectedOrConnectedAdapter), [adapterRows]);
  const connectedSources = setup?.connectedSources ?? [];
  const connectedSetupSources = useMemo(() => connectedSources.filter(isConnectedSource), [connectedSources]);
  const [localOnboardingOpen, setLocalOnboardingOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const activeImportCount = activeProgressImports.length;
  const diagnosticCount = diagnosticCountForAdapters(visibleAdapterRows) + visibleDiagnosticImports.reduce((total, job) => total + (job.failureCount > 0 || job.failureMessage ? 1 : 0), 0);

  useEffect(() => {
    if (activeImportCount === 0 || !props.onPollImports) return undefined;
    const timer = window.setInterval(() => props.onPollImports?.(), 1_500);
    return () => window.clearInterval(timer);
  }, [activeImportCount, props.onPollImports]);

  const hasConnectedSetup = connectedSetupSources.length > 0;
  const hasConnectedAdapters = connectedAdapters.length > 0;
  const hasImportActivity = visibleDiagnosticImports.length > 0;
  const showConnectedDashboard = hasConnectedSetup || hasConnectedAdapters || hasImportActivity;
  const showAdapterInventory = showConnectedDashboard && visibleAdapterRows.length > 0 && !hasConnectedSetup;
  const onboardingOpen = props.onboardingOpen ?? localOnboardingOpen;
  const closeOnboarding = () => {
    props.onCloseOnboarding?.();
    setLocalOnboardingOpen(false);
  };
  const openOnboarding = () => {
    props.onOpenOnboarding?.();
    setLocalOnboardingOpen(true);
  };

  return (
    <section id="sources" className="sources-panel sources-management surface-panel" aria-label="Session sources">
      {!showConnectedDashboard ? (
        <SourcesEmptyState
          busy={busy}
          onConnectSources={openOnboarding}
          readOnly={readOnly}
          status={status}
        />
      ) : (
        <SourcesConnectedDashboard
          adapters={connectedAdapters}
          busy={busy}
          connectedSources={hasConnectedSetup ? connectedSetupSources : undefined}
          coverage={setup?.coverage}
          diagnosticCount={diagnosticCount}
          imports={visibleDiagnosticImports}
          lastRefreshAt={lastRefreshAt ?? setup?.updatedAt}
          onImportHistory={() => setImportOpen(true)}
          onRefreshDetection={props.onRefresh}
          onViewDiagnostics={() => setDiagnosticsOpen((current) => !current)}
          readOnly={readOnly}
          showDiagnostics={diagnosticsOpen}
          status={status}
        />
      )}

      {showAdapterInventory ? (
        <AdapterList
          adapters={visibleAdapterRows}
          busy={busy || readOnly}
          enrichment={props.enrichment}
          hooks={props.hooks}
          hookActionBusy={props.hookActionBusy}
          llm={props.llm}
          onRuntimeHookAction={props.onRuntimeHookAction}
          onEnableTranscriptImport={props.onEnableTranscriptImport}
          onExcludePath={props.onExcludePath}
          onImportMetadata={props.onImportMetadata}
          onImportTranscripts={props.onImportTranscripts}
          onLoadAdapterSources={props.onLoadAdapterSources}
          onOpenImportJobsForRuntime={props.onOpenImportJobsForRuntime}
          onSaveLlmProvider={props.onSaveLlmProvider}
          onSyncAdapter={props.onSyncAdapter}
          settingsBaseUrl={props.settingsBaseUrl}
        />
      ) : null}

      {showConnectedDashboard ? (
        <>
          {props.importFilterRuntime ? (
            <section className="sources-import-filter" aria-label="Import activity filter">
              <p>Import activity — {runtimeLabel(props.importFilterRuntime)} only</p>
              <AppButton variant="quiet" disabled={busy || readOnly || !props.onClearImportJobsFilter} onClick={props.onClearImportJobsFilter}>
                Clear import filter
              </AppButton>
            </section>
          ) : null}
          {activeProgressImports.length > 0 ? (
            <section className="sources-active-imports" aria-label="Active import progress">
              {activeProgressImports.map((job) => <ImportProgressPanel key={job.importJobId} job={job} />)}
            </section>
          ) : null}
          <ImportJobsTable
            busy={busy}
            imports={visibleDiagnosticImports}
            onCancelImport={props.onCancelImport}
            onRetryImport={props.onRetryImport}
            total={props.importTotal}
          />
        </>
      ) : null}

      {showConnectedDashboard && diagnosticsOpen ? (
        <section className="sources-diagnostics-section" aria-label="Sources diagnostics">
          <div className="source-detail-section-head">
            <div>
              <p className="mono-label">Diagnostics</p>
              <h2>Adapter and import details</h2>
            </div>
          </div>
          {visibleAdapterRows.map((adapter) => (
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
          {visibleDiagnosticImports.some((job) => job.failureMessage || job.currentPath) ? (
            <ul className="source-diagnostic-list source-import-diagnostic-list" aria-label="Import diagnostics">
              {visibleDiagnosticImports
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
        hooks={props.hooks}
        llm={props.llm}
        enrichment={props.enrichment}
        onClose={closeOnboarding}
        onRuntimeHookAction={props.onRuntimeHookAction}
        onConnectSelected={props.onConnectSelected}
        onRunSetup={props.onRunSetup}
        onSaveLlmProvider={props.onSaveLlmProvider}
        onScan={props.onScan ?? props.onRefresh}
        onScanSetup={props.onScanSetup}
        onSkip={props.onSkipOnboarding}
        open={onboardingOpen}
        scan={setup?.latestScan ?? setup?.scan}
        settingsBaseUrl={props.settingsBaseUrl}
        variant={props.onboardingOpen === undefined ? "modal" : "fullWindow"}
      />
      <SourcesImportModal
        adapters={visibleAdapterRows}
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

function isDetectedOrConnectedAdapter(adapter: AdapterStatus): boolean {
  if (isConnectedAdapter(adapter)) return true;
  if ((adapter.sourceLocationCount ?? adapter.sourceLocations.length) > 0) return true;
  if ((adapter.discoveredSessions ?? 0) > 0 || (adapter.discoveredCount ?? 0) > 0) return true;
  return adapter.state !== "not_detected" && adapter.state !== "planned";
}

function isConnectedSource(source: { importedSessions?: number; importedRecords?: number; importedCount?: number; lastSync?: string; lastSyncAt?: string; metadataSessions?: number; queuedCount?: number; queuedRecords?: number; transcriptSessions?: number; enrichedSessions?: number }): boolean {
  return (
    (source.importedSessions ?? 0) > 0 ||
    (source.importedRecords ?? source.importedCount ?? 0) > 0 ||
    (source.metadataSessions ?? 0) > 0 ||
    (source.transcriptSessions ?? 0) > 0 ||
    (source.enrichedSessions ?? 0) > 0 ||
    (source.queuedRecords ?? source.queuedCount ?? 0) > 0 ||
    Boolean(source.lastSyncAt ?? source.lastSync)
  );
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
