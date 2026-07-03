import { parseCodexHookPayload, type CodexHookDiagnostic } from "./codexAdapter.ts";
import type { NormalizedEvent } from "./types";

export type IngestionState = {
  events: NormalizedEvent[];
  diagnostics: CodexHookDiagnostic[];
  seenProviderEventIds: Set<string>;
  seenPayloadHashes: Set<string>;
};

export type IngestionResult =
  | { status: "accepted"; event: NormalizedEvent }
  | { status: "duplicate"; event: NormalizedEvent }
  | { status: "malformed"; diagnostic: CodexHookDiagnostic };

type IngestionOptions = {
  receivedAt?: string;
};

type CreateIngestionStateOptions = {
  includeInLiveProjection?: (event: NormalizedEvent) => boolean;
};

export function createIngestionState(
  events: NormalizedEvent[] = [],
  options: CreateIngestionStateOptions = {}
): IngestionState {
  const state: IngestionState = {
    events: [],
    diagnostics: [],
    seenProviderEventIds: new Set(),
    seenPayloadHashes: new Set()
  };
  for (const event of events) {
    remember(state, event);
    if (options.includeInLiveProjection?.(event) ?? true) state.events.push(event);
  }
  return state;
}

export function ingestCodexHookPayload(
  raw: string,
  state: IngestionState = createIngestionState(),
  options: IngestionOptions = {}
): IngestionResult {
  const parsed = parseCodexHookPayload(raw, options);
  if (!parsed.ok) {
    state.diagnostics.push(parsed.diagnostic);
    return { status: "malformed", diagnostic: parsed.diagnostic };
  }

  const event = parsed.event;
  return ingestNormalizedEvent(event, state);
}

export function ingestNormalizedEvent(
  event: NormalizedEvent,
  state: IngestionState = createIngestionState()
): Exclude<IngestionResult, { status: "malformed" }> {
  if (hasSeen(state, event)) {
    return { status: "duplicate", event };
  }

  remember(state, event);
  state.events.push(event);
  return { status: "accepted", event };
}

export function removeEventFromLiveProjectionState(state: IngestionState, event: NormalizedEvent): void {
  state.events = state.events.filter((candidate) => candidate.eventId !== event.eventId);
}

function hasSeen(state: IngestionState, event: NormalizedEvent): boolean {
  return state.seenProviderEventIds.has(event.source.sourceEventId ?? "") || state.seenPayloadHashes.has(event.payloadHash);
}

function remember(state: IngestionState, event: NormalizedEvent): void {
  if (event.source.sourceEventId) state.seenProviderEventIds.add(event.source.sourceEventId);
  state.seenPayloadHashes.add(event.payloadHash);
}
