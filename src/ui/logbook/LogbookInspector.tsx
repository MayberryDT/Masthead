import type { LogbookExcerpt, LogbookSessionDetail } from "../../app/daemonClient";
import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";
import { StatusBadge } from "../primitives/StatusBadge";

type Props = {
  excerpts: LogbookExcerpt[];
  compactHeader?: boolean;
  loading?: boolean;
  session?: LogbookSessionDetail;
  onClose: () => void;
};

export function LogbookInspector({ compactHeader = false, excerpts, loading = false, onClose, session }: Props) {
  if (!session && !loading) return null;

  return (
    <aside className="logbook-inspector metal-surface" aria-label="Session detail">
      {compactHeader ? null : (
        <header>
          <div>
            <p className="mono-label">Session detail</p>
            <h2>{session?.title ?? "Loading session"}</h2>
          </div>
          <button type="button" className="surface-inline-action logbook-inspector-close" aria-label="Close session detail" onClick={onClose}>
            <Icon name="close" size="toolbar" weight={iconWeights.toolbar} />
          </button>
        </header>
      )}

      {session ? (
        <>
          <dl className="logbook-inspector-facts">
            <DetailFact label="Project" value={session.project ?? "Not captured"} />
            <DetailFact label="Runtime" value={runtimeLabel(session.runtime)} />
            <DetailFact label="Lifecycle" value={<span className={`state-token ${stateToneClass(session.lifecycle)}`.trim()}>{labelize(session.lifecycle)}</span>} />
            <DetailFact label="Models" value={session.models.join(", ") || "Not captured"} />
            <DetailFact label="Host" value={session.hostId} />
            <DetailFact label="Branch" value={session.branch ?? "Not captured"} />
            <DetailFact label="Started" value={formatDateTime(session.startedAt)} />
            <DetailFact label="Last activity" value={formatDateTime(session.lastActivityAt)} />
            <DetailFact label="Duration" value={durationLabel(session.durationMs, session.startedAt, session.endedAt)} />
            <DetailFact label="Errors" value={String(session.errorCount)} />
            <DetailFact label="MCP" value={<StatusBadge tone={session.mcpIncluded ? "active" : "warning"}>{session.mcpIncluded ? "Included" : "Excluded"}</StatusBadge>} />
            <DetailFact label="Source confidence" value={<StatusBadge tone={confidenceTone(session.sourceProvenance.sourceConfidence)}>{labelize(session.sourceProvenance.sourceConfidence)}</StatusBadge>} />
          </dl>
          <section className="logbook-inspector-provenance" aria-label="Source provenance">
            <p className="mono-label">Source provenance</p>
            <p>
              {session.sourceProvenance.runtime} / {session.sourceProvenance.hostId} / {session.sourceProvenance.sourceSessionId}
            </p>
            {session.repoRoot ? <p>Repo: {session.repoRoot}</p> : null}
            {session.worktreePath ? <p>Worktree: {session.worktreePath}</p> : null}
          </section>
          {session.objective || session.outcome ? (
            <div className="logbook-inspector-copy">
              {session.objective ? <p>{session.objective}</p> : null}
              {session.outcome ? <p>{session.outcome}</p> : null}
            </div>
          ) : null}
          <div className="logbook-inspector-columns">
            <DetailList label="Topics" values={session.topics} />
            <DetailList label="Tools" values={session.tools} />
            <DetailList label="Unresolved" values={session.unresolved} tone="attention" />
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
              <time dateTime={excerpt.observedAt}>{formatDateTime(excerpt.observedAt)}</time>
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

function DetailList({ label, tone, values }: { label: string; values: string[]; tone?: "attention" }) {
  return (
    <section className={tone === "attention" && values.length > 0 ? "attention" : undefined}>
      <p className="mono-label">{label}</p>
      {values.length > 0 ? <p>{values.join(", ")}</p> : <p className="surface-status">None captured</p>}
    </section>
  );
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "Not captured";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function durationLabel(durationMs: number | undefined, startedAt: string | undefined, endedAt: string | undefined): string {
  const milliseconds = durationMs ?? (startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : undefined);
  if (milliseconds === undefined || Number.isNaN(milliseconds) || milliseconds < 0) return "n/a";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function confidenceTone(confidence: LogbookSessionDetail["sourceConfidence"]): "active" | "info" | "warning" {
  if (confidence === "authoritative") return "active";
  if (confidence === "inferred") return "info";
  return "warning";
}

function runtimeLabel(runtime: string): string {
  return runtime === "codex" ? "Codex" : runtime;
}

function labelize(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function stateToneClass(value: string | undefined): string {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("fail") || normalized.includes("attention") || normalized.includes("blocked")) return "attention";
  if (normalized.includes("unknown") || normalized.includes("pending")) return "neutral";
  return "";
}
