import { expect, test } from "vitest";
import { buildWorkbenchHandoff } from "../workbenchHandoff";

test("builds a V3 selection-scoped disposable handoff", () => {
  const sessions = Array.from({ length: 13 }, (_, index) => ({
    bugFixTraceStatus: "unknown" as const,
    lastActivityAt: "2026-07-14T12:00:00.000Z",
    lifecycle: "ended" as const,
    nextAction: "enrich" as const,
    publicationStatus: "publish_path" as const,
    qualityStatus: "passed" as const,
    runtime: "codex",
    sessionDossierStatus: "missing" as const,
    sessionEnrichmentStatus: "missing" as const,
    sessionId: `session:${index + 1}`,
    title: `Compile ready ${index + 1}`,
    transcriptStatus: "imported" as const
  }));
  const sessionIds = sessions.map((session) => session.sessionId);
  const text = buildWorkbenchHandoff({
    authoringCommand: "/home/test/.local/bin/mastheadctl",
    databaseId: "database:test",
    sessionIds,
    sessions
  });
  const machineLine = text.split("\n").find((line) => line.startsWith("{"));
  const request = JSON.parse(machineLine ?? "{}") as Record<string, unknown>;

  expect(text).toContain("Complete this Masthead Workbench request for every selected session.");
  expect(text).toContain("Enrich each session before publishing its dossier.");
  expect(text).toContain("Create only the runbooks, ADRs, or incident timelines");
  expect(text).toContain("partition them into bounded runs");
  expect(text).toContain("completing every selected session exactly once");
  expect(request).toMatchObject({
    protocol: "masthead.workbench.authoring/v1",
    bundleVersion: "workbench-authoring-v3",
    databaseId: "database:test",
    sessionIds,
    maxSessionsPerRun: 12,
    authoringTool: { command: "/home/test/.local/bin/mastheadctl" }
  });
});

test("sanitizes visible metadata without changing authoritative session IDs", () => {
  const text = buildWorkbenchHandoff({
    authoringCommand: "/home/test/.local/bin/mastheadctl",
    databaseId: "database:test",
    sessionIds: ["session:npm run"],
    sessions: [{
      bugFixTraceStatus: "unknown",
      lastActivityAt: "2026-07-14T12:00:00.000Z",
      lifecycle: "ended",
      nextAction: "enrich",
      publicationStatus: "publish_path",
      qualityStatus: "passed",
      runtime: "codex",
      sessionDossierStatus: "missing",
      sessionEnrichmentStatus: "missing",
      sessionId: "session:npm run",
      title: "Use schema.json then apply.sh",
      transcriptStatus: "imported"
    }]
  });
  const visible = text.slice(0, text.indexOf("Machine request:")) + text.slice(text.indexOf("Selected session metadata"));

  expect(visible).not.toContain("npm run");
  expect(visible).not.toContain("schema.json");
  expect(visible).not.toContain("apply.sh");
  expect(text).toContain('"sessionIds":["session:npm run"]');
});
