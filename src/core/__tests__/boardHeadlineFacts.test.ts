import { describe, expect, test } from "vitest";
import { buildBoardHeadlineFacts } from "../boardHeadlineFacts";
import type { GitSnapshot, NormalizedEvent, SessionCardView } from "../types";

describe("board headline facts", () => {
  test("collects recent events while filtering low-value hook noise", () => {
    const facts = buildBoardHeadlineFacts({
      attentionItems: [
        {
          affectedCommandIds: ["cmd-test"],
          affectedPaths: [],
          createdAt: "2026-06-29T12:01:00.000Z",
          evidence: [],
          itemId: "attention-1",
          project: "Masthead",
          sessionId: "session-1",
          severity: "P2",
          suggestedNextAction: "Review failed command.",
          support: "deterministic",
          title: "Test command failed",
          type: "command_failed"
        }
      ],
      card: card(),
      conflicts: [],
      events: [
        event("event-hook", "session.started", "Live hook event"),
        event("event-p3", "command.finished", "P3", { exitCode: 0, normalizedCommand: "shell" }),
        event("event-failed", "command.finished", "npm test failed", { exitCode: 1, normalizedCommand: "npm test" }),
        event("event-file", "file.changed", "Updated session dossier", { path: "src/ui/session-dossier/SessionDossier.tsx" })
      ],
      gitSnapshots: [snapshot()]
    });

    expect(facts.recentEvents.map((event) => event.summary)).toEqual(["Updated session dossier", "npm test failed"]);
    expect(facts.recentToolNames).toContain("npm test");
    expect(facts.recentToolNames).not.toContain("shell");
    expect(facts.recentFileBasenames).toEqual(expect.arrayContaining(["SessionDossier.tsx", "enrichmentCoordinator.ts"]));
    expect(facts.recentCommandFailures).toEqual(["npm test failed"]);
    expect(facts.attentionTitles).toEqual(["Test command failed"]);
  });

  test("filters generic harness tool names out of headline facts", () => {
    const facts = buildBoardHeadlineFacts({
      attentionItems: [],
      card: card(),
      conflicts: [],
      events: [
        event("event-read", "command.finished", "Read completed", { toolName: "Read" }),
        event("event-grep", "command.finished", "Grep completed", { toolName: "Grep" }),
        event("event-command", "command.finished", "Typecheck completed", { normalizedCommand: "npm run typecheck" })
      ],
      gitSnapshots: []
    });

    expect(facts.recentToolNames).toEqual(["npm run typecheck"]);
  });

  test("keeps useful role-labeled transcript evidence while dropping directive noise", () => {
    const facts = buildBoardHeadlineFacts({
      attentionItems: [],
      card: card(),
      conflicts: [],
      events: [],
      gitSnapshots: [],
      recentTranscriptMessages: [
        {
          observedAt: "2026-07-01T21:00:00.000Z",
          role: "assistant",
          text: "The dev server is still running at [url] ::-stage{cwd=\"\"} ::-commit{cwd=\"\"}."
        },
        {
          observedAt: "2026-07-01T21:01:00.000Z",
          role: "assistant",
          text: "The timestamp was not the whole issue. I’m putting transcript evidence ahead of canonical enrichment."
        },
        {
          observedAt: "2026-07-01T21:02:00.000Z",
          role: "user",
          text: "I don't see the headlines changing in the Board tab."
        }
      ]
    });

    expect(facts.transcriptExcerpt).toEqual([
      {
        observedAt: "2026-07-01T21:01:00.000Z",
        role: "assistant",
        text: "The timestamp was not the whole issue. I’m putting transcript evidence ahead of canonical enrichment."
      },
      {
        observedAt: "2026-07-01T21:02:00.000Z",
        role: "user",
        text: "Headlines are not visibly changing in the Board tab."
      }
    ]);
    expect(facts.recentTranscriptMessages).toEqual([
      "The timestamp was not the whole issue. I’m putting transcript evidence ahead of canonical enrichment.",
      "Headlines are not visibly changing in the Board tab."
    ]);
  });

  test("keeps a substantial recent transcript excerpt instead of only six short snippets", () => {
    const facts = buildBoardHeadlineFacts({
      attentionItems: [],
      card: card(),
      conflicts: [],
      events: [],
      gitSnapshots: [],
      recentTranscriptMessages: Array.from({ length: 10 }, (_, index) => ({
        observedAt: `2026-07-01T21:${String(index).padStart(2, "0")}:00.000Z`,
        role: index % 2 === 0 ? "user" : "assistant",
        text: `Transcript message ${index} includes concrete headline work context for the model.`
      }))
    });

    expect(facts.transcriptExcerpt).toHaveLength(10);
    expect(facts.recentTranscriptMessages).toHaveLength(10);
    expect(facts.transcriptExcerpt?.at(0)).toMatchObject({
      role: "user",
      text: "Transcript message 0 includes concrete headline work context for the model."
    });
  });

  test("sanitizes URL-like project and title facts before headline enrichment", () => {
    const facts = buildBoardHeadlineFacts({
      attentionItems: [],
      card: card({
        project: "https-huggingface-co-yuxinlu1-gemma-4",
        title: "https-huggingface-co-yuxinlu1-gemma-4 Codex session"
      }),
      conflicts: [],
      events: [],
      gitSnapshots: []
    });

    expect(facts.project).toBeUndefined();
    expect(facts.title).toBeUndefined();
  });

  test("drops stale MCP-only canonical enrichment when current activity is unrelated", () => {
    const facts = buildBoardHeadlineFacts({
      attentionItems: [],
      canonicalEnrichment: {
        liveSummary: "MCP launch config validation is being reviewed for Masthead.",
        title: "MCP launch config validation",
        topics: ["mcp"]
      },
      card: card(),
      conflicts: [],
      events: [event("event-copy", "file.changed", "Reworked board headline for the Now surface.")],
      gitSnapshots: [snapshot()]
    });

    expect(facts.canonicalEnrichment).toBeUndefined();
  });

  test("keeps MCP canonical enrichment when current activity explicitly mentions MCP", () => {
    const facts = buildBoardHeadlineFacts({
      attentionItems: [],
      canonicalEnrichment: {
        liveSummary: "MCP launch config validation has passing tools-list coverage.",
        title: "MCP launch config validation",
        topics: ["mcp"]
      },
      card: card(),
      conflicts: [],
      events: [event("event-mcp", "file.changed", "Verified MCP tools-list coverage.")],
      gitSnapshots: []
    });

    expect(facts.canonicalEnrichment).toMatchObject({
      liveSummary: "MCP launch config validation has passing tools-list coverage.",
      title: "MCP launch config validation"
    });
  });

  test("drops canonical enrichment with URL and directive placeholders", () => {
    const facts = buildBoardHeadlineFacts({
      attentionItems: [],
      canonicalEnrichment: {
        liveSummary: "The dev server is still running at [url] ::-stage{cwd=\"\"} ::-commit{cwd=\"\"}.",
        title: "The dev server is still running at [url]."
      },
      card: card(),
      conflicts: [],
      events: [],
      gitSnapshots: []
    });

    expect(facts.canonicalEnrichment).toBeUndefined();
  });
});

