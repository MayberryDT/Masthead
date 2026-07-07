import { describe, expect, test } from "vitest";
import { deriveLiveBlockers } from "../liveBlockers.ts";
import type { NormalizedEvent } from "../types.ts";

describe("live blocker derivation", () => {
  test("opens and resolves approval blockers", () => {
    const blockers = deriveLiveBlockers([
      event("approval-1", "approval.requested", "2026-07-07T12:00:00.000Z", { toolUseId: "tool-1" }),
      event("approval-2", "approval.resolved", "2026-07-07T12:01:00.000Z", { toolUseId: "tool-1" })
    ]);

    expect(blockers.get("session-1")).toEqual([]);
  });

  test("does not open blockers for user questions", () => {
    const blockers = deriveLiveBlockers([
      event("question-1", "user.question", "2026-07-07T12:00:00.000Z"),
      event("response-1", "user.response", "2026-07-07T12:01:00.000Z")
    ]);

    expect(blockers.get("session-1")).toEqual([]);
  });

  test("ignores bypass approval events", () => {
    const blockers = deriveLiveBlockers([
      event("approval-1", "approval.requested", "2026-07-07T12:00:00.000Z", {
        permissionMode: "bypassPermissions",
        toolName: "mcp__gbrain__search"
      })
    ]);

    expect(blockers.get("session-1")).toEqual([]);
  });

  test("keeps fresh unresolved permission approvals grouped by session", () => {
    const blockers = deriveLiveBlockers(
      [
        event("approval-1", "approval.requested", "2026-07-07T12:00:00.000Z", {
          permissionMode: "on-request",
          commandId: "cmd-1"
        })
      ],
      { now: new Date("2026-07-07T12:01:59.000Z"), maxAgeMs: 120_000 }
    );

    expect(blockers.get("session-1")?.map((blocker) => blocker.kind)).toEqual(["approval"]);
  });

  test("expires stale unresolved approval blockers", () => {
    const blockers = deriveLiveBlockers(
      [
        event("approval-1", "approval.requested", "2026-07-07T12:00:00.000Z", {
          permissionMode: "on-request",
          commandId: "cmd-1"
        })
      ],
      { now: new Date("2026-07-07T12:02:01.000Z"), maxAgeMs: 120_000 }
    );

    expect(blockers.get("session-1")).toEqual([]);
  });

  test("resolves approval blockers when the approved command starts", () => {
    const blockers = deriveLiveBlockers([
      event("approval-1", "approval.requested", "2026-07-07T12:00:00.000Z", {
        permissionMode: "on-request",
        commandId: "cmd-1"
      }),
      event("command-1", "command.started", "2026-07-07T12:00:10.000Z", {
        commandId: "cmd-1"
      }),
      event("question-1", "user.question", "2026-07-07T12:01:00.000Z")
    ]);

    expect(blockers.get("session-1")).toEqual([]);
  });
});

function event(eventId: string, type: NormalizedEvent["type"], occurredAt: string, payload: Record<string, unknown> = {}): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId,
    sessionId: "session-1",
    source: { adapter: "codex", surface: "hook", sourceEventId: eventId },
    occurredAt,
    receivedAt: occurredAt,
    type,
    summary: type,
    payload: { runtime: "codex", sourceSessionId: "source-1", ...payload },
    sensitivity: "metadata",
    payloadHash: eventId,
    evidence: [{ id: eventId, kind: "event", observedAt: occurredAt, source: "test" }]
  };
}
