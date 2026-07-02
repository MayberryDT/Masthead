import { describe, expect, test, vi } from "vitest";
import { createDeterministicEnrichmentProvider } from "../deterministicProvider.ts";
import { createOpenAIEnrichmentProvider } from "../openAIProvider.ts";
import type { SessionFacts } from "../sessionCompiler.ts";

describe("OpenAI enrichment provider", () => {
  test("uses validated Responses output when enabled and configured", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        input: string;
        instructions: string;
        max_output_tokens: number;
        reasoning: { effort: string };
        text: { format: { schema: { required: string[] } } };
      };
      const input = JSON.parse(body.input);
      expect(body.input).not.toContain("/home/tyler");
      expect(body.input).not.toContain("OPENAI_API_KEY");
      expect(body.instructions).toContain("neutral third-person");
      expect(body.instructions).toContain("Do not write from the assistant's perspective");
      expect(body.max_output_tokens).toBe(760);
      expect(body.reasoning).toEqual({ effort: "minimal" });
      expect(body.text.format.schema.required).toEqual([
        "title",
        "liveSummary",
        "outcome",
        "searchSummary",
        "action",
        "object",
        "confidence",
        "missingEvidence",
        "version",
        "sessionTitle",
        "sessionSummary",
        "sessionDossier"
      ]);
      expect(input.evidenceCatalog).toEqual([]);
      expect(Object.keys(input)).toEqual(["evidenceCatalog", "facts"]);
      expect(Object.keys(input.facts).sort()).toEqual(["assistantEvidence", "userEvidence"]);
      expect(input.facts.userEvidence).toEqual([
        "Fix MCP launch config validation before review.",
        "Make sure the Dossier copy stays neutral."
      ]);
      expect(input.facts.assistantEvidence).toEqual([
        "Added validation and tools-list coverage for MCP launch config.",
        "The Dossier summary now describes the session in neutral language."
      ]);
      return responseWithOutput({
        confidence: "high",
        liveSummary: "Durable enrichment provider returned structured session copy.",
        action: "generate",
        object: "structured session copy",
        missingEvidence: [],
        outcome: "Structured session copy was generated.",
        searchSummary: "Durable title, summary, and dossier enrichment were generated.",
        sessionDossier: {
          blockers: [],
          continuation: {
            constraints: [],
            nextStep: "Persist the durable fields.",
            openQuestions: []
          },
          decisions: [],
          evidenceRefIds: [],
          keyWork: ["Generated durable title and archival summary."],
          outcome: "Durable title, summary, and Dossier sections were generated.",
          purpose: "Generate structured session copy.",
          verification: {
            commands: ["vitest"],
            evidenceRefIds: [],
            failures: [],
            status: "passed",
            summary: "Provider parsing test passed."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "high",
          evidenceRefIds: [],
          state: "completed",
          text: "Generated structured session copy with durable title, archival summary, and Dossier sections."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "high",
          evidenceRefIds: [],
          text: "Structured session copy generation"
        },
        title: "Legacy compatible title",
        version: "session-capsule-v4"
      });
    });
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: true,
      fetchImpl,
      model: "test-model"
    });

    const result = await provider.enrich({ facts: facts() });

    expect(provider.id).toBe("openai");
    expect(provider.model).toBe("test-model");
    expect(result.status).toBe("success");
    expect(result.source).toBe("llm");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("test-model");
    expect(result.capsule?.title).toBe("Structured session copy generation");
    expect(result.capsule?.titleSource).toBe("llm");
    expect(result.capsule?.confidence).toBe("high");
    expect(result.capsule?.missingEvidence).toEqual([]);
    expect(result.capsule?.liveSummary).toBe("Durable enrichment provider returned structured session copy.");
    expect(result.capsule?.searchSummary).toContain("dossier enrichment");
    expect(result.capsule?.sessionTitle?.text).toBe("Structured session copy generation");
    expect(result.capsule?.sessionSummary?.text).toContain("Generated structured session copy");
    expect(result.capsule?.sessionDossier?.verification.status).toBe("passed");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("returns validation failure without deterministic fallback when Responses output is invalid", async () => {
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: true,
      fetchImpl: vi.fn(async () =>
        responseWithOutput({
          liveSummary: "Updated files.",
          searchSummary: "Changed files were updated in this session.",
          title: "Codex session"
        })
      )
    });

    const result = await provider.enrich({ facts: facts() });

    expect(result.status).toBe("validation_failed");
    expect(result.source).toBe("none");
    expect(result.capsule).toBeUndefined();
    expect(result.validationFailures).toContain("title");
  });

  test("returns disabled without deterministic fallback when OpenAI enrichment is disabled", async () => {
    const fetchImpl = vi.fn();
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: false,
      fetchImpl
    });

    const result = await provider.enrich({ facts: facts() });

    expect(provider.id).toBe("openai");
    expect(result.status).toBe("disabled");
    expect(result.source).toBe("none");
    expect(result.capsule).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("returns not_configured when OpenAI enrichment is enabled without an API key", async () => {
    const fetchImpl = vi.fn();
    const provider = createOpenAIEnrichmentProvider({
      enabled: true,
      fetchImpl
    });

    const result = await provider.enrich({ facts: facts() });

    expect(result.status).toBe("not_configured");
    expect(result.source).toBe("none");
    expect(result.provider).toBe("openai");
    expect(result.capsule).toBeUndefined();
    expect(result.failureMessage).toContain("no API key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("uses configured durable timeout for OpenAI requests", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          })
      );
      const provider = createOpenAIEnrichmentProvider({
        apiKey: "test-key",
        enabled: true,
        fetchImpl,
        timeoutMs: 25
      });

      const resultPromise = provider.enrich({ facts: facts() });
      await vi.advanceTimersByTimeAsync(25);
      const result = await resultPromise;

      expect(result.status).toBe("timeout");
      expect(result.failureMessage).toContain("25ms");
    } finally {
      vi.useRealTimers();
    }
  });

  test("deterministic provider is explicit local enrichment", async () => {
    const result = await createDeterministicEnrichmentProvider().enrich({ facts: facts() });

    expect(result).toMatchObject({
      status: "success",
      source: "deterministic",
      provider: "deterministic",
      model: "local-rules"
    });
    expect(result.capsule?.titleSource).toBe("deterministic");
  });
});

