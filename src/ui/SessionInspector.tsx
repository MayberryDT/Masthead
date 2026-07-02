import type { SafeAction, SessionDetailView } from "../core/types";
import { isBlockedSessionCard, stateClassName, statusTokenLabel } from "./format";

// Legacy live inspector. New detail surfaces should use SessionDossier.
type Props = {
  session?: SessionDetailView;
  onAction?: (action: SafeAction, session: SessionDetailView) => void;
  actionStatus?: string;
  compactHeader?: boolean;
};

export function SessionInspector({ session, onAction, actionStatus, compactHeader = false }: Props) {
  if (!session) {
    return (
      <section className="session-inspector-panel empty" aria-label="Session inspector empty state">
        <p className="mono-label">Inspector</p>
        <h2>Select a session</h2>
        <p>Technical details appear here after a session is selected.</p>
      </section>
    );
  }

  const sections = session.inspectorSections ?? ["state", "attention_conflicts", "evidence", "timeline", "actions"];

  return (
    <article className={`session-inspector-panel ${stateClassName(session)}`} aria-label="Selected session technical details">
      {compactHeader ? null : (
        <header className="inspector-head">
          <div>
            <p className="mono-label">
              {session.project} / {session.title}
            </p>
            <h2>{session.headline.headline}</h2>
          </div>
          <span className={`state-token ${isBlockedSessionCard(session) ? "attention" : ""}`}>
            {statusTokenLabel(session)}
          </span>
        </header>
      )}

      <div className="modal-content inspector-content">
        <SessionBrief session={session} />
        {sections.map((section) => {
          if (section === "state") return <StateSection key={section} session={session} />;
          if (section === "latest_feedback" && session.latestFeedback) {
            return <LatestFeedbackSection key={section} session={session} />;
          }
          if (section === "attention_conflicts") return <AttentionConflictSection key={section} session={session} />;
          if (section === "evidence") return <EvidenceSection key={section} session={session} />;
          if (section === "timeline") return <TimelineSection key={section} session={session} />;
          if (section === "actions") {
            return <ActionsSection key={section} session={session} onAction={onAction} actionStatus={actionStatus} />;
          }
          return null;
        })}
      </div>
    </article>
  );
}

function SessionBrief({ session }: { session: SessionDetailView }) {
  const worktree = session.workspace?.branch ?? session.branchOrWorktree ?? "None";
  const model = session.model ?? "Not captured";
  const thinkingLevel = session.thinkingLevel ?? "Not captured";
  const harness = session.harness ?? "Codex";
  const observed = session.evidence.observed.length;
  const inferred = session.evidence.inferred.length;
  const missing = session.evidence.missing.length;
  const detail = headlineDetail(session);
  const evidence = headlineEvidence(session);

  return (
    <section className="session-detail-summary" aria-label="Session brief">
      <div className="summary-hero">
        <p className="block-label">Session brief</p>
        <h3>{detail}</h3>
        {evidence ? <p>{evidence}</p> : null}
      </div>

      <dl className="summary-facts" aria-label="Operational facts">
        <div>
          <dt>Runtime</dt>
          <dd>{session.durationLabel}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{model}</dd>
        </div>
        <div>
          <dt>Thinking</dt>
          <dd>{thinkingLevel}</dd>
        </div>
        <div>
          <dt>Harness</dt>
          <dd>{harness}</dd>
        </div>
        <div>
          <dt>Worktree</dt>
          <dd>{worktree}</dd>
        </div>
      </dl>

      <div className="summary-health" aria-label="Evidence health">
        <p className="block-label">Evidence health</p>
        <div>
          <span>{observed} observed</span>
          <span>{inferred} inferred</span>
          <span>{missing} missing</span>
        </div>
        <small>
          Last activity {session.lastActivityLabel} / Started {displayTimestamp(session.startedAt ?? session.lastActivity)}
        </small>
      </div>
    </section>
  );
}

