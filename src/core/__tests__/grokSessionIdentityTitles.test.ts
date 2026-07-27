import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { grokAdapter } from "../../adapters/grok/adapter.ts";
import type { DiscoveredSource } from "../../adapters/types.ts";
import { normalizeLiveHookPayload, parseLiveHookPayload } from "../liveHookAdapter";
import { projectLiveEvents } from "../liveProjection";
import { normalizeLiveStateReport } from "../liveState";
import { buildOfflineBoardHeadlineView } from "../offlineBoardHeadline";
import { toBoardHeadlineInput } from "../boardHeadlineInput";
import type { BoardHeadlineFacts } from "../boardHeadlineFacts";
import { deriveSessions } from "../sessionReducer";
import type { NormalizedEvent } from "../types";

const conversationId = "019f42f6-8ada-7001-afff-c722e75faf45";

describe("Grok session identity + titles (Issue A)", () => {
  test("keeps one stable sourceSessionId across multi-turn Grok hook events", () => {
    const sessionId = "019fa45d-5d4a-71b0-aa16-3d6aeefde4e6";
    const events = [
      parseLiveHookPayload(
        JSON.stringify({
          hookEventName: "SessionStart",
          sessionId,
          cwd: "/home/tyler/.grok/worktrees/documents-masthead/subagent-019fa45d-5d4a-71b0-aa16-3d6aeefde4e6",
          workspaceRoot: "/home/tyler/.grok/worktrees/documents-masthead/subagent-019fa45d-5d4a-71b0-aa16-3d6aeefde4e6",
          timestamp: "2026-07-27T16:00:00.000Z"
        }),
        { receivedAt: "2026-07-27T16:00:00.100Z", runtime: "grok" }
      ),
      parseLiveHookPayload(
        JSON.stringify({
          hookEventName: "UserPromptSubmit",
          sessionId,
          cwd: "/home/tyler/.grok/worktrees/documents-masthead/subagent-019fa45d-5d4a-71b0-aa16-3d6aeefde4e6",
          timestamp: "2026-07-27T16:01:00.000Z"
        }),
        { receivedAt: "2026-07-27T16:01:00.100Z", runtime: "grok" }
      ),
      parseLiveHookPayload(
        JSON.stringify({
          hookEventName: "PreToolUse",
          sessionId,
          toolName: "run_terminal_command",
          toolInput: { command: "npm test" },
          cwd: "/home/tyler/.grok/worktrees/documents-masthead/subagent-019fa45d-5d4a-71b0-aa16-3d6aeefde4e6",
          timestamp: "2026-07-27T16:02:00.000Z"
        }),
        { receivedAt: "2026-07-27T16:02:00.100Z", runtime: "grok" }
      ),
      parseLiveHookPayload(
        JSON.stringify({
          hookEventName: "Stop",
          sessionId,
          cwd: "/home/tyler/.grok/worktrees/documents-masthead/subagent-019fa45d-5d4a-71b0-aa16-3d6aeefde4e6",
          timestamp: "2026-07-27T16:03:00.000Z"
        }),
        { receivedAt: "2026-07-27T16:03:00.100Z", runtime: "grok" }
      ),
      parseLiveHookPayload(
        JSON.stringify({
          hookEventName: "UserPromptSubmit",
          sessionId,
          cwd: "/home/tyler/.grok/worktrees/documents-masthead/subagent-019fa45d-5d4a-71b0-aa16-3d6aeefde4e6",
          timestamp: "2026-07-27T16:04:00.000Z"
        }),
        { receivedAt: "2026-07-27T16:04:00.100Z", runtime: "grok" }
      )
    ];

    expect(events.every((result) => result.ok)).toBe(true);
    const normalized = events.flatMap((result) => (result.ok ? [result.event] : []));
    expect(new Set(normalized.map((event) => event.sessionId))).toEqual(new Set([sessionId]));

    const envelope = projectLiveEvents(normalized, [], {
      generatedAt: "2026-07-27T16:04:30.000Z",
      headlineMode: "offline",
      liveStateReports: new Map([
        [
          sessionId,
          normalizeLiveStateReport({
            runtime: "grok",
            source: "test",
            sourceSessionId: sessionId,
            state: "working",
            observedAt: "2026-07-27T16:04:20.000Z"
          })
        ]
      ])
    });

    expect(envelope.projection.cards).toHaveLength(1);
    expect(envelope.projection.cards[0]).toMatchObject({
      sourceSessionId: sessionId,
      runtime: "grok",
      lifecycle: "running"
    });
    expect(envelope.projection.cards[0]?.primaryStatus).not.toBe("stalled");
    expect(envelope.projection.cards[0]?.headline?.headline ?? "").not.toMatch(/stalled with no new turns/i);
    // Subagent worktree basenames must not become the project/title subject.
    expect(envelope.projection.cards[0]?.project).not.toMatch(/^subagent-/i);
    expect(envelope.projection.cards[0]?.title).not.toMatch(/hook event/i);
  });

  test("does not label recently active Grok sessions as stalled after Stop idle state", () => {
    const sessionId = "grok-active-then-stop";
    const started = normalizeLiveHookPayload(
      {
        hookEventName: "SessionStart",
        sessionId,
        cwd: "/home/tyler/Documents/Masthead",
        workspaceRoot: "/home/tyler/Documents/Masthead",
        title: "Fix Now Grok titles",
        timestamp: "2026-07-27T16:00:00.000Z"
      },
      { receivedAt: "2026-07-27T16:00:00.100Z", runtime: "grok" }
    );
    const tool = normalizeLiveHookPayload(
      {
        hookEventName: "PreToolUse",
        sessionId,
        toolName: "run_terminal_command",
        toolInput: { command: "npm test" },
        cwd: "/home/tyler/Documents/Masthead",
        timestamp: "2026-07-27T16:01:00.000Z"
      },
      { receivedAt: "2026-07-27T16:01:00.100Z", runtime: "grok" }
    );
    const stop = normalizeLiveHookPayload(
      {
        hookEventName: "Stop",
        sessionId,
        cwd: "/home/tyler/Documents/Masthead",
        timestamp: "2026-07-27T16:02:00.000Z"
      },
      { receivedAt: "2026-07-27T16:02:00.100Z", runtime: "grok" }
    );

    const envelope = projectLiveEvents([started, tool, stop], [], {
      generatedAt: "2026-07-27T16:02:10.000Z",
      headlineMode: "offline",
      liveStateReports: new Map([
        [
          sessionId,
          normalizeLiveStateReport({
            runtime: "grok",
            source: "test",
            sourceSessionId: sessionId,
            state: "idle",
            observedAt: "2026-07-27T16:02:01.000Z"
          })
        ]
      ])
    });

    const card = envelope.projection.cards[0];
    expect(card?.sourceSessionId).toBe(sessionId);
    expect(card?.primaryStatus).not.toBe("stalled");
    expect(card?.headline?.headline ?? "").not.toMatch(/stalled with no new turns/i);
    expect(card?.title).toBe("Fix Now Grok titles");
  });

  test("rejects default Grok hook summaries as permanent titles", () => {
    const event: NormalizedEvent = {
      schemaVersion: 1,
      eventId: "grok:start",
      sessionId: "grok-session-title",
      source: { adapter: "grok", surface: "hook", sourceEventId: "start" },
      occurredAt: "2026-07-27T16:00:00.000Z",
      receivedAt: "2026-07-27T16:00:00.100Z",
      type: "session.started",
      workspace: { cwd: "/home/tyler/Documents/Masthead", repoRoot: "/home/tyler/Documents/Masthead" },
      summary: "Grok Build hook event",
      payload: { runtime: "grok", harness: "Grok Build", sourceSessionId: "grok-session-title" },
      sensitivity: "metadata",
      payloadHash: "hash",
      evidence: [{ id: "grok:start", kind: "event", observedAt: "2026-07-27T16:00:00.000Z", source: "grok.hook" }]
    };

    const sessions = deriveSessions([event], [], {
      now: new Date("2026-07-27T16:00:30.000Z"),
      idleAfterMs: 15 * 60_000
    });
    expect(sessions[0]).toMatchObject({
      project: "Masthead",
      title: "Masthead session",
      lifecycle: "running"
    });
    expect(sessions[0]?.title).not.toMatch(/hook event/i);
  });

  test("offline headline does not use stalled copy for non-stalled idle Grok cards", () => {
    const facts: BoardHeadlineFacts = {
      attentionTitles: [],
      changedFileCount: 0,
      conflictTitles: [],
      lifecycle: "idle",
      model: undefined,
      primaryStatus: "reading",
      project: "Masthead",
      recentCommandFailures: [],
      recentEvents: [{ type: "command.finished", summary: "Grok Build: run_terminal_command", occurredAt: "2026-07-27T16:02:00.000Z" }],
      recentFileBasenames: [],
      recentToolNames: ["run_terminal_command"],
      recentTranscriptMessages: [],
      runtime: "grok",
      sessionId: "grok-session",
      title: "Masthead session",
      workContext: undefined
    };
    const input = toBoardHeadlineInput({
      lifecycle: "idle",
      primaryStatus: "reading",
      signals: [],
      facts
    });
    const view = buildOfflineBoardHeadlineView(input);
    expect(view.headline).not.toMatch(/stalled with no new turns/i);
  });

  test("Grok adapter emits stable conversation identity and summary titles", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-grok-title-"));
    const conversationDir = join(root, conversationId);
    const chatPath = join(conversationDir, "chat_history.jsonl");
    await mkdir(conversationDir);
    await writeFile(
      chatPath,
      [
        JSON.stringify({ type: "user", content: "Diagnose Now Grok session spam" }),
        JSON.stringify({ type: "assistant", content: "Checking adapter identity and stalled labels." })
      ].join("\n") + "\n"
    );
    await writeFile(
      join(conversationDir, "summary.json"),
      JSON.stringify({
        info: { id: conversationId, cwd: "/home/tyler/Documents/Masthead" },
        session_summary: "Diagnose Now Grok session spam",
        generated_title: "Diagnose Now Grok session spam",
        created_at: "2026-07-27T16:00:00.000Z",
        updated_at: "2026-07-27T16:05:00.000Z",
        last_active_at: "2026-07-27T16:05:00.000Z",
        agent_name: "grok-build-plan"
      })
    );

    try {
      const source: DiscoveredSource = {
        confidence: "heuristic",
        path: chatPath,
        runtime: "grok",
        schemaVersion: "grok-jsonl-tree",
        sourceId: `grok:${chatPath}`,
        sourceKind: "jsonl",
        sourceSessionId: conversationId
      };
      const [unit] = await grokAdapter.planTranscriptUnits(source);
      expect(unit.sourceSessionId).toBe(conversationId);
      expect(unit.unitId).toBe(`grok:${conversationId}`);

      const parsed = await grokAdapter.parseTranscriptUnit(unit);
      expect(parsed.sourceSessionIds).toEqual([conversationId]);
      const sessionRecord = parsed.records.find((record) => record.normalized.kind === "session");
      expect(sessionRecord?.normalized.value).toMatchObject({
        sessionId: conversationId,
        title: "Diagnose Now Grok session spam",
        project: "Masthead"
      });
      const messageObservedAt = parsed.records
        .filter((record) => record.normalized.kind === "message")
        .map((record) => record.observedAt);
      expect(messageObservedAt.every((value) => value !== "1970-01-01T00:00:00.000Z")).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("distinct Grok conversations keep distinct sourceSessionIds and prefer distinct titles", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-grok-multi-"));
    const firstId = "019faaaa-aaaa-7aaa-aaaa-aaaaaaaaaaaa";
    const secondId = "019fbbbb-bbbb-7bbb-bbbb-bbbbbbbbbbbb";
    for (const [id, title] of [
      [firstId, "Repair Grok stalled labeling"],
      [secondId, "Improve Grok session titles"]
    ] as const) {
      const dir = join(root, id);
      await mkdir(dir);
      await writeFile(join(dir, "chat_history.jsonl"), `${JSON.stringify({ type: "user", content: title })}\n`);
      await writeFile(
        join(dir, "summary.json"),
        JSON.stringify({
          info: { id, cwd: "/home/tyler/Documents/Masthead" },
          generated_title: title,
          last_active_at: "2026-07-27T16:10:00.000Z"
        })
      );
    }

    try {
      const source: DiscoveredSource = {
        confidence: "heuristic",
        path: root,
        runtime: "grok",
        schemaVersion: "grok-jsonl-tree",
        sourceId: `grok:${root}`,
        sourceKind: "jsonl"
      };
      const units = await grokAdapter.planTranscriptUnits(source);
      expect(units.map((unit) => unit.sourceSessionId).toSorted()).toEqual([firstId, secondId].toSorted());
      const titles = [];
      for (const unit of units) {
        const parsed = await grokAdapter.parseTranscriptUnit(unit);
        const session = parsed.records.find((record) => record.normalized.kind === "session");
        titles.push((session?.normalized.value as { title?: string } | undefined)?.title);
      }
      expect(new Set(titles).size).toBe(2);
      expect(titles).toEqual(expect.arrayContaining(["Repair Grok stalled labeling", "Improve Grok session titles"]));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
