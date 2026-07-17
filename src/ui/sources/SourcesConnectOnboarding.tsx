import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportJob } from "../../app/daemonClient";
import type { ConnectorActionRequired, HarnessConnectorDto, HarnessConnectorsSnapshotDto } from "../../shared/harnessConnectors";
import type { SourcesSetupRunInput } from "../../shared/sourcesSetup";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge } from "../primitives/StatusBadge";
import { liveLabel, liveTone, presenceLabel, presenceTone } from "./HarnessConnectorRow";
import { isHostActivationAction, pendingActionTestCopy } from "./connectorStatusPresentation";

type ConnectorTestResult = { verified: boolean; needsAction: boolean; actionRequired?: ConnectorActionRequired };

export type SourcesConnectOnboardingProps = {
  open: boolean;
  snapshot?: HarnessConnectorsSnapshotDto;
  busy?: boolean;
  onClose: () => void;
  onSkip: () => void;
  onDiscover: () => Promise<void> | void;
  onEnable: (runtime: string) => Promise<void> | void;
  onTest: (runtime: string) => Promise<boolean | ConnectorTestResult> | boolean | ConnectorTestResult;
  onConfirmActivation?: (runtime: string) => Promise<void> | void;
  imports?: ImportJob[];
  onImportHistory?: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
  onPollImports?: () => Promise<void> | void;
  onRetryImport?: (importJobId: string) => Promise<void> | void;
};

type Step = "intro" | "connect" | "history";
type Stage = "discover" | "connect" | "history" | "ready";
type HistoryChoice = "everything" | "recent";
type ConnectionState = {
  status: "enabling" | "verifying" | "verified" | "verified_needs_action" | "failed";
  actionRequired?: ConnectorActionRequired;
  verified?: boolean;
};

const stepRail: Array<{ id: Stage; label: string; description: string }> = [
  { id: "discover", label: "Discover", description: "Find harnesses and local history." },
  { id: "connect", label: "Connect", description: "Choose and connect found harnesses." },
  { id: "history", label: "Import history", description: "Start durable background import." },
  { id: "ready", label: "Ready", description: "Use Masthead while history updates." }
];

