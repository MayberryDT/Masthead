import type { LiveBoardProjection, SessionCardView } from "../core/types";

type Props = {
  sourceLabel: string;
  summary: LiveBoardProjection["summary"];
  sessions: SessionCardView[];
  selectedSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
};

export function SessionRail({ sourceLabel, summary, sessions, selectedSessionId, onSelectSession }: Props) {
  return (
    <div className="session-rail-panel">
      <header className="rail-head">
        <p className="mono-label">Control plane</p>
        <h2>Sessions</h2>
        <span className="source-token">{sourceLabel}</span>
      </header>

      <dl className="rail-counts" aria-label="Session counts">
        <div>
          <dt>Active</dt>
          <dd>{summary.active} active</dd>
        </div>
        <div>
          <dt>Attention</dt>
          <dd>{summary.needsAttention} needs attention</dd>
        </div>
        <div>
          <dt>Conflicts</dt>
          <dd>{summary.conflicts} overlaps</dd>
        </div>
      </dl>

      <nav className="rail-session-list" aria-label="Visible sessions">
        {sessions.length === 0 ? (
          <p className="rail-empty">No sessions are visible.</p>
        ) : (
          sessions.map((session) => (
            <button
              key={session.sessionId}
              type="button"
              className={`rail-session ${session.sessionId === selectedSessionId ? "selected" : ""}`}
              onClick={() => onSelectSession(session.sessionId)}
              aria-current={session.sessionId === selectedSessionId ? "true" : undefined}
            >
              <span className="rail-session-project">{session.project}</span>
              <strong>{session.copy.headline}</strong>
              <span>{session.copy.status}</span>
            </button>
          ))
        )}
      </nav>
    </div>
  );
}
