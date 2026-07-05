import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseLiveHookPayload } from "../liveHookAdapter.ts";

const fixtureDir = join(process.cwd(), "src/adapters/live/__fixtures__");

describe("live hook adapter", () => {
  test.each([
    ["codex", "codex-session-start.json", "session.started", "codex-session-1"],
    ["claude_code", "claude-user-prompt-submit.json", "user.question", "claude-session-1"],
    ["cursor", "cursor-before-submit-prompt.json", "user.question", "cursor-session-1"],
    ["grok", "grok-pre-tool-use.json", "command.started", "grok-session-1"],
    ["omp", "omp-session-start.json", "session.started", "omp-session-1"],
    ["opencode", "opencode-chat-message.json", "session.started", "opencode-session-1"]
  ])("normalizes %s fixture", (runtime, fixture, type, sourceSessionId) => {
    const raw = readFileSync(join(fixtureDir, fixture), "utf8");
    const parsed = parseLiveHookPayload(raw, { receivedAt: "2026-07-05T12:00:10.000Z", runtime });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event).toMatchObject({
      sessionId: sourceSessionId,
      source: { adapter: runtime, surface: runtime === "opencode" || runtime === "omp" ? "plugin" : "hook" },
      type
    });
    if (runtime === "codex") {
      expect(parsed.event.payload).not.toHaveProperty("runtime");
      expect(parsed.event.payload).not.toHaveProperty("harness");
      expect(parsed.event.payload).not.toHaveProperty("sourceSessionId");
    } else {
      expect(parsed.event.payload).toMatchObject({
        runtime,
        harness: expect.any(String),
        sourceSessionId
      });
    }
    expect(parsed.event.evidence[0]?.source).toBe(runtime === "omp" ? "omp.extension" : `${runtime}.${runtime === "opencode" ? "plugin" : "hook"}`);
    expect(JSON.stringify(parsed.event.payload)).not.toContain("Inspect Masthead sources");
    expect(JSON.stringify(parsed.event.payload)).not.toContain("Fix the failing tests");
  });

  test("defaults to Codex for compatibility when runtime is omitted", () => {
    const raw = readFileSync(join(fixtureDir, "codex-session-start.json"), "utf8");
    const parsed = parseLiveHookPayload(raw, { receivedAt: "2026-07-05T12:00:10.000Z" });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.event.source.adapter).toBe("codex");
  });

  test("uses non-Codex identity fields for fallback event ids after redaction", () => {
    const first = parseLiveHookPayload(
      JSON.stringify({
        hookEventName: "UserPromptSubmit",
        sessionId: "claude-collision-session",
        timestamp: "2026-07-05T12:02:00.000Z",
        prompt: "abcd"
      }),
      { receivedAt: "2026-07-05T12:02:10.000Z", runtime: "claude_code" }
    );
    const second = parseLiveHookPayload(
      JSON.stringify({
        hookEventName: "UserPromptSubmit",
        sessionId: "claude-collision-session",
        timestamp: "2026-07-05T12:02:01.000Z",
        prompt: "wxyz"
      }),
      { receivedAt: "2026-07-05T12:02:11.000Z", runtime: "claude_code" }
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.event.payloadHash).toBe(second.event.payloadHash);
    expect(first.event.eventId).not.toBe(second.event.eventId);
    expect(first.event.source.sourceEventId).not.toBe(second.event.source.sourceEventId);
    expect(first.event.eventId).toMatch(/^claude_code:/);
  });

  test.each([
    ["message string", "message", "private chat message RAW_PRIVATE_SENTINEL", "messageSummary"],
    ["message object", "message", { content: "RAW_PRIVATE_SENTINEL" }, "messageSummary"],
    ["messages", "messages", [{ role: "user", content: "RAW_PRIVATE_SENTINEL" }], "messagesSummary"],
    ["toolOutput", "toolOutput", "RAW_PRIVATE_SENTINEL", "toolOutputSummary"],
    ["toolOutputs", "toolOutputs", ["RAW_PRIVATE_SENTINEL"], "toolOutputsSummary"],
    ["output", "output", "RAW_PRIVATE_SENTINEL", "outputSummary"],
    ["stdout", "stdout", "RAW_PRIVATE_SENTINEL", "stdoutSummary"],
    ["stderr", "stderr", "RAW_PRIVATE_SENTINEL", "stderrSummary"],
    ["prompt", "prompt", "RAW_PRIVATE_SENTINEL", "promptSummary"],
    ["toolResponse", "toolResponse", "RAW_PRIVATE_SENTINEL", "toolResponseSummary"],
    ["fullDiff", "fullDiff", "RAW_PRIVATE_SENTINEL", "fullDiffSummary"],
    ["patch", "patch", "RAW_PRIVATE_SENTINEL", "patchSummary"],
    ["screenshot", "screenshot", "RAW_PRIVATE_SENTINEL", "screenshotSummary"],
    ["screenshots", "screenshots", ["RAW_PRIVATE_SENTINEL"], "screenshotsSummary"]
  ])("suppresses raw %s before storage", (_label, key, value, summaryKey) => {
    const parsed = parseLiveHookPayload(
      JSON.stringify({
        hookEventName: "PostToolUse",
        sessionId: "claude-private-session",
        timestamp: "2026-07-05T12:01:00.000Z",
        cwd: "/tmp/masthead-live-fixture",
        [key]: value
      }),
      { receivedAt: "2026-07-05T12:01:01.000Z", runtime: "claude_code" }
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.sensitivity).toBe("redacted");
    expect(parsed.event.payload).toHaveProperty(summaryKey);
    expect(JSON.stringify(parsed.event)).not.toContain("RAW_PRIVATE_SENTINEL");
  });
});
