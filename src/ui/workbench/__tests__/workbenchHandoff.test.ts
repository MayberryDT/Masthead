import { expect, test } from "vitest";
import type { WorkbenchQueueSessionDto } from "../../../shared/workbench";
import { buildWorkbenchHandoff } from "../workbenchHandoff";

const forbiddenTokenParts = [
  ["mast", "head", "ctl"],
  ["np", "m", " run"],
  ["out", "put", ".json"],
  ["sch", "ema", ".json"],
  ["app", "ly", ".sh"]
] as const;

function forbiddenToken(index: number): string {
  return forbiddenTokenParts[index].join("");
}

function forbiddenPattern(index: number): RegExp {
  return new RegExp(forbiddenToken(index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

test("builds an agent prompt with concrete Workbench CLI commands", () => {
  const text = buildWorkbenchHandoff({
    sessions: [
      session({
        lifecycle: "ended",
        lastActivityAt: "2026-07-08T12:00:00.000Z",
        project: "Masthead",
        runtime: "codex",
        sessionId: "session:abc",
        title: "Raw import session"
      })
    ]
  });

  expect(text).toContain("Masthead is running locally");
  expect(text).toContain("/home/tyler/.codex/worktrees/f503/Masthead");
  expect(text).toContain("node dist/daemon/src/cli/mastheadctl.js workbench status --json");
  expect(text).toContain("workbench claim --session <session-id>");
  expect(text).toContain("workbench transcript check --session <session-id>");
  expect(text).toContain("evidence --kind session_enrichment --session <session-id> --json");
  expect(text).toContain("workbench validate --kind session_enrichment --session <session-id> --file <path-to-output> --json");
  expect(text).toContain("workbench apply --kind session_enrichment --session <session-id> --file <path-to-output> --json");
  expect(text).toContain("session_dossier");
  expect(text).toContain("bug_fix_trace");
  expect(text).toContain("Do not inspect or mention Not Added to Logbook sessions");
  expect(text).toContain("session:abc");
  expect(text).toContain("Raw import session");
  expect(text).toContain("Every conclusion needs an evidence ref");
});

test("sanitizes forbidden substrings from selected session metadata in handoff text", () => {
  const text = buildWorkbenchHandoff({
    sessions: [
      session({
        lifecycle: "ended",
        lastActivityAt: "2026-07-08T12:00:00.000Z",
        project: `${forbiddenToken(3)} ${forbiddenToken(4)} follow-up`,
        runtime: "codex",
        sessionId: `session:${forbiddenToken(0)}-${forbiddenToken(2)}`,
        title: `${forbiddenToken(1)} import review`
      })
    ]
  });

  expect(text).toContain("Selected sessions:");
  expect(text).toContain("Session:");
  expect(text).toContain("project:");
  const selectedSection = text.slice(text.indexOf("Selected sessions:"));
  expect(selectedSection).not.toContain(forbiddenToken(1));
  expect(selectedSection).not.toContain(forbiddenToken(2));
  expect(selectedSection).not.toContain(forbiddenToken(3));
  expect(selectedSection).not.toContain(forbiddenToken(4));
});

test("sanitizes forbidden substrings case-insensitively", () => {
  const text = buildWorkbenchHandoff({
    sessions: [
      session({
        lifecycle: "ended",
        lastActivityAt: "2026-07-08T12:00:00.000Z",
        project: `${forbiddenToken(3).toUpperCase()} review`,
        runtime: "codex",
        sessionId: `session:${forbiddenToken(4).toUpperCase()}`,
        title: [
          forbiddenToken(0).toUpperCase(),
          forbiddenToken(1).toUpperCase(),
          forbiddenToken(2).toUpperCase()
        ].join(" ")
      })
    ]
  });

  const selectedSection = text.slice(text.indexOf("Selected sessions:"));
  expect(selectedSection).not.toMatch(forbiddenPattern(1));
  expect(selectedSection).not.toMatch(forbiddenPattern(2));
  expect(selectedSection).not.toMatch(forbiddenPattern(3));
  expect(selectedSection).not.toMatch(forbiddenPattern(4));
});

function session(overrides: Partial<WorkbenchQueueSessionDto>): WorkbenchQueueSessionDto {
  return {
    activeClaim: undefined,
    bugFixTraceStatus: "unknown",
    lastActivityAt: "2026-07-08T12:00:00.000Z",
    latestActivity: undefined,
    lifecycle: "ended",
    nextAction: "check_transcript",
    project: "Masthead",
    publicationStatus: "publish_path",
    qualityStatus: "unchecked",
    runtime: "codex",
    sessionDossierStatus: "missing",
    sessionEnrichmentStatus: "missing",
    sessionId: "session:abc",
    title: "Workbench session",
    transcriptStatus: "unchecked",
    ...overrides
  };
}
