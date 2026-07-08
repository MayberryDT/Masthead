import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { WorkbenchQueueSessionDto } from "../../../shared/workbench";
import { WorkbenchPanel } from "../WorkbenchPanel";

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

const heroCopyFragments = [
  "Agent Workbench",
  "Choose raw sessions",
  "Handoff",
  "Get started",
  "How it works",
  "Run these commands",
  "CLI recipe",
  "onboarding"
] as const;

describe("WorkbenchPanel", () => {
  test("renders a session-first Workbench view without visible CLI strings", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[
          session({
            lifecycle: "ended",
            lastActivityAt: "2026-07-08T12:00:00.000Z",
            project: "Masthead",
            runtime: "codex",
            sessionId: "session:abc",
            title: "Raw session needing enrichment"
          })
        ]}
        selectedSessionIds={new Set(["session:abc"])}
        handoffText={"Masthead is running locally.\n- Raw session needing enrichment (session:abc)"}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAllVisible={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("Publish path");
    expect(html).toContain(">1</dd>");
    expect(html).toContain("Selected");
    expect(html).toContain("Raw session needing enrichment");
    expect(html).toContain("check transcript");
    expect(html).toContain("Workbench Activity");
    expect(html).toContain("Masthead");
    expect(html).toContain("codex");
    expect(html).toContain("ended");
    expect(html).toContain("Copy Agent Prompt");
    expect(html).toContain("Select Visible");
    expect(html).toContain("Clear");
    expect(html).toContain("Refresh");
    expect(html).toContain("observability-toolbar");
    expect(html).toContain("metal-toolbar");
    expect(html).not.toContain("textarea");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<h2");
    for (const fragment of heroCopyFragments) {
      expect(html).not.toContain(fragment);
    }
    expect(html).not.toContain(forbiddenToken(0));
    expect(html).not.toContain(forbiddenToken(1));
    expect(html).not.toContain(forbiddenToken(2));
    expect(html).not.toContain(forbiddenToken(3));
    expect(html).not.toContain(forbiddenToken(4));
    expect(html).not.toContain("Bug-fix candidates");
    expect(html).not.toContain("Missing dossiers");
  });

  test("renders an intentional empty ops state without hero or CLI copy", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[]}
        activity={[]}
        notAddedSummary={{ ok: true, total: 12, reasons: [{ reason: "hook_only", count: 12 }] }}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAllVisible={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("No publish-path sessions");
    expect(html).toContain("Publish path");
    expect(html).toContain(">0</dd>");
    expect(html).toContain("Workbench Activity");
    expect(html).toContain("No activity yet");
    expect(html).toContain("Not Added to Logbook");
    expect(html).toContain(">12</dd>");
    expect(html).not.toContain("hook_only");
    expect(html).toContain("Copy Agent Prompt");
    expect(html).toContain("workbench-activity-rail");
    expect(html).not.toContain("workbench-reason-list");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("textarea");
    for (const fragment of heroCopyFragments) {
      expect(html).not.toContain(fragment);
    }
    for (let index = 0; index < forbiddenTokenParts.length; index += 1) {
      expect(html).not.toContain(forbiddenToken(index));
    }
  });

  test("empty state omits Not Added total when summary is absent", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[]}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAllVisible={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("No publish-path sessions");
    expect(html).not.toContain("Not Added to Logbook");
    expect(html).toContain("No activity yet");
  });

  test("sanitizes forbidden session metadata before rendering the panel", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[
          session({
            lifecycle: "ended",
            lastActivityAt: "2026-07-08T12:00:00.000Z",
            project: `${forbiddenToken(3)} follow-up`,
            runtime: `${forbiddenToken(0)} runner`,
            sessionId: `session:${forbiddenToken(4)}`,
            title: `${forbiddenToken(1)} ${forbiddenToken(2)}`
          })
        ]}
        selectedSessionIds={new Set([`session:${forbiddenToken(4)}`])}
        handoffText={`Selected ${forbiddenToken(0)} ${forbiddenToken(1)} ${forbiddenToken(2)} ${forbiddenToken(3)} ${forbiddenToken(4)}`}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAllVisible={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    for (let index = 0; index < forbiddenTokenParts.length; index += 1) {
      expect(html).not.toContain(forbiddenToken(index));
    }
  });
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
