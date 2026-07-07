import { projectFixture, type LiveSessionEnrichment, type LiveSessionTranscriptFacts } from "./replay.ts";
import type { BoardHeadlineView } from "./boardHeadlineFrame.ts";
import type { LiveBlocker } from "./liveBlockers.ts";
import type { LiveStateReport } from "./liveState.ts";
import type { FixtureReplay, GitSnapshot, LiveBoardProjection, NormalizedEvent } from "./types";

export type LiveProjectionEnvelope = {
  ok: true;
  source: "live";
  generatedAt: string;
  events: number;
  gitSnapshots: number;
  diagnostics: number;
  projection: LiveBoardProjection;
};

type LiveProjectionOptions = {
  expandedSessionId?: string;
  selectedSessionId?: string | null;
  sessionEnrichments?: Map<string, LiveSessionEnrichment>;
  sessionHeadlineViews?: Map<string, BoardHeadlineView>;
  sessionTranscriptFacts?: Map<string, LiveSessionTranscriptFacts>;
  liveStateReports?: Map<string, LiveStateReport>;
  blockers?: Map<string, LiveBlocker[]>;
  headlineMode?: "llm" | "offline";
  generatedAt?: string;
  diagnostics?: number;
  refreshIntervalMs?: number;
  eventWorkingGraceMs?: number;
};

export function eventWorkingGraceMsForRefresh(refreshIntervalMs: number | undefined): number {
  if (!Number.isFinite(refreshIntervalMs)) return 30_000;
  return Math.max(15_000, Math.min(60_000, Number(refreshIntervalMs) * 2));
}

export function approvalBlockerTtlMsForRefresh(refreshIntervalMs: number | undefined): number {
  if (!Number.isFinite(refreshIntervalMs)) return 10 * 60_000;
  return Math.max(60_000, Math.min(10 * 60_000, Number(refreshIntervalMs) * 12));
}

export function projectLiveEvents(
  events: NormalizedEvent[],
  gitSnapshots: GitSnapshot[] = [],
  options: LiveProjectionOptions = {}
): LiveProjectionEnvelope {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const selectedSessionId = options.selectedSessionId === null ? null : options.selectedSessionId ?? options.expandedSessionId;
  const projectionEvents = events.map(parentScopedOmpChildEvent);
  const replay: FixtureReplay = {
    events: projectionEvents,
    gitSnapshots,
    expandedSessionId: options.expandedSessionId
  };

  return {
    ok: true,
    source: "live",
    generatedAt,
    events: events.length,
    gitSnapshots: gitSnapshots.length,
    diagnostics: options.diagnostics ?? 0,
    projection: projectFixture(replay, {
      expandedSessionId: options.expandedSessionId,
      sessionEnrichments: normalizeLiveSessionEnrichments(options.sessionEnrichments),
      sessionHeadlineViews: options.sessionHeadlineViews,
      sessionTranscriptFacts: options.sessionTranscriptFacts,
      liveStateReports: options.liveStateReports,
      blockers: options.blockers,
      headlineMode: options.headlineMode ?? "llm",
      selectedSessionId,
      now: new Date(generatedAt),
      eventWorkingGraceMs: options.eventWorkingGraceMs ?? eventWorkingGraceMsForRefresh(options.refreshIntervalMs)
    })
  };
}

function parentScopedOmpChildEvent(event: NormalizedEvent): NormalizedEvent {
  if (event.source.adapter !== "omp") return event;
  const parentSourceSessionId = stringPayload(event, "parentSourceSessionId");
  const childSessionId = stringPayload(event, "childSessionId");
  if (!parentSourceSessionId || !childSessionId || event.sessionId === parentSourceSessionId) return event;
  return {
    ...event,
    sessionId: parentSourceSessionId,
    payload: {
      ...event.payload,
      sourceSessionId: parentSourceSessionId,
      childSourceSessionId: event.sessionId
    }
  };
}

function stringPayload(event: NormalizedEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeLiveSessionEnrichments(
  enrichments: Map<string, LiveSessionEnrichment> | undefined
): Map<string, LiveSessionEnrichment> | undefined {
  if (!enrichments) return undefined;
  return new Map(
    Array.from(enrichments.entries()).map(([sessionId, enrichment]) => [
      sessionId,
      {
        ...enrichment,
        title: selectLiveTitle(enrichment)
      }
    ])
  );
}

function selectLiveTitle(enrichment: LiveSessionEnrichment): string | undefined {
  const title = cleanTitle(enrichment.title);
  if (isUsableLiveTitle(title)) return title;
  return undefined;
}

function cleanTitle(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > 96 ? `${normalized.slice(0, 93).trim()}...` : normalized;
}

function isUsableLiveTitle(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.toLowerCase();
  if (value.startsWith("{") || value.includes('"event"') || /^https?:\/\//i.test(value)) return false;
  if (["codex session", "untitled session", "new session", "session", "chat session"].includes(normalized)) return false;
  if (/^[\w .-]+\s+codex session$/i.test(value)) return false;
  if (/^[0-9a-f]{12,}$/i.test(value) || /^[0-9a-f-]{32,}$/i.test(value)) return false;
  if (/^session[-_:][a-z0-9][a-z0-9_-]{5,}$/i.test(value)) return false;
  return /\s/.test(value) || value.length < 24;
}