function facts(): SessionFacts {
  return {
    commands: ["npm test -- --run src/mcp/__tests__/toolsList.test.ts"],
    evidence: [],
    files: ["/home/tyler/.codex/worktrees/7c35/Masthead/src/ui/AgentAccessPanel.tsx"],
    messages: ["Fix MCP launch config validation before review."],
    userEvidence: ["Fix MCP launch config validation before review.", "Make sure the Dossier copy stays neutral."],
    assistantEvidence: [
      "Added validation and tools-list coverage for MCP launch config.",
      "The Dossier summary now describes the session in neutral language."
    ],
    narrative: {
      buildFailed: false,
      buildPassed: false,
      checkpointSummaries: [],
      commands: [
        {
          category: "test",
          exitCode: 0,
          name: "npm test -- --run src/mcp/__tests__/toolsList.test.ts",
          outputPreview: "tools-list coverage passed",
          status: "succeeded"
        }
      ],
      coverage: {
        assistantMessages: 1,
        fileEffects: 1,
        hasUsableTranscript: true,
        level: "complete",
        messageCount: 2,
        toolCalls: 1,
        tokenUsageRows: 0,
        userMessages: 1
      },
      deployMentioned: false,
      eventSummaries: [],
      fileBasenames: ["Agent Access Panel"],
      fileDirectories: ["src/ui"],
      files: [{ basename: "Agent Access Panel", directory: "src/ui", extension: "tsx", operation: "modified", path: "src/ui/AgentAccessPanel.tsx" }],
      finalAssistantMessage: "Added validation and tools-list coverage for MCP launch config.",
      firstUserPrompt: "Fix MCP launch config validation before review.",
      lastUserPrompt: "Fix MCP launch config validation before review.",
      objective: "Fix MCP launch config validation",
      project: "Masthead",
      runtime: "codex",
      sessionId: "session-openai-provider",
      sourceSessionId: "source-openai-provider",
      storedTitle: "Codex session",
      technologies: ["TypeScript"],
      testsFailed: false,
      testsPassed: true,
      topics: ["mcp"]
    },
    objective: "Fix MCP launch config validation",
    project: "Masthead",
    sessionId: "session-openai-provider",
    sourceSessionId: "source-openai-provider",
    title: "Codex session"
  };
}

function responseWithOutput(output: Record<string, unknown>): Response {
  return {
    ok: true,
    json: async () => ({
      output: [
        {
          content: [
            {
              text: JSON.stringify(output),
              type: "output_text"
            }
          ]
        }
      ]
    })
  } as Response;
}
