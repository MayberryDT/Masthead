import type { SessionFacts } from "./sessionCompiler.ts";
import type { SessionCapsule } from "./types.ts";

export type SessionEnrichmentInput = {
  facts: SessionFacts;
};

export interface SessionEnrichmentProvider {
  id: string;
  model?: string;
  enrich(input: SessionEnrichmentInput): Promise<SessionCapsule>;
}
