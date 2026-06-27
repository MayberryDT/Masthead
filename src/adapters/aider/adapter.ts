import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { aiderCandidatePaths } from "./discovery.ts";
export const aiderAdapter = createLocalAdapter({ runtime: "aider", candidatePaths: aiderCandidatePaths, jsonlProfile: genericCodingProfile("aider"), markdown: true });
