import { describe, expect, test } from "vitest";
import { normalizeLiveHookPayload, parseLiveHookPayload } from "../liveHookAdapter";

describe("live hook adapter", () => {
  test("normalizes valid Claude Code hook payloads into adapter-neutral events", () => {
    const event = normalizeLiveHookPayload(
      {
        provider_event_id: "claude-provider-1",
        hookEventName: "PostToolUse",
        session_id: "claude-session-1",
        timestamp: "2026-06-23T02:10:00.000Z",
        cwd: "/workspace/masthead",
        repo_root: "/workspace/masthead",
        git_common_dir: "/workspace/masthead/.git",
        branch: "agent/live-hook-adapter",
        toolUseId: "cmd-1",
        toolName: "Bash",
        toolInput: {
          command: "npm test -- --run src/core/__tests__/liveProjection.test.ts"
        },
        exit_code: 0,
        category: "test",
        project: "Masthead",
        summary: "Live hook adapter test finished"
      },
      { receivedAt: "2026-06-23T02:10:00.100Z", runtime: "claude_code" }
    );

    expect(event).toMatchObject({
      schemaVersion: 1,
      sessionId: "claude-session-1",
      source: {
        adapter: "claude_code",
        surface: "hook",
        sourceEventId: "claude-provider-1"
      },
      occurredAt: "2026-06-23T02:10:00.000Z",
      receivedAt: "2026-06-23T02:10:00.100Z",
      type: "command.finished",
      workspace: {
        cwd: "/workspace/masthead",
        repoRoot: "/workspace/masthead",
        gitCommonDir: "/workspace/masthead/.git",
        branch: "agent/live-hook-adapter"
      },
      summary: "Live hook adapter test finished",
      sensitivity: "metadata"
    });
    expect(event.eventId).toBe("claude_code:claude-provider-1");
    expect(event.payload).toMatchObject({
      commandId: "cmd-1",
      normalizedCommand: "npm test -- --run src/core/__tests__/liveProjection.test.ts",
      exitCode: 0,
      category: "test",
      project: "Masthead",
      summary: "Live hook adapter test finished",
      runtime: "claude_code",
      harness: "Claude Code",
      sourceSessionId: "claude-session-1"
    });
    expect(event.payloadHash).toHaveLength(64);
    expect(event.evidence).toEqual([
      {
        id: "claude_code:claude-provider-1",
        kind: "event",
        observedAt: "2026-06-23T02:10:00.000Z",
        source: "claude_code.hook"
      }
    ]);
  });

  test("returns malformed JSON diagnostics without throwing", () => {
    const parsed = parseLiveHookPayload("{ nope", {
      receivedAt: "2026-06-23T02:10:00.000Z",
      runtime: "claude_code"
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.diagnostic.code).toBe("malformed_json");
      expect(parsed.diagnostic.message).toContain("Claude Code hook payload could not be parsed as JSON");
      expect(parsed.diagnostic.receivedAt).toBe("2026-06-23T02:10:00.000Z");
    }
  });

  test("requires callers to supply a supported live runtime", () => {
    const parsed = parseLiveHookPayload("{}", { receivedAt: "2026-06-23T02:10:00.000Z" });

    expect(parsed).toEqual({
      ok: false,
      diagnostic: {
        code: "unsupported_runtime",
        message: "Live hook runtime is required.",
        receivedAt: "2026-06-23T02:10:00.000Z"
      }
    });
  });

  test("derives stable event ids for supported runtime payloads without provider ids", () => {
    const event = normalizeLiveHookPayload(
      {
        type: "chat.message",
        sessionID: "opencode-session-hash",
        time: "2026-06-23T02:10:00.000Z",
        directory: "/workspace/masthead",
        message: "Run focused live hook adapter coverage"
      },
      { receivedAt: "2026-06-23T02:10:00.100Z", runtime: "opencode" }
    );

    expect(event).toMatchObject({
      eventId: expect.stringMatching(/^opencode:[a-f0-9]{64}$/),
      payload: {
        runtime: "opencode",
        harness: "OpenCode",
        sourceSessionId: "opencode-session-hash",
        messageSummary: expect.objectContaining({
          redacted: true
        })
      },
      source: {
        adapter: "opencode",
        surface: "plugin",
        sourceEventId: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    expect(event.source.sourceEventId).not.toBe(event.payloadHash);
  });

  test("redacts sensitive payload fields before hashing and storage", () => {
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "UserPromptSubmit",
        sessionId: "claude-sensitive-session",
        timestamp: "2026-06-23T02:10:00.000Z",
        prompt: "Use sk-super-secret-token to query production."
      },
      { receivedAt: "2026-06-23T02:10:00.100Z", runtime: "claude_code" }
    );

    expect(event.sensitivity).toBe("redacted");
    expect(JSON.stringify(event.payload)).not.toContain("sk-super-secret-token");
    expect(event.payload).toMatchObject({
      promptSummary: expect.objectContaining({
        redacted: true
      })
    });
  });

  test("normalizes real patch hooks without storing patch bodies", () => {
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "PostToolUse",
        sessionId: "claude-patch-session",
        timestamp: "2026-06-23T02:11:00.000Z",
        cwd: "/workspace/masthead",
        toolName: "apply_patch",
        toolInput: {
          command: "*** Begin Patch\n*** Update File: src/example.ts\n@@\n-secret\n+redacted\n*** End Patch"
        },
        exit_code: 0,
        summary: "Applied focused test patch"
      },
      { receivedAt: "2026-06-23T02:11:00.100Z", runtime: "claude_code" }
    );

    expect(event.type).toBe("file.changed");
    expect(JSON.stringify(event.payload)).not.toContain("*** Begin Patch");
    expect(event.payload).toMatchObject({
      category: "file_edit",
      toolInputSummary: expect.objectContaining({
        redacted: true,
        kind: "patch"
      }),
      exitCode: 0,
      summary: "Applied focused test patch"
    });
  });
});
