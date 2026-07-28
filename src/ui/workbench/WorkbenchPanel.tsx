import { useEffect, useId, useRef, useState } from "react";
import type { WorkbenchActionKind, UseWorkbenchControllerResult } from "../../app/workbench/useWorkbenchController";
import { AppButton } from "../primitives/AppButton";
import { useNewItemIds } from "../motion/useNewItemIds";
import {
  formatWorkbenchActivityTime,
  workbenchActivityLabel,
  workbenchActivityReason,
  workbenchActivityTone
} from "./workbenchActivity";
import { sanitizeWorkbenchVisibleText } from "./workbenchHandoff";
import {
  formatCopyAgentPromptLabel,
  formatCopyAgentPromptTitle,
  formatWorkbenchSelectionHonesty
} from "./workbenchSelectionHonesty";

type WorkbenchPanelProps = Partial<
  Pick<
    UseWorkbenchControllerResult,
    | "actionBusy"
    | "actionError"
    | "activity"
    | "agentPromptExcludedCount"
    | "agentPromptSessionCount"
    | "canRun"
    | "clearActionFeedback"
    | "copyAgentPrompt"
    | "copyResumePrompt"
    | "error"
    | "incompleteAuthoring"
    | "lastActionSummary"
    | "loading"
    | "notAddedOpen"
    | "notAddedSessions"
    | "notAddedSummary"
    | "page"
    | "pageSize"
    | "qualityReviewOpen"
    | "qualityReviewSessions"
    | "qualityReviewSummary"
    | "qualityReviewSelectedCount"
    | "runAction"
    | "selectedSessionIds"
    | "sessions"
    | "setNotAddedOpen"
    | "setQualityReviewOpen"
    | "setPage"
    | "total"
>
> & {
  /** Compatibility-only test input; V4 prompts are created durably on click. */
  handoffText?: string;
  onClearSelection?: () => void;
  onRetry?: () => void;
  onSelectAll?: () => void;
  onSelectPage?: () => void;
  onToggleSession?: (sessionId: string) => void;
};

const EMPTY_SELECTION = new Set<string>();
const EMPTY_SESSIONS: UseWorkbenchControllerResult["sessions"] = [];
const EMPTY_NOT_ADDED: UseWorkbenchControllerResult["notAddedSessions"] = [];
const EMPTY_QUALITY_REVIEW: UseWorkbenchControllerResult["qualityReviewSessions"] = [];
const EMPTY_ACTIVITY: UseWorkbenchControllerResult["activity"] = [];

const defaultCanRun: UseWorkbenchControllerResult["canRun"] = () => false;

const TOOLTIPS = {
  copyAgentPrompt:
    "Copy a plain-language request for your coding agent to enrich the selected sessions and publish only justified artifacts.",
  selectAll: "Select every package-path session across all pages (not just this page).",
  clear: "Clear the current selection.",
  pipeline:
    "Expand pipeline operations to the right: enroll, transcript, quality, and claims.",
  enrollMissing: "Add captured sessions that are not yet on the Workbench package path.",
  checkTranscript: "Run a lightweight transcript availability check on selected sessions.",
  importTranscript: "Import transcript content for selected sessions (requires source permission).",
  precheck: "Run the cheap capture quality precheck on selected review sessions and apply pass/fail automatically.",
  acceptQuality:
    "Accept quality for selected review sessions only. Marks them quality passed so they become compile-ready for enrichment. Ready/passed sessions in the selection are left unchanged. Masthead does not write enrichment prose.",
  failQuality:
    "Fail quality for selected review sessions only. Moves them to Not Added with reason operator rejected. Destructive: they leave the package path. Ready/passed sessions in the selection are left unchanged.",
  claim: "Place a short-lived claim so agents avoid duplicate work on selected sessions.",
  release: "Release active claims on selected sessions.",
  pagePrevious: "Show the previous page of package-path sessions.",
  pageNext: "Show the next page of package-path sessions.",
  selectPage: "Select or clear all sessions on this page.",
  notAdded: "Review sessions excluded from the package path (Not Added).",
  qualityReview:
    "Package-path sessions that need a quality decision (review_quality) before enrichment."
} as const;

