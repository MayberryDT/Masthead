import { describe, expect, test } from "vitest";
import { deriveOutcome } from "../outcomes";
import type { DerivedSession, NormalizedEvent } from "../types";

const evidence = [{ id: "event-1", kind: "event" as const, observedAt: "2026-06-23T02:00:00.000Z", source: "fixture" }];

const session: DerivedSession = {
  sessionId: "session-1",
  project: "Pip",
  title: "Fix auth",
  primaryStatus: "completed_unreviewed",
  lifecycle: "ended",
  endReason: "completed",
  endedAt: "2026-06-23T02:10:00.000Z",
  lastEventType: "session.completed",
  flags: ["agent_claims_complete", "dirty_worktree", "no_tests_observed"],
  lastMeaningfulActivityAt: "2026-06-23T02:10:00.000Z",
  attribution: "direct",
  changedFileCount: 2,
  evidence
};

const event = (eventId: string, type: NormalizedEvent["type"], payload: Record<string, unknown>): NormalizedEvent => ({
  schemaVersion: 1,
  eventId,
  sessionId: "session-1",
  source: { adapter: "codex", surface: "fixture", sourceEventId: eventId },
  occurredAt: "2026-06-23T02:05:00.000Z",
  receivedAt: "2026-06-23T02:05:00.000Z",
  type,
  summary: type,
  payload,
  sensitivity: "metadata",
  payloadHash: `hash-${eventId}`,
  evidence
});

describe("outcome engine", () => {
  test("keeps observed evidence separate from policy result", () => {
    const outcome = deriveOutcome(session, [
      event("test-pass", "command.finished", {
        commandId: "cmd-1",
        category: "test",
        normalizedCommand: "npm test",
        exitCode: 0
      })
    ]);

    expect(outcome.evidence.sessionId).toBe("session-1");
    expect(outcome.evidence.changedFileCount).toBe(2);
    expect(outcome.evidence.verificationCommands).toHaveLength(1);
    expect(outcome.policyResult.label).toBe("needs_attention");
    expect(outcome.policyResult.reasons).toContain("working tree still dirty");
  });

  test("completed session without verification needs attention", () => {
    const outcome = deriveOutcome(session, []);

    expect(outcome.policyResult.label).toBe("needs_attention");
    expect(outcome.policyResult.reasons).toContain("no verification observed");
  });

  test("verification commands without exit status remain unknown instead of failed", () => {
    const outcome = deriveOutcome(session, [
      event("test-unknown", "command.finished", {
        commandId: "cmd-1",
        category: "test",
        normalizedCommand: "npm test"
      })
    ]);

    expect(outcome.evidence.verificationCommands).toEqual([]);
    expect(outcome.policyResult.label).toBe("needs_attention");
    expect(outcome.policyResult.reasons).toContain("no verification observed");
    expect(outcome.policyResult.reasons).not.toContain("verification failed");
  });

  test("policy can classify clean verified work as completed without mutating evidence", () => {
    const cleanSession: DerivedSession = {
      ...session,
      flags: ["agent_claims_complete"],
      changedFileCount: 1
    };
    const outcome = deriveOutcome(
      cleanSession,
      [
        event("test-pass", "command.finished", {
          commandId: "cmd-1",
          category: "test",
          normalizedCommand: "npm test",
          exitCode: 0
        })
      ],
      { allowAutoAcceptedWhenCleanAndVerified: true }
    );

    expect(outcome.policyResult.label).toBe("completed");
    expect(outcome.evidence.changedFileCount).toBe(1);
  });

  test("latest verification result controls terminal outcome after fail-fix-pass", () => {
    const cleanSession: DerivedSession = {
      ...session,
      flags: ["agent_claims_complete"],
      changedFileCount: 1
    };
    const outcome = deriveOutcome(cleanSession, [
      {
        ...event("test-fail", "command.finished", {
          commandId: "cmd-1",
          category: "test",
          normalizedCommand: "npm test",
          exitCode: 1
        }),
        occurredAt: "2026-06-23T02:04:00.000Z"
      },
      {
        ...event("test-pass", "command.finished", {
          commandId: "cmd-2",
          category: "test",
          normalizedCommand: "npm test",
          exitCode: 0
        }),
        occurredAt: "2026-06-23T02:08:00.000Z"
      }
    ]);

    expect(outcome.policyResult.label).toBe("completed");
    expect(outcome.policyResult.reasons).toContain("clean verified outcome");
  });
});
