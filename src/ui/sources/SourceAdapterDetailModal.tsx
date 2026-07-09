import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AdapterStatus, CodexHookSettingsDto, SettingsStateDto, UpdateLlmProviderSettingsInput } from "../../app/daemonClient";
import { Icon } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge } from "../primitives/StatusBadge";
import { LlmProviderControls } from "../settings/LlmProviderControls";
import {
  adapterState,
  formatLastSync,
  runtimeLabel,
  stateLabel,
  stateTone,
  type AdapterRowModel
} from "./AdapterRow";
import { HarnessLiveCaptureSection, liveCaptureStatusForRuntime } from "./HarnessLiveCaptureSection";
import { SourceDiagnosticPanel } from "./SourceDiagnosticPanel";
import { SourcePathTable } from "./SourcePathTable";
import { SourcePolicyControls } from "./SourcePolicyControls";

type HookAction = "install" | "test" | "uninstall";

type Props = {
  adapter: AdapterStatus;
  busy: boolean;
  checked?: boolean;
  enrichment?: SettingsStateDto["enrichment"];
  hooks?: CodexHookSettingsDto;
  hookActionBusy?: boolean;
  llm?: SettingsStateDto["llm"];
  locationError?: string;
  locationLoading?: boolean;
  locationTotal?: number;
  settingsBaseUrl?: string;
  onClose: () => void;
  onRuntimeHookAction?: (runtime: string, action: HookAction) => Promise<void> | void;
  onExcludePath: (path: string) => void;
  onImportMetadata?: (runtime: string) => void;
  onLoadMoreLocations?: () => void;
  onOpenImportJobs?: (runtime: string) => void;
  onSaveLlmProvider?: (input: UpdateLlmProviderSettingsInput) => Promise<void> | void;
  onSyncAdapter?: (runtime: string) => void;
  onToggleSelected?: (runtime: string, checked: boolean) => void;
};

