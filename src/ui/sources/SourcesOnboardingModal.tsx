import { useEffect, useMemo, useState } from "react";
import type { AdapterStatus, CodexHookSettingsDto, SettingsStateDto, UpdateLlmProviderSettingsInput } from "../../app/daemonClient";
import { runSourcesSetupPlan, type SetupRunLogEntry } from "../../app/sources/setupPlanRunner";
import { onboardingHarnesses, type HarnessCatalogEntry } from "../../adapters/harnessCatalog";
import type { ImportScopeDto } from "../../shared/sourceImport";
import type { FoundSourceDto, SourcesOnboardingScanDto, SourcesSetupRunInput } from "../../shared/sourcesSetup";
import { AppButton } from "../primitives/AppButton";
import { LlmProviderControls } from "../settings/LlmProviderControls";
import { HarnessSetupControls, type HistoryImportScopeChoice } from "./HarnessSetupControls";
import { SetupRunProgress } from "./SetupRunProgress";

type HookAction = "install" | "test" | "uninstall";

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
  onRuntimeHookAction?: (runtime: string, action: HookAction) => Promise<void> | void;
  onConnectSelected?: (runtimes: string[]) => void;
  onSaveLlmProvider?: (input: UpdateLlmProviderSettingsInput) => Promise<void> | void;
  onScan?: () => void;
  onScanSetup?: () => Promise<SourcesOnboardingScanDto | undefined> | SourcesOnboardingScanDto | undefined | void;
  onSkip?: () => void;
  onRunSetup?: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
  scan?: SourcesOnboardingScanDto;
};

type Step = "intro" | "found" | "history" | "enrichment" | "build";
type EnrichmentMode = SourcesSetupRunInput["enrichmentMode"];
type HarnessSourceGroup = {
  label: string;
  paths: string[];
  runtime: string;
  sessionCount: number;
  sourceIds: string[];
};

const commandSpineSteps: Array<{ id: Step; label: string; description: string }> = [
  { id: "intro", label: "Start", description: "Local setup scope and scan action." },
  { id: "found", label: "Detect", description: "Detected harnesses selected by default." },
  { id: "history", label: "Configure", description: "History source and range." },
  { id: "enrichment", label: "Provider", description: "Optional key and model setup." },
  { id: "build", label: "Apply", description: "Logs continue after failures." }
];

