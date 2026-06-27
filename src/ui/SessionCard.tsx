import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SessionCardView } from "../core/types";
import { isBlockedSessionCard, stateClassName } from "./format";
import { Icon, type IconName } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";
import type { DemoSessionTelemetry } from "./observabilityDemo";

type Props = {
  session: SessionCardView;
  onToggle?: (sessionId: string) => void;
  demoTelemetry?: DemoSessionTelemetry;
  isNew?: boolean;
  newCardIndex?: number;
  headlineUpdateIndex?: number;
};

export function SessionCard({ session, onToggle, demoTelemetry, isNew = false, newCardIndex = 0, headlineUpdateIndex }: Props) {
  const className = stateClassName(session);
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
      className={`session-card metal-surface metal-card ${className}${isNew ? " is-new-card" : ""}`}
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
      <header className="observability-card-head">
        <span className="card-session-name" title={sessionName}>
          {sessionName}
        </span>
        <span className="card-harness">{harness}</span>
        <span className={`state-token ${className === "needs-attention" || className === "conflict" ? "attention" : ""}`}>
          {observabilityStateLabel(session)}
        </span>
      </header>

      <AnimatedHeadline isNew={isNew} staggerIndex={headlineUpdateIndex} text={headline} />

      <dl className="observability-card-facts">
        <Fact icon="runtime" label="Runtime" value={harness} valueClassName="runtime-value" />
        <Fact icon="lastActivity" label="Tokens" value={tokenLabel(session.totalTokens)} />
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
          Duration <span className="timestamp">{session.durationLabel}</span>
        </span>
      </footer>
    </article>
  );
}

function AnimatedHeadline({ isNew, staggerIndex, text }: { isNew: boolean; staggerIndex?: number; text: string }) {
  const [visibleText, setVisibleText] = useState(text);
  const [isTyping, setIsTyping] = useState(false);
  const mountedRef = useRef(false);
  const previousTextRef = useRef(text);
  const isNewRef = useRef(isNew);
  const staggerIndexRef = useRef(staggerIndex);

  isNewRef.current = isNew;
  staggerIndexRef.current = staggerIndex;

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      previousTextRef.current = text;
      setVisibleText(text);
      return;
    }

    if (previousTextRef.current === text) return;
    const oldText = previousTextRef.current;
    previousTextRef.current = text;

    if (isNewRef.current || staggerIndexRef.current === undefined || prefersReducedMotion()) {
      setIsTyping(false);
      setVisibleText(text);
      return;
    }

    setVisibleText(oldText);
    const characters = Array.from(text);
    const startDelay = Math.min(staggerIndexRef.current, 8) * 75;
    const characterDelay = text.length > 72 ? 11 : 16;
    let characterIndex = 0;
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      setIsTyping(true);
      setVisibleText("");
      if (characters.length === 0) {
        setIsTyping(false);
        return;
      }
      intervalId = window.setInterval(() => {
        characterIndex += 1;
        setVisibleText(characters.slice(0, characterIndex).join(""));
        if (characterIndex >= characters.length) {
          if (intervalId !== undefined) window.clearInterval(intervalId);
          intervalId = undefined;
          setIsTyping(false);
        }
      }, characterDelay);
    }, startDelay);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [text]);

  return (
    <h2 className={`card-headline ${isTyping ? "is-headline-typing" : ""}`.trim()} aria-label={text}>
      <span className="card-headline-text" aria-hidden="true">
        {visibleText}
      </span>
      {isTyping ? <span className="card-headline-cursor" aria-hidden="true" /> : null}
    </h2>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
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
  if (isBlockedSessionCard(session)) return "Blocked";
  if (session.lifecycle === "idle") return "Idle";
  if (session.lifecycle === "ended" && session.outcomeLabel === "completed") return "Turn complete";
  if (session.lifecycle === "ended") return "Response ready";
  return "Active";
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
