import { describe, expect, test } from "vitest";
import { validateNarrativeField } from "../sessionNarrativeValidator.ts";

describe("session narrative validator", () => {
  test.each([
    "Updated.",
    "Updated files.",
    "Updated done and deployed.",
    "Session is complete.",
    "Masthead session had recent activity.",
    "Changed files were updated in this session.",
    '{"event":"session.completed"}',
    'Updated ::-stage{cwd=""} ::-commit{cwd=""}.'
  ])("rejects low-quality title %s", (value) => {
    expect(validateNarrativeField("title", value).ok).toBe(false);
  });

  test.each([
    "Canonical Logbook search",
    "MCP launch configuration validation",
    "Codex transcript import progress",
    "Settings destructive-action safeguards"
  ])("accepts useful title %s", (value) => {
    expect(validateNarrativeField("title", value).ok).toBe(true);
  });

  test.each([
    "Logbook search now reads canonical session records.",
    "MCP setup is validating the launch path and active database.",
    "Codex transcript import is parsing rollout records."
  ])("accepts useful live summary %s", (value) => {
    expect(validateNarrativeField("liveSummary", value).ok).toBe(true);
  });
});