function StateSection({ session }: { session: SessionDetailView }) {
  const degradedSessionAttribution =
    session.identityConfidence === "shared_workspace" || session.identityConfidence === "unattributed";
  const degradedConflictAttribution = session.conflicts.some((item) => item.attribution === "degraded");
  const detail = headlineDetail(session);
  const evidence = headlineEvidence(session);

  return (
    <>
      <section className="detail-section detail-focus" aria-label="Current activity">
        <p className="block-label">Current activity</p>
        <h3>{detail}</h3>
        {evidence ? <p>{evidence}</p> : null}
        {degradedSessionAttribution || degradedConflictAttribution ? (
          <p className="attribution-note">
            Attribution degraded. Session: {session.identityConfidence.replace("_", " ")}. Conflict:{" "}
            {degradedConflictAttribution ? "degraded" : "direct"}.
          </p>
        ) : null}
      </section>

      <dl className="detail-section detail-grid" aria-label="Lifecycle and work state">
        <div>
          <dt>Lifecycle</dt>
          <dd>{session.lifecycle}</dd>
        </div>
        <div>
          <dt>Outcome</dt>
          <dd>{session.outcomeLabel ?? session.endReason ?? "Not ended"}</dd>
        </div>
        <div>
          <dt>Worktree</dt>
          <dd>
            {session.changedFileCount} changed files
            {session.workspace?.branch ? `, ${session.workspace.branch}` : ""}
          </dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{session.reviewAnnotations.length === 0 ? "No local review disposition" : reviewSummary(session)}</dd>
        </div>
      </dl>
    </>
  );
}

function headlineDetail(session: SessionDetailView): string {
  return sentence(session.headline.frame?.disposition ?? session.currentActivity ?? session.headline.headline);
}

function headlineEvidence(session: SessionDetailView): string | undefined {
  return session.headline.frame?.evidence.find(Boolean);
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function displayTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function LatestFeedbackSection({ session }: { session: SessionDetailView }) {
  if (!session.latestFeedback) return null;

  return (
    <section className="detail-section latest-feedback" aria-label="Latest agent feedback">
      <p className="block-label">Latest agent feedback</p>
      <p>{session.latestFeedback.text}</p>
      <div className="section-line">
        <span>{session.latestFeedback.source.replace("_", " ")}</span>
        <span>{session.latestFeedback.observedAt}</span>
      </div>
    </section>
  );
}

function AttentionConflictSection({ session }: { session: SessionDetailView }) {
  return (
    <section className="detail-section" aria-label="Attention and conflicts">
      <div className="section-line">
        <span>
          {session.attentionItems.length} attention / {session.conflicts.length} conflicts
        </span>
      </div>
      {session.conflicts.length > 0 ? (
        <ul className="detail-list">
          {session.conflicts.map((conflict) => (
            <li key={conflict.conflictId}>
              <strong>{conflict.title}</strong>
              <span>{conflict.sharedPaths.join(", ") || conflict.type}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No unresolved conflict evidence.</p>
      )}
    </section>
  );
}

function EvidenceSection({ session }: { session: SessionDetailView }) {
  return (
    <section className="detail-section" aria-label="Evidence">
      <div className="section-line">
        <span>{session.evidence.observed.length} observed evidence refs</span>
        <span>{session.evidence.inferred.length} inferred refs</span>
        <span>{session.evidence.missing.length} missing refs</span>
      </div>
    </section>
  );
}

function TimelineSection({ session }: { session: SessionDetailView }) {
  return (
    <section className="detail-section" aria-label="Timeline">
      <div className="section-line">
        <span>{session.timeline.length} timeline events</span>
      </div>
      <ul className="timeline-list">
        {session.timeline.slice(-5).map((event) => (
          <li key={event.eventId}>
            <span>{event.occurredAt}</span>
            <strong>{event.type}</strong>
            <em>{event.summary}</em>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActionsSection({
  session,
  onAction,
  actionStatus
}: {
  session: SessionDetailView;
  onAction?: (action: SafeAction, session: SessionDetailView) => void;
  actionStatus?: string;
}) {
  return (
    <section className="detail-section" aria-label="Actions">
      <footer className="modal-actions">
        {session.safeActions.map((action) => (
          <button
            key={action}
            type="button"
            className={action === "open_source_session" ? "primary-pill" : "ghost-pill"}
            onClick={() => onAction?.(action, session)}
          >
            {actionLabel(action)}
          </button>
        ))}
      </footer>
      {actionStatus ? <p className="action-status">{actionStatus}</p> : null}
    </section>
  );
}

function reviewSummary(session: SessionDetailView): string {
  const latest = session.reviewAnnotations.at(-1);
  if (!latest) return "No local review disposition";
  const stale = latest.stale ? "previously " : "";
  return `${stale}${latest.status.replace("_", " ")} at ${latest.recordedAt}`;
}

function actionLabel(action: SafeAction): string {
  const labels: Record<SafeAction, string> = {
    open_source_session: "Open Codex",
    open_repo: "Open repo",
    open_file: "Open file",
    open_readonly_diff: "Open diff",
    snooze: "Snooze",
    dismiss: "Dismiss",
    mark_reviewed: "Mark reviewed",
    mark_expected: "Mark expected"
  };
  return labels[action];
}
