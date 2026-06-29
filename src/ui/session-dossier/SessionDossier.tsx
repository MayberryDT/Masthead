import { useMemo, useState } from "react";
import type React from "react";
import type { SessionTranscriptKindFilter, SessionTranscriptResult } from "../../app/daemonClient";
import type { SessionTranscriptItem } from "../../shared/sessionTranscript";
import type { SafeAction, SessionDetailView } from "../../core/types";
import type { SessionDossierDto, SessionDossierTimelineEvent } from "../../shared/sessionDossier";
import { DossierCoverageBanner } from "./DossierCoverageBanner";
import { DossierTranscript } from "./DossierTranscript";
import { readableTranscriptText } from "./transcriptPresentation";

type TimelineFilter = "all" | "user" | "assistant" | "tools" | "checkpoints" | "attention";
type CopyState = "idle" | "copied" | "unavailable" | "failed";

type Props = {
  live?: SessionDetailView;
  dossier?: SessionDossierDto;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  transcript?: SessionTranscriptResult;
  transcriptLoading?: boolean;
  transcriptError?: string;
  transcriptFilter?: SessionTranscriptKindFilter;
  transcriptQuery?: string;
  onTranscriptFilterChange?: (filter: SessionTranscriptKindFilter) => void;
  onTranscriptQueryChange?: (query: string) => void;
  onTranscriptLoadMore?: () => void;
  onTranscriptRetry?: () => void;
  onOpenSources?: () => void;
  onAction?: (action: SafeAction, session: SessionDetailView) => void;
  actionStatus?: string;
};

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const safeDossierActions = new Set<SafeAction>(["snooze", "dismiss", "mark_reviewed", "mark_expected"]);
const noop = () => undefined;
const noopString = (_value: string) => undefined;
const noopTranscriptFilter = (_value: SessionTranscriptKindFilter) => undefined;