export function SourceAdapterDetailModal({
  adapter,
  busy,
  checked = false,
  enrichment,
  hooks,
  hookActionBusy = false,
  llm,
  locationError,
  locationLoading = false,
  locationTotal,
  settingsBaseUrl,
  onClose,
  onRuntimeHookAction,
  onExcludePath,
  onImportMetadata,
  onLoadMoreLocations,
  onOpenImportJobs,
  onSaveLlmProvider,
  onSyncAdapter,
  onToggleSelected
}: Props) {
  const view = adapter as AdapterRowModel;
  const state = adapterState(view);
  const label = runtimeLabel(view.runtime);
  const modalRef = useRef<HTMLElement>(null);
  const closeTimeoutRef = useRef<number | undefined>(undefined);
  const closeFrameRef = useRef<number | undefined>(undefined);
  const [modalState, setModalState] = useState<"opening" | "open" | "closing">("opening");
  const titleId = `${view.runtime}-source-detail-title`;
  const discoveredCount = view.discoveredCount ?? view.discoveredSessions;
  const importedCount = view.importedCount ?? view.importedSessions;
  const sourceLocationCount = locationTotal ?? view.sourceLocationCount ?? view.sourceLocations.length;
  const liveConnector = liveCaptureStatusForRuntime(hooks, view.runtime);
  const modalClassName = [
    "session-detail-modal",
    "source-detail-modal",
    "t-modal",
    modalState === "closing" ? "is-closing" : "",
    modalState === "open" ? "is-open" : ""
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    modalRef.current?.focus();
  }, [view.runtime]);

  useEffect(() => {
    setModalState("opening");
    const frame = window.requestAnimationFrame(() => setModalState("open"));
    return () => window.cancelAnimationFrame(frame);
  }, [view.runtime]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== undefined) window.clearTimeout(closeTimeoutRef.current);
      if (closeFrameRef.current !== undefined) window.cancelAnimationFrame(closeFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  const requestClose = () => {
    if (modalState === "closing") return;
    setModalState("closing");
    const closeMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur")) || 150;
    closeFrameRef.current = window.requestAnimationFrame(() => {
      closeFrameRef.current = window.requestAnimationFrame(() => {
        closeFrameRef.current = undefined;
        closeTimeoutRef.current = window.setTimeout(onClose, closeMs);
      });
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={requestClose}>
      <article
        ref={modalRef}
        className={modalClassName}
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleSourceModalKeyDown(event, modalRef.current, requestClose)}
        tabIndex={-1}
      >
        <header className="modal-head source-detail-head">
          <div className="modal-session-meta" aria-label="Source adapter summary">
            <span>{stateLabel(state)}</span>
            <span>{discoveredCount} discovered</span>
            <span>{importedCount} imported</span>
            <span>{sourceLocationCount} locations</span>
            <span>{formatLastSync(view.lastSyncAt)}</span>
          </div>
          <div className="modal-title-row source-detail-title-row">
            <button type="button" className="icon-button" aria-label="Close source detail" onClick={requestClose}>
              <Icon name="close" size="toolbar" weight={iconWeights.toolbar} />
            </button>
          </div>
          <div className="source-detail-head-badges" aria-label="Harness and connector status">
            <div>
              <p className="mono-label">Source adapter</p>
              <h2 id={titleId}>{label}</h2>
            </div>
            <StatusBadge tone={stateTone(state)}>{stateLabel(state)}</StatusBadge>
            <StatusBadge tone={liveConnector.tone}>Live: {liveConnector.label}</StatusBadge>
          </div>
        </header>

        <div className="modal-scroll-frame source-detail-scroll-frame">
          <div className="source-detail-content">
            <section className="detail-section source-detail-section" aria-label={`${label} harness overview`}>
              <div className="source-detail-section-head">
                <div>
                  <p className="mono-label">Harness overview</p>
                  <h3>{label}</h3>
                </div>
                <StatusBadge tone={stateTone(state)}>{stateLabel(state)}</StatusBadge>
              </div>
              <dl className="harness-overview-proof">
                <div>
                  <dt>Runtime</dt>
                  <dd>{view.runtime}</dd>
                </div>
                <div>
                  <dt>Discovered</dt>
                  <dd>{discoveredCount}</dd>
                </div>
                <div>
                  <dt>Imported</dt>
                  <dd>{importedCount}</dd>
                </div>
                <div>
                  <dt>Locations</dt>
                  <dd>{sourceLocationCount}</dd>
                </div>
                <div>
                  <dt>Last sync</dt>
                  <dd>{formatLastSync(view.lastSyncAt)}</dd>
                </div>
              </dl>
            </section>

            <section className="detail-section source-detail-actions" aria-label={`${label} source actions`}>
              <div className="source-detail-action-summary">
                <label className="adapter-card-select">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy || state === "planned"}
                    onChange={(event) => onToggleSelected?.(view.runtime, event.currentTarget.checked)}
                    aria-label={`Select ${label}`}
                  />
                  <span>Select for bulk actions</span>
                </label>
                <StatusBadge tone={stateTone(state)}>{stateLabel(state)}</StatusBadge>
              </div>
              <div className="source-detail-action-buttons">
                {state === "planned" ? (
                  <AppButton disabled>Coming later</AppButton>
                ) : (
                  <>
                    <AppButton onClick={() => onImportMetadata?.(view.runtime)} disabled={busy || !onImportMetadata}>
                      Import metadata
                    </AppButton>
                    <AppButton variant="primary" disabled={busy || !onSyncAdapter} onClick={() => onSyncAdapter?.(view.runtime)}>
                      Sync
                    </AppButton>
                  </>
                )}
              </div>
            </section>

            <HarnessLiveCaptureSection
              busy={busy || hookActionBusy}
              hooks={hooks}
              runtime={view.runtime}
              onAction={onRuntimeHookAction}
            />

            {state !== "planned" ? (
              <section className="detail-section source-detail-section" aria-label={`${label} history import`}>
                <div className="source-detail-section-head">
                  <div>
                    <p className="mono-label">History import</p>
                    <h3>Metadata and sync</h3>
                  </div>
                  <StatusBadge tone={view.policies.metadataImport ? "active" : "neutral"}>
                    {view.policies.metadataImport ? "Metadata enabled" : "Metadata disabled"}
                  </StatusBadge>
                </div>
                <p className="surface-status">Metadata import keeps Logbook searchable without bulk transcript ingestion.</p>
                <div className="source-detail-action-buttons">
                  <AppButton variant="quiet" disabled={busy || !onOpenImportJobs} onClick={() => onOpenImportJobs?.(view.runtime)}>
                    Open import jobs
                  </AppButton>
                </div>
              </section>
            ) : null}

            {state !== "planned" ? (
              <section className="detail-section source-detail-section" aria-label={`${label} transcript policy`}>
                <div className="source-detail-section-head">
                  <div>
                    <p className="mono-label">Transcript policy</p>
                    <h3>Lazy Dossier hydration</h3>
                  </div>
                  <StatusBadge tone={view.policies.transcriptImport ? "active" : "neutral"}>
                    {view.policies.transcriptImport ? "Approved" : "Metadata only"}
                  </StatusBadge>
                </div>
                <p className="surface-status">
                  Masthead imports transcript evidence for an individual session when its Dossier opens.
                </p>
              </section>
            ) : null}

            <section className="detail-section source-detail-section source-detail-enrichment" aria-label={`${label} Dossier enrichment`}>
              <div className="source-detail-section-head">
                <div>
                  <p className="mono-label">Dossier enrichment</p>
                  <h3>Provider and model</h3>
                </div>
              </div>
              <LlmProviderControls
                enrichment={enrichment}
                llm={llm}
                onSaveProvider={onSaveLlmProvider}
                readOnly={busy || !onSaveLlmProvider}
                settingsBaseUrl={settingsBaseUrl}
              />
            </section>

            {state !== "planned" ? (
              <section className="detail-section source-detail-section" aria-label={`${label} policies`}>
                <p className="mono-label">Capture policy</p>
                <SourcePolicyControls policies={view.policies} />
              </section>
            ) : null}

            <SourceDiagnosticPanel
              busy={busy}
              checkedPaths={view.checkedPaths}
              diagnostics={view.diagnostics}
              runtime={view.runtime}
              sources={view.sourceLocations}
              state={state}
            />

            {locationLoading || locationError || view.sourceLocations.length > 0 ? (
              <section className="detail-section source-detail-section" aria-label={`${label} source locations`}>
                <div className="source-detail-section-head">
                  <div>
                    <p className="mono-label">Source locations</p>
                    <h3>{locationLoading && view.sourceLocations.length === 0 ? "Loading locations" : `${view.sourceLocations.length} of ${sourceLocationCount} known locations`}</h3>
                  </div>
                  {view.sourceLocations.length < sourceLocationCount ? (
                    <AppButton variant="quiet" disabled={busy || locationLoading || !onLoadMoreLocations} onClick={onLoadMoreLocations}>
                      Load more
                    </AppButton>
                  ) : null}
                </div>
                {locationError ? <p className="surface-status">{locationError}</p> : null}
                {view.sourceLocations.length > 0 ? <SourcePathTable sources={view.sourceLocations} busy={busy} onExcludePath={onExcludePath} /> : null}
              </section>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}

function handleSourceModalKeyDown(event: KeyboardEvent, modal: HTMLElement | null, onClose: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab" || !modal) return;

  const focusable = [
    ...modal.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ].filter((element) => element.offsetParent !== null || element === document.activeElement);
  if (focusable.length === 0) {
    event.preventDefault();
    modal.focus();
    return;
  }

  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
