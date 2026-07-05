import { describe, expect, test } from "vitest";
import {
  liveSessionKeyFromEvent,
  liveSessionKeyId,
  projectionScopeForKey,
  scopeEventForProjection
} from "../liveIdentity.ts";
import type { NormalizedEvent } from "../types.ts";

describe("live identity", () => {
  test("keeps identical source session ids separate across runtimes", () => {
    const codex = event("codex", "shared-session");
    const claude = event("claude_code", "shared-session");

    expect(liveSessionKeyId(liveSessionKeyFromEvent(codex)!)).toBe("codex:shared-session");
    expect(liveSessionKeyId(liveSessionKeyFromEvent(claude)!)).toBe("claude_code:shared-session");
    expect(projectionScopeForKey("host:dev", liveSessionKeyFromEvent(codex)!).canonicalSessionId).not.toBe(
      projectionScopeForKey("host:dev", liveSessionKeyFromEvent(claude)!).canonicalSessionId
    );
  });

  test("preserves source session id while changing projection session id", () => {
    const scoped = scopeEventForProjection(event("grok", "abc/123"));

    expect(scoped?.sessionId).toBe("grok:abc%2F123");
    expect(scoped?.payload.sourceSessionId).toBe("abc/123");
    expect(scoped?.payload.runtime).toBe("grok");
  });
});

function event(adapter: string, sessionId: string): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `${adapter}:${sessionId}:start`,
    sessionId,
    source: { adapter, surface: "hook", sourceEventId: `${sessionId}:start` },
    occurredAt: "2026-07-05T12:00:00.000Z",
    receivedAt: "2026-07-05T12:00:00.000Z",
    type: "session.started",
    summary: "Started",
    payload: { title: "Started" },
    sensitivity: "metadata",
    payloadHash: `${adapter}:${sessionId}:hash`,
    evidence: [
      {
        id: `${adapter}:${sessionId}:start`,
        kind: "event",
        observedAt: "2026-07-05T12:00:00.000Z",
        source: `${adapter}.hook`
      }
    ]
  };
}
