import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { claudeCodeCandidatePaths } from "./discovery.ts";

export const claudeCodeAdapter = createLocalAdapter({
  runtime: "claude_code",
  candidatePaths: claudeCodeCandidatePaths,
  jsonlProfile: genericCodingProfile("claude_code")
});
