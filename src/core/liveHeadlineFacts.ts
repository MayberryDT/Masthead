import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { RuntimeKind } from "../adapters/types.ts";
import type { BoardTranscriptMessageFact } from "./boardHeadlineFacts.ts";
import type { LiveBlocker } from "./liveBlockers.ts";
import type { LiveRuntimeSemanticState, LiveStateReport } from "./liveState.ts";
import type { EventType, GitSnapshot, NormalizedEvent } from "./types.ts";

export type LiveHeadlineFacts = {
  sourceSessionId: string;
  canonicalSessionId?: string;
  runtime?: RuntimeKind;
  generatedAt: string;
  latestTranscriptAt?: string;
  recentMessages: Array<{
    role: "user" | "assistant" | "tool" | "system";
    text: string;
    observedAt: string;
  }>;
  recentEvents: Array<{
    type: EventType;
    summary: string;
    occurredAt: string;
  }>;
  latestLiveState?: {
    state: LiveRuntimeSemanticState;
    message?: string;
    observedAt: string;
  };
  blockers: Array<{
    kind: "approval" | "question";
    title: string;
    openedAt: string;
  }>;
  changedFiles: string[];
  latestCommand?: {
    command?: string;
    status?: "running" | "passed" | "failed";
    observedAt?: string;
  };
  fingerprint: string;
};

export function buildLiveHeadlineFacts(input: {
  sessionId: string;
  sourceSessionId: string;
  runtime?: RuntimeKind;
  events: NormalizedEvent[];
  transcriptFacts?: { recentMessages: BoardTranscriptMessageFact[] };
  liveState?: LiveStateReport;
  blockers?: LiveBlocker[];
  gitSnapshots?: GitSnapshot[];
  maxMessages?: number;
  maxBytes?: number;
  now?: Date;
}): LiveHeadlineFacts {
  const maxMessages = input.maxMessages ?? 24;
  const maxBytes = input.maxBytes ?? 40_000;
  const recentMessages = boundedMessages(input.transcriptFacts?.recentMessages ?? [], maxMessages, maxBytes);
  const recentEvents = input.events
    .filter((event) => event.sessionId === input.sessionId || event.sessionId === input.sourceSessionId)
    .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 20)
    .map((event) => ({ type: event.type, summary: event.summary, occurredAt: event.occurredAt }))
    .toReversed();
  const changedFiles = [
    ...new Set(
      (input.gitSnapshots ?? [])
        .filter((snapshot) => snapshot.sessionId === input.sessionId || snapshot.sessionId === input.sourceSessionId)
        .flatMap((snapshot) => snapshot.changedPaths.map((path) => basename(path.path)))
        .filter(Boolean)
    )
  ].toSorted();
  const latestCommand = latestCommandFact(input.events);
  const blockers = (input.blockers ?? []).map((blocker) => ({
    kind: blocker.kind,
    title: blocker.title,
    openedAt: blocker.openedAt
  }));
  const latestTranscriptAt = recentMessages.map((message) => message.observedAt).toSorted().at(-1);
  const base = {
    sourceSessionId: input.sourceSessionId,
    runtime: input.runtime,
    latestTranscriptAt,
    recentMessages,
    recentEvents,
    latestLiveState: input.liveState
      ? {
          state: input.liveState.state,
          message: input.liveState.message ?? input.liveState.customStatus,
          observedAt: input.liveState.observedAt
        }
      : undefined,
    blockers,
    changedFiles,
    latestCommand
  };

  return {
    ...base,
    generatedAt: (input.now ?? new Date()).toISOString(),
    fingerprint: hashStable({
      messages: recentMessages.map((message) => [message.role, message.observedAt, hashStable(message.text)]),
      events: recentEvents.map((event) => [event.type, event.occurredAt, hashStable(event.summary)]),
      liveState: input.liveState ? [input.liveState.reportId, input.liveState.state, input.liveState.observedAt] : undefined,
      blockers,
      changedFiles,
      latestCommand
    })
  };
}

function boundedMessages(messages: BoardTranscriptMessageFact[], maxMessages: number, maxBytes: number): LiveHeadlineFacts["recentMessages"] {
  const selected: LiveHeadlineFacts["recentMessages"] = [];
  let bytes = 0;
  for (const message of messages.toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))) {
    if (selected.length >= maxMessages) break;
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "tool" && message.role !== "system") continue;
    const text = message.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const nextBytes = Buffer.byteLength(text, "utf8");
    if (bytes + nextBytes > maxBytes && selected.length > 0) break;
    selected.push({ role: message.role, text, observedAt: message.observedAt });
    bytes += nextBytes;
  }
  return selected.toReversed();
}

function latestCommandFact(events: NormalizedEvent[]): LiveHeadlineFacts["latestCommand"] {
  const event = events
    .filter((candidate) => candidate.type === "command.started" || candidate.type === "command.finished")
    .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (!event) return undefined;
  const command = stringPayload(event, "normalizedCommand") ?? stringPayload(event, "command");
  const exitCode = typeof event.payload.exitCode === "number" ? event.payload.exitCode : undefined;
  return {
    command,
    status: event.type === "command.started" ? "running" : exitCode === 0 ? "passed" : exitCode === undefined ? undefined : "failed",
    observedAt: event.occurredAt
  };
}

function stringPayload(event: NormalizedEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
