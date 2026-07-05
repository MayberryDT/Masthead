import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SessionCardView } from "../core/types";
import { firstUsefulSessionTitle, isWeakLiveSummary } from "../shared/sessionTextQuality.ts";
import { isBlockedSessionCard } from "./format";
import { prefersReducedMotion } from "./motionPreference";
import type { DemoSessionTelemetry } from "./observabilityDemo";

type Props = {
  session: SessionCardView;
  onToggle?: (sessionId: string) => void;
  demoTelemetry?: DemoSessionTelemetry;
  isNew?: boolean;
  newCardIndex?: number;
  headlineUpdateIndex?: number;
  refreshPulseIndex?: number;
};

type SessionVisualTier = "quiet" | "live" | "action";

const HEADLINE_TEXT_SWAP_MS = 1_850;
const HEADLINE_ANIMATION_CLEANUP_MS = 2_700;

export function SessionCard({
  session,
  onToggle,
  demoTelemetry,
  isNew = false,
  newCardIndex = 0,
  headlineUpdateIndex,
  refreshPulseIndex
}: Props) {
  const stateClass = sessionStateClassName(session);
  const tierClass = `tier-${sessionVisualTier(session)}`;
  const model = demoTelemetry?.model.value ?? session.model ?? "Not captured";
  const harness = demoTelemetry?.harness.value ?? session.harness ?? "Codex";
  const worktree = session.branchOrWorktree ?? "None";
  const headline = sessionHeadline(session);
  const [visibleHeadline, setVisibleHeadline] = useState(headline);
  const [outgoingHeadline, setOutgoingHeadline] = useState<string | undefined>();
  const visibleHeadlineRef = useRef(headline);
  const latestHeadlineRef = useRef(headline);
  const sessionName = sessionHeaderName(session);
  const isHeadlineRefreshing = outgoingHeadline !== undefined || (headlineUpdateIndex !== undefined && visibleHeadline !== headline);
  const isRefreshPulsing = refreshPulseIndex !== undefined && !isHeadlineRefreshing;
  const style = {
    viewTransitionName: `session-card-${viewTransitionNamePart(session.sessionId)}`,
    "--new-card-index": Math.min(newCardIndex, 4),
    "--headline-refresh-index": Math.min(headlineUpdateIndex ?? 0, 4),
    "--refresh-pulse-index": Math.min(refreshPulseIndex ?? 0, 4)
  } as CSSProperties & { "--new-card-index": number; "--headline-refresh-index": number; "--refresh-pulse-index": number };

  useEffect(() => {
    visibleHeadlineRef.current = visibleHeadline;
  }, [visibleHeadline]);

  useEffect(() => {
    if (headline === latestHeadlineRef.current) return undefined;

    const previousHeadline = visibleHeadlineRef.current;
    latestHeadlineRef.current = headline;

    if (headlineUpdateIndex === undefined || prefersReducedMotion()) {
      setOutgoingHeadline(undefined);
      setVisibleHeadline(headline);
      return undefined;
    }

    setOutgoingHeadline(previousHeadline);

    const swapTimer = window.setTimeout(() => {
      setVisibleHeadline(headline);
    }, HEADLINE_TEXT_SWAP_MS);
    const cleanupTimer = window.setTimeout(
      () => {
        setOutgoingHeadline(undefined);
      },
      HEADLINE_ANIMATION_CLEANUP_MS + Math.min(headlineUpdateIndex, 4) * 55
    );

    return () => {
      window.clearTimeout(swapTimer);
      window.clearTimeout(cleanupTimer);
    };
  }, [headline, headlineUpdateIndex]);

  return (
    <article
      className={[
        "session-card",
        "bottom-variant-card",
        "dovetail-card",
        stateClass,
        tierClass,
        isNew ? "is-new-card" : "",
        isHeadlineRefreshing ? "is-headline-refreshing" : "",
        isRefreshPulsing ? "is-refresh-pulsing" : ""
      ]
        .filter(Boolean)
        .join(" ")}
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
        <HeadlineSourceBadge session={session} />
      </header>

      <h3 className="headline">
        {outgoingHeadline ? (
          <span className="headline-text headline-previous" aria-hidden="true">
            {outgoingHeadline}
          </span>
        ) : null}
        <span className="headline-text headline-current">{visibleHeadline}</span>
      </h3>

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

function HeadlineSourceBadge({ session }: { session: SessionCardView }) {
  const label = headlineSourceLabel(session);
  if (!label) return null;

  return (
    <span className={`headline-source is-${label.toLowerCase()}`} title={`Headline source: ${label}`}>
      {label}
    </span>
  );
}

function headlineSourceLabel(session: SessionCardView): "Pending" | "Offline" | undefined {
  if (session.headline.status === "pending" || session.headline.source === "pending") return "Pending";
  if (session.headline.source === "offline") return "Offline";
  return undefined;
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

function sessionVisualTier(session: SessionCardView): SessionVisualTier {
  if (isBlockedSessionCard(session)) return "action";
  if (session.lifecycle === "running") return "live";
  if (session.indicators.includes("attention")) return "action";
  if (session.indicators.includes("conflict")) return "action";
  return "quiet";
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
  const headline = cleanHeadline(session.headline.headline);
  if (headline && !isWeakLiveSummary(headline)) return headline;
  return firstUsefulSessionTitle([session.title, session.workContext?.label], sessionTextContext(session)) ?? `${session.project} session update`;
}

function cleanSessionName(value: string | undefined): string | undefined {
  const label = value?.replace(/\s+/g, " ").trim();
  if (!label) return undefined;
  if (/^unknown project$/i.test(label)) return undefined;
  if (/^[a-f0-9-]{12,}(?:\s+session)?$/i.test(label)) return undefined;
  return label;
}

function meaningfulSessionTitle(value: string | undefined, project: string): string | undefined {
  return firstUsefulSessionTitle([cleanSessionName(value)], { project });
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

function sessionTextContext(session: SessionCardView) {
  return {
    project: session.project,
    sessionId: session.canonicalSessionId ?? session.sessionId,
    sourceSessionId: session.sourceSessionId ?? session.sessionId
  };
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
