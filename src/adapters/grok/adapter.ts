import { createLocalAdapter } from "../generic/localAdapterFactory.ts";
import { discoverGrokSources, grokCandidatePaths } from "./discovery.ts";
import { backfillGrokSource, parseGrokTranscriptUnit, planGrokTranscriptUnits } from "./transcriptUnit.ts";

const baseGrokAdapter = createLocalAdapter({ runtime: "grok", candidatePaths: grokCandidatePaths });

export const grokAdapter = {
  ...baseGrokAdapter,
  backfill: backfillGrokSource,
  discover: discoverGrokSources,
  parseTranscriptUnit: parseGrokTranscriptUnit,
  planTranscriptUnits: planGrokTranscriptUnits
};
