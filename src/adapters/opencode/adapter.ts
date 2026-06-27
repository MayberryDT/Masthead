import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { opencodeCandidatePaths } from "./discovery.ts";
export const opencodeAdapter = createLocalAdapter({ runtime: "opencode", candidatePaths: opencodeCandidatePaths, jsonlProfile: genericCodingProfile("opencode") });
