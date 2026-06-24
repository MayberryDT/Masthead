import { describe, expect, test } from "vitest";
import { normalizeCodexHookPayload, parseCodexHookPayload } from "../codexAdapter";

describe("codex hook adapter", () => {
  test("normalizes valid Codex hook payloads into adapter-neutral events", () => {
    const event = normalizeCodexHookPayload(
      {
        provider_event_id: "codex-provider-1",
        event: "command_finished",
        session_id: "codex-session-1",
        timestamp: "2026-06-23T02:10:00.000Z",
        cwd: "/workspace/masthead",
        repo_root: "/workspace/masthead",
        git_common_dir: "/workspace/masthead/.git",
        branch: "task/hook-ingestion",
        command_id: "cmd-1",
        command: "npm test -- --run src/core/__tests__/codexAdapter.test.ts",
        exit_code: 0,
        category: "test",
        project: "Masthead",
        title: "Implement hook ingestion",
        modelReasoningEffort: "xhigh",
        summary: "Tests passed"
      },
      { receivedAt: "2026-06-23T02:10:00.100Z" }
    );

    expect(event).toMatchObject({
      schemaVersion: 1,
      sessionId: "codex-session-1",
      source: {
        adapter: "codex",
        surface: "hook",
        sourceEventId: "codex-provider-1"
      },
      occurredAt: "2026-06-23T02:10:00.000Z",
      receivedAt: "2026-06-23T02:10:00.100Z",
      type: "command.finished",
      workspace: {
        cwd: "/workspace/masthead",
        repoRoot: "/workspace/masthead",
        gitCommonDir: "/workspace/masthead/.git",
        branch: "task/hook-ingestion"
      },
      summary: "Tests passed",
      sensitivity: "metadata"
    });
    expect(event.eventId).toBe("codex:codex-provider-1");
    expect(event.payload).toMatchObject({
      commandId: "cmd-1",
      command: "npm test -- --run src/core/__tests__/codexAdapter.test.ts",
      exitCode: 0,
      category: "test",
      project: "Masthead",
      title: "Implement hook ingestion",
      modelReasoningEffort: "xhigh"
    });
    expect(event.payloadHash).toHaveLength(64);
    expect(event.evidence).toEqual([
      {
        id: event.eventId,
        kind: "event",
        observedAt: "2026-06-23T02:10:00.000Z",
        source: "codex.hook"
      }
    ]);
  });

  test("returns malformed JSON diagnostics without throwing", () => {
    const parsed = parseCodexHookPayload("{ nope", { receivedAt: "2026-06-23T02:10:00.000Z" });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.diagnostic.code).toBe("malformed_json");
      expect(parsed.diagnostic.message).toContain("Unable to parse Codex hook payload");
      expect(parsed.diagnostic.receivedAt).toBe("2026-06-23T02:10:00.000Z");
    }
  });

  test("redacts sensitive payload fields before hashing and storage", () => {
    const event = normalizeCodexHookPayload(
      {
        provider_event_id: "codex-provider-secret",
        event: "approval_requested",
        session_id: "codex-session-secret",
        timestamp: "2026-06-23T02:11:00.000Z",
        command: "curl -H 'Authorization: Bearer live-secret-token' https://example.test",
        cwd: "/workspace/.env",
        blast_radius: "production"
      },
      { receivedAt: "2026-06-23T02:11:00.100Z" }
    );

    expect(event.type).toBe("approval.requested");
    expect(event.sensitivity).toBe("redacted");
    expect(event.workspace?.cwd).toBe("/workspace/.env");
    expect(event.payload.command).toBe("curl -H 'Authorization: Bearer [SECRET:bearer_token]' https://example.test");
    expect(JSON.stringify(event)).not.toContain("live-secret-token");
  });

  test("normalizes real PostToolUse command hooks without storing raw command output", () => {
    const event = normalizeCodexHookPayload(
      {
        hookEventName: "PostToolUse",
        sessionId: "codex-session-tool",
        timestamp: "2026-06-23T02:12:00.000Z",
        cwd: "/workspace/masthead",
        toolName: "Bash",
        toolInput: {
          command: "curl -H 'Authorization: Bearer live-secret-token' https://example.test"
        },
        toolResponse: "private command output\nwith multiple lines",
        toolUseId: "call_123"
      },
      { receivedAt: "2026-06-23T02:12:00.100Z" }
    );

    expect(event.type).toBe("command.finished");
    expect(event.sensitivity).toBe("redacted");
    expect(event.payload).toMatchObject({
      commandId: "call_123",
      category: "shell",
      normalizedCommand: "curl -H 'Authorization: Bearer [SECRET:bearer_token]' https://example.test",
      toolResponseSummary: {
        stored: false,
        redacted: true
      }
    });
    expect(JSON.stringify(event)).not.toContain("private command output");
    expect(JSON.stringify(event)).not.toContain("live-secret-token");
  });

  test("normalizes real PostToolUse patch hooks without storing patch bodies", () => {
    const event = normalizeCodexHookPayload(
      {
        hookEventName: "PostToolUse",
        sessionId: "codex-session-patch",
        timestamp: "2026-06-23T02:13:00.000Z",
        cwd: "/workspace/masthead",
        toolName: "apply_patch",
        toolInput: {
          command: "*** Begin Patch\n*** Update File: secret.txt\n@@\n-old\n+new\n*** End Patch\n"
        },
        toolResponse: "Exit code: 0\nOutput:\nSuccess. Updated the following files:\nM secret.txt\n",
        toolUseId: "call_patch"
      },
      { receivedAt: "2026-06-23T02:13:00.100Z" }
    );

    expect(event.type).toBe("file.changed");
    expect(event.payload).toMatchObject({
      commandId: "call_patch",
      category: "file_edit",
      toolInputSummary: {
        stored: false,
        redacted: true,
        kind: "patch"
      },
      toolResponseSummary: {
        stored: false,
        redacted: true
      }
    });
    expect(JSON.stringify(event)).not.toContain("*** Begin Patch");
    expect(JSON.stringify(event)).not.toContain("Success. Updated");
  });

  test("normalizes real Stop hooks without storing the last assistant message", () => {
    const event = normalizeCodexHookPayload(
      {
        hook_event_name: "Stop",
        session_id: "codex-session-stop",
        timestamp: "2026-06-23T02:14:00.000Z",
        cwd: "/workspace/masthead",
        last_assistant_message:
          "private assistant response that should not be stored. Implementation is complete, but tests are still failing in src/private.ts.",
        transcript_path: "/home/tyler/.codex/sessions/2026/06/23/rollout.jsonl",
        stop_hook_active: false
      },
      { receivedAt: "2026-06-23T02:14:00.100Z" }
    );

    expect(event.type).toBe("session.completed");
    expect(event.sensitivity).toBe("redacted");
    expect(event.payload).toMatchObject({
      latestFeedbackSnapshot: {
        source: "stop_hook",
        observedAt: "2026-06-23T02:14:00.000Z",
        redacted: true,
        claims: expect.arrayContaining(["claims_complete", "mentions_tests", "mentions_error"])
      },
      lastAssistantMessageSummary: {
        stored: false,
        redacted: true
      },
      transcriptPath: "/home/tyler/.codex/sessions/2026/06/23/rollout.jsonl",
      stopHookActive: false
    });
    expect(event.payload.lastAssistantMessage).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("private assistant response");
    expect(JSON.stringify(event)).not.toContain("src/private.ts");
  });
});
