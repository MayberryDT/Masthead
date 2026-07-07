import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { RuntimeKind } from "../../adapters/types.ts";
import { parseLiveHookPayload } from "../liveHookAdapter.ts";

const fixtureDir = join(process.cwd(), "src/adapters/live/__fixtures__");

const liveCases: Array<{
  fixture?: string;
  raw?: string;
  runtime: RuntimeKind;
  sourceSessionId: string;
  sourceName: string;
  surface: "hook" | "plugin";
  type: string;
}> = [
  {
    runtime: "codex",
    fixture: "codex-session-start.json",
    type: "session.started",
    sourceSessionId: "codex-session-1",
    sourceName: "codex.hook",
    surface: "hook"
  },
  {
    runtime: "claude_code",
    fixture: "claude-user-prompt-submit.json",
    type: "user.question",
    sourceSessionId: "claude-session-1",
    sourceName: "claude_code.hook",
    surface: "hook"
  },
  {
    runtime: "cursor",
    fixture: "cursor-before-submit-prompt.json",
    type: "user.question",
    sourceSessionId: "cursor-session-1",
    sourceName: "cursor.hook",
    surface: "hook"
  },
  {
    runtime: "grok",
    fixture: "grok-pre-tool-use.json",
    type: "command.started",
    sourceSessionId: "grok-session-1",
    sourceName: "grok.hook",
    surface: "hook"
  },
  {
    runtime: "opencode",
    fixture: "opencode-chat-message.json",
    type: "session.started",
    sourceSessionId: "opencode-session-1",
    sourceName: "opencode.plugin",
    surface: "plugin"
  },
  {
    runtime: "omp",
    fixture: "omp-session-start.json",
    type: "session.started",
    sourceSessionId: "omp-session-1",
    sourceName: "omp.extension",
    surface: "plugin"
  },
  {
    runtime: "pi",
    raw: JSON.stringify({
      type: "session_start",
      sessionId: "pi-session-1",
      timestamp: "2026-07-05T12:00:00.000Z",
      cwd: "/workspace/masthead"
    }),
    type: "session.started",
    sourceSessionId: "pi-session-1",
    sourceName: "pi.extension",
    surface: "plugin"
  },
  {
    runtime: "hermes",
    raw: JSON.stringify({
      type: "session_start",
      sessionId: "hermes-session-1",
      timestamp: "2026-07-05T12:00:00.000Z",
      directory: "/workspace/masthead"
    }),
    type: "session.started",
    sourceSessionId: "hermes-session-1",
    sourceName: "hermes.plugin",
    surface: "plugin"
  }
];

