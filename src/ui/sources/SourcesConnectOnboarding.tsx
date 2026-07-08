import { useEffect, useMemo, useRef, useState } from "react";
import type { HarnessConnectorDto, HarnessConnectorsSnapshotDto } from "../../shared/harnessConnectors";
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
};

type Step = "intro" | "select" | "enable" | "activate" | "done";

const stepRail: Array<{ id: Step; label: string; description: string }> = [
  { id: "intro", label: "Start", description: "Live capture setup, not history import." },
  { id: "select", label: "Select", description: "Found harnesses to wire." },
  { id: "enable", label: "Enable", description: "Install live connectors." },
  { id: "activate", label: "Activate", description: "Host trust and enablement." },
  { id: "done", label: "Done", description: "Ready for live capture." }
];

export function SourcesConnectOnboarding({
  open,
  snapshot,
  busy = false,
  onClose,
  onSkip,
  onDiscover,
  onEnable,
  onConfirmActivation
}: SourcesConnectOnboardingProps) {
  const [step, setStep] = useState<Step>("intro");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [discoverStarted, setDiscoverStarted] = useState(false);
  const [enableRunning, setEnableRunning] = useState(false);
  const [enabledRuntimes, setEnabledRuntimes] = useState<string[]>([]);
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

  useEffect(() => {
    if (!open) {
      setStep("intro");
      setSelected(new Set());
      setDiscoverStarted(false);
      setEnableRunning(false);
      setEnabledRuntimes([]);
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

  const stepBody = (
    <>
      {step === "intro" ? (
        <div className="sources-onboarding-step-content">
          <div className="sources-onboarding-stage-hero">
            <p className="mono-label">Screen 01 / connect</p>
            <h3>Wire local harnesses for live capture.</h3>
            <p>
              Masthead discovers supported coding harnesses on this machine and enables live connectors (hooks and
              plugins). This is not history import — Workbench deepens sessions later.
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
              ? "Discovering local harnesses and live connector status..."
              : snapshot
                ? `Discovery ready: ${foundConnectors.length} found · ${snapshot.summary.ready} ready · ${snapshot.summary.needsAction} need action.`
                : "Discover runs automatically when this setup opens."}
          </p>
        </div>
      ) : null}

      {step === "select" ? (
        <div className="sources-onboarding-step-content">
          <p className="mono-label">Screen 02 / select</p>
          <h3>Select found harnesses</h3>
          <p className="surface-status">
            Found harnesses are selected by default. Enable only installs live connectors — it does not queue import
            jobs or bulk transcript import.
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
            <AppButton type="button" variant="primary" onClick={() => setStep("done")}>
              Continue
            </AppButton>
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="sources-onboarding-step-content">
          <div className="sources-onboarding-stage-hero">
            <p className="mono-label">Screen 05 / done</p>
            <h3>Live connectors are set up on this machine.</h3>
            <p>
              Sources stays focused on Discover → Enable → Activate → Test. Session history deepening stays in
              Workbench — not import jobs from this setup.
            </p>
            <dl className="harness-overview-proof">
              <div>
                <dt>Selected</dt>
                <dd>{selected.size}</dd>
              </div>
              <div>
                <dt>Ready</dt>
                <dd>{readyAmongSelected.length}</dd>
              </div>
              <div>
                <dt>Needs action</dt>
                <dd>{needsActionConnectors.length}</dd>
              </div>
              <div>
                <dt>Enabled this run</dt>
                <dd>{enabledRuntimes.length || "—"}</dd>
              </div>
            </dl>
            <div className="surface-actions">
              <AppButton type="button" variant="primary" onClick={onClose}>
                Done
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
        aria-label="Connect live sources"
      >
        <header className="session-detail-header">
          <div>
            <p className="mono-label">Sources connect</p>
            <h2>Connect live harnesses</h2>
          </div>
          <div className="surface-actions">
            <AppButton type="button" variant="quiet" onClick={onSkip}>
              Skip setup
            </AppButton>
            <AppButton type="button" variant="quiet" onClick={onClose}>
              Close
            </AppButton>
          </div>
        </header>

        <div className="session-detail-body sources-onboarding-command-layout">
          <aside className="sources-onboarding-step-rail" aria-label="Connect steps">
            <ol className="sources-onboarding-step-list">
              {stepRail.map((item, index) => (
                <li className={`sources-onboarding-step-item ${step === item.id ? "is-active" : ""}`} key={item.id}>
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