function card(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    changedFileCount: 2,
    headline: {
      headline: "Dossier enrichment is active now.",
      source: "offline",
      status: "ready"
    },
    durationLabel: "2m",
    identityConfidence: "direct",
    indicators: [],
    isExpanded: false,
    lastActivity: "2026-06-29T12:02:00.000Z",
    lastActivityLabel: "now",
    lifecycle: "running",
    primaryStatus: "editing",
    priorityRank: 50,
    project: "Masthead",
    safeActions: ["open_source_session"],
    sessionId: "session-1",
    stateLabel: "Running",
    title: "Dossier enrichment",
    ...overrides
  };
}

function event(
  eventId: string,
  type: NormalizedEvent["type"],
  summary: string,
  payload: Record<string, unknown> = {}
): NormalizedEvent {
  return {
    eventId,
    evidence: [],
    occurredAt: `2026-06-29T12:0${eventId.length % 4}:00.000Z`,
    payload,
    payloadHash: `hash:${eventId}`,
    receivedAt: "2026-06-29T12:00:00.000Z",
    schemaVersion: 1,
    sensitivity: "metadata",
    sessionId: "session-1",
    source: { adapter: "codex", surface: "fixture" },
    summary,
    type
  };
}

function snapshot(): GitSnapshot {
  return {
    branch: "main",
    changedPaths: [
      {
        path: "src/enrichment/enrichmentCoordinator.ts",
        sensitivity: "metadata",
        staged: false,
        status: "modified"
      }
    ],
    gitCommonDir: "/repo/.git",
    observedAt: "2026-06-29T12:02:00.000Z",
    repoRoot: "/repo",
    sessionId: "session-1",
    snapshotId: "snapshot-1",
    worktreePath: "/repo"
  };
}
