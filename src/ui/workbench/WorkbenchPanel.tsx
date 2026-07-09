import { useEffect } from "react";
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
  onSelectAllVisible?: () => void;
  onToggleSession?: (sessionId: string) => void;
};

const EMPTY_SELECTION = new Set<string>();
const EMPTY_SESSIONS: UseWorkbenchControllerResult["sessions"] = [];
const EMPTY_NOT_ADDED: UseWorkbenchControllerResult["notAddedSessions"] = [];
const EMPTY_ACTIVITY: UseWorkbenchControllerResult["activity"] = [];

const defaultCanRun: UseWorkbenchControllerResult["canRun"] = () => false;

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
  onSelectAllVisible,
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
  const primaryKind = resolvePrimaryAction(selectedSessions, canRun);
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

  useEffect(() => {
    if (!toastMessage || !clearActionFeedback) return;
    const timer = window.setTimeout(() => clearActionFeedback(), actionError ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [actionError, clearActionFeedback, toastMessage]);

  return (
    <section className="workbench-panel surface-panel" aria-label="Workbench">
      <div className="workbench-toolbar observability-toolbar metal-toolbar" role="toolbar" aria-label="Workbench actions">
        <div className="workbench-toolbar-actions toolbar-select-row" aria-label="Workbench ops actions">
          <AppButton onClick={() => run("enroll_missing")} disabled={!canRun("enroll_missing")}>
            Enroll missing
          </AppButton>
          <AppButton
            variant={primaryKind === "copy_agent_prompt" ? "primary" : "default"}
            onClick={() => run("copy_agent_prompt")}
            disabled={!canRun("copy_agent_prompt")}
          >
            Copy Agent Prompt
          </AppButton>
          <AppButton
            variant={primaryKind === "check_transcript" ? "primary" : "default"}
            onClick={() => run("check_transcript")}
            disabled={!canRun("check_transcript")}
          >
            Check Transcript
          </AppButton>
          <AppButton
            variant={primaryKind === "import_transcript" ? "primary" : "default"}
            onClick={() => run("import_transcript")}
            disabled={!canRun("import_transcript")}
          >
            Import Transcript
          </AppButton>
          <AppButton
            variant={primaryKind === "quality_precheck" ? "primary" : "default"}
            onClick={() => run("quality_precheck")}
            disabled={!canRun("quality_precheck")}
          >
            Precheck
          </AppButton>
          <AppButton
            variant={primaryKind === "quality_pass" ? "primary" : "default"}
            onClick={() => run("quality_pass")}
            disabled={!canRun("quality_pass")}
          >
            Accept Quality
          </AppButton>
          <AppButton variant="quiet" onClick={() => run("quality_fail")} disabled={!canRun("quality_fail")}>
            Fail Quality
          </AppButton>
          <AppButton
            variant={primaryKind === "publish" ? "primary" : "default"}
            onClick={() => run("publish")}
            disabled={!canRun("publish")}
          >
            Publish
          </AppButton>
          <AppButton
            variant={primaryKind === "claim" ? "primary" : "default"}
            onClick={() => run("claim")}
            disabled={!canRun("claim")}
          >
            Claim
          </AppButton>
          <AppButton onClick={() => run("release")} disabled={!canRun("release")}>
            Release
          </AppButton>
          <span className="workbench-toolbar-divider" aria-hidden="true" />
          <AppButton onClick={onSelectAllVisible} disabled={loading || sessions.length === 0}>
            Select Visible
          </AppButton>
          <AppButton variant="quiet" onClick={onClearSelection} disabled={selectionCount === 0}>
            Clear
          </AppButton>
          <AppButton onClick={onRetry} disabled={loading || actionBusy}>
            Refresh
          </AppButton>
        </div>
        <dl className="workbench-toolbar-facts" aria-label="Workbench queue facts">
          <div>
            <dt>Publish path</dt>
            <dd>{publishPathLabel}</dd>
          </div>
          <div>
            <dt>Selected</dt>
            <dd>{selectionCount}</dd>
          </div>
          {notAddedLabel != null ? (
            <div className={notAddedOpen ? "is-active" : undefined}>
              <dt>Not Added</dt>
              <dd>
                <button
                  type="button"
                  className="workbench-fact-toggle"
                  onClick={toggleNotAdded}
                  aria-pressed={notAddedOpen}
                  aria-label={`Not Added ${notAddedLabel}, ${notAddedOpen ? "close" : "open"} review`}
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
        <div
          className={`workbench-toast is-${toastTone}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
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
          <AppButton variant="primary" onClick={onRetry}>
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
                  <tr className="workbench-empty-row">
                    <td className="workbench-session-empty" colSpan={4}>
                      <span className="workbench-empty-title">No not-added sessions loaded</span>
                    </td>
                  </tr>
                ) : (
                  notAddedSessions.map((session) => {
                    const safeTitle = sanitizeWorkbenchVisibleText(session.title);
                    const safeSessionId = sanitizeWorkbenchVisibleText(session.sessionId);
                    const safeReason = sanitizeWorkbenchVisibleText(session.reason);
                    const safeRuntime = sanitizeWorkbenchVisibleText(session.runtime);
                    const safeLastActivity = sanitizeWorkbenchVisibleText(session.lastActivityAt);
                    const safeProject = session.project ? sanitizeWorkbenchVisibleText(session.project) : undefined;
                    return (
                      <tr key={session.sessionId}>
                        <td>
                          <span className="workbench-session-meta">
                            <strong>{safeTitle}</strong>
                            <span>
                              {safeProject ? `${safeProject} / ` : ""}
                              {safeSessionId}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="workbench-claim">{safeReason}</span>
                        </td>
                        <td>
                          <span className="workbench-claim">{safeRuntime}</span>
                        </td>
                        <td>
                          <span className="workbench-latest">{safeLastActivity}</span>
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
                  <th scope="col">session</th>
                  <th scope="col">next</th>
                  <th scope="col">transcript</th>
                  <th scope="col">quality</th>
                  <th scope="col">enrichment</th>
                  <th scope="col">dossier</th>
                  <th scope="col">bug fix</th>
                  <th scope="col">claim</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr className="workbench-empty-row">
                    <td className="workbench-session-empty" colSpan={8}>
                      <span className="workbench-empty-title">{loading ? "Loading" : "No publish-path sessions"}</span>
                      {!loading ? (
                        <span className="workbench-empty-hint">If Now has captures, use Enroll missing</span>
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
                      <tr key={session.sessionId} className={selected ? "is-selected" : undefined}>
                        <td>
                          <label className="workbench-session-main">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => onToggleSession?.(session.sessionId)}
                              aria-label={`Select ${safeTitle}`}
                            />
                            <span className="workbench-session-meta">
                              <strong>{safeTitle}</strong>
                              <span>
                                {safeProject} / {safeRuntime} / {safeLifecycle}
                              </span>
                              <span>{safeSessionId}</span>
                            </span>
                          </label>
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
                        <StatusToken value={session.bugFixTraceStatus} />
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
              {queueTotal === 0
                ? "0 sessions"
                : `Showing ${rangeStart}–${rangeEnd} of ${queueTotal}`}
            </span>
            <div className="workbench-pagination-actions">
              <AppButton
                variant="quiet"
                onClick={() => setPage?.(Math.max(0, safePage - 1))}
                disabled={loading || safePage <= 0}
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
                      <p className="workbench-activity-summary">
                        {sanitizeWorkbenchVisibleText(item.summary)}
                      </p>
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

function resolvePrimaryAction(
  selectedSessions: UseWorkbenchControllerResult["sessions"],
  canRun: UseWorkbenchControllerResult["canRun"]
): WorkbenchActionKind | null {
  if (selectedSessions.length === 0) return null;

  const nextActions = new Set(selectedSessions.map((session) => session.nextAction));
  if (nextActions.size === 1) {
    const next = selectedSessions[0]?.nextAction;
    const mapped = mapNextActionToKind(next);
    if (mapped && canRun(mapped)) return mapped;
  }

  if (canRun("copy_agent_prompt")) return "copy_agent_prompt";
  return null;
}

function mapNextActionToKind(nextAction: string | undefined): WorkbenchActionKind | null {
  switch (nextAction) {
    case "check_transcript":
      return "check_transcript";
    case "import_transcript":
      return "import_transcript";
    case "review_quality":
      return "quality_pass";
    case "enrich":
    case "create_dossier":
      return "copy_agent_prompt";
    case "publish":
      return "publish";
    default:
      return null;
  }
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
