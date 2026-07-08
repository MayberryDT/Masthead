import type { UseWorkbenchControllerResult } from "../../app/workbench/useWorkbenchController";
import { AppButton } from "../primitives/AppButton";
import { sanitizeWorkbenchVisibleText } from "./workbenchHandoff";

type WorkbenchPanelProps = Partial<Pick<UseWorkbenchControllerResult, "error" | "handoffText" | "loading" | "selectedSessionIds" | "sessions">> & {
  activity?: UseWorkbenchControllerResult["activity"];
  notAddedSummary?: UseWorkbenchControllerResult["notAddedSummary"];
  onClearSelection?: () => void;
  onRetry?: () => void;
  onSelectAllVisible?: () => void;
  onToggleSession?: (sessionId: string) => void;
};

const EMPTY_SELECTION = new Set<string>();

export function WorkbenchPanel({
  activity = [],
  error,
  handoffText = "",
  loading = false,
  notAddedSummary,
  onClearSelection,
  onRetry,
  onSelectAllVisible,
  onToggleSession,
  selectedSessionIds = EMPTY_SELECTION,
  sessions = []
}: WorkbenchPanelProps) {
  const selectionCount = selectedSessionIds.size;
  const canCopyAgentPrompt = selectionCount > 0 && handoffText.trim().length > 0;
  const publishPathLabel = loading ? "…" : String(sessions.length);
  const notAddedLabel = notAddedSummary != null ? String(notAddedSummary.total) : undefined;
  const copyAgentPrompt = () => {
    if (!canCopyAgentPrompt) return;
    void copyTextToClipboard(handoffText);
  };

  return (
    <section className="workbench-panel surface-panel" aria-label="Workbench">
      <div className="workbench-toolbar observability-toolbar metal-toolbar" role="toolbar" aria-label="Workbench actions">
        <div className="workbench-toolbar-actions toolbar-select-row" aria-label="Workbench selection actions">
          <AppButton variant="primary" onClick={copyAgentPrompt} disabled={!canCopyAgentPrompt}>
            Copy Agent Prompt
          </AppButton>
          <AppButton onClick={onSelectAllVisible} disabled={loading || sessions.length === 0}>
            Select Visible
          </AppButton>
          <AppButton variant="quiet" onClick={onClearSelection} disabled={selectionCount === 0}>
            Clear
          </AppButton>
          <AppButton onClick={onRetry} disabled={loading}>
            Refresh
          </AppButton>
        </div>
        <dl className="workbench-toolbar-facts" aria-label="Workbench queue facts">
          <div>
            <dt>Publish path</dt>
            <dd>{publishPathLabel}</dd>
          </div>
          {selectionCount > 0 ? (
            <div>
              <dt>Selected</dt>
              <dd>{selectionCount}</dd>
            </div>
          ) : null}
          {notAddedLabel != null ? (
            <div>
              <dt>Not Added to Logbook</dt>
              <dd>{notAddedLabel}</dd>
            </div>
          ) : null}
        </dl>
      </div>

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

      <section className="workbench-layout">
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
                  const latestSummary = session.latestActivity?.summary ? sanitizeWorkbenchVisibleText(session.latestActivity.summary) : safeLastActivity;
                  const claim = session.activeClaim ? sanitizeWorkbenchVisibleText(session.activeClaim.claimedBy) : "-";

                  return (
                    <tr key={session.sessionId} className={selected ? "is-selected" : undefined}>
                      <td>
                        <label className="workbench-session-main">
                          <input type="checkbox" checked={selected} onChange={() => onToggleSession?.(session.sessionId)} aria-label={`Select ${safeTitle}`} />
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

        <aside className="workbench-activity-rail" aria-label="Workbench Activity">
          <div className="workbench-rail-block workbench-activity-block">
            <p className="mono-label">Workbench Activity</p>
            {activity.length === 0 ? (
              <p className="workbench-muted">No activity yet</p>
            ) : (
              <ol className="workbench-activity-list">
                {activity.map((item) => (
                  <li key={item.activityId}>
                    <span>{sanitizeWorkbenchVisibleText(item.summary)}</span>
                    <small>
                      {sanitizeWorkbenchVisibleText(item.eventType)} / {sanitizeWorkbenchVisibleText(item.actorId ?? item.actorKind)}
                    </small>
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
  return <span className={`workbench-status-token is-${statusClass(value)} ${tone === "next" ? "is-next" : ""}`.trim()}>{formatStatus(value, safeValue)}</span>;
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
