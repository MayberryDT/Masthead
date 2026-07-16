import { createLocalAdapter } from "../generic/localAdapterFactory.ts";
import { grokCandidatePaths } from "./discovery.ts";
import { backfillGrokSource, parseGrokTranscriptUnit, planGrokTranscriptUnits } from "./transcriptUnit.ts";

const baseGrokAdapter = createLocalAdapter({ runtime: "grok", candidatePaths: grokCandidatePaths });

export const grokAdapter = {
  ...baseGrokAdapter,
  backfill: backfillGrokSource,
  parseTranscriptUnit: parseGrokTranscriptUnit,
  planTranscriptUnits: planGrokTranscriptUnits
};
