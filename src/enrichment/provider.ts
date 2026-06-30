import type { SessionFacts } from "./sessionCompiler.ts";
import type { SessionCapsule } from "./types.ts";

export type SessionEnrichmentInput = {
  facts: SessionFacts;
};

export type EnrichmentProviderStatus =
  | "success"
  | "disabled"
  | "not_configured"
  | "api_error"
  | "timeout"
  | "invalid_json"
  | "invalid_output"
  | "validation_failed";

export type EnrichmentProviderResult = {
  status: EnrichmentProviderStatus;
  capsule?: SessionCapsule;
  source: "llm" | "deterministic" | "none";
  provider: string;
  model: string;
  latencyMs?: number;
  requestPayload?: unknown;
  rawOutput?: unknown;
  parsedOutput?: unknown;
  validationFailures?: string[];
  failureMessage?: string;
};

export interface SessionEnrichmentProvider {
  id: string;
  model: string;
  enrich(input: SessionEnrichmentInput): Promise<EnrichmentProviderResult>;
}
