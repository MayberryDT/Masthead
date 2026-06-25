import { deterministicCapsuleFromFacts } from "./sessionCompiler.ts";
import type { SessionEnrichmentProvider } from "./provider.ts";

export function createDeterministicEnrichmentProvider(): SessionEnrichmentProvider {
  return {
    id: "deterministic",
    model: "local-rules",
    async enrich(input) {
      return deterministicCapsuleFromFacts(input.facts);
    }
  };
}
