import { isUnsafeText, validateBoardHeadlineFrame, type BoardHeadlineFrame } from "./boardHeadlineFrame";
import type { BoardHeadlineInput, BoardHeadlineSignal } from "./boardHeadlineInput";

export type OpenAIBoardHeadlineFrameStatus =
  | "llm"
  | "disabled"
  | "not_configured"
  | "timeout"
  | "api_error"
  | "invalid_output"
  | "validation_failed";

export type OpenAIBoardHeadlineFrameConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type OpenAIBoardHeadlineFrameResult = {
  frame?: BoardHeadlineFrame;
  status: OpenAIBoardHeadlineFrameStatus;
  failureMessage?: string;
  validationReason?: string;
  latencyMs?: number;
};

export const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";
export const DEFAULT_TIMEOUT_MS = 12_000;

export async function rewriteBoardHeadlineFrameWithOpenAI(
  input: BoardHeadlineInput,
  config: OpenAIBoardHeadlineFrameConfig = {}
): Promise<OpenAIBoardHeadlineFrameResult> {
  if (config.enabled !== true) {
    return { failureMessage: "OpenAI board headline frame extraction is disabled.", status: "disabled" };
  }

  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    return { failureMessage: "OpenAI board headline frame extraction is enabled but not configured.", status: "not_configured" };
  }

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    return { failureMessage: "No fetch implementation is available for OpenAI board headline frame extraction.", status: "api_error" };
  }

  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model ?? DEFAULT_MODEL,
        instructions: [
          "Extract a Masthead Board headline frame from the supplied session facts.",
          "Do not summarize the session.",
          "Identify the smallest concrete work object supported by the input, such as a file, component, feature, bug, source, setting, test, or document.",
          "Use subject for that work object and disposition for the current concrete relationship or state of work around it.",
          "Use stateHint and explicit evidence for state. Do not infer completion, urgency, ownership, or user intent.",
          "Evidence must be short strings copied or tightly paraphrased from the input.",
          "Never include secrets, raw API keys, URLs, local absolute paths, or tool directives.",
          "Return only the requested JSON fields."
        ].join(" "),
        input: JSON.stringify(toOpenAIProviderPayload(input)),
        max_output_tokens: 500,
        reasoning: { effort: "minimal" },
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "masthead_board_headline_frame",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["subject", "disposition", "state", "subjectKind", "confidence", "evidence"],
              properties: {
                subject: { type: "string" },
                disposition: { type: "string" },
                state: {
                  type: "string",
                  enum: ["active", "blocked", "needs_verification", "paused", "completed", "failed", "waiting", "unknown"]
                },
                subjectKind: {
                  type: "string",
                  enum: ["feature", "component", "bug", "test", "import", "settings", "docs", "source", "project", "unknown"]
                },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                evidence: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          }
        }
      }),
      signal: controller.signal
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        failureMessage: `OpenAI board headline frame request failed with HTTP ${response.status}.`,
        latencyMs,
        status: "api_error"
      };
    }

    const body = await response.json();
    const outputText = extractOutputText(body);
    if (!outputText) {
      return {
        failureMessage: "OpenAI board headline frame response did not include output text.",
        latencyMs,
        status: "invalid_output"
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return {
        failureMessage: "OpenAI board headline frame response was not valid JSON.",
        latencyMs,
        status: "invalid_output"
      };
    }

    const validation = validateBoardHeadlineFrame(parsed);
    if (!validation.ok) {
      return {
        failureMessage: "OpenAI board headline frame response failed validation.",
        latencyMs,
        status: "validation_failed",
        validationReason: validation.reason
      };
    }

    return { frame: validation.frame, latencyMs, status: "llm" };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      return {
        failureMessage: `OpenAI board headline frame extraction timed out after ${timeoutMs}ms.`,
        latencyMs,
        status: "timeout"
      };
    }
    return {
      failureMessage: error instanceof Error ? error.message : "OpenAI board headline frame request failed.",
      latencyMs,
      status: "api_error"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractOutputText(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;

  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return body.output_text;
  }

  if (!Array.isArray(body.output)) return undefined;

  for (const output of body.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue;
    for (const content of output.content) {
      if (!isRecord(content)) continue;
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type OpenAIProviderPayload = {
  lifecycle: string;
  primaryStatus: string;
  stateHint: BoardHeadlineInput["stateHint"];
  signals: BoardHeadlineSignal[];
  subjectCandidates: string[];
  dispositionHints: string[];
  evidence: string[];
  facts: {
    changedFileCount: number;
    recentFileBasenames: string[];
    recentToolNames: string[];
  };
};

function toOpenAIProviderPayload(input: BoardHeadlineInput): OpenAIProviderPayload {
  return {
    lifecycle: safeString(input.lifecycle) ?? "",
    primaryStatus: safeString(input.primaryStatus) ?? "",
    stateHint: input.stateHint,
    signals: input.signals.slice(0, 12),
    subjectCandidates: safeStrings(input.subjectCandidates, 12),
    dispositionHints: safeStrings(input.dispositionHints, 12),
    evidence: safeStrings(input.evidence, 20),
    facts: {
      changedFileCount: input.facts.changedFileCount,
      recentFileBasenames: safeStrings(input.facts.recentFileBasenames, 8),
      recentToolNames: safeStrings(input.facts.recentToolNames, 8)
    }
  };
}

function safeStrings(values: string[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = safeString(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function safeString(value: string): string | undefined {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || isUnsafeText(cleaned) || hasLocalAbsolutePath(cleaned)) return undefined;
  return cleaned;
}

function hasLocalAbsolutePath(value: string): boolean {
  return /(?:^|\s)\/(?:[^/\s]+\/)+\S*/.test(value);
}