type PipelineItem = {
  kind: WorkbenchActionKind;
  label: string;
  tooltip: string;
  quiet?: boolean;
};

const PIPELINE_BASE_ITEMS: PipelineItem[] = [
  { kind: "enroll_missing", label: "Enroll missing", tooltip: TOOLTIPS.enrollMissing },
  { kind: "check_transcript", label: "Check Transcript", tooltip: TOOLTIPS.checkTranscript },
  { kind: "import_transcript", label: "Import Transcript", tooltip: TOOLTIPS.importTranscript },
  { kind: "quality_precheck", label: "Precheck", tooltip: TOOLTIPS.precheck },
  { kind: "quality_pass", label: "Accept Quality", tooltip: TOOLTIPS.acceptQuality },
  { kind: "quality_fail", label: "Fail Quality", tooltip: TOOLTIPS.failQuality, quiet: true },
  { kind: "claim", label: "Claim", tooltip: TOOLTIPS.claim },
  { kind: "release", label: "Release", tooltip: TOOLTIPS.release }
];

/** Confirm copy for bulk fail — destructive, explicit Not Added semantics. */
export function buildBulkQualityFailConfirmMessage(reviewCount: number): string {
  const n = Math.max(0, Math.trunc(reviewCount));
  const noun = n === 1 ? "review session" : "review sessions";
  return [
    `Fail quality for ${n} selected ${noun}?`,
    "",
    "This moves them to Not Added (reason: operator rejected). They leave the package path.",
    "Ready/passed sessions in the selection are not affected.",
    "Masthead will not author artifacts or write enrichment prose."
  ].join("\n");
}

/** Confirm copy for bulk accept — explicit compile-ready / no silent authoring. */
export function buildBulkQualityAcceptConfirmMessage(reviewCount: number): string {
  const n = Math.max(0, Math.trunc(reviewCount));
  const noun = n === 1 ? "review session" : "review sessions";
  return [
    `Accept quality for ${n} selected ${noun}?`,
    "",
    "They will be marked quality passed and become compile-ready for enrichment.",
    "Ready/passed sessions in the selection are not affected.",
    "Masthead will not write enrichment prose."
  ].join("\n");
}

function pipelineItemsForSelection(qualityReviewSelectedCount: number): PipelineItem[] {
  if (qualityReviewSelectedCount <= 0) return PIPELINE_BASE_ITEMS;
  const n = qualityReviewSelectedCount;
  return PIPELINE_BASE_ITEMS.map((item) => {
    if (item.kind === "quality_pass") {
      return {
        ...item,
        label: n === 1 ? "Accept 1 review" : `Accept ${n} review`,
        tooltip: `${TOOLTIPS.acceptQuality} (${n} selected need quality review.)`
      };
    }
    if (item.kind === "quality_fail") {
      return {
        ...item,
        label: n === 1 ? "Fail 1 review" : `Fail ${n} review`,
        tooltip: `${TOOLTIPS.failQuality} (${n} selected need quality review.)`
      };
    }
    if (item.kind === "quality_precheck") {
      return {
        ...item,
        label: n === 1 ? "Precheck 1 review" : `Precheck ${n} review`,
        tooltip: `${TOOLTIPS.precheck} (${n} selected need quality review.)`
      };
    }
    return item;
  });
}

