import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { antigravityCandidatePaths } from "./discovery.ts";

export const antigravityAdapter = createLocalAdapter({
  runtime: "antigravity",
  candidatePaths: antigravityCandidatePaths,
  jsonlProfile: genericCodingProfile("antigravity")
});
