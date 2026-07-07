import type { NormalizedEvent } from "./types.ts";

export type LiveEventProcessingMode = "immediate" | "deferred";

export type LiveSessionFactKind =
  | "session_started"
  | "session_completed"
  | "user_turn"
  | "assistant_turn"
  | "attention"
  | "status"
  | "tool_stat";

export type DeferredLiveReason = "tool_stat" | "file_stat";

export type LiveTranscriptPointer = {
  sourceSessionId: string;
  transcriptPath: string;
};

export type LiveSessionFact = {
  eventId: string;
  sourceSessionId: string;
  adapter: string;
  surface: string;
  kind: LiveSessionFactKind;
  priority: LiveEventProcessingMode;
  occurredAt: string;
  summary: string;
  status?: "active" | "waiting" | "failed" | "completed";
  transcriptPointer?: LiveTranscriptPointer;
  deferredReason?: DeferredLiveReason;
};

export function eventLiveProcessingMode(event: NormalizedEvent): LiveEventProcessingMode {
  return shouldApplyLiveEventImmediately(event) ? "immediate" : "deferred";
}

export function shouldApplyLiveEventImmediately(event: NormalizedEvent): boolean {
  if (!event.sessionId) return false;
  if (event.type === "file.changed") return false;
  if (event.type === "command.finished") return commandFailed(event);
  return true;
}

export function liveSessionFactFromEvent(event: NormalizedEvent): LiveSessionFact | undefined {
  if (!event.sessionId) return undefined;
  const priority = eventLiveProcessingMode(event);
  const fact: LiveSessionFact = {
    adapter: event.source.adapter,
    eventId: event.eventId,
    kind: factKindForEvent(event),
    occurredAt: event.occurredAt,
    priority,
    sourceSessionId: event.sessionId,
    status: statusForEvent(event),
    summary: event.summary,
    surface: event.source.surface,
    transcriptPointer: liveTranscriptPointerFromEvent(event)
  };
  const deferredReason = deferredReasonForEvent(event);
  return deferredReason ? { ...fact, deferredReason } : fact;
}

export function liveTranscriptPointerFromEvent(event: NormalizedEvent): LiveTranscriptPointer | undefined {
  if (!event.sessionId) return undefined;
  const transcriptPath = stringPayload(event, "transcriptPath") ?? stringPayload(event, "transcript_path");
  if (!transcriptPath) return undefined;
  return {
    sourceSessionId: event.sessionId,
    transcriptPath
  };
}

function factKindForEvent(event: NormalizedEvent): LiveSessionFactKind {
  if (event.type === "session.started") return "session_started";
  if (event.type === "session.completed" || event.type === "turn.completed") return "session_completed";
  if (event.type === "user.question" || event.type === "user.response") return "user_turn";
  if (event.type === "approval.requested") return "attention";
  if (event.type === "command.finished" && commandFailed(event)) return "attention";
  if (event.type === "command.started" || event.type === "command.finished" || event.type === "file.changed") {
    return "tool_stat";
  }
  return "status";
}

function statusForEvent(event: NormalizedEvent): LiveSessionFact["status"] {
  if (event.type === "session.completed" || event.type === "turn.completed") return "completed";
  if (event.type === "approval.requested" || event.type === "user.question") return "waiting";
  if (event.type === "user.response") return "active";
  if (event.type === "command.finished" && commandFailed(event)) return "failed";
  if (event.type === "session.started") return "active";
  return undefined;
}

function deferredReasonForEvent(event: NormalizedEvent): DeferredLiveReason | undefined {
  if (event.type === "file.changed") return "file_stat";
  if (event.type === "command.started" && eventLiveProcessingMode(event) === "deferred") return "tool_stat";
  if (event.type === "command.finished" && !commandFailed(event)) return "tool_stat";
  return undefined;
}

function commandFailed(event: NormalizedEvent): boolean {
  const exitCode = numberPayload(event, "exitCode");
  const status = stringPayload(event, "status");
  return (exitCode !== undefined && exitCode !== 0) || status === "failed" || status === "error";
}

function stringPayload(event: NormalizedEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberPayload(event: NormalizedEvent, key: string): number | undefined {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
