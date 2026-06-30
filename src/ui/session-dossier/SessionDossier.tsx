import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { SessionTranscriptKindFilter, SessionTranscriptResult } from "../../app/daemonClient";
import type { SafeAction, SessionDetailView } from "../../core/types";
import type { SessionDossierDto, SessionDossierTimelineEvent } from "../../shared/sessionDossier";
import type { SessionTranscriptItem } from "../../shared/sessionTranscript";
import { AppButton } from "../primitives/AppButton";
import { readableTranscriptText } from "./transcriptPresentation";

type TimelineFilter = "all" | "user" | "assistant" | "tools" | "checkpoints" | "attention";

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
  onClose?: () => void;
  titleId?: string;
};

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const transcriptFilters: Array<{ label: string; value: SessionTranscriptKindFilter }> = [
  { label: "Evidence", value: "all" },
  { label: "User", value: "user" },
  { label: "Assistant", value: "assistant" },
  { label: "Tools", value: "tools" }
];

export function SessionDossier({
  dossier,
  error,
  live,
  loading = false,
  onClose,
  onTranscriptFilterChange,
  onTranscriptLoadMore,
  titleId,
  transcript,
  transcriptError,
  transcriptFilter = "all",
  transcriptLoading = false,
  transcriptQuery = ""
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const transcriptLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const requestedTranscriptCursorRef = useRef<string | undefined>(undefined);
  const identity = dossier?.identity;
  const summary = dossierSummary(dossier, live);
  const attentionItems = dossier?.attention ?? liveAttention(live);
  const timelineEvents = useMemo(() => (dossier?.timeline ?? liveTimeline(live)).filter((event) => event.kind !== "file"), [dossier?.timeline, live]);
  const transcriptRows = useMemo(() => compactTranscriptRows(transcript?.items), [transcript?.items]);
  const title = identity?.title ?? live?.copy.headline ?? live?.title ?? "Session dossier";
  const description =
    summary ??
    readableTranscriptText(live?.copy.reason) ??
    readableTranscriptText(live?.currentActivity) ??
    "Canonical identifiers and reusable session context.";
  const endedAt = identity?.endedAt ?? identity?.lastActivityAt ?? live?.lastActivity;
  const advancedPanelId = `${identity?.sessionId ?? live?.canonicalSessionId ?? live?.sessionId ?? "session"}-advanced-details-panel`;
  const sourceId = identity?.sourceSessionId ?? live?.sourceSessionId ?? live?.sessionId ?? "-";

  useEffect(() => {
    requestedTranscriptCursorRef.current = undefined;
  }, [transcriptFilter, transcriptQuery]);

  useEffect(() => {
    const nextCursor = transcript?.nextCursor;
    const sentinel = transcriptLoadMoreRef.current;
    if (!nextCursor || !sentinel || transcriptLoading || !onTranscriptLoadMore || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (requestedTranscriptCursorRef.current === nextCursor) return;
        requestedTranscriptCursorRef.current = nextCursor;
        onTranscriptLoadMore();
      },
      { root: transcriptScrollRef.current, rootMargin: "80px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onTranscriptLoadMore, transcript?.nextCursor, transcriptLoading]);

  return (
    <section className="session-dossier stage" aria-label="Session dossier">
      <div className="backdrop">
        <article className="dossier" aria-label="Session dossier modal">
          <header className="dossier-header">
            <div className="meta-rail" aria-label="Session identity metadata">
              <MetaCell label="Project" value={identity?.project ?? live?.project ?? "Not captured"} />
              <MetaCell label="Runtime" value={identity?.runtime ?? live?.runtime ?? "Not captured"} />
              <MetaCell label="Lifecycle" value={identity?.lifecycle ?? live?.lifecycle ?? "Unknown"} />
              <MetaCell label="Ended" value={endedAt ? formatDateTime(endedAt) : live?.durationLabel ?? "-"} />
              <MetaCell label="Model" value={identity?.model ?? live?.model ?? identity?.models?.join(", ") ?? "Not captured"} />
            </div>
            <div className="title-block">
              <div>
                <span className="mono label">Session identity</span>
                <h2 id={titleId}>{title}</h2>
                <p>{description}</p>
              </div>
              <AppButton className="close" variant="icon" type="button" aria-label="Close session dossier" onClick={onClose}>
                &times;
              </AppButton>
            </div>
          </header>

          <div className="content-grid">
            <section className="metrics" aria-label="Key stats">
              <Metric className="is-good" label="Source confidence" value={identity?.sourceConfidence ?? live?.identityConfidence ?? "Unknown"} />
              <Metric label="Coverage" value={coverageLabel(dossier?.coverage.level)} />
              <Metric className="is-primary" label="Total tokens" value={formatCompactNumber(dossier?.usage.totalTokens ?? live?.totalTokens)} />
              <Metric label="Input tokens" value={formatCompactNumber(dossier?.usage.inputTokens)} />
              <Metric label="Output tokens" value={formatCompactNumber(dossier?.usage.outputTokens)} />
              <Metric label="Usage rows" value={formatNumber(dossier?.usage.usageRows)} />
              <Metric label="Messages" value={formatNumber(dossier?.coverage.transcript.messages)} />
              <Metric label="Tool calls" value={formatNumber(dossier?.coverage.transcript.toolCalls)} />
              <Metric className={attentionItems.length > 0 ? "is-warning" : undefined} label="Attention rows" value={formatNumber(attentionItems.length)} />
            </section>

            <DossierEnrichmentPanel dossier={dossier} error={error} loading={loading} summary={summary} />

            <section className="panel transcript" aria-label="Transcript excerpt">
              <div className="transcript-toolbar">
                <div>
                  <h3>Transcript evidence</h3>
                  <span className="rail-label">filtered to useful card/prototype rows</span>
                </div>
                <div className="filter-row" aria-label="Transcript filters">
                  {transcriptFilters.map((filter) => (
                    <AppButton
                      key={filter.value}
                      className={filter.value === transcriptFilter ? "filter is-active" : "filter"}
                      variant={filter.value === transcriptFilter ? "primary" : "default"}
                      type="button"
                      aria-pressed={filter.value === transcriptFilter}
                      onClick={() => onTranscriptFilterChange?.(filter.value)}
                    >
                      {filter.label}
                    </AppButton>
                  ))}
                </div>
              </div>
              <div className="transcript-scroll" ref={transcriptScrollRef}>
                <ol>
                  {transcriptRows.length > 0 ? (
                    transcriptRows.map((item, index) => (
                      <li key={`${item.itemId}:${index}`} className={rowTone(item.kind === "message" ? item.role : item.kind)}>
                        <time dateTime={item.observedAt}>{formatTime(item.observedAt)}</time>
                        <b>{itemLabel(item)}</b>
                        <p>{item.displayText}</p>
                      </li>
                    ))
                  ) : (
                    <li className="is-system">
                      <time>-</time>
                      <b>Empty</b>
                      <p>{transcriptError ? `Transcript error: ${transcriptError}` : transcriptLoading ? "Loading transcript..." : "No transcript evidence captured."}</p>
                    </li>
                  )}
                </ol>
                {transcript?.nextCursor ? (
                  <div ref={transcriptLoadMoreRef} className="transcript-sentinel" aria-hidden="true">
                    {transcriptLoading ? "Loading more evidence..." : ""}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="advanced" aria-label="Advanced session details">
              <div className="advanced-cell is-wide">
                <span>Canonical ID</span>
                <strong>{identity?.sessionId ?? live?.canonicalSessionId ?? "-"}</strong>
              </div>
              <div className="advanced-cell">
                <span>Source session</span>
                <strong>{sourceId}</strong>
              </div>
              <div className="advanced-cell">
                <span>Agent retrieval</span>
                <strong>{dossier ? (dossier.reuse.mcpIncluded ? "Included" : "Excluded") : "-"}</strong>
              </div>
              <div className="advanced-cell">
                <span>Verification</span>
                <strong>{dossier?.verification.summary ?? verificationFallback(live)}</strong>
              </div>
              <div className="advanced-cell">
                <span>Enrichment</span>
                <strong>{dossier?.narrative.narrativeDebug?.providerStatus ?? (dossier ? "deterministic / current" : "-")}</strong>
              </div>
              <div className="advanced-cell is-wide">
                <span>Worktree</span>
                <strong>{identity?.worktreePath ?? identity?.repoRoot ?? live?.workspace?.worktreePath ?? "-"}</strong>
                <div className="path-row">Host: {identity?.hostId ?? live?.workspace?.repoRoot ?? "Not captured"}</div>
              </div>
              <AppButton
                className="advanced-toggle"
                type="button"
                aria-expanded={advancedOpen}
                aria-controls={advancedPanelId}
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                {advancedOpen ? "Hide advanced details" : "Advanced details"}
              </AppButton>
              <div className="advanced-details-panel" id={advancedPanelId} hidden={!advancedOpen}>
                <section className="advanced-detail-card is-compact">
                  <h4>Verification</h4>
                  <p>{dossier?.verification.summary ?? verificationFallback(live)}</p>
                </section>

                <section className="advanced-detail-card is-compact">
                  <h4>Needs attention</h4>
                  <AdvancedList empty="No attention items captured.">
                    {attentionItems.slice(0, 6).map((item, index) => (
                      <li key={`${item.kind}:${item.title}:${index}`}>
                        <strong>{item.title}</strong>
                        <span>{item.detail ?? item.severity}</span>
                      </li>
                    ))}
                  </AdvancedList>
                </section>

                <section className="advanced-detail-card is-wide is-compact">
                  <h4>Tools</h4>
                  <AdvancedList empty="No tool calls captured.">
                    {dossier?.tools.slice(0, 12).map((tool, index) => (
                      <li key={`${tool.toolCallId}:${index}`}>
                        <strong>{tool.toolName}</strong>
                        <span>{tool.status ?? tool.category ?? "captured"}{tool.exitCode !== undefined ? ` / exit ${tool.exitCode}` : ""}</span>
                      </li>
                    ))}
                  </AdvancedList>
                </section>

                <section className="advanced-detail-card is-wide">
                  <h4>Provenance</h4>
                  <ul className="advanced-list">
                    <li><strong>Canonical ID</strong><span>{identity?.sessionId ?? live?.canonicalSessionId ?? "-"}</span></li>
                    <li><strong>Source session</strong><span>{sourceId}</span></li>
                    <li><strong>Source confidence</strong><span>{identity?.sourceConfidence ?? live?.identityConfidence ?? "Unknown"}</span></li>
                    <li><strong>Agent retrieval</strong><span>{dossier ? (dossier.reuse.mcpIncluded ? "included in MCP search" : "excluded from MCP search") : "-"}</span></li>
                  </ul>
                </section>

                <section className="advanced-detail-card is-wide">
                  <h4>Narrative evidence</h4>
                  {dossier?.narrative.narrativeDebug ? (
                    <ul className="advanced-list">
                      <li><strong>Title source</strong><span>{dossier.narrative.narrativeDebug.titleSource ?? "-"}</span></li>
                      <li><strong>Subject source</strong><span>{dossier.narrative.narrativeDebug.subjectSource ?? "-"}</span></li>
                      <li><strong>Provider</strong><span>{dossier.narrative.narrativeDebug.provider ?? "local rules"}</span></li>
                      <li><strong>Evidence refs</strong><span>{formatNumber(dossier.narrative.narrativeDebug.sourceRefs.length)}</span></li>
                    </ul>
                  ) : (
                    <p className="advanced-detail-muted">Narrative not generated yet.</p>
                  )}
                </section>

                <section className="advanced-detail-card is-full is-scroll-window is-timeline">
                  <div className="advanced-scroll-head">
                    <h4>Timeline</h4>
                    <span className="rail-label">{formatNumber(timelineEvents.length)} events / all</span>
                  </div>
                  <div className="advanced-scroll-body">
                    <ol className="advanced-list timeline-list">
                      {timelineEvents.length > 0 ? (
                        timelineEvents.map((event, index) => (
                          <li key={`${event.eventId}:${index}`} className={rowTone(event.kind)}>
                            <strong>{formatDateTime(event.observedAt)}</strong>
                            <span>{event.summary}</span>
                          </li>
                        ))
                      ) : (
                        <li className="is-system"><strong>-</strong><span>No timeline events captured.</span></li>
                      )}
                    </ol>
                  </div>
                </section>

                <section className="advanced-detail-card is-full is-scroll-window is-raw">
                  <div className="advanced-scroll-head">
                    <h4>Raw transcript</h4>
                    <span className="rail-label">{formatNumber(transcript?.items.length)} rows / transcript</span>
                  </div>
                  <div className="advanced-scroll-body">
                    <DossierRawTranscript items={transcript?.items} />
                  </div>
                </section>
              </div>
            </section>
          </div>
        </article>
      </div>
    </section>
  );
}

function MetaCell({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="meta-cell">
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function Metric({ className, label, value }: { className?: string; label: string; value?: string | number }) {
  return (
    <div className={["metric", className].filter(Boolean).join(" ")}>
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function DossierEnrichmentPanel({
  dossier,
  error,
  loading,
  summary
}: {
  dossier?: SessionDossierDto;
  error?: string;
  loading?: boolean;
  summary?: string;
}) {
  const coverage = dossier?.coverage.transcript;
  const status = dossier
    ? [dossier.narrative.narrativeDebug?.promptVersion ?? "session-capsule-v2", dossier.reuse.mcpIncluded ? "current" : "not indexed"].join(" / ")
    : "live projection";
  return (
    <section className="panel summary" aria-label="Enrichment summary">
      <div className="panel-head">
        <h3>Enrichment summary</h3>
        <span className="rail-label">{status}</span>
      </div>
      <div className="summary-scroll">
        <div className="summary-grid" aria-label="Enrichment stats" data-dossier-section="stats">
          <SummaryFact label="User messages" value={formatNumber(coverage?.userMessages)} />
          <SummaryFact label="Assistant messages" value={formatNumber(coverage?.assistantMessages)} />
          <SummaryFact label="Tool results" value={formatNumber(coverage?.toolResults)} />
          <SummaryFact label="Checkpoints" value={formatNumber(coverage?.checkpoints)} />
          <SummaryFact label="Runtime signals" value={formatNumber(coverage?.runtimeSignals)} />
          <SummaryFact label="Low-value rows" value={formatNumber(coverage?.lowValueItems)} />
        </div>
        <DossierEvidenceBlocks dossier={dossier} />
        <SummarySection label="Transcript summary" section="summary" value={summary} extraParagraphs={[dossier?.narrative.outcome].filter((value): value is string => Boolean(value))} />
        <SummarySection label="First prompt" section="first-prompt" value={dossier?.narrative.firstUserPrompt} />
        <SummarySection label="Latest prompt" section="latest-prompt" value={dossier?.narrative.latestUserPrompt} />
        <SummarySection label="Technologies" section="technologies" values={dossier?.narrative.technologies} />
        <SummarySection label="Unresolved" section="unresolved" values={dossier?.narrative.unresolved} />
        {loading ? <SummarySection label="Loading" section="loading" value="Loading canonical session dossier..." /> : null}
        {error ? <SummarySection label="Dossier error" section="error" value={error} /> : null}
        <SummarySection label="Retrieval notes" section="retrieval" value={dossier?.reuse.copyableContext} />
        <SummarySection label="Continuation notes" section="continuation" values={dossier?.attention.map((item) => item.title)} />
      </div>
    </section>
  );
}

function SummaryFact({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="summary-fact">
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function DossierEvidenceBlocks({ dossier }: { dossier?: SessionDossierDto }) {
  const values = [
    ...(dossier?.narrative.topics ?? []).map((value) => ({ className: "is-blue", value })),
    ...(dossier?.reuse.mcpIncluded ? [{ className: "is-green", value: "MCP included" }] : []),
    ...(dossier?.narrative.unresolved ?? []).map((value) => ({ className: "is-yellow", value })),
    ...(dossier?.coverage.warnings.slice(0, 3).map((warning) => ({ className: "is-yellow", value: warning.code.replaceAll("_", " ") })) ?? [])
  ];
  const uniqueValues = values.filter((item, index) => {
    const key = item.value.trim().toLowerCase();
    return values.findIndex((candidate) => candidate.value.trim().toLowerCase() === key) === index;
  });
  if (uniqueValues.length === 0) return null;
  return (
    <div className="evidence-blocks" aria-label="Session topics and warnings" data-dossier-section="signals">
      {uniqueValues.slice(0, 10).map((item) => (
        <div key={`${item.className}:${item.value}`} className={`evidence-block ${item.className}`}>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function SummarySection({
  extraParagraphs,
  label,
  section,
  value,
  values
}: {
  extraParagraphs?: string[];
  label: string;
  section: string;
  value?: string;
  values?: string[];
}) {
  const text = readableTranscriptText(value);
  const paragraphs = [text, ...(extraParagraphs?.map(readableTranscriptText) ?? [])]
    .filter((item): item is string => Boolean(item))
    .filter((item, index, items) => items.findIndex((candidate) => sameReadableText(candidate, item)) === index)
    .slice(0, 8);
  const visibleValues = values?.map(readableTranscriptText).filter(Boolean).slice(0, 8) ?? [];
  if (paragraphs.length === 0 && visibleValues.length === 0) return null;
  return (
    <div className="summary-section" data-dossier-section={section}>
      <h4>{label}</h4>
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {visibleValues.length > 0 ? <p>{visibleValues.join(", ")}</p> : null}
    </div>
  );
}

function AdvancedList({ children, empty }: { children?: React.ReactNode; empty: string }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  if (items.length === 0) return <p className="advanced-detail-muted">{empty}</p>;
  return <ul className="advanced-list">{items}</ul>;
}

function DossierRawTranscript({ items }: { items?: SessionTranscriptItem[] }) {
  const visibleItems = items?.slice(0, 120) ?? [];
  if (visibleItems.length === 0) {
    return (
      <ul className="advanced-list raw-transcript-list">
        <li className="is-system"><strong>-</strong><span>No raw transcript items loaded.</span></li>
      </ul>
    );
  }
  return (
    <ul className="advanced-list raw-transcript-list">
      {visibleItems.map((item, index) => (
        <li key={`${item.itemId}:${index}`} className={rowTone(item.kind === "message" ? item.role : item.kind)}>
          <strong>{formatTime(item.observedAt)} {itemLabel(item).toLowerCase()}</strong>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

type CompactTranscriptRow = SessionTranscriptItem & { displayText: string };

function compactTranscriptRows(items?: SessionTranscriptItem[]): CompactTranscriptRow[] {
  return (items ?? [])
    .filter((item) => item.kind !== "file_effect")
    .map((item) => ({ ...item, displayText: readableTranscriptText(item.text) }))
    .filter((item) => item.displayText.length > 0);
}

function dossierSummary(dossier?: SessionDossierDto, live?: SessionDetailView): string | undefined {
  const narrative = dossier?.narrative;
  const candidates = [
    narrative?.finalAssistantMessage,
    narrative?.liveSummary,
    narrative?.outcome,
    live?.copy.headline,
    live?.currentActivity,
    narrative?.objective,
    live?.copy.reason,
    live?.copy.status
  ]
    .map(readableTranscriptText)
    .filter((value): value is string => Boolean(value));
  const summary = candidates.find((candidate, index) => !candidates.slice(0, index).some((earlier) => sameReadableText(candidate, earlier)));
  return summary ? sentence(summary) : undefined;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function sameReadableText(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function itemLabel(item: SessionTranscriptItem): string {
  if (item.kind === "tool_call") return `Tool · ${item.toolName ?? item.label}`;
  if (item.kind === "tool_result") return `Tool result · ${item.status ?? item.label}`;
  if (item.kind === "file_effect") return `File · ${item.label}`;
  if (item.kind === "runtime_signal") return `Signal · ${item.label}`;
  if (item.kind === "checkpoint") return `Checkpoint · ${item.label}`;
  return item.role[0].toUpperCase() + item.role.slice(1);
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

function rowTone(kind?: string): string {
  if (kind === "user") return "is-user";
  if (kind === "assistant") return "is-assistant";
  if (kind === "tool" || kind === "tool_call" || kind === "tool_result") return "is-tool";
  if (kind === "checkpoint") return "is-tool";
  return "is-system";
}

function coverageLabel(value?: SessionDossierDto["coverage"]["level"]): string {
  if (!value) return "Live";
  return value.replaceAll("_", " ");
}

function formatCompactNumber(value?: number): string {
  if (typeof value !== "number") return "-";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatter.format(value);
}

function formatNumber(value?: number): string {
  if (typeof value !== "number") return "-";
  return formatter.format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}
