import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { cursorCandidatePaths } from "./discovery.ts";

export const cursorAdapter = createLocalAdapter({
  runtime: "cursor",
  candidatePaths: cursorCandidatePaths,
  jsonlProfile: genericCodingProfile("cursor")
});
