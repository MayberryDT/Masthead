import { describe, expect, test } from "vitest";
import {
  eventLiveProcessingMode,
  liveSessionFactFromEvent,
  liveTranscriptPointerFromEvent,
  shouldApplyLiveEventImmediately
} from "../liveSessionFacts.ts";
import type { NormalizedEvent } from "../types.ts";

describe("live session facts", () => {
  test("treats session lifecycle, user turns, approvals, and completion as immediate live facts", () => {
    const events = [
      event("start", "session.started", { title: "Harness-neutral live facts" }),
      event("question", "user.question", { message: "Make the board lighter." }),
      event("approval", "approval.requested", { command: "npm test" }),
      event("stop", "session.completed", { summary: "Live fact path is working." })
    ];

    expect(events.map(eventLiveProcessingMode)).toEqual(["immediate", "immediate", "immediate", "immediate"]);
    expect(events.every(shouldApplyLiveEventImmediately)).toBe(true);
    expect(events.map((candidate) => liveSessionFactFromEvent(candidate)?.kind)).toEqual([
      "session_started",
      "user_turn",
      "attention",
      "session_completed"
    ]);
  });

  test("defers successful tool and file events out of the live board hot path", () => {
    const started = event("started", "command.started", {
      category: "shell",
      commandId: "call-started",
      normalizedCommand: "npm test"
    });
    const shell = event("shell", "command.finished", {
      category: "shell",
      commandId: "call-shell",
      exitCode: 0,
      normalizedCommand: "npm test"
    });
    const file = event("file", "file.changed", {
      category: "file_edit",
      commandId: "call-patch",
      path: "src/core/liveSessionFacts.ts"
    });

    expect(eventLiveProcessingMode(started)).toBe("deferred");
    expect(eventLiveProcessingMode(shell)).toBe("deferred");
    expect(eventLiveProcessingMode(file)).toBe("deferred");
    expect(shouldApplyLiveEventImmediately(started)).toBe(false);
    expect(shouldApplyLiveEventImmediately(shell)).toBe(false);
    expect(shouldApplyLiveEventImmediately(file)).toBe(false);
    expect(liveSessionFactFromEvent(started)).toMatchObject({
      deferredReason: "tool_stat",
      kind: "tool_stat",
      priority: "deferred"
    });
    expect(liveSessionFactFromEvent(shell)).toMatchObject({
      deferredReason: "tool_stat",
      kind: "tool_stat",
      priority: "deferred"
    });
    expect(liveSessionFactFromEvent(file)).toMatchObject({
      deferredReason: "file_stat",
      kind: "tool_stat",
      priority: "deferred"
    });
  });

  test("keeps failed commands immediate because they are high-level attention signals", () => {
    const failed = event("failed", "command.finished", {
      category: "shell",
      commandId: "call-failed",
      exitCode: 1,
      normalizedCommand: "npm test"
    });
    const errorStatus = event("error", "command.finished", {
      category: "shell",
      commandId: "call-error",
      normalizedCommand: "npm test",
      status: "error"
    });

    expect(eventLiveProcessingMode(failed)).toBe("immediate");
    expect(eventLiveProcessingMode(errorStatus)).toBe("immediate");
    expect(liveSessionFactFromEvent(failed)).toMatchObject({
      kind: "attention",
      priority: "immediate",
      status: "failed"
    });
    expect(liveSessionFactFromEvent(errorStatus)).toMatchObject({
      kind: "attention",
      priority: "immediate",
      status: "failed"
    });
  });

  test("preserves transcript source pointers without storing full transcript text", () => {
    const stopped = event("stop", "session.completed", {
      fullTranscript: "this raw transcript text must not be copied into the live fact",
      lastAssistantMessageSummary: { bytes: 4096, redacted: true, stored: false },
      transcriptPath: "/home/tyler/.codex/sessions/2026/07/02/session.jsonl"
    });

    expect(liveTranscriptPointerFromEvent(stopped)).toEqual({
      sourceSessionId: "session-1",
      transcriptPath: "/home/tyler/.codex/sessions/2026/07/02/session.jsonl"
    });
    expect(liveSessionFactFromEvent(stopped)).toMatchObject({
      transcriptPointer: {
        sourceSessionId: "session-1",
        transcriptPath: "/home/tyler/.codex/sessions/2026/07/02/session.jsonl"
      }
    });
    expect(JSON.stringify(liveSessionFactFromEvent(stopped))).not.toContain("this raw transcript text");
    expect(JSON.stringify(liveSessionFactFromEvent(stopped))).not.toContain("fullTranscript");
  });
});

function event(id: string, type: NormalizedEvent["type"], payload: Record<string, unknown>): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `event:${id}`,
    sessionId: "session-1",
    source: {
      adapter: "codex",
      surface: "hook",
      sourceEventId: id
    },
    occurredAt: `2026-07-02T12:00:${String(id.length).padStart(2, "0")}.000Z`,
    receivedAt: `2026-07-02T12:00:${String(id.length).padStart(2, "0")}.100Z`,
    type,
    summary: String(payload.summary ?? payload.message ?? payload.title ?? type),
    payload,
    sensitivity: "metadata",
    payloadHash: `hash:${id}`,
    evidence: [
      {
        id: `event:${id}`,
        kind: "event",
        observedAt: `2026-07-02T12:00:${String(id.length).padStart(2, "0")}.000Z`,
        source: "test"
      }
    ]
  };
}
