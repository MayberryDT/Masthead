import { useEffect, useMemo, useState } from "react";
import type { AdapterStatus, CodexHookSettingsDto, SettingsStateDto, UpdateLlmProviderSettingsInput } from "../../app/daemonClient";
import { runSourcesSetupPlan, type SetupRunLogEntry, type SetupRunReport } from "../../app/sources/setupPlanRunner";
import { onboardingHarnesses } from "../../adapters/harnessCatalog";
import type { FoundSourceDto, SourcesOnboardingScanDto, SourcesSetupRunInput } from "../../shared/sourcesSetup";
import { AppButton } from "../primitives/AppButton";
import { LlmProviderControls } from "../settings/LlmProviderControls";
import { HarnessSetupControls } from "./HarnessSetupControls";
import { SetupRunProgress } from "./SetupRunProgress";

type Props = {
  adapters: AdapterStatus[];
  busy?: boolean;
  enrichment?: SettingsStateDto["enrichment"];
  hooks?: CodexHookSettingsDto;
  llm?: SettingsStateDto["llm"];
  open: boolean;
  settingsBaseUrl?: string;
  variant?: "modal" | "fullWindow";
  onClose: () => void;
  onCodexHookAction?: (action: "install" | "test" | "uninstall") => Promise<void> | void;
  onConnectSelected?: (runtimes: string[]) => void;
  onSaveLlmProvider?: (input: UpdateLlmProviderSettingsInput) => Promise<void> | void;
  onScan?: () => void;
  onScanSetup?: () => Promise<SourcesOnboardingScanDto | undefined> | SourcesOnboardingScanDto | undefined | void;
  onSkip?: () => void;
  onRunSetup?: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
  scan?: SourcesOnboardingScanDto;
};

type Step = "intro" | "found" | "history" | "enrichment" | "build" | "success";
type EnrichmentMode = SourcesSetupRunInput["enrichmentMode"];

