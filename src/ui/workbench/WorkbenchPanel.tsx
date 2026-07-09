import { useEffect, useId, useRef, useState } from "react";
import type { WorkbenchActionKind, UseWorkbenchControllerResult } from "../../app/workbench/useWorkbenchController";
import { AppButton } from "../primitives/AppButton";
import { formatWorkbenchActivityTime, workbenchActivityTone } from "./workbenchActivity";
import { sanitizeWorkbenchVisibleText } from "./workbenchHandoff";

type WorkbenchPanelProps = Partial<
  Pick<
    UseWorkbenchControllerResult,
    | "actionBusy"
    | "actionError"
    | "activity"
    | "canRun"
    | "clearActionFeedback"
    | "error"
    | "handoffText"
    | "lastActionSummary"
    | "loading"
    | "notAddedOpen"
    | "notAddedSessions"
    | "notAddedSummary"
    | "page"
    | "pageSize"
    | "runAction"
    | "selectedSessionIds"
    | "sessions"
    | "setNotAddedOpen"
    | "setPage"
    | "total"
  >
> & {
  onClearSelection?: () => void;
  onRetry?: () => void;
  onSelectAll?: () => void;
  onSelectPage?: () => void;
  onToggleSession?: (sessionId: string) => void;
};

const EMPTY_SELECTION = new Set<string>();
const EMPTY_SESSIONS: UseWorkbenchControllerResult["sessions"] = [];
const EMPTY_NOT_ADDED: UseWorkbenchControllerResult["notAddedSessions"] = [];
const EMPTY_ACTIVITY: UseWorkbenchControllerResult["activity"] = [];

const defaultCanRun: UseWorkbenchControllerResult["canRun"] = () => false;

const TOOLTIPS = {
  copyAgentPrompt:
    "Copy a plain-language prompt for your coding agent to enrich, dossier, and process the selected sessions.",
  selectAll: "Select every publish-path session across all pages (not just this page).",
  clear: "Clear the current selection.",
  pipeline: "Expand pipeline operations to the right: enroll, transcript, quality, publish, and claims.",
  enrollMissing: "Add captured sessions that are not yet on the Workbench publish path.",
  checkTranscript: "Run a lightweight transcript availability check on selected sessions.",
  importTranscript: "Import transcript content for selected sessions (requires source permission).",
  precheck: "Run the cheap capture quality precheck and apply pass/fail automatically.",
  acceptQuality: "Mark quality as passed so selected sessions can move toward enrichment.",
  failQuality: "Fail quality and move selected sessions to Not Added to Logbook.",
  publish: "Publish selected sessions to Logbook when all gates are satisfied.",
  claim: "Place a short-lived claim so agents avoid duplicate work on selected sessions.",
  release: "Release active claims on selected sessions.",
  pagePrevious: "Show the previous page of publish-path sessions.",
  pageNext: "Show the next page of publish-path sessions.",
  selectPage: "Select or clear all sessions on this page.",
  notAdded: "Review sessions excluded from Logbook."
} as const;

type PipelineItem = {
  kind: WorkbenchActionKind;
  label: string;
  tooltip: string;
  quiet?: boolean;
};

const PIPELINE_ITEMS: PipelineItem[] = [
  { kind: "enroll_missing", label: "Enroll missing", tooltip: TOOLTIPS.enrollMissing },
  { kind: "check_transcript", label: "Check Transcript", tooltip: TOOLTIPS.checkTranscript },
  { kind: "import_transcript", label: "Import Transcript", tooltip: TOOLTIPS.importTranscript },
  { kind: "quality_precheck", label: "Precheck", tooltip: TOOLTIPS.precheck },
  { kind: "quality_pass", label: "Accept Quality", tooltip: TOOLTIPS.acceptQuality },
  { kind: "quality_fail", label: "Fail Quality", tooltip: TOOLTIPS.failQuality, quiet: true },
  { kind: "publish", label: "Publish", tooltip: TOOLTIPS.publish },
  { kind: "claim", label: "Claim", tooltip: TOOLTIPS.claim },
  { kind: "release", label: "Release", tooltip: TOOLTIPS.release }
];

