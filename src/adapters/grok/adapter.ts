import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { grokCandidatePaths } from "./discovery.ts";

export const grokAdapter = createLocalAdapter({
  runtime: "grok",
  candidatePaths: grokCandidatePaths,
  jsonlProfile: genericCodingProfile("grok")
});
