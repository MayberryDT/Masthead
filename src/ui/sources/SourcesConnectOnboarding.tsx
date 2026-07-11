import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportJob } from "../../app/daemonClient";
import type { HarnessConnectorDto, HarnessConnectorsSnapshotDto } from "../../shared/harnessConnectors";
import type { SourcesSetupRunInput } from "../../shared/sourcesSetup";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge } from "../primitives/StatusBadge";
import { liveLabel, liveTone, presenceLabel, presenceTone } from "./HarnessConnectorRow";

export type SourcesConnectOnboardingProps = {
  open: boolean;
  snapshot?: HarnessConnectorsSnapshotDto;
  busy?: boolean;
  onClose: () => void;
  onSkip: () => void;
  onDiscover: () => Promise<void> | void;
  onEnable: (runtime: string) => Promise<void> | void;
  onConfirmActivation?: (runtime: string) => Promise<void> | void;
  imports?: ImportJob[];
  onImportHistory?: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
  onPollImports?: () => Promise<void> | void;
  onRetryImport?: (importJobId: string) => Promise<void> | void;
};

type Step = "intro" | "select" | "enable" | "activate" | "history" | "progress" | "done";
type Stage = "discover" | "connect" | "history" | "reconcile" | "ready";
type HistoryChoice = "everything" | "recent";

const stepRail: Array<{ id: Stage; label: string; description: string }> = [
  { id: "discover", label: "Discover", description: "Find harnesses and local history." },
  { id: "connect", label: "Connect", description: "Enable live capture where selected." },
  { id: "history", label: "Import history", description: "Choose Everything or a bounded range." },
  { id: "reconcile", label: "Reconcile", description: "Account for every discovered unit." },
  { id: "ready", label: "Ready", description: "Open the hydrated Workbench." }
];