export function WorkbenchPanel({
  actionBusy = false,
  actionError,
  activity = EMPTY_ACTIVITY,
  canRun = defaultCanRun,
  clearActionFeedback,
  error,
  handoffText = "",
  lastActionSummary,
  loading = false,
  notAddedOpen = false,
  notAddedSessions = EMPTY_NOT_ADDED,
  notAddedSummary,
  onClearSelection,
  onRetry,
  onSelectAll,
  onSelectPage,
  onToggleSession,
  page = 0,
  pageSize = 100,
  runAction,
  selectedSessionIds = EMPTY_SELECTION,
  sessions = EMPTY_SESSIONS,
  setNotAddedOpen,
  setPage,
  total
}: WorkbenchPanelProps) {
  const selectionCount = selectedSessionIds.size;
  const selectedSessions = sessions.filter((session) => selectedSessionIds.has(session.sessionId));
  const queueTotal = typeof total === "number" ? total : sessions.length;
  const publishPathLabel = loading ? "…" : String(queueTotal);
  const notAddedTotal = notAddedSummary?.total;
  const notAddedLabel = notAddedTotal != null ? String(notAddedTotal) : undefined;
  const showAgentPromptEmphasis = selectedSessions.some(
    (session) => session.nextAction === "enrich" || session.nextAction === "create_dossier"
  );
  const pageCount = Math.max(1, Math.ceil(queueTotal / Math.max(1, pageSize)));
  const safePage = Math.min(page, pageCount - 1);
  const rangeStart = queueTotal === 0 ? 0 : safePage * pageSize + 1;
  const rangeEnd = Math.min(queueTotal, (safePage + 1) * pageSize);
  const toastMessage = actionError
    ? sanitizeWorkbenchVisibleText(actionError)
    : lastActionSummary
      ? sanitizeWorkbenchVisibleText(lastActionSummary)
      : undefined;
  const toastTone = actionError ? "error" : "ok";

  const pageSessionIds = sessions.map((session) => session.sessionId);
  const pageSelectedCount = pageSessionIds.filter((id) => selectedSessionIds.has(id)).length;
  const allPageSelected = pageSessionIds.length > 0 && pageSelectedCount === pageSessionIds.length;
  const somePageSelected = pageSelectedCount > 0 && !allPageSelected;

  const [pipelineExpanded, setPipelineExpanded] = useState(false);
  const [pipelineClosing, setPipelineClosing] = useState(false);
  const pipelineCloseTimerRef = useRef<number | null>(null);
  const pipelineActionsId = useId();
  /** Keep rail open long enough for reverse cascade (~250ms) + width collapse (~140ms). */
  const PIPELINE_CLOSE_MS = 380;
  const pipelineRailOpen = pipelineExpanded || pipelineClosing;

  const clearPipelineCloseTimer = () => {
    if (pipelineCloseTimerRef.current === null) return;
    window.clearTimeout(pipelineCloseTimerRef.current);
    pipelineCloseTimerRef.current = null;
  };

  const openPipeline = () => {
    clearPipelineCloseTimer();
    setPipelineClosing(false);
    setPipelineExpanded(true);
  };

  const closePipeline = () => {
    if (!pipelineExpanded || pipelineClosing) return;
    clearPipelineCloseTimer();
    setPipelineClosing(true);
    pipelineCloseTimerRef.current = window.setTimeout(() => {
      setPipelineExpanded(false);
      setPipelineClosing(false);
      pipelineCloseTimerRef.current = null;
    }, PIPELINE_CLOSE_MS);
  };

  const togglePipeline = () => {
    if (pipelineClosing) {
      openPipeline();
      return;
    }
    if (pipelineExpanded) closePipeline();
    else openPipeline();
  };

  useEffect(() => () => clearPipelineCloseTimer(), []);

  useEffect(() => {
    if (!pipelineRailOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePipeline();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pipelineExpanded, pipelineClosing]);

  const run = (kind: WorkbenchActionKind) => {
    if (!canRun(kind) || actionBusy) return;
    if (kind === "copy_agent_prompt") {
      void copyTextToClipboard(handoffText);
    }
    void runAction?.(kind);
  };

  const toggleNotAdded = () => {
    setNotAddedOpen?.(!notAddedOpen);
  };

  const onHeaderCheckboxChange = () => {
    if (allPageSelected) {
      for (const id of pageSessionIds) {
        if (selectedSessionIds.has(id)) onToggleSession?.(id);
      }
      return;
    }
    onSelectPage?.();
  };

  useEffect(() => {
    if (!toastMessage || !clearActionFeedback) return;
    const timer = window.setTimeout(() => clearActionFeedback(), actionError ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [actionError, clearActionFeedback, toastMessage]);

  return (
    <section className="workbench-panel surface-panel" aria-label="Workbench">
      <div className="workbench-toolbar observability-toolbar metal-toolbar" role="toolbar" aria-label="Workbench actions">
        <div className="workbench-toolbar-actions toolbar-select-row" aria-label="Workbench ops actions">
          <AppButton
            className="workbench-copy-agent"
            variant="primary"
            onClick={() => run("copy_agent_prompt")}
            disabled={!canRun("copy_agent_prompt")}
            title={TOOLTIPS.copyAgentPrompt}
          >
            Copy Agent Prompt
          </AppButton>

          <span className="workbench-toolbar-divider" aria-hidden="true" />

          <AppButton
            onClick={() => void onSelectAll?.()}
            disabled={loading || actionBusy || queueTotal === 0}
            title={TOOLTIPS.selectAll}
          >
            Select all
          </AppButton>
          <AppButton
            variant="quiet"
            onClick={onClearSelection}
            disabled={selectionCount === 0}
            title={TOOLTIPS.clear}
          >
            Clear
          </AppButton>

          <div
            className={`workbench-pipeline-rail${pipelineRailOpen ? " is-expanded" : ""}${
              pipelineClosing ? " is-closing" : ""
            }`}
          >
            <AppButton
              className="workbench-pipeline-trigger"
              aria-expanded={pipelineExpanded && !pipelineClosing}
              aria-controls={pipelineActionsId}
              onClick={togglePipeline}
              disabled={actionBusy}
              title={TOOLTIPS.pipeline}
            >
              Pipeline
              <span className="workbench-pipeline-caret" aria-hidden="true">
                {pipelineExpanded && !pipelineClosing ? "‹" : "›"}
              </span>
            </AppButton>
            <div
              id={pipelineActionsId}
              className="workbench-pipeline-actions"
              role="group"
              aria-label="Pipeline operations"
              aria-hidden={!pipelineExpanded || pipelineClosing}
            >
              {PIPELINE_ITEMS.map((item) => (
                <AppButton
                  key={item.kind}
                  variant={item.quiet ? "quiet" : "default"}
                  disabled={!canRun(item.kind) || actionBusy || !pipelineExpanded || pipelineClosing}
                  title={item.tooltip}
                  tabIndex={pipelineExpanded && !pipelineClosing ? 0 : -1}
                  onClick={() => run(item.kind)}
                >
                  {item.label}
                </AppButton>
              ))}
            </div>
          </div>
        </div>

        <dl className="workbench-toolbar-facts" aria-label="Workbench queue facts">
          <div title="Sessions on the publish path waiting for Workbench processing">
            <dt>Publish path</dt>
            <dd>{publishPathLabel}</dd>
          </div>
          <div title="Sessions currently selected for bulk actions">
            <dt>Selected</dt>
            <dd>{selectionCount}</dd>
          </div>
          {notAddedLabel != null ? (
            <div className={notAddedOpen ? "is-active" : undefined} title={TOOLTIPS.notAdded}>
              <dt>Not Added</dt>
              <dd>
                <button
                  type="button"
                  className="workbench-fact-toggle"
                  onClick={toggleNotAdded}
                  aria-pressed={notAddedOpen}
                  aria-label={`Not Added ${notAddedLabel}, ${notAddedOpen ? "close" : "open"} review`}
                  title={TOOLTIPS.notAdded}
                >
                  {notAddedLabel}
                </button>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {showAgentPromptEmphasis ? (
        <p className="workbench-agent-hint" aria-live="polite">
          Enrichment and dossier work is agent-only — use Copy Agent Prompt
        </p>
      ) : null}

      {toastMessage ? (
        <div className={`workbench-toast is-${toastTone}`} role="status" aria-live="polite" aria-atomic="true">
          <div className="workbench-toast-body">
            <p className="mono-label">{actionError ? "Action failed" : "Workbench"}</p>
            <p>{toastMessage}</p>
          </div>
          <button
            type="button"
            className="workbench-toast-dismiss"
            onClick={() => clearActionFeedback?.()}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ) : null}

      {error ? (
        <section className="workbench-error surface-status" aria-live="polite">
          <div>
            <p className="mono-label">Workbench unavailable</p>
            <p>{sanitizeWorkbenchVisibleText(error)}</p>
          </div>
          <AppButton variant="primary" onClick={onRetry} title="Reload Workbench queue and activity">
            Retry
          </AppButton>
        </section>
      ) : null}

      {notAddedOpen ? (
        <section className="workbench-not-added-panel" aria-label="Not Added to Logbook">
          <div className="workbench-not-added-header">
            <p className="mono-label">Not Added to Logbook</p>
            <AppButton variant="quiet" onClick={() => setNotAddedOpen?.(false)}>
              Close
            </AppButton>
          </div>
          <div className="workbench-table-wrap workbench-not-added-table-wrap">
            <table className="workbench-session-table workbench-not-added-table">
              <thead>
                <tr>
                  <th scope="col">session</th>
                  <th scope="col">reason</th>
                  <th scope="col">runtime</th>
                  <th scope="col">last activity</th>
                </tr>
              </thead>
              <tbody>
                {notAddedSessions.length === 0 ? (
                  <tr>
                    <td className="workbench-session-empty" colSpan={4}>
                      No Not Added sessions
                    </td>
                  </tr>
                ) : (
                  notAddedSessions.map((session) => {
                    const safeTitle = sanitizeWorkbenchVisibleText(session.title);
                    const safeProject = session.project ? sanitizeWorkbenchVisibleText(session.project) : "-";
                    return (
                      <tr key={session.sessionId}>
                        <td>
                          <span className="workbench-session-meta">
                            <strong>{safeTitle}</strong>
                            <span>
                              {safeProject} / {sanitizeWorkbenchVisibleText(session.sessionId)}
                            </span>
                          </span>
                        </td>
                        <td>{sanitizeWorkbenchVisibleText(session.reason)}</td>
                        <td>{sanitizeWorkbenchVisibleText(session.runtime)}</td>
                        <td>
                          <span className="workbench-latest">{sanitizeWorkbenchVisibleText(session.lastActivityAt)}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="workbench-layout">
        <div className="workbench-queue-column">
          <div className="workbench-table-wrap">
            <table className="workbench-session-table">
              <thead>
                <tr>
                  <th scope="col" className="workbench-select-col">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = somePageSelected;
                      }}
                      disabled={loading || sessions.length === 0}
                      onChange={onHeaderCheckboxChange}
                      title={TOOLTIPS.selectPage}
                      aria-label="Select all sessions on this page"
                    />
                  </th>
                  <th scope="col">session</th>
                  <th scope="col">next</th>
                  <th scope="col">transcript</th>
                  <th scope="col">quality</th>
                  <th scope="col">enrichment</th>
                  <th scope="col">dossier</th>
                  <th scope="col">runbook</th>
                  <th scope="col">resolution</th>
                  <th scope="col">claim</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr className="workbench-empty-row">
                    <td className="workbench-session-empty" colSpan={9}>
                      <span className="workbench-empty-title">{loading ? "Loading" : "No publish-path sessions"}</span>
                      {!loading ? (
                        <span className="workbench-empty-hint">If Now has captures, open Pipeline → Enroll missing</span>
                      ) : null}
                      {!loading && notAddedTotal != null && notAddedTotal > 0 ? (
                        <button type="button" className="workbench-empty-not-added" onClick={toggleNotAdded}>
                          {notAddedTotal} not added to Logbook · open review
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ) : (
                  sessions.map((session) => {
                    const selected = selectedSessionIds.has(session.sessionId);
                    const safeTitle = sanitizeWorkbenchVisibleText(session.title);
                    const safeSessionId = sanitizeWorkbenchVisibleText(session.sessionId);
                    const safeProject = session.project ? sanitizeWorkbenchVisibleText(session.project) : "-";
                    const safeRuntime = sanitizeWorkbenchVisibleText(session.runtime);
                    const safeLifecycle = sanitizeWorkbenchVisibleText(session.lifecycle);
                    const safeLastActivity = sanitizeWorkbenchVisibleText(session.lastActivityAt);
                    const latestSummary = session.latestActivity?.summary
                      ? sanitizeWorkbenchVisibleText(session.latestActivity.summary)
                      : safeLastActivity;
                    const claim = session.activeClaim ? sanitizeWorkbenchVisibleText(session.activeClaim.claimedBy) : "-";

                    return (
                      <tr
                        key={session.sessionId}
                        className={selected ? "is-selected" : undefined}
                        onClick={() => onToggleSession?.(session.sessionId)}
                      >
                        <td className="workbench-select-col" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => onToggleSession?.(session.sessionId)}
                            aria-label={`Select ${safeTitle}`}
                            title="Select this session"
                          />
                        </td>
                        <td>
                          <span className="workbench-session-meta">
                            <strong>{safeTitle}</strong>
                            <span>
                              {safeProject} / {safeRuntime} / {safeLifecycle}
                            </span>
                            <span>{safeSessionId}</span>
                          </span>
                        </td>
                        <td>
                          <StatusToken value={session.nextAction} tone="next" />
                        </td>
                        <td>
                          <StatusToken value={session.transcriptStatus} />
                        </td>
                        <td>
                          <StatusToken value={session.qualityStatus} />
                        </td>
                        <td>
                          <StatusToken value={session.sessionEnrichmentStatus} />
                        </td>
                        <td>
                          <StatusToken value={session.sessionDossierStatus} />
                        </td>
                        <td>
                          <StatusToken value={session.runbookStatus ?? session.bugFixTraceStatus} />
                        </td>
                        <td>
                          <StatusToken value={session.resolutionStatus ?? "in_progress"} tone="next" />
                        </td>
                        <td>
                          <span className="workbench-claim">{claim}</span>
                          <span className="workbench-latest">{latestSummary}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="workbench-pagination" aria-label="Workbench pagination">
            <span className="workbench-pagination-range">
              {queueTotal === 0 ? "0 sessions" : `Showing ${rangeStart}–${rangeEnd} of ${queueTotal}`}
            </span>
            <div className="workbench-pagination-actions">
              <AppButton
                variant="quiet"
                onClick={() => setPage?.(Math.max(0, safePage - 1))}
                disabled={loading || safePage <= 0}
                title={TOOLTIPS.pagePrevious}
              >
                Previous
              </AppButton>
              <span className="workbench-pagination-page">
                Page {safePage + 1} / {pageCount}
              </span>
              <AppButton
                variant="quiet"
                onClick={() => setPage?.(safePage + 1)}
                disabled={loading || safePage >= pageCount - 1}
                title={TOOLTIPS.pageNext}
              >
                Next
              </AppButton>
            </div>
          </div>
        </div>

        <aside className="workbench-activity-rail" aria-label="Workbench Activity">
          <div className="workbench-rail-block workbench-activity-block">
            <p className="mono-label">Workbench Activity</p>
            {activity.length === 0 ? (
              <p className="workbench-muted">No activity yet</p>
            ) : (
              <ol className="workbench-activity-list">
                {activity.map((item) => (
                  <li
                    key={item.activityId}
                    className={`workbench-activity-item is-${workbenchActivityTone(item.eventType)}`}
                  >
                    <span className="workbench-activity-gutter" aria-hidden="true" />
                    <div className="workbench-activity-body">
                      <div className="workbench-activity-meta">
                        <time dateTime={item.eventAt}>{formatWorkbenchActivityTime(item.eventAt)}</time>
                        <span className="workbench-activity-type">
                          {sanitizeWorkbenchVisibleText(item.eventType)}
                        </span>
                        <span className="workbench-activity-actor">
                          {sanitizeWorkbenchVisibleText(item.actorId ?? item.actorKind)}
                        </span>
                      </div>
                      <p className="workbench-activity-summary">{sanitizeWorkbenchVisibleText(item.summary)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </section>
    </section>
  );
}

function StatusToken({ value, tone }: { value: string; tone?: "next" }) {
  const safeValue = sanitizeWorkbenchVisibleText(value);
  return (
    <span className={`workbench-status-token is-${statusClass(value)} ${tone === "next" ? "is-next" : ""}`.trim()}>
      {formatStatus(value, safeValue)}
    </span>
  );
}

function statusClass(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function formatStatus(value: string, fallback: string): string {
  if (!value) return "-";
  return fallback.replace(/_/g, " ");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for desktop shells that do not expose async clipboard writes.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
