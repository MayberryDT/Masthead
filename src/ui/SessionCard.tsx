import type { CSSProperties } from "react";
import type { SessionCardView } from "../core/types";
import { isBlockedSessionCard } from "./format";
import type { DemoSessionTelemetry } from "./observabilityDemo";

type Props = {
  session: SessionCardView;
  onToggle?: (sessionId: string) => void;
  demoTelemetry?: DemoSessionTelemetry;
  isNew?: boolean;
  newCardIndex?: number;
  headlineUpdateIndex?: number;
};

export function SessionCard({ session, onToggle, demoTelemetry, newCardIndex = 0 }: Props) {
  const stateClass = sessionStateClassName(session);
  const model = demoTelemetry?.model.value ?? session.model ?? "Not captured";
  const harness = demoTelemetry?.harness.value ?? session.harness ?? "Codex";
  const worktree = session.branchOrWorktree ?? "None";
  const headline = sessionHeadline(session);
  const sessionName = sessionHeaderName(session);
  const style = {
    viewTransitionName: `session-card-${viewTransitionNamePart(session.sessionId)}`,
    "--new-card-index": Math.min(newCardIndex, 4)
  } as CSSProperties & { "--new-card-index": number };

  return (
    <article
      className={`session-card bottom-variant-card dovetail-card ${stateClass}`}
      data-session-id={session.sessionId}
      style={style}
      role="button"
      aria-label={`Open ${headline} details`}
      tabIndex={0}
      onClick={() => onToggle?.(session.sessionId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle?.(session.sessionId);
        }
      }}
    >
      <span className="bottom-signal" aria-hidden="true" />
      <header className="card-topline">
        <span className="project" title={sessionName}>
          {sessionName}
        </span>
        <span className="runtime-tag">{harness}</span>
        <span className="state-pill">{sessionStatePillLabel(session)}</span>
      </header>

      <h3 className="headline">{headline}</h3>

      <div className="fact-grid">
        <Fact label="Runtime" value={harness} />
        <Fact label="Tokens" value={tokenLabel(session.totalTokens)} />
        <Fact label="Model" value={model} />
        <Fact label="Worktree" value={worktree} />
      </div>

      <footer className="footer-line">
        <span>
          Last activity <span className="timestamp">{session.lastActivityLabel}</span>
        </span>
        <span>
          Duration <span className="timestamp">{session.durationLabel}</span>
        </span>
      </footer>
    </article>
  );
}

function viewTransitionNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <div className="fact-value">{value}</div>
      <div className="fact-label">{label}</div>
    </div>
  );
}

function sessionStatePillLabel(session: SessionCardView): string {
  if (isBlockedSessionCard(session)) return "Blocked";
  if (session.lifecycle === "idle" || session.lifecycle === "ended" || session.primaryStatus === "stalled") return "Idle";
  return "Active";
}

function sessionStateClassName(session: SessionCardView): "is-active" | "is-idle" | "is-blocked" {
  if (isBlockedSessionCard(session)) return "is-blocked";
  if (session.lifecycle === "idle" || session.lifecycle === "ended" || session.primaryStatus === "stalled") return "is-idle";
  return "is-active";
}

function startedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function tokenLabel(value: number | undefined): string {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0
  }).format(value);
}

function sessionHeaderName(session: SessionCardView): string {
  const project = cleanProjectName(session.project);
  const context = meaningfulWorkContext(session.workContext?.label, project);
  if (context) return `${project} · ${context}`;
  return `${project} · ${startedLabel(session.startedAt ?? session.lastActivity)}`;
}

function sessionHeadline(session: SessionCardView): string {
  return cleanHeadline(session.copy.headline) ?? meaningfulSessionTitle(session.title, session.project) ?? `${session.project} session update`;
}

function cleanSessionName(value: string | undefined): string | undefined {
  const label = value?.replace(/\s+/g, " ").trim();
  if (!label) return undefined;
  if (/^unknown project$/i.test(label)) return undefined;
  if (/^[a-f0-9-]{12,}(?:\s+session)?$/i.test(label)) return undefined;
  return label;
}

function meaningfulSessionTitle(value: string | undefined, project: string): string | undefined {
  const label = cleanSessionName(value);
  if (!label) return undefined;

  const normalizedLabel = label.toLowerCase();
  const normalizedProject = project.trim().toLowerCase();
  if (
    normalizedLabel === "codex session" ||
    normalizedLabel === "codex hook event" ||
    normalizedLabel === "untitled session" ||
    normalizedLabel === "session"
  ) {
    return undefined;
  }
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

function cleanHeadline(value: string | undefined): string | undefined {
  const label = value?.replace(/\s+/g, " ").trim();
  if (!label) return undefined;
  if (containsSensitiveMarker(label)) return undefined;
  if (looksSerialized(label)) return undefined;
  if (looksLikeRawCommand(label)) return undefined;
  return label;
}

function looksSerialized(label: string): boolean {
  return (
    /^[{[]/.test(label) ||
    /["'](?:type|event|payload|command|arguments|content)["']\s*:/.test(label) ||
    /\\n|\\\"/.test(label)
  );
}

function looksLikeRawCommand(label: string): boolean {
  return /^(?:npm|pnpm|yarn|node|python|python3|bash|sh|zsh|git|curl|cat|sed|rg|grep)\s+/.test(label);
}

function cleanProjectName(value: string): string {
  const label = value.replace(/\s+/g, " ").trim();
  if (!label || /^unknown project$/i.test(label)) return "Session";
  return label;
}

function meaningfulWorkContext(value: string | undefined, project: string): string | undefined {
  const label = value?.replace(/\s+/g, " ").trim();
  if (!label) return undefined;
  const normalized = label.toLowerCase();
  if (["session work", "work", "unknown", "generic"].includes(normalized)) return undefined;
  if (normalized === project.toLowerCase()) return undefined;
  if (containsSensitiveMarker(label)) return undefined;
  return label;
}
