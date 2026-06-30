import { deterministicCapsuleFromFacts } from "./sessionCompiler.ts";
import type { SessionEnrichmentProvider } from "./provider.ts";

export function createDeterministicEnrichmentProvider(): SessionEnrichmentProvider {
  return {
    id: "deterministic",
    model: "local-rules",
    async enrich(input) {
      return {
        capsule: deterministicCapsuleFromFacts(input.facts),
        model: "local-rules",
        provider: "deterministic",
        source: "deterministic",
        status: "success"
      };
    }
  };
}
