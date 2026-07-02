import { describe, expect, test } from "vitest";
import { normalizeCodexHookPayload } from "../codexAdapter";
import { projectLiveEvents } from "../liveProjection";

describe("live projection", () => {
  test("projects pending Board headlines by default and in LLM mode", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "llm-headline-start",
        event: "session_started",
        session_id: "llm-headline-session",
        timestamp: "2026-06-23T03:00:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Wire Board headline frames"
      },
      { receivedAt: "2026-06-23T03:00:00.010Z" }
    );

    const defaultEnvelope = projectLiveEvents([started], [], {
      generatedAt: "2026-06-23T03:01:00.000Z"
    });
    const envelope = projectLiveEvents([started], [], {
      generatedAt: "2026-06-23T03:01:00.000Z",
      headlineMode: "llm"
    });

    const card = envelope.projection.cards[0];

    expect(defaultEnvelope.projection.cards[0]?.headline).toEqual({
      headline: "Generating headline...",
      source: "pending",
      status: "pending"
    });
    expect(card?.headline).toEqual({
      headline: "Generating headline...",
      source: "pending",
      status: "pending"
    });
    expect(card?.headlineInput).toBeDefined();
  });

  test("projects explicit offline Board headlines in offline mode", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "offline-headline-start",
        event: "session_started",
        session_id: "offline-headline-session",
        timestamp: "2026-06-23T03:00:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Wire Board headline frames"
      },
      { receivedAt: "2026-06-23T03:00:00.010Z" }
    );

    const envelope = projectLiveEvents([started], [], {
      generatedAt: "2026-06-23T03:01:00.000Z",
      headlineMode: "offline"
    });

    const card = envelope.projection.cards[0];

    expect(card?.headline.source).toBe("offline");
    expect(card?.headline.headline).toContain(":");
  });

  test("projects normalized hook events into a live board envelope", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "live-session-start",
        event: "session_started",
        session_id: "live-session",
        timestamp: "2026-06-23T03:00:00.000Z",
        cwd: "/workspace/masthead",
        repo_root: "/workspace/masthead",
        git_common_dir: "/workspace/masthead/.git",
        branch: "agent/live-ingestion",
        project: "Masthead",
        title: "Wire live ingestion"
      },
      { receivedAt: "2026-06-23T03:00:00.040Z" }
    );
    const approval = normalizeCodexHookPayload(
      {
        provider_event_id: "live-approval",
        event: "approval_requested",
        session_id: "live-session",
        timestamp: "2026-06-23T03:01:00.000Z",
        cwd: "/workspace/masthead",
        repo_root: "/workspace/masthead",
        git_common_dir: "/workspace/masthead/.git",
        branch: "agent/live-ingestion",
        project: "Masthead",
        command_id: "cmd-install-hook",
        blast_radius: "production",
        summary: "Codex requested hook installation"
      },
      { receivedAt: "2026-06-23T03:01:00.030Z" }
    );

    const envelope = projectLiveEvents([started, approval], [], {
      expandedSessionId: "live-session",
      generatedAt: "2026-06-23T03:01:00.050Z",
      diagnostics: 0
    });

    expect(envelope).toMatchObject({
      ok: true,
      source: "live",
      generatedAt: "2026-06-23T03:01:00.050Z",
      events: 2,
      gitSnapshots: 0,
      diagnostics: 0
    });
    expect(envelope.projection.cards).toHaveLength(1);
    expect(envelope.projection.cards[0]).toMatchObject({
      sessionId: "live-session",
      project: "Masthead",
      title: "Wire live ingestion",
      primaryStatus: "waiting_for_approval",
      isExpanded: true
    });
    expect(envelope.projection.attentionQueue[0]).toMatchObject({
      type: "approval_requested",
      severity: "P0",
      affectedCommandIds: ["cmd-install-hook"]
    });
  });

  test("uses recent canonical transcript messages as live board headline evidence", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "transcript-backed-start",
        event: "session_started",
        session_id: "transcript-backed-session",
        timestamp: "2026-06-23T03:00:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Codex session",
        summary: "Codex hook event"
      },
      { receivedAt: "2026-06-23T03:00:00.010Z" }
    );

    const envelope = projectLiveEvents([started], [], {
      generatedAt: "2026-06-23T03:01:00.000Z",
      sessionTranscriptFacts: new Map([
        [
          "transcript-backed-session",
          {
            recentMessages: [
              {
                observedAt: "2026-06-23T03:00:45.000Z",
                role: "user",
                text: "Investigate why Board headlines stopped refreshing from transcript updates."
              }
            ]
          }
        ]
      ])
    });

    const card = envelope.projection.cards[0];
    const headlineInput = card?.headlineInput as { evidence?: string[]; subjectCandidates?: string[] } | undefined;

    expect(headlineInput?.evidence).toContain("Investigate why Board headlines stopped refreshing from transcript updates.");
    expect(headlineInput?.subjectCandidates).toContain("Board headlines");
  });

  test("uses recent tool commands as live board headline evidence", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "tool-backed-start",
        event: "session_started",
        session_id: "tool-backed-session",
        timestamp: "2026-06-23T03:00:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Board headline refresh"
      },
      { receivedAt: "2026-06-23T03:00:00.010Z" }
    );
    const command = normalizeCodexHookPayload(
      {
        provider_event_id: "tool-backed-typecheck",
        event: "PostToolUse",
        session_id: "tool-backed-session",
        timestamp: "2026-06-23T03:00:30.000Z",
        cwd: "/workspace/masthead",
        toolName: "Bash",
        toolInput: {
          command: "npm run typecheck"
        },
        exit_code: 0,
        summary: "Typecheck completed for Board headline refresh."
      },
      { receivedAt: "2026-06-23T03:00:30.010Z" }
    );

    const envelope = projectLiveEvents([started, command], [], {
      generatedAt: "2026-06-23T03:01:00.000Z"
    });

    const headlineInput = envelope.projection.cards[0]?.headlineInput as { evidence?: string[] } | undefined;

    expect(headlineInput?.evidence).toContain("Typecheck completed for Board headline refresh.");
    expect(headlineInput?.evidence).toContain("npm run typecheck");
  });

  test("does not replace pending Board headlines with stale stored enrichment in LLM mode", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "stale-enrichment-start",
        event: "session_started",
        session_id: "stale-enrichment-session",
        timestamp: "2026-06-23T03:00:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Codex session"
      },
      { receivedAt: "2026-06-23T03:00:00.010Z" }
    );

    const envelope = projectLiveEvents([started], [], {
      generatedAt: "2026-06-23T03:02:00.000Z",
      headlineMode: "llm",
      sessionEnrichments: new Map([
        [
          "stale-enrichment-session",
          {
            generatedAt: "2026-06-23T03:00:20.000Z",
            liveSummary: "Old stored enrichment headline is still displayed.",
            title: "Old stored enrichment"
          }
        ]
      ]),
      sessionTranscriptFacts: new Map([
        [
          "stale-enrichment-session",
          {
            recentMessages: [
              {
                observedAt: "2026-06-23T03:01:30.000Z",
                role: "assistant",
                text: "Board headlines stopped refreshing from transcript updates."
              }
            ]
          }
        ]
      ])
    });

    expect(envelope.projection.cards[0]?.headline).toEqual({
      headline: "Generating headline...",
      source: "pending",
      status: "pending"
    });
  });

  test("uses payload project and title when a live session starts with an approval event", () => {
    const approval = normalizeCodexHookPayload(
      {
        provider_event_id: "live-approval-first",
        event: "approval_requested",
        session_id: "approval-first-session",
        timestamp: "2026-06-23T03:03:00.000Z",
        cwd: "/workspace/masthead",
        repo_root: "/workspace/masthead",
        git_common_dir: "/workspace/masthead/.git",
        branch: "agent/approval-first",
        project: "Masthead",
        title: "Review hook install",
        command_id: "cmd-review-hook",
        blast_radius: "production",
        summary: "Codex requested hook installation"
      },
      { receivedAt: "2026-06-23T03:03:00.020Z" }
    );

    const envelope = projectLiveEvents([approval], [], {
      expandedSessionId: "approval-first-session",
      generatedAt: "2026-06-23T03:03:00.040Z"
    });

    expect(envelope.projection.cards[0]).toMatchObject({
      sessionId: "approval-first-session",
      project: "Masthead",
      title: "Review hook install",
      primaryStatus: "waiting_for_approval"
    });
  });

  test("live projection ages quiet non-terminal sessions into idle", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "quiet-start",
        event: "session_started",
        session_id: "quiet-session",
        timestamp: "2026-06-23T03:00:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Quiet session"
      },
      { receivedAt: "2026-06-23T03:00:00.010Z" }
    );

    const envelope = projectLiveEvents([started], [], {
      generatedAt: "2026-06-23T03:30:00.000Z"
    });

    expect(envelope.projection.cards[0]).toMatchObject({
      sessionId: "quiet-session",
      lifecycle: "idle",
      stateLabel: "Idle"
    });
    expect(envelope.projection.summary).toMatchObject({
      active: 1,
      running: 0,
      idle: 1
    });
    expect(envelope.projection.lanes).toContainEqual(
      expect.objectContaining({
        laneId: "idle",
        sessionIds: ["quiet-session"]
      })
    );
  });

  test("live projection keeps terminal sessions visible in lifecycle lanes", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "old-start",
        event: "session_started",
        session_id: "old-live-session",
        timestamp: "2026-06-23T03:00:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Old completed session"
      },
      { receivedAt: "2026-06-23T03:00:00.010Z" }
    );
    const completed = normalizeCodexHookPayload(
      {
        provider_event_id: "old-stop",
        event: "session_completed",
        session_id: "old-live-session",
        timestamp: "2026-06-23T03:01:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Old completed session"
      },
      { receivedAt: "2026-06-23T03:01:00.010Z" }
    );

    const envelope = projectLiveEvents([started, completed], [], {
      generatedAt: "2026-06-23T03:02:00.000Z"
    });

    expect(envelope.projection.summary).toMatchObject({ active: 0, completed: 1 });
    expect(envelope.projection.cards).toHaveLength(1);
    expect(envelope.projection.cards[0]).toMatchObject({
      sessionId: "old-live-session",
      lifecycle: "ended",
      outcomeLabel: "completed"
    });
    expect(envelope.projection.lanes).toContainEqual(
      expect.objectContaining({
        laneId: "history",
        sessionIds: ["old-live-session"]
      })
    );
    expect(envelope.projection.attentionQueue).toEqual([]);
  });

  test("null selected session keeps live projection board-first even when expanded session exists", () => {
    const started = normalizeCodexHookPayload(
      {
        provider_event_id: "board-first-start",
        event: "session_started",
        session_id: "board-first-session",
        timestamp: "2026-06-23T03:00:00.000Z",
        cwd: "/workspace/masthead",
        project: "Masthead",
        title: "Board first live session"
      },
      { receivedAt: "2026-06-23T03:00:00.010Z" }
    );

    const envelope = projectLiveEvents([started], [], {
      expandedSessionId: "board-first-session",
      selectedSessionId: null,
      generatedAt: "2026-06-23T03:02:00.000Z"
    });

    expect(envelope.projection.cards).toHaveLength(1);
    expect(envelope.projection.expandedSession?.sessionId).toBe("board-first-session");
    expect(envelope.projection.selectedSession).toBeUndefined();
  });

  test("empty live state remains a valid local projection instead of falling back inside the server", () => {
    const envelope = projectLiveEvents([], [], { generatedAt: "2026-06-23T03:02:00.000Z" });

    expect(envelope.ok).toBe(true);
    expect(envelope.events).toBe(0);
    expect(envelope.projection.summary).toEqual({
      active: 0,
      needsAttention: 0,
      conflicts: 0,
      completed: 0,
      running: 0,
      needsAction: 0,
      idle: 0
    });
    expect(envelope.projection.cards).toEqual([]);
  });
});
