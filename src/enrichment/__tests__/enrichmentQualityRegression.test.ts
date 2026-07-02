import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import { renderBoardHeadlineFrame, type BoardHeadlineFrame } from "../../core/boardHeadlineFrame.ts";
import type { BoardHeadlineInput } from "../../core/boardHeadlineInput.ts";
import { rewriteBoardHeadlineFrameWithOpenAI } from "../../core/openaiBoardHeadlineFrame.ts";
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

  test("board headline frame API validates provider output and renders accepted frames", async () => {
    const invalidFetch = vi.fn<typeof fetch>().mockResolvedValue(
      responseWithFrame({
        subject: "recent activity",
        disposition: "recent activity",
        state: "active",
        subjectKind: "unknown",
        confidence: "low",
        evidence: ["Recent activity."]
      })
    );

    await expect(
      rewriteBoardHeadlineFrameWithOpenAI(headlineInput(), { apiKey: "key", enabled: true, fetchImpl: invalidFetch })
    ).resolves.toMatchObject({
      status: "validation_failed",
      validationReason: "weak_subject"
    });

    const frame: BoardHeadlineFrame = {
      subject: "Board headlines",
      disposition: "structured around subject and disposition",
      state: "active",
      subjectKind: "component",
      confidence: "high",
      evidence: ["Use subject and disposition frames for Board headlines."]
    };
    const validFetch = vi.fn<typeof fetch>().mockResolvedValue(responseWithFrame(frame));
    const result = await rewriteBoardHeadlineFrameWithOpenAI(headlineInput(), {
      apiKey: "key",
      enabled: true,
      fetchImpl: validFetch
    });

    expect(result.status).toBe("llm");
    expect(result.frame).toEqual(frame);
    expect(result.frame ? renderBoardHeadlineFrame(result.frame) : undefined).toBe(
      "Board headlines: structured around subject and disposition."
    );
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

function headlineInput(): BoardHeadlineInput {
  return {
    lifecycle: "running",
    primaryStatus: "editing",
    stateHint: "active",
    signals: [],
    subjectCandidates: ["Board headlines"],
    dispositionHints: ["structured around subject and disposition"],
    evidence: ["Use subject and disposition frames for Board headlines."],
    facts: {
      sessionId: "session-board-refresh",
      project: "Masthead",
      lifecycle: "running",
      primaryStatus: "editing",
      recentTranscriptMessages: ["Use subject and disposition frames for Board headlines."],
      recentFileBasenames: ["boardHeadlineEnricher.ts"],
      changedFileCount: 1,
      recentEvents: [],
      recentToolNames: [],
      recentCommandFailures: [],
      attentionTitles: [],
      conflictTitles: []
    }
  };
}

function responseWithFrame(frame: unknown): Response {
  return new Response(
    JSON.stringify({
      output: [
        {
          content: [{ type: "output_text", text: JSON.stringify(frame) }]
        }
      ]
    }),
    { status: 200 }
  );
}