export function SourcesConnectOnboarding({
  open,
  snapshot,
  busy = false,
  onClose,
  onSkip,
  onDiscover,
  onEnable,
  onConfirmActivation,
  imports = [],
  onImportHistory,
  onPollImports,
  onRetryImport
}: SourcesConnectOnboardingProps) {
  const [step, setStep] = useState<Step>("intro");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [discoverStarted, setDiscoverStarted] = useState(false);
  const [enableRunning, setEnableRunning] = useState(false);
  const [enabledRuntimes, setEnabledRuntimes] = useState<string[]>([]);
  const [historyChoice, setHistoryChoice] = useState<HistoryChoice>("everything");
  const [importRunning, setImportRunning] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [startedJobs, setStartedJobs] = useState<ImportJob[]>([]);
  const [startedJobIds, setStartedJobIds] = useState<Set<string>>(() => new Set());
  const discoverOnceRef = useRef(false);
  const seededSelectionRef = useRef(false);

  const foundConnectors = useMemo(
    () => (snapshot?.connectors ?? []).filter((connector) => connector.presence === "found"),
    [snapshot]
  );
  const selectedConnectors = useMemo(
    () => foundConnectors.filter((connector) => selected.has(connector.runtime)),
    [foundConnectors, selected]
  );
  const needsActionConnectors = useMemo(
    () =>
      (snapshot?.connectors ?? []).filter(
        (connector) => selected.has(connector.runtime) && connector.live === "needs_action"
      ),
    [selected, snapshot]
  );
  const readyAmongSelected = useMemo(
    () =>
      (snapshot?.connectors ?? []).filter(
        (connector) => selected.has(connector.runtime) && connector.live === "ready"
      ),
    [selected, snapshot]
  );
  const activeStage = stageForStep(step);
  const trackedJobs = useMemo(() => {
    const byId = new Map<string, ImportJob>();
    for (const job of startedJobs) byId.set(job.importJobId, job);
    for (const job of imports) {
      if (startedJobIds.size === 0 || startedJobIds.has(job.importJobId)) byId.set(job.importJobId, job);
    }
    return Array.from(byId.values());
  }, [imports, startedJobIds, startedJobs]);
  const activeJobs = trackedJobs.filter((job) => isActiveImport(job.status));
  const reconciliationComplete =
    trackedJobs.length > 0 && trackedJobs.every((job) => !isActiveImport(job.status));

  useEffect(() => {
    if (!open) {
      setStep("intro");
      setSelected(new Set());
      setDiscoverStarted(false);
      setEnableRunning(false);
      setEnabledRuntimes([]);
      setHistoryChoice("everything");
      setImportRunning(false);
      setImportError(undefined);
      setStartedJobs([]);
      setStartedJobIds(new Set());
      discoverOnceRef.current = false;
      seededSelectionRef.current = false;
      return;
    }

    if (discoverOnceRef.current) return;
    discoverOnceRef.current = true;
    setDiscoverStarted(true);
    void Promise.resolve(onDiscover()).finally(() => {
      setDiscoverStarted(false);
    });
  }, [open, onDiscover]);

  useEffect(() => {
    if (!open || seededSelectionRef.current) return;
    if (foundConnectors.length === 0) return;
    setSelected(new Set(foundConnectors.map((connector) => connector.runtime)));
    seededSelectionRef.current = true;
  }, [foundConnectors, open]);

  useEffect(() => {
    if (!open || startedJobIds.size > 0) return;
    const resumable = imports.filter(
      (job) =>
        job.importKind === "transcript" &&
        (isActiveImport(job.status) || job.scope?.mode === "transcript_full" || job.scope?.mode === "transcript_recent")
    );
    if (resumable.length === 0) return;
    setStartedJobs(resumable);
    setStartedJobIds(new Set(resumable.map((job) => job.importJobId)));
    setStep("progress");
  }, [imports, open, startedJobIds.size]);

  useEffect(() => {
    if (!open || step !== "progress" || activeJobs.length === 0 || !onPollImports) return undefined;
    const timer = window.setInterval(() => void onPollImports(), 1_500);
    return () => window.clearInterval(timer);
  }, [activeJobs.length, onPollImports, open, step]);

  if (!open) return null;

  const toggle = (runtime: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(runtime);
      else next.delete(runtime);
      return next;
    });
  };

  const handleEnableSelected = async () => {
    const targets = selectedConnectors.filter((connector) => connector.live !== "ready");
    setEnableRunning(true);
    const completed: string[] = [];
    try {
      for (const target of targets) {
        await onEnable(target.runtime);
        completed.push(target.runtime);
      }
      setEnabledRuntimes((current) => Array.from(new Set([...current, ...completed, ...readyAmongSelected.map((c) => c.runtime)])));
    } finally {
      setEnableRunning(false);
    }
    // Land on activate so the checklist reflects post-enable snapshot (empty checklist can Continue).
    setStep("activate");
  };

  const handleRediscover = async () => {
    setDiscoverStarted(true);
    try {
      await onDiscover();
    } finally {
      setDiscoverStarted(false);
    }
  };

  const handleImportHistory = async () => {
    if (!onImportHistory) return;
    setImportRunning(true);
    setImportError(undefined);
    try {
      const result = await onImportHistory({
        importMetadata: true,
        importScope:
          historyChoice === "everything"
            ? { includeChangedSinceCursor: true, mode: "transcript_full" }
            : { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
        queueEnrichment: false,
        runtimes: selectedConnectors.map((connector) => connector.runtime)
      });
      const jobs = importJobsFromResult(result);
      if (jobs.length === 0) throw new Error("No history import jobs were created for the selected harnesses.");
      setStartedJobs(jobs);
      setStartedJobIds(new Set(jobs.map((job) => job.importJobId)));
      setStep("progress");
      void onPollImports?.();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportRunning(false);
    }
  };

  const handleImportRemaining = async (job: ImportJob) => {
    if (!onImportHistory) return;
    const runtime = job.completionReport?.runtime;
    if (!runtime) {
      setImportError("The completed import did not report its runtime.");
      return;
    }
    setImportRunning(true);
    setImportError(undefined);
    try {
      const result = await onImportHistory({
        importMetadata: true,
        importScope: { includeChangedSinceCursor: true, mode: "transcript_full" },
        queueEnrichment: false,
        runtimes: [runtime]
      });
      const jobs = importJobsFromResult(result);
      if (jobs.length === 0) throw new Error("No remaining-history import job was created.");
      setStartedJobs((current) => [...current, ...jobs]);
      setStartedJobIds((current) => new Set([...current, ...jobs.map((created) => created.importJobId)]));
      void onPollImports?.();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportRunning(false);
    }
  };

  const stepBody = (
    <>
      {step === "intro" ? (
        <div className="sources-onboarding-step-content">
          <div className="sources-onboarding-stage-hero">
            <p className="mono-label">Screen 01 / discover</p>
            <h3>Find local harnesses and their history.</h3>
            <p>
              Masthead discovers supported coding harnesses, reports the history available on this machine, and keeps
              the original source files read-only.
            </p>
            <div className="surface-actions">
              <AppButton
                type="button"
                variant="primary"
                disabled={busy || discoverStarted}
                onClick={() => {
                  if (!snapshot) {
                    void handleRediscover().then(() => setStep("select"));
                    return;
                  }
                  setStep("select");
                }}
              >
                {busy || discoverStarted ? "Discovering..." : "Continue"}
              </AppButton>
              <AppButton type="button" variant="quiet" disabled={busy || discoverStarted} onClick={() => void handleRediscover()}>
                Discover again
              </AppButton>
            </div>
          </div>
          <p className="surface-status" role="status">
            {busy || discoverStarted
              ? "Discovering local harnesses, history, and live connector status..."
              : snapshot
                ? `Discovery ready: ${foundConnectors.length} found · ${foundConnectors.reduce((total, connector) => total + (connector.historySessionCount ?? 0), 0)} history sessions · ${snapshot.summary.ready} live-ready.`
                : "Discover runs automatically when this setup opens."}
          </p>
        </div>
      ) : null}

      {step === "select" ? (
        <div className="sources-onboarding-step-content">
          <p className="mono-label">Screen 02 / connect</p>
          <h3>Select found harnesses</h3>
          <p className="surface-status">
            Found harnesses are selected by default. Connector setup happens first; history import remains a separate,
            explicit step.
          </p>
          {foundConnectors.length > 0 ? (
            <div className="source-adapter-grid">
              {foundConnectors.map((connector) => (
                <label className="adapter-card source-select-card" key={connector.runtime}>
                  <span className="adapter-card-head">
                    <span>
                      <strong>{connector.label}</strong>
                    </span>
                    <input
                      type="checkbox"
                      checked={selected.has(connector.runtime)}
                      onChange={(event) => toggle(connector.runtime, event.currentTarget.checked)}
                    />
                  </span>
                  <span className="sources-connector-row-badges">
                    <StatusBadge tone={presenceTone(connector.presence)}>{presenceLabel(connector.presence)}</StatusBadge>
                    <StatusBadge tone={liveTone(connector.live)}>{liveLabel(connector)}</StatusBadge>
                  </span>
                  <span className="surface-status">
                    {connector.historyFound
                      ? historyCountLabel(connector)
                      : "No local history counted"}
                  </span>
                  {connector.actionMessage ? (
                    <span className="surface-status source-card-path">{connector.actionMessage}</span>
                  ) : null}
                </label>
              ))}
            </div>
          ) : (
            <div className="empty-session-state">
              <p className="mono-label">Discover</p>
              <h3>{busy || discoverStarted ? "Still scanning..." : "No local harnesses found yet"}</h3>
              <p>
                Masthead checks known harness homes only. Install a supported harness, then Discover again — no silent
                install and no import jobs on this surface.
              </p>
            </div>
          )}
          <div className="surface-actions">
            <AppButton type="button" onClick={() => setStep("intro")}>
              Back
            </AppButton>
            <AppButton type="button" variant="quiet" disabled={busy || discoverStarted} onClick={() => void handleRediscover()}>
              Discover
            </AppButton>
            <AppButton
              type="button"
              variant="primary"
              disabled={selected.size === 0}
              onClick={() => setStep("enable")}
            >
              Continue
            </AppButton>
          </div>
        </div>
      ) : null}

      {step === "enable" ? (
        <div className="sources-onboarding-step-content">
          <p className="mono-label">Screen 03 / enable</p>
          <h3>Enable selected connectors</h3>
          <p className="surface-status">
            Enable installs or repairs Masthead-managed live connectors for the selected harnesses. Host activation may
            still be required after install.
          </p>
          <ul className="sources-onboarding-review-notes" aria-label="Harnesses to enable">
            {selectedConnectors.map((connector) => (
              <li key={connector.runtime}>
                <strong>{connector.label}</strong>
                {" — "}
                {liveLabel(connector)}
                {connector.live === "ready" ? " (already ready)" : ""}
              </li>
            ))}
          </ul>
          <div className="surface-actions">
            <AppButton type="button" onClick={() => setStep("select")} disabled={enableRunning}>
              Back
            </AppButton>
            <AppButton
              type="button"
              variant="primary"
              disabled={busy || enableRunning || selectedConnectors.length === 0}
              onClick={() => void handleEnableSelected()}
            >
              {enableRunning ? "Enabling..." : "Enable selected"}
            </AppButton>
          </div>
        </div>
      ) : null}

      {step === "activate" ? (
        <div className="sources-onboarding-step-content">
          <p className="mono-label">Screen 04 / activate</p>
          <h3>Activation checklist</h3>
          <p className="surface-status">
            Some hosts need a manual trust or enable step after the connector files are written. Complete those steps,
            then confirm here.
          </p>
          {needsActionConnectors.length > 0 ? (
            <div className="source-adapter-grid">
              {needsActionConnectors.map((connector) => (
                <ActivationChecklistCard
                  key={connector.runtime}
                  connector={connector}
                  busy={busy}
                  onConfirm={onConfirmActivation}
                />
              ))}
            </div>
          ) : (
            <div className="empty-session-state">
              <p className="mono-label">Activation</p>
              <h3>No host activation remaining</h3>
              <p>
                {readyAmongSelected.length > 0
                  ? `${readyAmongSelected.length} selected harness${readyAmongSelected.length === 1 ? "" : "es"} ready for live capture.`
                  : "Selected connectors do not currently report a host activation gate."}
              </p>
            </div>
          )}
          <div className="surface-actions">
            <AppButton type="button" onClick={() => setStep("enable")}>
              Back
            </AppButton>
            <AppButton type="button" variant="primary" onClick={() => setStep("history")}>
              Continue
            </AppButton>
          </div>
        </div>
      ) : null}

      {step === "history" ? (
        <div className="sources-onboarding-step-content">
          <p className="mono-label">Screen 03 / import history</p>
          <h3>Import local history</h3>
          <p className="surface-status">
            Everything schedules every discovered transcript. Internal batches are progress pages, never exclusions.
          </p>
          <div className="sources-history-choice-grid" role="radiogroup" aria-label="History range">
            <label className={`adapter-card source-select-card ${historyChoice === "everything" ? "is-selected" : ""}`}>
              <span className="adapter-card-head">
                <strong>Everything</strong>
                <input
                  type="radio"
                  name="history-range"
                  value="everything"
                  checked={historyChoice === "everything"}
                  onChange={() => setHistoryChoice("everything")}
                />
              </span>
              <span>Import every discovered local session and transcript.</span>
            </label>
            <label className={`adapter-card source-select-card ${historyChoice === "recent" ? "is-selected" : ""}`}>
              <span className="adapter-card-head">
                <strong>Last 30 days</strong>
                <input
                  type="radio"
                  name="history-range"
                  value="recent"
                  checked={historyChoice === "recent"}
                  onChange={() => setHistoryChoice("recent")}
                />
              </span>
              <span>Import recent history now and report the remainder as deferred.</span>
            </label>
          </div>
          <dl className="harness-overview-proof">
            {selectedConnectors.map((connector) => (
              <div key={connector.runtime}>
                <dt>{connector.label}</dt>
                <dd>{connector.historySessionCount ?? 0}</dd>
              </div>
            ))}
          </dl>
          {importError ? <p className="surface-status status-error" role="alert">{importError}</p> : null}
          <div className="surface-actions">
            <AppButton type="button" onClick={() => setStep("activate")} disabled={importRunning}>Back</AppButton>
            <AppButton
              type="button"
              variant="primary"
              disabled={busy || importRunning || !onImportHistory || selectedConnectors.length === 0}
              onClick={() => void handleImportHistory()}
            >
              {importRunning ? "Starting import..." : "Start history import"}
            </AppButton>
          </div>
        </div>
      ) : null}

      {step === "progress" ? (
        <div className="sources-onboarding-step-content">
          <p className="mono-label">Screen 04 / reconcile</p>
          <h3>Import and reconciliation progress</h3>
          <p className="surface-status">
            Progress is stored by the Masthead daemon. Closing or restarting the app does not discard queued work.
          </p>
          <div className="sources-onboarding-import-list" aria-label="History import jobs">
            {trackedJobs.map((job) => (
              <article className="adapter-card sources-onboarding-import-row" key={job.importJobId}>
                <div className="adapter-card-head">
                  <strong>{historyJobLabel(job, snapshot)}</strong>
                  <StatusBadge tone={importStatusTone(job.status)}>{job.status.replaceAll("_", " ")}</StatusBadge>
                </div>
                <dl className="harness-overview-proof">
                  <div><dt>Discovered</dt><dd>{job.totalWorkUnits || job.discoveredCount || 0}</dd></div>
                  <div><dt>Processed units</dt><dd>{job.completedWorkUnits || job.processedCount || 0}</dd></div>
                  {job.completionReport?.sessionsHydrated !== undefined ? (
                    <div><dt>Hydrated sessions</dt><dd>{job.completionReport.sessionsHydrated}</dd></div>
                  ) : null}
                  <div><dt>Deferred</dt><dd>{job.skippedWorkUnits || 0}</dd></div>
                  <div><dt>Failed</dt><dd>{job.failedWorkUnits || job.failureCount || 0}</dd></div>
                  <div><dt>Remaining</dt><dd>{remainingWork(job)}</dd></div>
                </dl>
                {job.failureMessage ? <p className="surface-status status-error">{job.failureMessage}</p> : null}
                {job.status === "failed" && onRetryImport ? (
                  <div className="surface-actions">
                    <AppButton type="button" onClick={() => void onRetryImport(job.importJobId)}>Retry</AppButton>
                  </div>
                ) : null}
                {!isActiveImport(job.status) && job.scope?.mode === "transcript_recent" && (job.skippedWorkUnits ?? 0) > 0 ? (
                  <div className="surface-actions">
                    <AppButton type="button" disabled={importRunning} onClick={() => void handleImportRemaining(job)}>
                      Import remaining
                    </AppButton>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          <div className="surface-actions">
            <AppButton type="button" disabled={!onPollImports || busy} onClick={() => void onPollImports?.()}>Refresh progress</AppButton>
            <AppButton type="button" variant="primary" disabled={!reconciliationComplete} onClick={() => setStep("done")}>
              {activeJobs.length > 0 ? `Importing ${activeJobs.length} job${activeJobs.length === 1 ? "" : "s"}...` : "Continue"}
            </AppButton>
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="sources-onboarding-step-content">
          <div className="sources-onboarding-stage-hero">
            <p className="mono-label">Screen 05 / ready</p>
            <h3>Your session history is ready in Workbench.</h3>
            <p>
              Every selected history unit is now processed, intentionally deferred, or reported as failed. Workbench
              can continue quality and artifact work from the canonical session database.
            </p>
            <dl className="harness-overview-proof">
              <div>
                <dt>Harnesses</dt>
                <dd>{selectedConnectors.length}</dd>
              </div>
              <div>
                <dt>Ready</dt>
                <dd>{readyAmongSelected.length}</dd>
              </div>
              <div>
                <dt>Import jobs</dt>
                <dd>{trackedJobs.length}</dd>
              </div>
              <div>
                <dt>Enabled this run</dt>
                <dd>{enabledRuntimes.length || "—"}</dd>
              </div>
            </dl>
            <div className="surface-actions">
              <AppButton type="button" variant="primary" onClick={onClose}>
                Finish setup
              </AppButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="sources-onboarding-full-window" role="presentation">
      <section
        className="session-detail-modal sources-onboarding-modal sources-onboarding-modal-full"
        role="dialog"
        aria-modal="true"
        aria-label="Capture local session history"
      >
        <header className="session-detail-header">
          <div>
            <p className="mono-label">First-run setup</p>
            <h2>Capture local session history</h2>
          </div>
          <div className="surface-actions">
            <AppButton type="button" variant="quiet" onClick={onSkip}>
              Skip setup
            </AppButton>
          </div>
        </header>

        <div className="session-detail-body sources-onboarding-command-layout">
          <aside className="sources-onboarding-step-rail" aria-label="Onboarding steps">
            <ol className="sources-onboarding-step-list">
              {stepRail.map((item, index) => (
                <li className={`sources-onboarding-step-item ${activeStage === item.id ? "is-active" : ""}`} key={item.id}>
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
      </section>
    </div>
  );
}

function historyCountLabel(connector: HarnessConnectorDto): string {
  const sessions = connector.historySessionCount ?? 0;
  const units = connector.historySourceUnitCount ?? sessions;
  return `${sessions} history session${sessions === 1 ? "" : "s"} · ${units} source unit${units === 1 ? "" : "s"}`;
}

function ActivationChecklistCard({
  connector,
  busy,
  onConfirm
}: {
  connector: HarnessConnectorDto;
  busy: boolean;
  onConfirm?: (runtime: string) => Promise<void> | void;
}) {
  const canConfirm =
    connector.actionRequired === "trust_hooks" || connector.actionRequired === "confirm_activation";

  return (
    <article className="adapter-card" aria-label={`${connector.label} activation`}>
      <div className="adapter-card-head">
        <strong>{connector.label}</strong>
        <StatusBadge tone={liveTone(connector.live)}>{liveLabel(connector)}</StatusBadge>
      </div>
      <p className="surface-status">{connector.actionMessage ?? "Host activation still required."}</p>
      {connector.actionRequired ? (
        <p className="mono-label">{connector.actionRequired.replaceAll("_", " ")}</p>
      ) : null}
      {canConfirm && onConfirm ? (
        <div className="surface-actions">
          <AppButton type="button" variant="primary" disabled={busy} onClick={() => void onConfirm(connector.runtime)}>
            Confirm trusted
          </AppButton>
        </div>
      ) : null}
    </article>
  );
}

function stageForStep(step: Step): Stage {
  if (step === "intro") return "discover";
  if (step === "select" || step === "enable" || step === "activate") return "connect";
  if (step === "history") return "history";
  if (step === "progress") return "reconcile";
  return "ready";
}

function importJobsFromResult(value: unknown): ImportJob[] {
  if (!value || typeof value !== "object") return [];
  const jobs = (value as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.filter(
    (job): job is ImportJob =>
      Boolean(job && typeof job === "object" && typeof (job as { importJobId?: unknown }).importJobId === "string")
  );
}

function isActiveImport(status: ImportJob["status"]): boolean {
  return status === "queued" || status === "running" || status === "cancelling";
}

function remainingWork(job: ImportJob): number {
  const total = job.totalWorkUnits || job.discoveredCount || 0;
  const terminal = (job.completedWorkUnits || 0) + (job.failedWorkUnits || 0) + (job.skippedWorkUnits || 0);
  return Math.max(0, total - terminal);
}

function historyJobLabel(job: ImportJob, snapshot: HarnessConnectorsSnapshotDto | undefined): string {
  const connector = snapshot?.connectors.find(
    (candidate) => job.sourceId.startsWith(candidate.runtime) || job.sourceId.startsWith(candidate.runtime.replaceAll("_", "-"))
  );
  return `${connector?.label ?? job.sourceId} · ${job.importKind}`;
}

function importStatusTone(status: ImportJob["status"]): "neutral" | "active" | "info" | "warning" | "danger" {
  if (status === "running") return "active";
  if (status === "queued" || status === "cancelling") return "info";
  if (status === "failed") return "danger";
  if (status === "succeeded_with_issues") return "warning";
  return "neutral";
}
