import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { openclawCandidatePaths } from "./discovery.ts";
export const openclawAdapter = createLocalAdapter({ runtime: "openclaw", candidatePaths: openclawCandidatePaths, jsonlProfile: genericCodingProfile("openclaw") });
