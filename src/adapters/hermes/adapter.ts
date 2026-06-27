import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { hermesCandidatePaths } from "./discovery.ts";
export const hermesAdapter = createLocalAdapter({ runtime: "hermes", candidatePaths: hermesCandidatePaths, jsonlProfile: genericCodingProfile("hermes") });
