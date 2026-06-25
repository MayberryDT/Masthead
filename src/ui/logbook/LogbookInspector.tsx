import type { LogbookExcerpt, LogbookSessionDetail } from "../../app/daemonClient";
import type { ReactNode } from "react";
import { StatusBadge } from "../primitives/StatusBadge";

type Props = {
  excerpts: LogbookExcerpt[];
  loading?: boolean;
  session?: LogbookSessionDetail;
  onClose: () => void;
};

export function LogbookInspector({ excerpts, loading = false, onClose, session }: Props) {
  if (!session && !loading) return null;

  return (
    <aside className="logbook-inspector metal-surface" aria-label="Session detail">
      <header>
        <div>
          <p className="mono-label">Session detail</p>
          <h2>{session?.title ?? "Loading session"}</h2>
        </div>
        <button type="button" className="surface-inline-action" onClick={onClose}>
          Close
        </button>
      </header>

      {session ? (
        <>
          <dl className="logbook-inspector-facts">
            <DetailFact label="Project" value={session.project ?? "Not captured"} />
            <DetailFact label="Runtime" value={session.runtime} />
            <DetailFact label="Models" value={session.models.join(", ") || "Not captured"} />
            <DetailFact label="Host" value={session.hostId} />
            <DetailFact label="Branch" value={session.branch ?? "Not captured"} />
            <DetailFact label="MCP" value={<StatusBadge tone={session.mcpIncluded ? "active" : "warning"}>{session.mcpIncluded ? "Included" : "Excluded"}</StatusBadge>} />
          </dl>
          {session.objective || session.outcome ? (
            <div className="logbook-inspector-copy">
              {session.objective ? <p>{session.objective}</p> : null}
              {session.outcome ? <p>{session.outcome}</p> : null}
            </div>
          ) : null}
          <div className="logbook-inspector-columns">
            <DetailList label="Topics" values={session.topics} />
            <DetailList label="Files" values={session.files} />
            <DetailList label="Tools" values={session.tools} />
          </div>
        </>
      ) : (
        <p className="surface-status">Loading session detail...</p>
      )}

      <section className="logbook-excerpts" aria-label="Relevant excerpts">
        <p className="mono-label">Relevant excerpts</p>
        {excerpts.length > 0 ? (
          excerpts.map((excerpt) => (
            <article key={excerpt.excerptId} className="logbook-excerpt">
              <strong>{excerpt.role ?? excerpt.kind}</strong>
              <p>{excerpt.text}</p>
            </article>
          ))
        ) : (
          <p className="surface-status">No relevant excerpts found.</p>
        )}
      </section>
    </aside>
  );
}

function DetailFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function DetailList({ label, values }: { label: string; values: string[] }) {
  return (
    <section>
      <p className="mono-label">{label}</p>
      {values.length > 0 ? <p>{values.join(", ")}</p> : <p className="surface-status">None captured</p>}
    </section>
  );
}
