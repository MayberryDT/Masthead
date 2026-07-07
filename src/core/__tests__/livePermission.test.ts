import { describe, expect, test } from "vitest";
import { approvalEventRequiresPermission, eventIsWorkingProof, liveStateImpliedByEvent } from "../livePermission.ts";
import type { NormalizedEvent } from "../types.ts";

describe("live permission policy", () => {
  test("treats ordinary approval requests as pending permission blockers", () => {
    const approval = event("approval.requested", { commandId: "cmd-1", permissionMode: "on-request" });

    expect(approvalEventRequiresPermission(approval)).toBe(true);
    expect(liveStateImpliedByEvent(approval)).toBe("blocked");
  });

  test.each(["bypassPermissions", "bypass_permissions", "full_access", "danger-full-access", "none", "disabled"] as const)(
    "does not block bypass/full-access approval mode %s",
    (permissionMode) => {
      const approval = event("approval.requested", { commandId: "cmd-1", permissionMode });

      expect(approvalEventRequiresPermission(approval)).toBe(false);
      expect(liveStateImpliedByEvent(approval)).toBe("working");
    }
  );

  test("does not treat user questions as blocked or working proof", () => {
    const question = event("user.question", { status: "needs_input" });

    expect(liveStateImpliedByEvent(question)).toBeUndefined();
    expect(eventIsWorkingProof(question)).toBe(false);
  });

  test("maps only state-bearing work events to working proof", () => {
    expect(eventIsWorkingProof(event("command.started"))).toBe(true);
    expect(eventIsWorkingProof(event("turn.started"))).toBe(true);
    expect(eventIsWorkingProof(event("user.response"))).toBe(true);
    expect(eventIsWorkingProof(event("file.changed"))).toBe(false);
    expect(eventIsWorkingProof(event("session.started"))).toBe(false);
  });
});

function event(type: NormalizedEvent["type"], payload: Record<string, unknown> = {}): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${type}`,
    sessionId: "session-1",
    source: { adapter: "codex", surface: "hook", sourceEventId: `event-${type}` },
    occurredAt: "2026-07-07T12:00:00.000Z",
    receivedAt: "2026-07-07T12:00:00.000Z",
    type,
    summary: type,
    payload: { runtime: "codex", sourceSessionId: "source-1", ...payload },
    sensitivity: "metadata",
    payloadHash: `hash-${type}`,
    evidence: []
  };
}
