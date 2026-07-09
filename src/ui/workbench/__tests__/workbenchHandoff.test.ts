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

test("builds an agent handoff for automatic artifact completion without CLI recipes", () => {
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
  expect(text).toContain("Automatic completion loop");
  expect(text).toContain("session package");
  expect(text).toContain("runbook");
  expect(text).toContain("adr");
  expect(text).toContain("incident timeline");
  expect(text).toContain("strong join key");
  expect(text).toContain("session:abc");
  expect(text).toContain("Raw import session");
  expect(text).toContain("Apply is not publish");
  expect(text).not.toMatch(/mastheadctl/i);
  expect(text).not.toContain("node dist/daemon");
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
        project: "Masthead",
        runtime: "codex",
        sessionId: "session:abc",
        title: `${forbiddenToken(1).toUpperCase()} import review`
      })
    ]
  });
  const selectedSection = text.slice(text.indexOf("Selected sessions:"));
  expect(selectedSection).not.toMatch(new RegExp(forbiddenToken(1), "i"));
});

function session(input: Partial<WorkbenchQueueSessionDto> & Pick<WorkbenchQueueSessionDto, "sessionId" | "title" | "runtime" | "lifecycle" | "lastActivityAt">): WorkbenchQueueSessionDto {
  return {
    bugFixTraceStatus: "unknown",
    nextAction: "check_transcript",
    publicationStatus: "publish_path",
    qualityStatus: "unchecked",
    runbookStatus: "unknown",
    adrStatus: "unknown",
    incidentTimelineStatus: "unknown",
    sessionDossierStatus: "missing",
    sessionEnrichmentStatus: "missing",
    transcriptStatus: "unchecked",
    ...input
  };
}