describe("live hook adapter", () => {
  test.each(liveCases)("normalizes $runtime live payloads", ({ runtime, fixture, raw, type, sourceSessionId, sourceName, surface }) => {
    const parsed = parseLiveHookPayload(raw ?? readFileSync(join(fixtureDir, fixture!), "utf8"), {
      receivedAt: "2026-07-05T12:00:10.000Z",
      runtime
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event).toMatchObject({
      sessionId: sourceSessionId,
      source: { adapter: runtime, surface },
      type
    });
    expect(parsed.event.payload).toMatchObject({
      runtime,
      harness: expect.any(String),
      sourceSessionId
    });
    expect(parsed.event.evidence[0]?.source).toBe(sourceName);
    expect(JSON.stringify(parsed.event.payload)).not.toContain("Inspect Masthead sources");
    expect(JSON.stringify(parsed.event.payload)).not.toContain("Fix the failing tests");
  });

  test("rejects omitted runtime instead of defaulting to a deleted adapter", () => {
    const raw = readFileSync(join(fixtureDir, "claude-user-prompt-submit.json"), "utf8");
    const parsed = parseLiveHookPayload(raw, { receivedAt: "2026-07-05T12:00:10.000Z" });

    expect(parsed).toEqual({
      ok: false,
      diagnostic: {
        code: "unsupported_runtime",
        message: "Live hook runtime is required.",
        receivedAt: "2026-07-05T12:00:10.000Z"
      }
    });
  });

  test("keeps explicit runtime authority when the payload reports a different runtime", () => {
    const parsed = parseLiveHookPayload(
      JSON.stringify({
        event: "SessionStart",
        session_id: "codex-runtime-authority-session",
        timestamp: "2026-07-05T12:00:04.000Z",
        runtime: "claude_code",
        provider_event_id: "codex-runtime-authority-session:start"
      }),
      { receivedAt: "2026-07-05T12:00:10.000Z", runtime: "codex" }
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event).toMatchObject({
      eventId: "codex:codex-runtime-authority-session:start",
      sessionId: "codex-runtime-authority-session",
      source: { adapter: "codex", surface: "hook" },
      type: "session.started"
    });
    expect(parsed.event.payload).toMatchObject({
      runtime: "codex",
      harness: "Codex",
      sourceSessionId: "codex-runtime-authority-session",
      runtimeDiagnostics: [
        {
          code: "runtime_mismatch",
          normalizedRuntime: "codex",
          reportedRuntime: "claude_code"
        }
      ]
    });
    expect(parsed.event.evidence[0]?.source).toBe("codex.hook");
  });

  test("reports source path mismatches without overriding the normalized runtime", () => {
    const parsed = parseLiveHookPayload(
      JSON.stringify({
        event: "SessionStart",
        session_id: "codex-path-mismatch-session",
        transcriptPath: "/tmp/sanitized/.grok/sessions/session.jsonl",
        timestamp: "2026-07-05T12:00:04.000Z"
      }),
      { receivedAt: "2026-07-05T12:00:10.000Z", runtime: "codex" }
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.source.adapter).toBe("codex");
    expect(parsed.event.payload).toMatchObject({
      runtime: "codex",
      runtimeDiagnostics: [
        {
          code: "source_path_mismatch",
          normalizedRuntime: "codex",
          payloadKey: "transcriptPath",
          reportedRuntime: "grok"
        }
      ]
    });
  });

  test("keeps OMP session files and turn ids as metadata instead of session keys", () => {
    const parsed = parseLiveHookPayload(
      JSON.stringify({
        type: "session_stop",
        sessionId: "omp-stable-session",
        sessionFile: "/home/user/.omp/agent/sessions/project/turn-scoped-child.jsonl",
        turnId: "turn-7",
        timestamp: "2026-07-05T12:03:00.000Z"
      }),
      { receivedAt: "2026-07-05T12:03:01.000Z", runtime: "omp" }
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.sessionId).toBe("omp-stable-session");
    expect(parsed.event.sessionId).not.toBe(parsed.event.payload.sessionFile);
    expect(parsed.event.sessionId).not.toBe(parsed.event.payload.turnId);
    expect(parsed.event.payload).toMatchObject({
      runtime: "omp",
      harness: "Oh My Pi",
      sourceSessionId: "omp-stable-session",
      sessionFile: "/home/user/.omp/agent/sessions/project/turn-scoped-child.jsonl",
      turnId: "turn-7"
    });
  });

  test("preserves OMP runtime state model and provider fields in normalized payloads", () => {
    const parsed = parseLiveHookPayload(
      JSON.stringify({
        type: "runtime_state",
        sessionId: "omp-state-session",
        timestamp: "2026-07-05T12:05:00.000Z",
        cwd: "/workspace/masthead",
        status: "active",
        state: "logged",
        model: "gpt-5.5",
        provider: "openai",
        totalTokens: 42
      }),
      { receivedAt: "2026-07-05T12:05:00.100Z", runtime: "omp" }
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.source.adapter).toBe("omp");
    expect(parsed.event.payload).toMatchObject({
      runtime: "omp",
      harness: "Oh My Pi",
      sourceSessionId: "omp-state-session",
      status: "active",
      state: "logged",
      model: "gpt-5.5",
      provider: "openai",
      totalTokens: 42
    });
  });

  test.each([
    ["waiting_for_approval", undefined],
    ["permission_requested", undefined],
    ["waiting_for_user", undefined],
    ["blocked", "blocked"]
  ] as const)("normalizes %s runtime state without false blocked waiting semantics", (state, runtimeLifecycleState) => {
    const parsed = parseLiveHookPayload(
      JSON.stringify({
        type: "runtime_state",
        sessionId: `omp-${state}-session`,
        timestamp: "2026-07-05T12:05:00.000Z",
        cwd: "/workspace/masthead",
        status: state
      }),
      { receivedAt: "2026-07-05T12:05:00.100Z", runtime: "omp" }
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.payload.status).toBe(state);
    expect(parsed.event.payload.runtimeLifecycleState).toBe(runtimeLifecycleState);
  });

  test("uses supported runtime identity fields for fallback event ids after redaction", () => {
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
