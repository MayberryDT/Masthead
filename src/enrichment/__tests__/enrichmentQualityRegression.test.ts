import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import { createOpenAISessionCopyEnricher } from "../../core/openaiSessionCopy.ts";
import type { LiveBoardProjection, SessionCardView } from "../../core/types.ts";
import { createOpenAIEnrichmentProvider } from "../openAIProvider.ts";
import { deterministicCapsuleFromFacts, type SessionFacts } from "../sessionCompiler.ts";
import { validateNarrativeField } from "../sessionNarrativeValidator.ts";
import { classifyWorkSubject } from "../workSubject.ts";

describe("enrichment quality regressions", () => {
  test("bad fixture labels are rejected or kept low confidence", async () => {
    const hookOnly = JSON.parse(await readFile("fixtures/enrichment/repeated-codex-hook-event.json", "utf8")) as {
      runtimeSignals: string[];
    };

    for (const signal of hookOnly.runtimeSignals) {
      expect(validateNarrativeField("title", signal).ok).toBe(false);
    }
    const capsule = deterministicCapsuleFromFacts({
      commands: [],
      evidence: [],
      files: [],
      messages: [],
      narrative: {
        buildFailed: false,
        buildPassed: false,
        checkpointSummaries: [],
        commands: [],
        coverage: {
          assistantMessages: 0,
          fileEffects: 0,
          hasUsableTranscript: false,
          level: "hook_only",
          messageCount: 0,
          tokenUsageRows: 0,
          toolCalls: 0,
          userMessages: 0
        },
        deployMentioned: false,
        eventSummaries: [],
        fileBasenames: [],
        fileDirectories: [],
        files: [],
        project: "Masthead",
        runtime: "codex",
        sessionId: "hook-only",
        technologies: [],
        testsFailed: false,
        testsPassed: false,
        topics: []
      },
      project: "Masthead",
      sessionId: "hook-only",
      title: "Codex hook event"
    });

    expect(capsule.confidence).toBe("low");
    expect(capsule.missingEvidence).toContain("transcript");
  });

  test("codex alone is not Sources work, but transcript import still is", async () => {
    const codexOnly = JSON.parse(await readFile("fixtures/enrichment/codex-not-sources.json", "utf8")) as { text: string };

    expect(classifyWorkSubject({ texts: [codexOnly.text] }).area).not.toBe("Sources");
    expect(classifyWorkSubject({ texts: ["transcript import"] }).area).toBe("Sources");
  });

  test("provider payload includes command names and remote failures do not return capsules", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string };
      expect(JSON.parse(body.input).facts.commands[0]).toMatchObject({
        name: "npm test -- --run src/mcp/__tests__/tools.test.ts",
        status: "succeeded"
      });
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });

    const result = await createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: true,
      fetchImpl
    }).enrich({ facts: facts() });

    expect(result.status).toBe("api_error");
    expect(result.capsule).toBeUndefined();
    expect(result.source).toBe("none");
  });

  test("board live copy attempts the same session on every refresh", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                text: JSON.stringify({
                  headline: "This session is active now.",
                  reason: "This session is active and has recent activity.",
                  status: "Working now"
                }),
                type: "output_text"
              }
            ]
          }
        ]
      })
    });
    const enricher = createOpenAISessionCopyEnricher({ apiKey: "key", enabled: true, fetchImpl });
    const projection = liveProjection(card());

    await enricher.enrichProjection(projection);
    await enricher.enrichProjection(projection);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function facts(): SessionFacts {
  return {
    commands: ["npm test -- --run src/mcp/__tests__/tools.test.ts"],
    evidence: [],
    files: ["src/mcp/server.ts"],
    messages: ["Validate MCP tools list."],
    narrative: {
      buildFailed: false,
      buildPassed: false,
      checkpointSummaries: [],
      commands: [
        {
          category: "test",
          exitCode: 0,
          name: "npm test -- --run src/mcp/__tests__/tools.test.ts",
          outputPreview: "tools tests passed",
          status: "succeeded"
        }
      ],
      coverage: {
        assistantMessages: 1,
        fileEffects: 1,
        hasUsableTranscript: true,
        level: "complete",
        messageCount: 2,
        tokenUsageRows: 0,
        toolCalls: 1,
        userMessages: 1
      },
      deployMentioned: false,
      eventSummaries: [],
      fileBasenames: ["server"],
      fileDirectories: ["src/mcp"],
      files: [{ basename: "server", directory: "src/mcp", extension: "ts", path: "src/mcp/server.ts" }],
      firstUserPrompt: "Validate MCP tools list.",
      project: "Masthead",
      runtime: "codex",
      sessionId: "quality-regression",
      technologies: ["TypeScript"],
      testsFailed: false,
      testsPassed: true,
      topics: ["mcp"]
    },
    project: "Masthead",
    sessionId: "quality-regression",
    title: "MCP tools validation"
  };
}

function card(): SessionCardView {
  return {
    changedFileCount: 0,
    copy: {
      headline: "Masthead session is active now.",
      reason: "This session is active and has recent activity.",
      source: "deterministic",
      status: "Work is active."
    },
    durationLabel: "1m",
    identityConfidence: "direct",
    indicators: [],
    isExpanded: false,
    lastActivity: "2026-06-29T12:00:00.000Z",
    lastActivityLabel: "now",
    lifecycle: "running",
    primaryStatus: "editing",
    priorityRank: 50,
    project: "Masthead",
    safeActions: ["open_source_session"],
    sessionId: "session-board-refresh",
    stateLabel: "Running",
    title: "Board refresh"
  };
}

function liveProjection(cardView: SessionCardView): LiveBoardProjection {
  return {
    attentionQueue: [],
    cards: [cardView],
    conflicts: [],
    summary: {
      active: 1,
      completed: 0,
      conflicts: 0,
      idle: 0,
      needsAction: 0,
      needsAttention: 0,
      running: 1
    }
  };
}
