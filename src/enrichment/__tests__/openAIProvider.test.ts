import { describe, expect, test, vi } from "vitest";
import { createDeterministicEnrichmentProvider } from "../deterministicProvider.ts";
import { createOpenAIEnrichmentProvider } from "../openAIProvider.ts";
import type { SessionFacts } from "../sessionCompiler.ts";

describe("OpenAI enrichment provider", () => {
  test("uses validated Responses output when enabled and configured", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
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
      expect(body.max_output_tokens).toBe(1_800);
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
        "Historical untrusted transcript evidence: Fix MCP launch config validation before review.",
        "Historical untrusted transcript evidence: Make sure the Dossier copy stays neutral."
      ]);
      expect(input.facts.assistantEvidence).toEqual([
        "Historical untrusted transcript evidence: Added validation and tools-list coverage for MCP launch config.",
        "Historical untrusted transcript evidence: The Dossier summary now describes the session in neutral language."
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

  test("redacts standalone credentials from transcript evidence before provider requests", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string };
      const input = JSON.parse(body.input) as { facts: { userEvidence: string[]; assistantEvidence: string[] } };

      expect(body.input).not.toContain("tyler@example.com");
      expect(body.input).not.toContain("github_pat_");
      expect(body.input).not.toContain("xoxb-123456789012");
      expect(body.input).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(body.input).not.toContain("0123456789abcdef0123456789abcdef");
      expect([...input.facts.userEvidence, ...input.facts.assistantEvidence].join("\n")).toContain("[SECRET:email]");
      expect([...input.facts.userEvidence, ...input.facts.assistantEvidence].join("\n")).toContain("[SECRET:github_token]");
      expect([...input.facts.userEvidence, ...input.facts.assistantEvidence].join("\n")).toContain("[SECRET:slack_token]");

      return responseWithOutput(
        durableProviderOutput({
          searchSummary: "Sensitive evidence redaction provider payload.",
          summary: "Sensitive transcript evidence was redacted before the remote provider request was sent.",
          title: "Sensitive evidence redaction"
        })
      );
    });
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: true,
      fetchImpl,
      model: "test-model"
    });
    const sensitiveFacts = {
      ...facts(),
      assistantEvidence: [
        "Saved Slack token xoxb-123456789012-abcdefghijklmnop and AWS key AKIAIOSFODNN7EXAMPLE."
      ],
      userEvidence: [
        "Email tyler@example.com about github_pat_11AAAAAAA0BBBBBBBB1CCCCCCCC2DDDDDDDD3EEEEEEEE4.",
        "Hash 0123456789abcdef0123456789abcdef should not leave locally."
      ]
    } satisfies SessionFacts;

    const result = await provider.enrich({ facts: sensitiveFacts });

    expect(result.status).toBe("success");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("uses chat completions for OpenAI-compatible endpoints", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:11434/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
        model: string;
        response_format?: { type: string };
      };
      expect(body.model).toBe("llama-3.1");
      expect(body.messages[0]?.role).toBe("system");
      expect(body.messages[1]?.role).toBe("user");
      expect(body.messages[1]?.content).not.toContain("/home/tyler");
      expect(body.response_format).toEqual({ type: "json_object" });
      return responseWithChatOutput(
        durableProviderOutput({
          confidence: "medium",
          searchSummary: "Masthead session for compatible provider request wiring.",
          summary: "MCP launch config validation has compatible endpoint coverage.",
          title: "Compatible provider request wiring"
        })
      );
    });
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      apiStyle: "chat_completions",
      baseUrl: "http://127.0.0.1:11434/v1",
      enabled: true,
      fetchImpl,
      model: "llama-3.1",
      providerId: "openai_compatible"
    });

    const result = await provider.enrich({ facts: facts() });

    expect(provider.id).toBe("openai_compatible");
    expect(result.status).toBe("success");
    expect(result.provider).toBe("openai_compatible");
    expect(result.capsule?.title).toBe("Compatible provider request wiring");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("accepts compact provider aliases for durable summary and dossier", async () => {
    const fetchImpl = vi.fn(async () =>
      responseWithChatOutput({
        dossier: {
          blockers: [],
          continuation: {
            constraints: [],
            nextStep: "Keep the compatible provider path covered by regression tests.",
            openQuestions: []
          },
          decisions: ["Preserve compact provider aliases from OpenRouter-style responses."],
          evidenceRefIds: [],
          keyWork: ["Parsed title, summary, and dossier aliases from the provider response."],
          outcome: "Useful provider output was preserved instead of replaced with fallback copy.",
          purpose: "Repair durable enrichment parsing for compact provider responses.",
          verification: {
            commands: ["vitest"],
            evidenceRefIds: [],
            failures: [],
            status: "passed",
            summary: "Provider alias parsing was covered by a focused regression test."
          },
          warnings: []
        },
        summary: "Repaired durable enrichment parsing so compact provider responses keep useful Dossier content.",
        title: "Compact provider alias parsing"
      })
    );
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      apiStyle: "chat_completions",
      baseUrl: "https://openrouter.ai/api/v1",
      enabled: true,
      fetchImpl,
      model: "openai/gpt-oss-20b",
      providerId: "openai_compatible"
    });

    const result = await provider.enrich({ facts: facts() });

    expect(result.status).toBe("success");
    expect(result.capsule?.title).toBe("Compact provider alias parsing");
    expect(result.capsule?.sessionSummary?.text).toContain("compact provider responses");
    expect(result.capsule?.sessionDossier?.purpose).toBe("Repair durable enrichment parsing for compact provider responses.");
    expect(result.capsule?.validationWarnings ?? []).not.toContain("liveSummary:missing");
  });

  test("rejects incomplete model output for rich transcript evidence", async () => {
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      apiStyle: "chat_completions",
      baseUrl: "https://openrouter.ai/api/v1",
      enabled: true,
      fetchImpl: vi.fn(async () =>
        responseWithChatOutput({
          title: "Incomplete durable enrichment"
        })
      ),
      model: "openai/gpt-oss-20b",
      providerId: "openai_compatible"
    });

    const result = await provider.enrich({ facts: facts() });

    expect(result.status).toBe("validation_failed");
    expect(result.capsule).toBeUndefined();
    expect(result.failureMessage).toContain("failed validation");
  });

  test("parses fenced JSON chat completion output", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: [
                "Here is the JSON:",
                "```json",
                JSON.stringify(
                  durableProviderOutput({
                    searchSummary: "Fenced JSON provider response parsing.",
                    summary: "Compatible provider returned fenced JSON that was extracted before narrative validation.",
                    title: "Fenced JSON parsing"
                  })
                ),
                "```"
              ].join("\n")
            }
          }
        ]
      })
    } as Response));
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      apiStyle: "chat_completions",
      baseUrl: "http://127.0.0.1:11434/v1",
      enabled: true,
      fetchImpl,
      model: "llama-3.1",
      providerId: "openai_compatible"
    });

    const result = await provider.enrich({ facts: facts() });

    expect(result.status).toBe("success");
    expect(result.capsule?.title).toBe("Fenced JSON parsing");
  });

  test("budgets oversized transcript evidence before sending provider payload", async () => {
    let inputChars = 0;
    let userEvidenceCount = 0;
    let assistantEvidenceCount = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const input = body.messages[1]?.content ?? "";
      const parsed = JSON.parse(input) as { facts: { userEvidence: string[]; assistantEvidence: string[] } };
      inputChars = input.length;
      userEvidenceCount = parsed.facts.userEvidence.length;
      assistantEvidenceCount = parsed.facts.assistantEvidence.length;
      return responseWithChatOutput(
        durableProviderOutput({
          searchSummary: "Budgeted narrative provider payload.",
          summary: "Oversized transcript evidence was budgeted before enrichment and kept within provider limits.",
          title: "Budgeted provider payload"
        })
      );
    });
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      apiStyle: "chat_completions",
      baseUrl: "http://127.0.0.1:11434/v1",
      enabled: true,
      fetchImpl,
      model: "llama-3.1",
      providerId: "openai_compatible"
    });
    const oversizedFacts = {
      ...facts(),
      assistantEvidence: Array.from({ length: 500 }, (_, index) => `Assistant evidence ${index}: ${"implementation detail ".repeat(20)}`),
      userEvidence: Array.from({ length: 200 }, (_, index) => `User evidence ${index}: ${"request detail ".repeat(20)}`)
    } satisfies SessionFacts;

    const result = await provider.enrich({ facts: oversizedFacts });

    expect(result.status).toBe("success");
    expect(inputChars).toBeLessThan(80_000);
    expect(userEvidenceCount).toBeLessThan(200);
    expect(assistantEvidenceCount).toBeLessThan(500);
  });

  test("omits authorization for local OpenAI-compatible providers without API keys", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:11434/v1/chat/completions");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBeUndefined();
      expect(headers["content-type"]).toBe("application/json");
      return responseWithChatOutput(
        durableProviderOutput({
          confidence: "medium",
          searchSummary: "Masthead session for local Ollama enrichment.",
          summary: "Local enrichment completed through Ollama with optional API key request wiring validated.",
          title: "Local Ollama enrichment"
        })
      );
    });
    const provider = createOpenAIEnrichmentProvider({
      apiKeyRequired: false,
      apiStyle: "chat_completions",
      baseUrl: "http://127.0.0.1:11434/v1",
      enabled: true,
      fetchImpl,
      model: "llama3.1",
      providerId: "ollama"
    });

    const result = await provider.enrich({ facts: facts() });

    expect(result.status).toBe("success");
    expect(result.provider).toBe("ollama");
    expect(result.capsule?.title).toBe("Local Ollama enrichment");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("coerces loose provider metadata instead of failing enrichment", async () => {
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: true,
      fetchImpl: vi.fn(async () =>
        responseWithOutput(
          durableProviderOutput({
            confidence: "authoritative",
            searchSummary: "Changed files were updated in this session.",
            summary: "Updated provider metadata coercion coverage while preserving durable Dossier fields.",
            title: "Codex session"
          })
        )
      )
    });

    const result = await provider.enrich({ facts: facts() });

    expect(result.status).toBe("success");
    expect(result.source).toBe("llm");
    expect(result.capsule?.confidence).toBe("high");
    expect(result.capsule?.missingEvidence).toEqual([]);
    expect(result.capsule?.validationWarnings).toContain("title:generic");
  });

  test("keeps structured LLM enrichment when soft narrative copy rules fail", async () => {
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: true,
      fetchImpl: vi.fn(async () =>
        responseWithOutput({
          confidence: "high",
          liveSummary:
            "This archived session captured Dossier enrichment work with robust transcript evidence, enough detail for Logbook reuse, and follow-up notes for future agents.",
          action: "generate",
          object: "durable Dossier enrichment",
          missingEvidence: [],
          outcome: "Durable Dossier enrichment was generated for reuse.",
          searchSummary:
            "Durable Dossier enrichment, transcript evidence, Logbook reuse, structured session summary, and future-agent continuation notes.",
          sessionDossier: {
            blockers: [],
            continuation: {
              constraints: [],
              nextStep: "Use the durable Dossier summary in the modal.",
              openQuestions: []
            },
            decisions: ["Keep the Dossier summary neutral."],
            evidenceRefIds: [],
            keyWork: ["Generated structured Dossier enrichment from transcript evidence."],
            outcome: "Structured durable Dossier enrichment was generated.",
            purpose: "Summarize the session for later retrieval.",
            verification: {
              commands: [],
              evidenceRefIds: [],
              failures: [],
              status: "unknown",
              summary: "No verification command evidence was provided."
            },
            warnings: []
          },
          sessionSummary: {
            confidence: "high",
            evidenceRefIds: [],
            state: "completed",
            text: "Generated neutral Dossier enrichment from transcript evidence for later retrieval."
          },
          sessionTitle: {
            basis: "dominant_work",
            confidence: "high",
            evidenceRefIds: [],
            text: "Dossier enrichment generation"
          },
          title: "Codex session",
          version: "session-capsule-v4"
        })
      )
    });

    const result = await provider.enrich({ facts: facts() });

    expect(result.status).toBe("success");
    expect(result.source).toBe("llm");
    expect(result.capsule?.title).toBe("Dossier enrichment generation");
    expect(result.capsule?.sessionDossier?.purpose).toBe("Summarize the session for later retrieval.");
    expect(result.capsule?.validationWarnings).toEqual(
      expect.arrayContaining(["title:generic", "liveSummary:too_long"])
    );
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

