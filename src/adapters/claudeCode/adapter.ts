import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import { claudeCodeCandidatePaths } from "./discovery.ts";
import { backfillClaudeCodeSource, parseClaudeCodeTranscriptUnit, planClaudeCodeTranscriptUnits } from "./transcriptUnit.ts";

const baseClaudeCodeAdapter = createLocalAdapter({
  runtime: "claude_code",
  candidatePaths: claudeCodeCandidatePaths,
  jsonlProfile: genericCodingProfile("claude_code")
});

export const claudeCodeAdapter = {
  ...baseClaudeCodeAdapter,
  backfill: backfillClaudeCodeSource,
  parseTranscriptUnit: parseClaudeCodeTranscriptUnit,
  planTranscriptUnits: planClaudeCodeTranscriptUnits
};