export function SessionDossier({
  actionStatus,
  dossier,
  error,
  live,
  loading = false,
  onAction,
  onOpenSources,
  onRetry,
  onTranscriptFilterChange,
  onTranscriptLoadMore,
  onTranscriptQueryChange,
  onTranscriptRetry,
  transcript,
  transcriptError,
  transcriptFilter = "all",
  transcriptLoading = false,
  transcriptQuery = ""
}: Props) {
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const identity = dossier?.identity;
  const subtitle = [identity?.project ?? live?.project, identity?.runtime ?? live?.runtime, identity?.model ?? live?.model]
    .filter(Boolean)
    .join(" · ");
  const summary = dossierSummary(dossier, live);
  const timelineEvents = useMemo(() => (dossier?.timeline ?? liveTimeline(live)).filter((event) => event.kind !== "file"), [dossier?.timeline, live]);
  const filteredTimeline = useMemo(() => filterTimeline(timelineEvents, timelineFilter), [timelineEvents, timelineFilter]);
  const visibleTimeline = showAllTimeline ? filteredTimeline : filteredTimeline.slice(-30);
  const availableActions = live?.safeActions.filter((action) => safeDossierActions.has(action)) ?? [];
  const visibleTools = showAllTools ? dossier?.tools : dossier?.tools.slice(0, 12);

  const copyContext = async (value?: string) => {
    if (!value || !navigator.clipboard?.writeText) {
      setCopyState("unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section className="session-dossier" aria-label="Session dossier">
      {loading ? <div className="dossier-banner">Loading canonical session dossier...</div> : null}
      {error ? (
        <div className="dossier-banner dossier-banner-error">
          <span>{error}</span>
          {onRetry ? (
            <button type="button" className="dossier-link-button" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {!dossier && live ? <div className="dossier-banner">Canonical details unavailable. Showing live session state only.</div> : null}

      <section className="dossier-hero">
        <div className="dossier-hero-copy">
          <div>
            <p className="mono-label">Session identity</p>
            <p>{subtitle || "Canonical identifiers and reusable context"}</p>
          </div>
          <div className="dossier-hero-actions" aria-label="Session context actions">
            <button type="button" onClick={() => copyContext(dossier?.reuse.copyableContext)}>
              Copy context
            </button>
            <button type="button" onClick={() => copyContext(identity?.sessionId ?? live?.canonicalSessionId)}>
              Copy canonical ID
            </button>
            <button type="button" onClick={() => copyContext(identity?.sourceSessionId ?? live?.sourceSessionId ?? live?.sessionId)}>
              Copy source ID
            </button>
          </div>
          {copyState !== "idle" ? <p className="dossier-muted">{copyFeedback(copyState)}</p> : null}
        </div>
        <div className="dossier-identity-grid" aria-label="Session identity">
          <DossierMetric label="Lifecycle" value={identity?.lifecycle ?? live?.lifecycle ?? "Unknown"} />
          <DossierMetric label="Duration" value={formatDuration(identity?.durationMs) ?? live?.durationLabel ?? "-"} />
          <DossierMetric label="Tokens" value={formatNumber(dossier?.usage.totalTokens ?? live?.totalTokens)} />
          <DossierMetric label="Input" value={formatNumber(dossier?.usage.inputTokens)} />
          <DossierMetric label="Output" value={formatNumber(dossier?.usage.outputTokens)} />
          <DossierMetric label="Messages" value={formatNumber(dossier?.coverage.transcript.messages)} />
        </div>
      </section>

      <DossierCoverageBanner coverage={dossier?.coverage} onOpenSources={onOpenSources} />

      <div className="dossier-grid">
        <DossierPanel title="Enrichment" className="dossier-panel-span dossier-panel-primary">
          <div className="dossier-copy-stack">
            <DossierCopyBlock label="Summary" value={summary} />
            <DossierCopyBlock label="Objective" value={dossier?.narrative.objective ?? live?.copy.reason} />
            <DossierCopyBlock label="Outcome" value={dossier?.narrative.outcome ?? live?.copy.status} />
            <DossierCopyBlock label="First prompt" value={dossier?.narrative.firstUserPrompt} />
            <DossierCopyBlock label="Latest prompt" value={dossier?.narrative.latestUserPrompt} />
            <DossierTags label="Topics" values={dossier?.narrative.topics} />
            <DossierTags label="Technologies" values={dossier?.narrative.technologies} />
            <DossierTags label="Unresolved" values={dossier?.narrative.unresolved} />
          </div>
        </DossierPanel>

        <DossierPanel title="Transcript" className="dossier-panel-span dossier-panel-transcript">
          <DossierTranscript
            sessionId={identity?.sessionId ?? live?.canonicalSessionId}
            transcript={transcript}
            loading={transcriptLoading}
            error={transcriptError}
            filter={transcriptFilter}
            query={transcriptQuery}
            onFilterChange={onTranscriptFilterChange ?? noopTranscriptFilter}
            onQueryChange={onTranscriptQueryChange ?? noopString}
            onLoadMore={onTranscriptLoadMore ?? noop}
            onRetry={onTranscriptRetry ?? noop}
          />
        </DossierPanel>

        {advancedOpen ? (
          <section className="dossier-advanced-details" aria-label="Advanced session details">
            <DossierPanel title="Verification">
              <p className={`dossier-status dossier-status-${dossier?.verification.status ?? "unknown"}`}>
                {dossier?.verification.summary ?? verificationFallback(live)}
              </p>
              <ListEmpty empty="No verification commands captured.">
                {dossier?.verification.commands.slice(0, 5).map((tool) => (
                  <li key={tool.toolCallId}>
                    <strong>{tool.toolName}</strong>
                    <span>{tool.status ?? "unknown"}</span>
                  </li>
                ))}
              </ListEmpty>
            </DossierPanel>

            <DossierPanel title="Needs attention">
              <ListEmpty empty="No attention items captured.">
                {(dossier?.attention ?? liveAttention(live)).slice(0, 6).map((item, index) => (
                  <li key={`${item.kind}:${item.title}:${index}`}>
                    <strong>{item.title}</strong>
                    <span>{item.detail ?? item.severity}</span>
                  </li>
                ))}
              </ListEmpty>
            </DossierPanel>

            <DossierPanel title="Tools">
              <ListEmpty empty="No tool calls captured.">
                {visibleTools?.map((tool, index) => (
                  <li key={`${tool.toolCallId}:${index}`} className={tool.status === "failed" || (tool.exitCode !== undefined && tool.exitCode !== 0) ? "is-failed" : ""}>
                    <div>
                      <strong>{tool.toolName}</strong>
                      {tool.outputPreview ? <small className="dossier-list-preview">{tool.outputPreview}</small> : null}
                    </div>
                    <span>{tool.status ?? tool.category ?? "captured"}{tool.exitCode !== undefined ? ` · exit ${tool.exitCode}` : ""}</span>
                  </li>
                ))}
              </ListEmpty>
              {dossier && dossier.tools.length > 12 ? (
                <button type="button" className="dossier-link-button" onClick={() => setShowAllTools((current) => !current)}>
                  {showAllTools ? "Show fewer tools" : `Show ${dossier.tools.length - 12} more tools`}
                </button>
              ) : null}
            </DossierPanel>

            <DossierPanel title="Transcript excerpts" className="dossier-panel-span">
              <ListEmpty empty="No transcript excerpts captured.">
                {dossier?.excerpts.map((excerpt, index) => (
                  <li key={`${excerpt.excerptId}:${index}`}>
                    <strong>{excerpt.role ?? excerpt.kind}</strong>
                    <span>{excerpt.text}</span>
                  </li>
                ))}
              </ListEmpty>
            </DossierPanel>

            <DossierPanel title="Raw transcript" className="dossier-panel-span">
              <DossierRawTranscript items={transcript?.items} />
            </DossierPanel>

            <DossierPanel title="Timeline" className="dossier-panel-span">
              <div className="dossier-filter-row" aria-label="Timeline filters">
                {(["all", "user", "assistant", "tools", "checkpoints", "attention"] as TimelineFilter[]).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={filter === timelineFilter ? "is-active" : ""}
                    onClick={() => {
                      setTimelineFilter(filter);
                      setShowAllTimeline(false);
                    }}
                  >
                    {timelineLabel(filter)}
                  </button>
                ))}
              </div>
              <ol className="dossier-timeline">
                {visibleTimeline.length > 0 ? (
                  visibleTimeline.map((event, index) => (
                    <li key={`${event.eventId}:${index}`}>
                      <time dateTime={event.observedAt}>{formatDateTime(event.observedAt)}</time>
                      <div>
                        <strong>{event.label}</strong>
                        <span>{event.summary}</span>
                        {formatSourceRef(event.sourceRef) ? <small>{formatSourceRef(event.sourceRef)}</small> : null}
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="dossier-empty">No timeline events captured.</li>
                )}
              </ol>
              {filteredTimeline.length > 30 ? (
                <button type="button" className="dossier-link-button dossier-panel-footer-action" onClick={() => setShowAllTimeline((current) => !current)}>
                  {showAllTimeline ? "Show less" : `Show ${filteredTimeline.length - 30} more`}
                </button>
              ) : null}
            </DossierPanel>

            <DossierPanel title="Token usage" className="dossier-panel-half">
              {dossier?.usage.usageRows ? (
                <div className="dossier-provenance dossier-provenance-compact">
                  <DossierMetric label="Input tokens" value={formatNumber(dossier.usage.inputTokens)} />
                  <DossierMetric label="Output tokens" value={formatNumber(dossier.usage.outputTokens)} />
                  <DossierMetric label="Total tokens" value={formatNumber(dossier.usage.totalTokens)} />
                  <DossierMetric label="Rows" value={formatNumber(dossier.usage.usageRows)} />
                </div>
              ) : (
                <p className="dossier-muted">Token usage not captured.</p>
              )}
            </DossierPanel>

            <DossierPanel title="Review actions" className="dossier-panel-half">
              {availableActions.length > 0 && live && onAction ? (
                <div className="dossier-action-row">
                  {availableActions.map((action) => (
                    <button key={action} type="button" onClick={() => onAction(action, live)}>
                      {actionLabel(action)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="dossier-muted">No safe review actions are available for this session.</p>
              )}
              {actionStatus ? <p className="dossier-muted">{actionStatus}</p> : null}
            </DossierPanel>

            <DossierPanel title="Provenance" className="dossier-panel-span">
              <div className="dossier-provenance">
                <DossierMetric label="Canonical ID" value={identity?.sessionId ?? live?.canonicalSessionId ?? "-"} />
                <DossierMetric label="Source ID" value={identity?.sourceSessionId ?? live?.sourceSessionId ?? live?.sessionId ?? "-"} />
                <DossierMetric label="MCP included" value={dossier ? (dossier.reuse.mcpIncluded ? "Yes" : "No") : "-"} />
                <DossierMetric label="Confidence" value={identity?.sourceConfidence ?? live?.identityConfidence ?? "Unknown"} />
              </div>
              <div className="dossier-narrative-debug">
                <h5>Narrative evidence</h5>
                {dossier?.narrative.narrativeDebug ? (
                  <>
                    <div className="dossier-provenance dossier-provenance-compact">
                      <DossierMetric label="Title source" value={dossier.narrative.narrativeDebug.titleSource ?? "-"} />
                      <DossierMetric label="Subject source" value={dossier.narrative.narrativeDebug.subjectSource ?? "-"} />
                      <DossierMetric label="Provider" value={dossier.narrative.narrativeDebug.provider ?? "deterministic"} />
                      <DossierMetric label="Model" value={dossier.narrative.narrativeDebug.model ?? "local-rules"} />
                      <DossierMetric label="Prompt version" value={dossier.narrative.narrativeDebug.promptVersion ?? "-"} />
                      <DossierMetric label="Evidence refs" value={formatNumber(dossier.narrative.narrativeDebug.sourceRefs.length)} />
                    </div>
                    <ul className="dossier-evidence-list">
                      {dossier.narrative.narrativeDebug.sourceRefs.slice(0, 6).map((ref, index) => (
                        <li key={`${ref.id}:${index}`}>{formatSourceRef(ref) ?? ref.id}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="dossier-muted">Narrative not generated yet.</p>
                )}
              </div>
            </DossierPanel>
          </section>
        ) : null}
      </div>

      <div className="dossier-advanced-footer">
        <button type="button" className="dossier-link-button" onClick={() => setAdvancedOpen((current) => !current)}>
          {advancedOpen ? "Hide advanced details" : "Advanced details"}
        </button>
      </div>
    </section>
  );
}

function DossierPanel({ children, className = "", title }: { children: React.ReactNode; className?: string; title: string }) {
  return (
    <section className={["dossier-panel", className].filter(Boolean).join(" ")}>
      <h4>{title}</h4>
      <div className="dossier-panel-body">{children}</div>
    </section>
  );
}

function DossierMetric({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="dossier-metric">
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function dossierSummary(dossier?: SessionDossierDto, live?: SessionDetailView): string | undefined {
  const narrative = dossier?.narrative;
  const objective = readableTranscriptText(narrative?.objective ?? live?.copy.reason);
  const outcome = readableTranscriptText(narrative?.outcome ?? live?.copy.status);
  const finalAssistantMessage = readableTranscriptText(narrative?.finalAssistantMessage);
  const fallbackSummary = readableTranscriptText(narrative?.liveSummary ?? live?.currentActivity);
  const parts = [
    objective ? `Objective: ${sentence(objective)}` : undefined,
    outcome && !sameReadableText(outcome, objective) ? `Outcome: ${sentence(outcome)}` : undefined,
    finalAssistantMessage && !sameReadableText(finalAssistantMessage, outcome) && !sameReadableText(finalAssistantMessage, objective)
      ? `Latest assistant note: ${sentence(finalAssistantMessage)}`
      : undefined
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : fallbackSummary;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function sameReadableText(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function DossierCopyBlock({ label, value }: { label: string; value?: string }) {
  const text = readableTranscriptText(value);
  if (!text) return null;
  return (
    <div>
      <span>{label}</span>
      <p>{text}</p>
    </div>
  );
}

function DossierRawTranscript({ items }: { items?: SessionTranscriptItem[] }) {
  return (
    <ListEmpty empty="No raw transcript items loaded.">
      {items?.slice(0, 30).map((item, index) => (
        <li key={`${item.itemId}:${index}`} className="dossier-raw-transcript-item">
          <strong>{itemLabel(item)}</strong>
          <span>{item.text}</span>
        </li>
      ))}
    </ListEmpty>
  );
}

function itemLabel(item: SessionTranscriptItem): string {
  if (item.kind === "tool_call") return `Tool · ${item.toolName ?? item.label}`;
  if (item.kind === "tool_result") return `Tool result · ${item.status ?? item.label}`;
  if (item.kind === "file_effect") return `File · ${item.label}`;
  if (item.kind === "runtime_signal") return `Signal · ${item.label}`;
  if (item.kind === "checkpoint") return `Checkpoint · ${item.label}`;
  return item.role[0].toUpperCase() + item.role.slice(1);
}

function DossierTags({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null;
  return (
    <div>
      <span>{label}</span>
      <div className="dossier-tags">
        {values.slice(0, 10).map((value) => (
          <b key={value}>{value}</b>
        ))}
      </div>
    </div>
  );
}

function ListEmpty({ children, empty }: { children?: React.ReactNode; empty: string }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  if (items.length === 0) return <p className="dossier-muted">{empty}</p>;
  return <ul className="dossier-list">{items}</ul>;
}

function filterTimeline(events: SessionDossierTimelineEvent[], filter: TimelineFilter): SessionDossierTimelineEvent[] {
  if (filter === "all") return events;
  if (filter === "user") return events.filter((event) => event.kind === "user");
  if (filter === "assistant") return events.filter((event) => event.kind === "assistant");
  if (filter === "tools") return events.filter((event) => event.kind === "tool");
  if (filter === "checkpoints") return events.filter((event) => event.kind === "checkpoint");
  return events.filter((event) => event.kind === "attention" || event.kind === "runtime_signal");
}

function liveTimeline(live?: SessionDetailView): SessionDossierTimelineEvent[] {
  return (
    live?.timeline.map((event) => ({
      eventId: event.eventId,
      kind: "session" as const,
      label: event.type,
      observedAt: event.occurredAt,
      summary: event.summary
    })) ?? []
  );
}

function liveAttention(live?: SessionDetailView) {
  const attention =
    live?.attentionItems.map((item) => ({
      detail: item.suggestedNextAction,
      kind: item.type === "command_failed" ? ("command_failure" as const) : ("stalled" as const),
      observedAt: item.createdAt,
      severity: item.severity,
      sourceRefs: item.evidence,
      title: item.title
    })) ?? [];
  const conflicts =
    live?.conflicts.map((conflict) => ({
      detail: conflict.sharedPaths.slice(0, 3).join(", "),
      kind: "conflict" as const,
      severity: conflict.severity === "high" ? ("P1" as const) : ("P2" as const),
      sourceRefs: conflict.evidence,
      title: conflict.title
    })) ?? [];
  return [...attention, ...conflicts];
}

function verificationFallback(live?: SessionDetailView): string {
  if (!live) return "No verification signal captured.";
  if (live.indicators.includes("verification")) return "Verification signal was captured in the live projection.";
  return "No canonical verification signal captured.";
}

function timelineLabel(filter: TimelineFilter): string {
  if (filter === "all") return "All";
  if (filter === "user") return "User";
  if (filter === "assistant") return "Assistant";
  if (filter === "tools") return "Tools";
  if (filter === "checkpoints") return "Checkpoints";
  return "Attention";
}

function actionLabel(action: SafeAction): string {
  if (action === "snooze") return "Snooze";
  if (action === "dismiss") return "Dismiss";
  if (action === "mark_reviewed") return "Mark reviewed";
  if (action === "mark_expected") return "Mark expected";
  return action;
}

function formatNumber(value?: number): string {
  if (typeof value !== "number") return "-";
  return formatter.format(value);
}

function formatSourceRef(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const ref = value as { id?: unknown; kind?: unknown; source?: unknown; observedAt?: unknown };
  const parts = [
    typeof ref.source === "string" ? ref.source : undefined,
    typeof ref.kind === "string" ? ref.kind : undefined,
    typeof ref.id === "string" ? ref.id : undefined,
    typeof ref.observedAt === "string" ? formatDateTime(ref.observedAt) : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatDuration(value?: number): string | undefined {
  if (typeof value !== "number") return undefined;
  const minutes = Math.max(1, Math.round(value / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function copyFeedback(state: CopyState): string {
  if (state === "copied") return "Copied.";
  if (state === "unavailable") return "Clipboard unavailable.";
  if (state === "failed") return "Copy failed.";
  return "";
}
