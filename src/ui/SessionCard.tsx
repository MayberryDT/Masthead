import type { SessionCardView } from "../core/types";
import { stateClassName } from "./format";
import { Icon, type IconName } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";
import type { DemoSessionTelemetry } from "./observabilityDemo";

type Props = {
  session: SessionCardView;
  onToggle?: (sessionId: string) => void;
  demoTelemetry?: DemoSessionTelemetry;
};

export function SessionCard({ session, onToggle, demoTelemetry }: Props) {
  const className = stateClassName(session);
  const model = demoTelemetry?.model.value ?? session.model ?? "Not captured";
  const harness = demoTelemetry?.harness.value ?? session.harness ?? "Codex";
  const worktree = session.branchOrWorktree ?? "None";
  const sessionName = sessionHeaderName(session);

  return (
    <article
      className={`session-card metal-surface metal-card ${className}`}
      data-session-id={session.sessionId}
      style={{ viewTransitionName: `session-card-${viewTransitionNamePart(session.sessionId)}` }}
      role="button"
      aria-label={`Open ${session.copy.headline} details`}
      tabIndex={0}
      onClick={() => onToggle?.(session.sessionId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle?.(session.sessionId);
        }
      }}
    >
      <header className="observability-card-head">
        <span className="card-session-name" title={sessionName}>
          {sessionName}
        </span>
        <span className="card-harness">{harness}</span>
        <span className={`state-token ${className === "needs-attention" || className === "conflict" ? "attention" : ""}`}>
          {observabilityStateLabel(session)}
        </span>
      </header>

      <h2>{session.copy.headline}</h2>

      <dl className="observability-card-facts">
        <Fact icon="runtime" label="Runtime" value={harness} valueClassName="runtime-value" />
        <Fact icon="lastActivity" label="Duration" value={session.durationLabel} />
        <Fact icon="model" label="Model" value={model} valueClassName="model-name" />
        <Fact icon="worktree" label="Worktree" value={worktree} valueClassName="worktree-name" />
      </dl>

      <span className="card-rule" aria-hidden="true" />

      <footer className="observability-card-footer">
        <span className="card-footer-meta">
          <Icon name="lastActivity" size="inline" weight={iconWeights.inline} />
          Last activity <span className="timestamp">{session.lastActivityLabel}</span>
        </span>
        <span>
          Started <span className="timestamp">{startedLabel(session.startedAt ?? session.lastActivity)}</span>
        </span>
      </footer>
    </article>
  );
}

function viewTransitionNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function Fact({
  icon,
  label,
  value,
  valueClassName
}: {
  icon: IconName;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <span className="fact-icon" aria-hidden="true">
        <Icon name={icon} size="cardMeta" weight={iconWeights.cardMeta} />
      </span>
      <dt>{label}</dt>
      <dd className={valueClassName}>{value}</dd>
    </div>
  );
}

function observabilityStateLabel(session: SessionCardView): string {
  if (session.primaryStatus === "blocked" || session.outcomeLabel === "blocked") return "Blocked";
  if (session.lifecycle === "idle") return "Idle";
  if (session.lifecycle === "ended" && session.outcomeLabel === "completed") return "Complete";
  if (session.lifecycle === "ended") return "Review";
  return "Active";
}

function startedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sessionHeaderName(session: SessionCardView): string {
  return meaningfulSessionTitle(session.title, session.project) ?? `${session.project} session`;
}

function cleanSessionName(value: string | undefined): string | undefined {
  const label = value?.replace(/\s+/g, " ").trim();
  if (!label) return undefined;
  if (/^unknown project$/i.test(label)) return undefined;
  if (/^[a-f0-9-]{12,}$/i.test(label)) return undefined;
  return label;
}

function meaningfulSessionTitle(value: string | undefined, project: string): string | undefined {
  const label = cleanSessionName(value);
  if (!label) return undefined;

  const normalizedLabel = label.toLowerCase();
  const normalizedProject = project.trim().toLowerCase();
  if (normalizedLabel === "codex session" || normalizedLabel === "untitled session" || normalizedLabel === "session") return undefined;
  if (normalizedProject && normalizedLabel === `${normalizedProject} codex session`) return undefined;
  if (containsSensitiveMarker(label)) return undefined;

  return label;
}

function containsSensitiveMarker(label: string): boolean {
  return (
    /\b(?:private|confidential|secret|token|password)\b/i.test(label) ||
    /\bsk-[A-Za-z0-9_-]+\b/.test(label) ||
    /\bhttps?:\/\//i.test(label) ||
    /@/.test(label)
  );
}