export function WorkbenchPanel({
  actionBusy = false,
  actionError,
  activity = EMPTY_ACTIVITY,
  agentPromptExcludedCount = 0,
  agentPromptSessionCount = 0,
  canRun = defaultCanRun,
  clearActionFeedback,
  copyAgentPrompt,
  copyResumePrompt,
  error,
  incompleteAuthoring,
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
  qualityReviewOpen = false,
  qualityReviewSessions = EMPTY_QUALITY_REVIEW,
  qualityReviewSummary,
  qualityReviewSelectedCount = 0,
  runAction,
  selectedSessionIds = EMPTY_SELECTION,
  sessions = EMPTY_SESSIONS,
  setNotAddedOpen,
  setQualityReviewOpen,
  setPage,
  total
}: WorkbenchPanelProps) {
  const selectionCount = selectedSessionIds.size;
  const selectedSessions = sessions.filter((session) => selectedSessionIds.has(session.sessionId));
  /** Prefer controller-tracked count; fall back to visible page for partial props / tests. */
  const reviewSelectedCount =
    qualityReviewSelectedCount > 0
      ? qualityReviewSelectedCount
      : selectedSessions.filter(
          (session) => session.nextAction === "review_quality" || session.qualityStatus === "unchecked"
        ).length;
  const pipelineItems = pipelineItemsForSelection(reviewSelectedCount);
  const queueTotal = typeof total === "number" ? total : sessions.length;
  const publishPathLabel = typeof total === "number" ? String(total) : loading ? "…" : String(queueTotal);
  const notAddedTotal = notAddedSummary?.total;
  const notAddedLabel = notAddedTotal != null ? String(notAddedTotal) : undefined;
  const qualityReviewTotal = qualityReviewSummary?.total;
  const qualityReviewLabel = qualityReviewTotal != null ? String(qualityReviewTotal) : undefined;
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
  const copyAgentPromptTitle = formatCopyAgentPromptTitle({
    selectionCount,
    ready: agentPromptSessionCount,
    excluded: agentPromptExcludedCount,
    defaultTitle: TOOLTIPS.copyAgentPrompt
  });
  const copyAgentPromptLabel = formatCopyAgentPromptLabel({
    ready: agentPromptSessionCount,
    excluded: agentPromptExcludedCount
  });
  const selectionHonesty =
    selectionCount > 0
      ? formatWorkbenchSelectionHonesty({
          selected: selectionCount,
          ready: agentPromptSessionCount,
          needQualityReview: agentPromptExcludedCount
        })
      : undefined;

  const pageSessionIds = sessions.map((session) => session.sessionId);
  const newSessionIds = useNewItemIds(pageSessionIds, page);
  const newActivityIds = useNewItemIds(activity.map((item) => item.activityId));
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

  const run = async (kind: WorkbenchActionKind) => {
    if (!canRun(kind) || actionBusy) return;
    if (kind === "copy_agent_prompt") {
      try {
        const prompt = await copyAgentPrompt?.();
        if (!prompt || !(await copyTextToClipboard(prompt))) return;
      } catch {
        return;
      }
    }
    if (kind === "quality_fail") {
      const confirmed = window.confirm(buildBulkQualityFailConfirmMessage(reviewSelectedCount));
      if (!confirmed) return;
    } else if (kind === "quality_pass" && reviewSelectedCount > 1) {
      // Multi-select accept: explicit confirm so bulk pass is intentional.
      const confirmed = window.confirm(buildBulkQualityAcceptConfirmMessage(reviewSelectedCount));
      if (!confirmed) return;
    }
    await runAction?.(kind);
  };

  const runCopyResume = async () => {
    if (actionBusy || !copyResumePrompt || !incompleteAuthoring) return;
    try {
      const prompt = await copyResumePrompt();
      if (!prompt || !(await copyTextToClipboard(prompt))) return;
      clearActionFeedback?.();
    } catch {
      return;
    }
  };

  const incompleteBannerLabel = incompleteAuthoring
    ? `Authoring incomplete: ${incompleteAuthoring.packsCompleted}/${incompleteAuthoring.packCount} packs · ${incompleteAuthoring.sessionsCompleted}/${incompleteAuthoring.sessionCount} sessions. Copy resume prompt to continue.`
    : undefined;

  const toggleNotAdded = () => {
    setNotAddedOpen?.(!notAddedOpen);
  };

  const toggleQualityReview = () => {
    setQualityReviewOpen?.(!qualityReviewOpen);
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
            onClick={() => void run("copy_agent_prompt")}
            disabled={!canRun("copy_agent_prompt")}
            title={copyAgentPromptTitle}
          >
            {copyAgentPromptLabel}
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
          {onRetry ? (
            <AppButton
              variant="quiet"
              onClick={onRetry}
              disabled={actionBusy}
              title="Reload the Workbench queue and activity"
            >
              Refresh
            </AppButton>
          ) : null}

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
              {pipelineItems.map((item) => (
                <AppButton
                  key={item.kind}
                  variant={item.quiet ? "quiet" : "default"}
                  disabled={!canRun(item.kind) || actionBusy || !pipelineExpanded || pipelineClosing}
                  title={item.tooltip}
                  tabIndex={pipelineExpanded && !pipelineClosing ? 0 : -1}
                  onClick={() => void run(item.kind)}
                >
                  {item.label}
                </AppButton>
              ))}
            </div>
          </div>
        </div>

        <dl className="workbench-toolbar-facts" aria-label="Workbench queue facts">
          <div title="Sessions on the package path waiting for Workbench processing and automatic kind resolution">
            <dt>Package path</dt>
            <dd>{publishPathLabel}</dd>
          </div>
          <div
            title={
              selectionHonesty ??
              "Sessions currently selected for bulk actions. Only compile-ready sessions enter Copy Agent Prompt."
            }
          >
            <dt>Selected</dt>
            <dd>{selectionCount}</dd>
            {selectionHonesty ? (
              <span className="workbench-selection-readiness" data-selection-honesty="true">
                {selectionHonesty.replace(/^Selected\s+\d+\s*/, "")}
              </span>
            ) : null}
          </div>
          {qualityReviewLabel != null ? (
            <div
              className={qualityReviewOpen ? "is-active" : undefined}
              title={TOOLTIPS.qualityReview}
            >
              <dt>Quality review</dt>
              <dd>
                <button
                  type="button"
                  className="workbench-fact-toggle"
                  onClick={toggleQualityReview}
                  aria-pressed={qualityReviewOpen}
                  aria-label={`Quality review ${qualityReviewLabel}, ${qualityReviewOpen ? "close" : "open"} list`}
                  title={TOOLTIPS.qualityReview}
                >
                  {qualityReviewLabel}
                </button>
              </dd>
            </div>
          ) : null}
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

      {incompleteBannerLabel ? (
        <section
          className="workbench-incomplete-banner surface-status"
          aria-label="Incomplete authoring request"
          role="status"
        >
          <div className="workbench-incomplete-banner-body">
            <p className="mono-label">Authoring incomplete</p>
            <p>{incompleteBannerLabel}</p>
          </div>
          <AppButton
            variant="primary"
            className="workbench-copy-resume"
            onClick={() => void runCopyResume()}
            disabled={actionBusy || !copyResumePrompt}
            title="Copy the bootstrap resume prompt for the active authoring request"
          >
            Copy resume prompt
          </AppButton>
        </section>
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

      {qualityReviewOpen ? (
        <section
          className="workbench-not-added-panel workbench-quality-review-panel"
          aria-label="Quality review (package path)"
        >
          <div className="workbench-not-added-header">
            <p className="mono-label">Quality review — still on package path</p>
            <AppButton variant="quiet" onClick={() => setQualityReviewOpen?.(false)}>
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
                {qualityReviewSessions.length === 0 ? (
                  <tr>
                    <td className="workbench-session-empty" colSpan={4}>
                      No sessions awaiting quality review
                    </td>
                  </tr>
                ) : (
                  qualityReviewSessions.map((session) => {
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

      {notAddedOpen ? (
        <section className="workbench-not-added-panel" aria-label="Not Added (excluded from package path)">
          <div className="workbench-not-added-header">
            <p className="mono-label">Not Added — excluded from package path</p>
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
                  <th scope="col" className="workbench-session-col">session</th>
                  <th scope="col" className="workbench-status-col">next</th>
                  <th scope="col" className="workbench-status-col">transcript</th>
                  <th scope="col" className="workbench-status-col">quality</th>
                  <th scope="col" className="workbench-status-col">resolution</th>
                  <th scope="col" className="workbench-claim-col">claim</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr className="workbench-empty-row">
                    <td className="workbench-session-empty" colSpan={7}>
                      <span className="workbench-empty-title">{loading ? "Loading" : "No package-path sessions"}</span>
                      {!loading ? (
                        <span className="workbench-empty-hint">If Now has captures, open Pipeline → Enroll missing</span>
                      ) : null}
                      {!loading && notAddedTotal != null && notAddedTotal > 0 ? (
                        <button type="button" className="workbench-empty-not-added" onClick={toggleNotAdded}>
                          {notAddedTotal} excluded from package path · open review
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
                    const resolutionStatus = session.resolutionStatus ?? "in_progress";

                    return (
                      <tr
                        key={session.sessionId}
                        className={[
                          selected ? "is-selected" : "",
                          newSessionIds.has(session.sessionId) ? "is-new" : ""
                        ].filter(Boolean).join(" ") || undefined}
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
                        <td className="workbench-session-col">
                          <span className="workbench-session-meta">
                            <strong title={safeTitle}>{safeTitle}</strong>
                            <span className="workbench-session-identity" title={`${safeProject} / ${safeRuntime} / ${safeLifecycle}`}>
                              <span className="workbench-session-project">{safeProject}</span>
                              <span className="workbench-session-sep" aria-hidden="true">
                                /
                              </span>
                              <span className="workbench-session-runtime">{safeRuntime}</span>
                              <span className="workbench-session-sep" aria-hidden="true">
                                /
                              </span>
                              <span className="workbench-session-lifecycle">{safeLifecycle}</span>
                            </span>
                            <span className="workbench-session-id" title={safeSessionId}>
                              {safeSessionId}
                            </span>
                          </span>
                        </td>
                        <td className="workbench-status-col">
                          <StatusToken value={session.nextAction} tone="next" />
                        </td>
                        <td className="workbench-status-col">
                          <StatusToken value={session.transcriptStatus} label={transcriptStatusLabel(session.transcriptStatus)} />
                        </td>
                        <td className="workbench-status-col">
                          <StatusToken value={session.qualityStatus} />
                        </td>
                        <td className="workbench-status-col">
                          <StatusToken value={resolutionStatus} tone="next" />
                        </td>
                        <td className="workbench-claim-col">
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
            <div className="workbench-activity-scroll">
              {activity.length === 0 ? (
                <p className="workbench-muted">No activity yet</p>
              ) : (
                <ol className="workbench-activity-list">
                  {activity.map((item) => {
                    const reason = workbenchActivityReason(item);
                    return (
                      <li
                        key={item.activityId}
                        className={`workbench-activity-item is-${workbenchActivityTone(item.eventType, item.details)} ${newActivityIds.has(item.activityId) ? "is-new" : ""}`.trim()}
                      >
                        <span className="workbench-activity-gutter" aria-hidden="true" />
                        <div className="workbench-activity-body">
                          <div className="workbench-activity-meta">
                            <time dateTime={item.eventAt}>{formatWorkbenchActivityTime(item.eventAt)}</time>
                            <span className="workbench-activity-type">
                              {sanitizeWorkbenchVisibleText(workbenchActivityLabel(item.eventType, item.details))}
                            </span>
                            <span className="workbench-activity-actor">
                              {sanitizeWorkbenchVisibleText(item.actorId ?? item.actorKind)}
                            </span>
                          </div>
                          <p className="workbench-activity-summary">{sanitizeWorkbenchVisibleText(item.summary)}</p>
                          {reason ? (
                            <p className="workbench-activity-reason">{sanitizeWorkbenchVisibleText(reason)}</p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </aside>
      </section>
    </section>
  );
}

function StatusToken({ value, tone, label }: { value: string; tone?: "next"; label?: string }) {
  const safeValue = sanitizeWorkbenchVisibleText(value);
  return (
    <span className={`workbench-status-token is-${statusClass(value)} ${tone === "next" ? "is-next" : ""}`.trim()}>
      {label ?? formatStatus(value, safeValue)}
    </span>
  );
}

function transcriptStatusLabel(value: string): string {
  if (value === "unchecked") return "awaiting transcript";
  if (value === "available") return "transcript available";
  if (value === "imported") return "hydrated";
  if (value === "missing") return "transcript unavailable";
  if (value === "permission_needed") return "permission needed";
  return value.replaceAll("_", " ");
}

function statusClass(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function formatStatus(value: string, fallback: string): string {
  if (!value) return "-";
  return fallback.replace(/_/g, " ");
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
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
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}