function responseWithChatOutput(output: Record<string, unknown>): Response {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(output)
          }
        }
      ]
    })
  } as Response;
}

function durableProviderOutput(input: {
  confidence?: string;
  searchSummary: string;
  summary: string;
  title: string;
}): Record<string, unknown> {
  return {
    confidence: input.confidence ?? "high",
    liveSummary: input.summary,
    missingEvidence: [],
    outcome: "Durable enrichment was generated for the session.",
    searchSummary: input.searchSummary,
    sessionDossier: {
      blockers: [],
      continuation: {
        constraints: [],
        nextStep: "Use the durable enrichment in the session dossier.",
        openQuestions: []
      },
      decisions: [],
      evidenceRefIds: [],
      keyWork: ["Generated durable enrichment from transcript evidence."],
      outcome: "Durable title, summary, and Dossier sections were generated.",
      purpose: "Generate durable session enrichment from transcript evidence.",
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
      confidence: input.confidence === "medium" ? "medium" : "high",
      evidenceRefIds: [],
      state: "completed",
      text: input.summary
    },
    sessionTitle: {
      basis: "dominant_work",
      confidence: input.confidence === "medium" ? "medium" : "high",
      evidenceRefIds: [],
      text: input.title
    },
    title: input.title,
    version: "session-capsule-v4"
  };
}