export function SourcesOnboardingModal({
  adapters,
  busy = false,
  enrichment,
  hooks,
  llm,
  onClose,
  onCodexHookAction,
  onConnectSelected,
  onRunSetup,
  onSaveLlmProvider,
  onScan,
  onScanSetup,
  onSkip,
  open,
  scan,
  settingsBaseUrl,
  variant = "modal"
}: Props) {
  const [step, setStep] = useState<Step>("intro");
  const [localScan, setLocalScan] = useState<SourcesOnboardingScanDto | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [importMetadata, setImportMetadata] = useState(true);
  const [liveCaptureEnabled, setLiveCaptureEnabled] = useState(true);
  const [enrichmentMode] = useState<EnrichmentMode>("skip");
  const [setupLogs, setSetupLogs] = useState<SetupRunLogEntry[]>([]);
  const [setupReport, setSetupReport] = useState<SetupRunReport>();
  const foundAdapters = useMemo(() => adapters.filter(isFoundAdapter), [adapters]);
  const setupScan = localScan ?? scan;
  const importableSources = useMemo(() => (setupScan?.foundSources ?? []).filter(isImportableSource), [setupScan]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedIds = Array.from(selected);
  const selectedSources = importableSources.filter((source) => selected.has(source.sourceId));
  const selectedRuntimes = setupScan ? selectedSources.map((source) => source.runtime) : selectedIds;
  const usesSetupScan = Boolean(setupScan);
  const harnesses = onboardingHarnesses();

  useEffect(() => {
    if (!open || !scan) return;
    const importable = scan.foundSources.filter(isImportableSource);
    if (importable.length === 0) return;
    setLocalScan(scan);
    setSelected(new Set(importable.map((source) => source.sourceId)));
    if (step === "intro") setStep("found");
  }, [open, scan, step]);

  if (!open) return null;

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleScan = async () => {
    const result = await onScanSetup?.();
    if (result) {
      setLocalScan(result);
      setSelected(new Set(result.foundSources.filter(isImportableSource).map((source) => source.sourceId)));
    } else if (scan) {
      setSelected(new Set(scan.foundSources.filter(isImportableSource).map((source) => source.sourceId)));
    } else {
      onScan?.();
      if (foundAdapters.length > 0) setSelected(new Set(foundAdapters.map((adapter) => adapter.runtime)));
    }
    setStep("found");
  };

  const handleBuild = async () => {
    setSetupLogs([]);
    setSetupReport(undefined);
    if (usesSetupScan && onRunSetup) {
      setRunning(true);
      try {
        const report = await runSourcesSetupPlan({
          enrichmentMode,
          importMetadata,
          importTranscripts: false,
          liveCapture:
            liveCaptureEnabled && selectedSources.some((source) => source.runtime === "codex")
              ? [{ action: "install", runtime: "codex" }]
              : [],
          queueEnrichment: false,
          sourceIds: selectedSources.map((source) => source.sourceId),
          transcriptApprovals: selectedSources.map((source) => ({
            approved: false,
            runtime: source.runtime,
            sourceId: source.sourceId
          }))
        }, {
          onLog: (entry) => setSetupLogs((current) => [...current, entry]),
          runHookAction: async (action) => {
            if (!onCodexHookAction) return;
            await onCodexHookAction(action);
          },
          runSetup: onRunSetup
        });
        setSetupReport(report);
        setStep("success");
      } finally {
        setRunning(false);
      }
      return;
    }
    onConnectSelected?.(selectedRuntimes);
    setStep("success");
  };

  const backdropClass = variant === "fullWindow" ? "sources-onboarding-full-window" : "modal-backdrop";
  const modalClass = variant === "fullWindow" ? "session-detail-modal sources-onboarding-modal sources-onboarding-modal-full" : "session-detail-modal sources-onboarding-modal";

  return (
    <div className={backdropClass} role="presentation">
      <section className={modalClass} role="dialog" aria-modal="true" aria-label="Set up sources">
        <header className="session-detail-header">
          <div>
            <p className="mono-label">Sources setup</p>
            <h2>Set up sources</h2>
          </div>
          <div className="surface-actions">
            {onSkip ? <AppButton type="button" variant="quiet" onClick={onSkip}>Skip setup</AppButton> : null}
            {variant === "modal" ? <AppButton type="button" variant="quiet" onClick={onClose}>Close</AppButton> : null}
          </div>
        </header>

        {step === "intro" ? (
          <div className="session-detail-body">
            <p>
              Live capture can start without importing old sessions. Masthead checks known local history locations only when you ask it to.
            </p>
            <div className="surface-actions">
              <AppButton type="button" variant="primary" onClick={handleScan} disabled={busy}>Check local sources</AppButton>
            </div>
            {!onScanSetup ? (
              <details className="advanced-diagnostics-preview">
                <summary>Harnesses Masthead knows how to check</summary>
                <div className="source-adapter-grid">
                  {harnesses.slice(0, 12).map((harness) => (
                    <article className="adapter-card" key={harness.runtime}>
                      <p className="mono-label">{harness.supportLevel.replaceAll("_", " ")}</p>
                      <h3>{harness.label}</h3>
                      <p>{harness.description}</p>
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {step === "found" ? (
          <div className="session-detail-body">
            <p className="surface-status">Select the sources Masthead should connect. Unrecognized schemas stay out of the connected inventory until their import shape is verified.</p>
            {usesSetupScan ? (
              importableSources.length > 0 ? (
                <div className="source-adapter-grid">
                  {importableSources.map((source) => (
                    <label className="adapter-card source-select-card" key={source.sourceId}>
                      <span className="adapter-card-head">
                        <span>
                          <span className="mono-label">{source.runtime}</span>
                          <strong>{source.label ?? source.runtime}</strong>
                        </span>
                        <input type="checkbox" checked={selected.has(source.sourceId)} onChange={(event) => toggle(source.sourceId, event.currentTarget.checked)} />
                      </span>
                      <span>{source.discoveredSessions ?? source.sessions ?? 0} sessions</span>
                      {source.path ? <span className="surface-status">{source.path}</span> : null}
                    </label>
                  ))}
                </div>
              ) : (
                <ScanEmptyState />
              )
            ) : foundAdapters.length > 0 ? (
              <div className="source-adapter-grid">
                {foundAdapters.map((adapter) => (
                  <label className="adapter-card source-select-card" key={adapter.runtime}>
                    <span className="adapter-card-head">
                      <span>
                        <span className="mono-label">{adapter.runtime}</span>
                        <strong>{adapter.name ?? adapter.runtime}</strong>
                      </span>
                      <input type="checkbox" checked={selected.has(adapter.runtime)} onChange={(event) => toggle(adapter.runtime, event.currentTarget.checked)} />
                    </span>
                    <span>{adapter.importedSessions || adapter.discoveredSessions || 0} sessions</span>
                  </label>
                ))}
              </div>
            ) : (
              <ScanEmptyState />
            )}
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("intro")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={() => setStep("history")} disabled={selectedIds.length === 0}>Continue</AppButton>
            </div>
          </div>
        ) : null}

        {step === "history" ? (
          <div className="session-detail-body">
            <h3>Setup choices</h3>
            <HarnessSetupControls
              hooks={hooks}
              importMetadata={importMetadata}
              liveCaptureEnabled={liveCaptureEnabled}
              selectedSources={selectedSources}
              onImportMetadataChange={setImportMetadata}
              onLiveCaptureEnabledChange={setLiveCaptureEnabled}
            />
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("found")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={() => setStep("enrichment")}>Continue</AppButton>
            </div>
          </div>
        ) : null}

        {step === "enrichment" ? (
          <div className="session-detail-body">
            <h3>Enrichment</h3>
            <p className="surface-status">Configure provider settings now if you want. Setup will not queue enrichment across the whole library.</p>
            <LlmProviderControls
              enrichment={enrichment}
              llm={llm}
              onSaveProvider={onSaveLlmProvider}
              readOnly={busy || !onSaveLlmProvider}
              settingsBaseUrl={settingsBaseUrl}
            />
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("history")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={() => setStep("build")}>Continue</AppButton>
            </div>
          </div>
        ) : null}

        {step === "build" ? (
          <div className="session-detail-body">
            <h3>Review setup</h3>
            <p>Masthead will apply live capture choices and import selected metadata. Transcripts and enrichment run when Dossiers are opened.</p>
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("enrichment")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={handleBuild} disabled={busy || running || selectedIds.length === 0}>
                {running ? "Starting setup..." : "Start setup"}
              </AppButton>
            </div>
            {setupLogs.length > 0 ? <SetupRunProgress logs={setupLogs} report={setupReport} /> : null}
          </div>
        ) : null}

        {step === "success" ? (
          <div className="session-detail-body">
            <h3>{setupReport?.status === "needs_attention" ? "Setup needs attention" : "Session library build started"}</h3>
            <p>Sources are connected where setup succeeded. Import jobs and any skipped work remain visible in the Sources inventory.</p>
            <SetupRunProgress logs={setupLogs} report={setupReport} />
            <div className="surface-actions">
              <AppButton type="button" variant="primary" onClick={onClose}>Done</AppButton>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ScanEmptyState() {
  return (
    <div className="empty-session-state">
      <p className="mono-label">Scan complete</p>
      <h3>No importable local sources found yet</h3>
      <p>Checked locations and detector-only harnesses stay out of the connected inventory until Masthead can import them.</p>
    </div>
  );
}

function isImportableSource(source: FoundSourceDto): boolean {
  return source.importable === true || source.state === "importable";
}

function isFoundAdapter(adapter: AdapterStatus): boolean {
  return adapter.state === "connected" || adapter.state === "degraded" || adapter.discoveredSessions > 0 || adapter.importedSessions > 0 || adapter.sourceLocations.length > 0;
}
