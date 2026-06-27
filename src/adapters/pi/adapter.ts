import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { piCandidatePaths } from "./discovery.ts";
export const piAdapter = createLocalAdapter({ runtime: "pi", candidatePaths: piCandidatePaths, jsonlProfile: genericCodingProfile("pi") });