export function SourcesOnboardingModal({
  adapters,
  busy = false,
  enrichment,
  llm,
  onClose,
  onRuntimeHookAction,
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
  const [historyImportScope, setHistoryImportScope] = useState<HistoryImportScopeChoice>("recent");
  const [enrichmentMode] = useState<EnrichmentMode>("skip");
  const [setupLogs, setSetupLogs] = useState<SetupRunLogEntry[]>([]);
  const foundAdapters = useMemo(() => adapters.filter(isFoundAdapter), [adapters]);
  const setupScan = localScan ?? scan;
  const importableSources = useMemo(() => (setupScan?.foundSources ?? []).filter(isImportableSource), [setupScan]);
  const fallbackHistorySources = useMemo(() => foundAdapters.map(adapterToHistorySource), [foundAdapters]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedIds = Array.from(selected);
  const selectedSources = importableSources.filter((source) => selected.has(source.sourceId));
  const selectedRuntimes = setupScan ? selectedSources.map((source) => source.runtime) : selectedIds;
  const selectedRuntimeNames = Array.from(new Set(selectedRuntimes));
  const usesSetupScan = Boolean(setupScan);
  const harnesses = useMemo(() => onboardingHarnesses(), []);
  const importableHarnessGroups = useMemo(() => groupImportableSourcesByRuntime(importableSources, harnesses), [harnesses, importableSources]);

  useEffect(() => {
    if (!open || !scan) return;
    const importable = scan.foundSources.filter(isImportableSource);
    if (importable.length === 0) return;
    setLocalScan(scan);
    setSelected(new Set(importable.map((source) => source.sourceId)));
    if (step === "intro") setStep("found");
  }, [open, scan, step]);

  useEffect(() => {
    if (open) return;
    setStep("intro");
    setLocalScan(undefined);
    setRunning(false);
    setHistoryImportScope("recent");
    setSetupLogs([]);
    setSelected(new Set());
  }, [open]);

  if (!open) return null;

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleHarnessGroup = (sourceIds: string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const sourceId of sourceIds) {
        if (checked) next.add(sourceId);
        else next.delete(sourceId);
      }
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
    if (usesSetupScan && onRunSetup) {
      setRunning(true);
      let setupApplied = false;
      try {
        await runSourcesSetupPlan({
          enrichmentMode,
          importMetadata: true,
          importScope: scopeForHistoryChoice(historyImportScope),
          liveCapture: selectedRuntimeNames.map((runtime) => ({ action: "install", runtime })),
          queueEnrichment: false,
          runtimes: selectedRuntimeNames,
          sourceIds: selectedSources.map((source) => source.sourceId)
        }, {
          onLog: (entry) => setSetupLogs((current) => [...current, entry]),
          runHookAction: async (runtime, action) => {
            if (!onRuntimeHookAction) return;
            await onRuntimeHookAction(runtime, action);
          },
          runSetup: onRunSetup
        });
        setupApplied = true;
      } finally {
        setRunning(false);
      }
      if (setupApplied) onClose();
      return;
    }
    onConnectSelected?.(selectedRuntimes);
    onClose();
  };

  const backdropClass = variant === "fullWindow" ? "sources-onboarding-full-window" : "modal-backdrop";
  const modalClass = variant === "fullWindow" ? "session-detail-modal sources-onboarding-modal sources-onboarding-modal-full" : "session-detail-modal sources-onboarding-modal";
  const activeSpineStep = step;
  const selectedSourceCount = usesSetupScan ? selectedSources.length : selectedRuntimes.length;
  const selectedSourceLabel = selectedSourceCount > 0 ? `${selectedSourceCount} selected` : "None selected";
  const historyRangeLabel = historyImportScope === "full" ? "Everything" : "Last 30 days";
  const liveCaptureLabel = selectedRuntimeNames.length > 0 ? "Required" : "No harnesses selected";
  const providerLabel = llm?.providers.find((provider) => provider.id === llm.activeProvider)?.label ?? enrichment?.provider ?? "Optional";

  const stepBody = (
    <>
      {step === "intro" ? (
        <div className="sources-onboarding-step-content">
          <div className="sources-onboarding-stage-hero">
            <p className="mono-label">Screen 01 / start</p>
            <h3>Set up Masthead sources on this machine.</h3>
            <p>
              Live capture can start without importing old sessions. Masthead checks known local history locations only when you ask it to.
            </p>
            <div className="surface-actions">
              <AppButton type="button" variant="primary" onClick={handleScan} disabled={busy}>Check local sources</AppButton>
            </div>
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
        <div className="sources-onboarding-step-content">
          <p className="surface-status">Select the sources Masthead should connect. Unrecognized schemas stay out of the connected inventory until their import shape is verified.</p>
          {usesSetupScan ? (
            importableSources.length > 0 ? (
              <div className="source-adapter-grid">
                {importableHarnessGroups.map((group) => (
                  <label className="adapter-card source-select-card" key={group.runtime}>
                    <span className="adapter-card-head">
                      <span>
                        <strong>{group.label}</strong>
                      </span>
                      <input
                        type="checkbox"
                        checked={group.sourceIds.every((sourceId) => selected.has(sourceId))}
                        onChange={(event) => toggleHarnessGroup(group.sourceIds, event.currentTarget.checked)}
                      />
                    </span>
                    <span>{group.sessionCount} sessions across {formatLocationCount(group.paths.length)}</span>
                    {group.paths[0] ? <span className="surface-status source-card-path">{formatSourceHomePath(group.paths[0])}</span> : null}
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
        <div className="sources-onboarding-step-content">
          <h3>Setup choices</h3>
          <HarnessSetupControls
            availableSources={usesSetupScan ? importableSources : fallbackHistorySources}
            importScope={historyImportScope}
            selectedSourceIds={selected}
            onImportScopeChange={setHistoryImportScope}
            onToggleSourceGroup={toggleHarnessGroup}
          />
          <div className="surface-actions">
            <AppButton type="button" onClick={() => setStep("found")}>Back</AppButton>
            <AppButton type="button" variant="primary" onClick={() => setStep("enrichment")}>Continue</AppButton>
          </div>
        </div>
      ) : null}

      {step === "enrichment" ? (
        <div className="sources-onboarding-step-content">
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
        <div className="sources-onboarding-step-content">
          <h3>Review setup</h3>
          <p>Masthead will import selected session history, apply required live capture setup, then continue progress in Sources.</p>
          <div className="sources-onboarding-build-review">
            <p className="mono-label">Review before start</p>
            <dl className="harness-overview-proof">
              <div><dt>Sources</dt><dd>{selectedSourceLabel}</dd></div>
              <div><dt>History</dt><dd>{historyRangeLabel}</dd></div>
              <div><dt>Live capture</dt><dd>{liveCaptureLabel}</dd></div>
              <div><dt>Transcripts</dt><dd>When opened</dd></div>
              <div><dt>Enrichment</dt><dd>{providerLabel}</dd></div>
            </dl>
            <ul className="sources-onboarding-review-notes">
              <li>Detected importable harnesses are selected by default.</li>
              <li>Setup imports searchable history first and never bulk-imports transcripts.</li>
              <li>Provider settings match Settings and can be changed later.</li>
            </ul>
          </div>
          <div className="surface-actions">
            <AppButton type="button" onClick={() => setStep("enrichment")}>Back</AppButton>
            <AppButton type="button" variant="primary" onClick={handleBuild} disabled={busy || running || selectedIds.length === 0}>
              {running ? "Starting setup..." : "Start setup"}
            </AppButton>
          </div>
          {setupLogs.length > 0 ? <SetupRunProgress logs={setupLogs} /> : null}
        </div>
      ) : null}
    </>
  );

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

        {variant === "fullWindow" ? (
          <div className="session-detail-body sources-onboarding-command-layout">
            <aside className="sources-onboarding-step-rail" aria-label="Onboarding steps">
              <ol className="sources-onboarding-step-list">
                {commandSpineSteps.map((item, index) => (
                  <li className={`sources-onboarding-step-item ${activeSpineStep === item.id ? "is-active" : ""}`} key={item.id}>
                    <span className="sources-onboarding-step-number">{String(index + 1).padStart(2, "0")}</span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </aside>
            <section className="sources-onboarding-workspace" aria-live="polite">
              {stepBody}
            </section>
          </div>
        ) : (
          <div className="session-detail-body">
            {stepBody}
          </div>
        )}
      </section>
    </div>
  );
}

function groupImportableSourcesByRuntime(sources: FoundSourceDto[], harnesses: HarnessCatalogEntry[]): HarnessSourceGroup[] {
  const harnessLabels = new Map<string, string>(harnesses.map((harness) => [harness.runtime, harness.label]));
  const groups = new Map<string, HarnessSourceGroup>();

  for (const source of sources) {
    const existing = groups.get(source.runtime);
    const group = existing ?? {
      label: harnessLabels.get(source.runtime) ?? source.label ?? source.runtime,
      paths: [],
      runtime: source.runtime,
      sessionCount: 0,
      sourceIds: []
    };

    group.sourceIds.push(source.sourceId);
    group.sessionCount += source.discoveredSessions ?? source.sessions ?? 0;
    if (source.path && !group.paths.includes(source.path)) group.paths.push(source.path);
    groups.set(source.runtime, group);
  }

  return Array.from(groups.values());
}

function formatLocationCount(count: number): string {
  return `${count} ${count === 1 ? "location" : "locations"}`;
}

function formatSourceHomePath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);

  if (segments[0] === "home" && segments[1]) {
    if (segments[2] === ".config" && segments[3]) return `/${segments.slice(0, 4).join("/")}`;
    if (segments[2] === ".local" && segments[3] === "share" && segments[4]) return `/${segments.slice(0, 5).join("/")}`;
    if (segments[2]?.startsWith(".")) return `/${segments.slice(0, 3).join("/")}`;
  }

  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized;
}

function adapterToHistorySource(adapter: AdapterStatus): FoundSourceDto {
  return {
    discoveredSessions: adapter.discoveredSessions || adapter.importedSessions || 0,
    importable: true,
    label: adapter.name ?? adapter.runtime,
    runtime: adapter.runtime,
    sourceId: adapter.runtime
  };
}

function scopeForHistoryChoice(choice: HistoryImportScopeChoice): ImportScopeDto {
  return choice === "full"
    ? { includeChangedSinceCursor: true, mode: "transcript_full" }
    : { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 };
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