export function SourcesConnectOnboarding({
  open,
  snapshot,
  busy = false,
  onClose,
  onSkip,
  onDiscover,
  onEnable,
  onTest,
  onImportHistory
}: SourcesConnectOnboardingProps) {
  const [step, setStep] = useState<Step>("intro");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [discoverStarted, setDiscoverStarted] = useState(false);
  const [enableRunning, setEnableRunning] = useState(false);
  const [connectionStates, setConnectionStates] = useState<Record<string, ConnectionState>>({});
  const [discoverAttempted, setDiscoverAttempted] = useState(false);
  const [historyChoice, setHistoryChoice] = useState<HistoryChoice>("everything");
  const [importRunning, setImportRunning] = useState(false);
  const [importError, setImportError] = useState<string>();
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
  const activeStage = stageForStep(step);
  const discoveryComplete = discoverAttempted && !discoverStarted && !busy && snapshot !== undefined;

  useEffect(() => {
    if (!open) {
      setStep("intro");
      setSelected(new Set());
      setDiscoverStarted(false);
      setEnableRunning(false);
      setConnectionStates({});
      setDiscoverAttempted(false);
      setHistoryChoice("everything");
      setImportRunning(false);
      setImportError(undefined);
      discoverOnceRef.current = false;
      seededSelectionRef.current = false;
      return;
    }

    if (discoverOnceRef.current) return;
    discoverOnceRef.current = true;
    setDiscoverAttempted(true);
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

  if (!open) return null;

  const toggle = (runtime: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(runtime);
      else next.delete(runtime);
      return next;
    });
  };

  const handleConnectSelected = async () => {
    setEnableRunning(true);
    let failed = false;
    try {
      for (const target of selectedConnectors) {
        const alreadyInstalled =
          connectionStates[target.runtime]?.status === "verified" ||
          connectionStates[target.runtime]?.status === "verified_needs_action";
        if (!alreadyInstalled) {
          setConnectionStates((current) => ({ ...current, [target.runtime]: { status: "enabling" } }));
          await onEnable(target.runtime);
        }
        setConnectionStates((current) => ({ ...current, [target.runtime]: { status: "verifying" } }));
        const verification = await onTest(target.runtime);
        const verified = typeof verification === "boolean" ? verification : verification.verified;
        const needsAction = typeof verification === "boolean" ? false : verification.needsAction;
        const actionRequired = typeof verification === "boolean" ? undefined : verification.actionRequired;
        if (!verified) {
          failed = true;
          setConnectionStates((current) => ({ ...current, [target.runtime]: { status: "failed", actionRequired, verified: false } }));
          continue;
        }
        if (needsAction && !isHostActivationAction(actionRequired)) {
          failed = true;
          setConnectionStates((current) => ({ ...current, [target.runtime]: { status: "failed", actionRequired, verified: true } }));
          continue;
        }
        setConnectionStates((current) => ({
          ...current,
          [target.runtime]: {
            status: needsAction ? "verified_needs_action" : "verified",
            actionRequired
          }
        }));
      }
    } catch {
      failed = true;
    } finally {
      setEnableRunning(false);
    }
    if (!failed) setStep("history");
  };

  const handleRediscover = async () => {
    setDiscoverAttempted(true);
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
      onClose();
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
            <h3>{discoveryComplete ? `Discovered ${foundConnectors.length} source${foundConnectors.length === 1 ? "" : "s"}` : "Looking for local sources"}</h3>
            <p>
              Masthead discovers supported coding harnesses, reports the history available on this machine, and keeps
              the original source files read-only.
            </p>
            <div className={`sources-discovery-status ${discoveryComplete ? "is-complete" : "is-scanning"}`} role="status">
              <span className="sources-discovery-indicator" aria-hidden="true" />
              <span>
                {discoveryComplete
                  ? `${foundConnectors.reduce((total, connector) => total + (connector.historySessionCount ?? 0), 0)} history sessions found across ${foundConnectors.length} harness${foundConnectors.length === 1 ? "" : "es"}.`
                  : "Checking known harness locations…"}
              </span>
            </div>
            <div className="surface-actions">
              <AppButton
                type="button"
                variant="primary"
                disabled={!discoveryComplete}
                onClick={() => setStep("connect")}
              >
                Continue
              </AppButton>
              <AppButton type="button" variant="quiet" disabled={busy || discoverStarted} onClick={() => void handleRediscover()}>
                Discover again
              </AppButton>
            </div>
          </div>
        </div>
      ) : null}

      {step === "connect" ? (
        <div className="sources-onboarding-step-content">
          <p className="mono-label">Screen 02 / connect</p>
          <h3>Connect found harnesses</h3>
          <p className="surface-status">
            Found harnesses are selected by default. Masthead will enable live capture for the sources you keep selected.
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
                  {connectionStates[connector.runtime] ? (
                    <span className={`surface-status source-connection-verification is-${connectionStates[connector.runtime]!.status}`} role="status">
                      {connectionStateLabel(connectionStates[connector.runtime])}
                    </span>
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
              disabled={busy || enableRunning || selected.size === 0}
              onClick={() => void handleConnectSelected()}
            >
              {enableRunning ? "Connecting…" : "Connect selected"}
            </AppButton>
          </div>
        </div>
      ) : null}

      {step === "history" ? (
        <div className="sources-onboarding-step-content">
          <p className="mono-label">Screen 03 / import history</p>
          <h3>Import local history</h3>
          <p className="surface-status">
            Start the import, then use Masthead immediately. History continues in the background and reports progress in the sidebar.
          </p>
          {selectedConnectors.some((connector) => connectionStates[connector.runtime]?.status === "verified_needs_action") ? (
            <div className="surface-status status-warning" role="status">
              {selectedConnectors
                .filter((connector) => connectionStates[connector.runtime]?.status === "verified_needs_action")
                .map((connector) => (
                  <p key={connector.runtime}>
                    <strong>{connector.label} still needs activation.</strong>{" "}
                    {pendingActionTestCopy(connectionStates[connector.runtime]?.actionRequired)}. {connector.actionMessage ?? "Complete the host activation step before expecting live capture."}
                  </p>
                ))}
            </div>
          ) : null}
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
            <AppButton type="button" onClick={() => setStep("connect")} disabled={importRunning}>Back</AppButton>
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

function connectionStateLabel(state: ConnectionState): string {
  if (state.status === "enabling") return "Installing connector…";
  if (state.status === "verifying") return "Testing endpoint…";
  if (state.status === "verified") return "Endpoint test passed";
  if (state.status === "verified_needs_action") return pendingActionTestCopy(state.actionRequired);
  if (state.actionRequired === "repair" && state.verified) return pendingActionTestCopy("repair");
  return "Endpoint test failed — repair the connector and try again";
}

function historyCountLabel(connector: HarnessConnectorDto): string {
  const sessions = connector.historySessionCount ?? 0;
  const units = connector.historySourceUnitCount ?? sessions;
  return `${sessions} history session${sessions === 1 ? "" : "s"} · ${units} source unit${units === 1 ? "" : "s"}`;
}

function stageForStep(step: Step): Stage {
  if (step === "intro") return "discover";
  if (step === "connect") return "connect";
  return "history";
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
