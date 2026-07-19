import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { opencodeCandidatePaths } from "./discovery.ts";
import { backfillOpenCodeSource, parseOpenCodeTranscriptUnit, planOpenCodeTranscriptUnits } from "./transcriptUnit.ts";

const baseOpenCodeAdapter = createLocalAdapter({ runtime: "opencode", candidatePaths: opencodeCandidatePaths, jsonlProfile: genericCodingProfile("opencode") });

export const opencodeAdapter = {
  ...baseOpenCodeAdapter,
  backfill: (source: Parameters<typeof baseOpenCodeAdapter.backfill>[0], cursor?: Parameters<typeof baseOpenCodeAdapter.backfill>[1]) =>
    source.sourceKind === "sqlite" ? backfillOpenCodeSource(source, cursor) : baseOpenCodeAdapter.backfill(source, cursor),
  parseTranscriptUnit: (unit: Parameters<typeof baseOpenCodeAdapter.parseTranscriptUnit>[0], cursor?: Parameters<typeof baseOpenCodeAdapter.parseTranscriptUnit>[1]) =>
    unit.source.sourceKind === "sqlite" ? parseOpenCodeTranscriptUnit(unit, cursor) : baseOpenCodeAdapter.parseTranscriptUnit(unit, cursor),
  planTranscriptUnits: (source: Parameters<typeof baseOpenCodeAdapter.planTranscriptUnits>[0]) =>
    source.sourceKind === "sqlite" ? planOpenCodeTranscriptUnits(source) : baseOpenCodeAdapter.planTranscriptUnits(source)
};
