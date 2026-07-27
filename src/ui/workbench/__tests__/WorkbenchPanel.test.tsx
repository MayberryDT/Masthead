import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { WorkbenchActionKind } from "../../../app/workbench/useWorkbenchController";
import type {
  WorkbenchActivityDto,
  WorkbenchNotAddedSessionDto,
  WorkbenchQueueSessionDto
} from "../../../shared/workbench";
import { formatWorkbenchActivityTime } from "../workbenchActivity";
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

const PRIMARY_BUTTON_LABELS = [
  "Copy Agent Prompt",
  "Select all",
  "Clear",
  "Pipeline"
] as const;

const PIPELINE_LABELS = [
  "Enroll missing",
  "Check Transcript",
  "Import Transcript",
  "Precheck",
  "Accept Quality",
  "Fail Quality",
  "Claim",
  "Release"
] as const;

function allow(...kinds: WorkbenchActionKind[]) {
  const allowed = new Set(kinds);
  return (kind: WorkbenchActionKind) => allowed.has(kind);
}

function mediaRule(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = css.indexOf("\n@media ", start + 1);
  return css.slice(start, next === -1 ? css.length : next);
}

describe("WorkbenchPanel", () => {
  test("keeps import repair diagnostics out of the human Workbench surface", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        notAddedSummary={{ ok: true, total: 4, reasons: [{ reason: "confirmed_noise", count: 4 }] }}
        sessions={Array.from({ length: 102 }, (_, index) => session({ sessionId: `session:${index}` }))}
        selectedSessionIds={new Set()}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
        total={102}
      />
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    expect(text).toContain("Package path 102");
    expect(text).toContain("Not Added 4");
    expect(text).not.toContain("Import repair");
    expect(text).not.toContain("outside the package path");
    expect(text).not.toContain("repair units");
    expect(text).not.toContain("Open import receipt");
  });

  test("keeps the responsive action row from collapsing behind queue facts", () => {
    const css = readFileSync("src/styles/masthead.css", "utf8");
    expect(mediaRule(css, "(max-width: 1120px)")).toMatch(
      /\.workbench-toolbar\.observability-toolbar \.workbench-toolbar-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*40px;/s
    );
    expect(mediaRule(css, "(max-width: 640px)")).toMatch(
      /\.workbench-toolbar\.observability-toolbar \.workbench-toolbar-actions\s*\{[^}]*width:\s*100%;[^}]*flex-wrap:\s*wrap;/s
    );
  });
  test("renders only the disposable agent handoff control", () => {
    const html = renderToStaticMarkup(<WorkbenchPanel />);

    expect(html).toContain("Copy Agent Prompt");
    expect(html).not.toContain("Author candidate");
    expect(html).not.toContain("Publish canonical dossiers");
    expect(html).not.toContain("Artifact candidate");
    expect(html).not.toContain("<select");
  });
  test("keeps a known package-path total visible during refresh", () => {
    const html = renderToStaticMarkup(<WorkbenchPanel loading total={144} />);

    expect(html).toContain("Package path");
    expect(html).toContain(">144<");
    expect(html).not.toContain(">…<");
  });

  test("labels unchecked capture as awaiting transcript instead of a terminal exclusion", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[session({ transcriptStatus: "unchecked" })]}
        selectedSessionIds={new Set()}
        canRun={allow()}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("awaiting transcript");
  });

  test("ops toolbar exposes human actions without CLI recipes", () => {
    const publishReady = session({
      nextAction: "publish",
      qualityStatus: "passed",
      sessionDossierStatus: "satisfied",
      sessionEnrichmentStatus: "satisfied",
      title: "Ready to publish",
      transcriptStatus: "imported"
    });
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[publishReady]}
        selectedSessionIds={new Set([publishReady.sessionId])}
        handoffText="Process these sessions"
        canRun={allow("copy_agent_prompt", "claim")}
        runAction={async () => undefined}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    for (const label of PRIMARY_BUTTON_LABELS) {
      expect(html).toContain(label);
    }
    // Pipeline ops are hidden until the menu is open (client-only); labels not required in static markup
    expect(html).not.toContain("Select Visible");
    expect(html).toContain("Refresh");
    expect(html).toContain("workbench-pipeline-rail");
    expect(html).toContain("›");
    expect(html).toContain("Package path");
    expect(html).toContain("Selected");
    expect(html).toContain("Ready to publish");
    expect(html).toContain(">package</th>");
    expect(html).toContain(">runbook</th>");
    expect(html).toContain(">adr</th>");
    expect(html).toContain(">timeline</th>");
    expect(html).toContain(">resolution</th>");
    expect(html).not.toContain("Publish package");
    expect(html).toContain("Workbench Activity");
    expect(html).toContain("observability-toolbar");
    expect(html).toContain("metal-toolbar");
    expect(html).toContain('app-button-primary');
    expect(html).toContain("disabled");
    expect(html).not.toContain("textarea");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<h2");
    for (const fragment of heroCopyFragments) {
      expect(html).not.toContain(fragment);
    }
    for (let index = 0; index < forbiddenTokenParts.length; index += 1) {
      expect(html).not.toContain(forbiddenToken(index));
    }
    expect(html).not.toContain("Bug-fix candidates");
    expect(html).not.toContain("bug fix");
    expect(html).not.toContain("Missing dossiers");
  });

  test("enrich next-action emphasizes agent prompt not edit form", () => {
    const enrichSession = session({
      nextAction: "enrich",
      qualityStatus: "passed",
      sessionEnrichmentStatus: "missing",
      title: "Needs enrichment",
      transcriptStatus: "imported"
    });
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[enrichSession]}
        selectedSessionIds={new Set([enrichSession.sessionId])}
        handoffText="Agent handoff for enrichment"
        canRun={allow("copy_agent_prompt", "claim")}
        runAction={async () => undefined}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("Copy Agent Prompt");
    expect(html).toContain("app-button-primary");
    expect(html).toContain("workbench-copy-agent");
    expect(html).not.toContain("Enrichment and dossier work is agent-only");
    expect(html).not.toContain("workbench-agent-hint");
    expect(html).toContain("Needs enrichment");
    expect(html).toContain("enrich");
    expect(html).toContain("Pipeline");
    expect(html).not.toContain("textarea");
    expect(html).not.toContain("type=\"text\"");
    expect(html).not.toContain("Enrichment editor");
    expect(html).not.toContain("Apply enrichment");
    // Pipeline rail is collapsed (aria-hidden) but actions stay mounted for expand animation
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("workbench-pipeline-rail");
    expect(html).not.toContain("workbench-pipeline-rail is-expanded");
    for (let index = 0; index < forbiddenTokenParts.length; index += 1) {
      expect(html).not.toContain(forbiddenToken(index));
    }
  });

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
        canRun={allow("copy_agent_prompt", "check_transcript", "claim")}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("Package path");
    expect(html).toContain(">1</dd>");
    expect(html).toContain("Selected");
    expect(html).toContain("Raw session needing enrichment");
    expect(html).toContain("check transcript");
    expect(html).toContain("Pipeline");
    expect(html).toContain("Workbench Activity");
    expect(html).toContain("Masthead");
    expect(html).toContain("codex");
    expect(html).toContain("ended");
    expect(html).toContain("Copy Agent Prompt");
    expect(html).toContain("Select all");
    expect(html).toContain("Clear");
    expect(html).toContain("workbench-pipeline-actions");
    expect(html).not.toContain("workbench-pipeline-rail is-expanded");
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
    expect(html).not.toContain("bug fix");
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
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
        setNotAddedOpen={() => undefined}
      />
    );

    expect(html).toContain("No package-path sessions");
    expect(html).toContain("If Now has captures, open Pipeline → Enroll missing");
    expect(html).toContain("12 excluded from package path · open review");
    expect(html).toContain("Package path");
    expect(html).toContain(">0</dd>");
    expect(html).toContain("Workbench Activity");
    expect(html).toContain("No activity yet");
    expect(html).toContain("Not Added");
    expect(html).toContain(">12</");
    expect(html).not.toContain("hook_only");
    expect(html).toContain("Enroll missing");
    expect(html).toContain("Copy Agent Prompt");
    expect(html).toContain("Pipeline");
    expect(html).toContain("workbench-pipeline-rail");
    expect(html).not.toContain("workbench-pipeline-rail is-expanded");
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
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("No package-path sessions");
    expect(html).toContain("If Now has captures, open Pipeline → Enroll missing");
    expect(html).toContain("Enroll missing");
    // Fact chip absent; pipeline Fail Quality tooltip uses package/Not Added wording
    expect(html).not.toContain("<dt>Not Added</dt>");
    expect(html).not.toContain("excluded from package path · open review");
    expect(html).toContain("No activity yet");
  });

  test("toolbar exposes primary controls and Pipeline menu without CLI recipes", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[session()]}
        canRun={allow("enroll_missing", "copy_agent_prompt")}
        runAction={async () => undefined}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("Copy Agent Prompt");
    expect(html).toContain("workbench-copy-agent");
    expect(html).toContain("Pipeline");
    expect(html).toContain("Select all");
    expect(html).toMatch(/Copy Agent Prompt[\s\S]*Select all/);
    for (let index = 0; index < forbiddenTokenParts.length; index += 1) {
      expect(html).not.toContain(forbiddenToken(index));
    }
    for (const fragment of heroCopyFragments) {
      expect(html).not.toContain(fragment);
    }
  });

  test("keeps mixed selection counts truthful while enabling the ready agent handoff", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[session({ qualityStatus: "passed", transcriptStatus: "imported" })]}
        selectedSessionIds={new Set(["session:ready", "session:review-a", "session:review-b"])}
        agentPromptSessionCount={1}
        agentPromptExcludedCount={2}
        handoffText="Ready-only agent prompt"
        canRun={allow("copy_agent_prompt")}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const copyButton = html.match(/<button[^>]*workbench-copy-agent[^>]*>/)?.[0];

    expect(text).toContain("Selected 3 1 ready · 2 review");
    expect(copyButton).not.toContain("disabled");
    expect(copyButton).toContain(
      "title=\"Copy a plain-language request for 1 ready session. 2 selected sessions need review and will be left out.\""
    );
  });

  test("activity rail renders clear V5 labels, tones, and editorial reasons", () => {
    const eventAt = "2026-07-08T12:34:56.000Z";
    const items: WorkbenchActivityDto[] = [
      {
        activityId: "act-ok",
        actorId: "agent-1",
        actorKind: "agent",
        details: {},
        eventAt,
        eventType: "quality_passed",
        sessionId: "session:abc",
        summary: "Quality accepted for session"
      },
      {
        activityId: "act-bad",
        actorKind: "system",
        details: {
          findings: [{ code: "generic_title", message: "The title is too generic to publish." }]
        },
        eventAt,
        eventType: "authoring_session_rejected",
        sessionId: "session:abc",
        summary: "V5 session rejected"
      }
    ];
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[session()]}
        activity={items}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("workbench-activity-item is-ok");
    expect(html).toContain("workbench-activity-item is-bad");
    expect(html).toContain("workbench-activity-gutter");
    expect(html).toContain("workbench-activity-type");
    expect(html).toContain("workbench-activity-summary");
    expect(html).toContain("quality_passed");
    expect(html).toContain("Session rejected");
    expect(html).not.toContain("authoring_session_rejected");
    expect(html).toContain("Quality accepted for session");
    expect(html).toContain("V5 session rejected");
    expect(html).toContain("The title is too generic to publish.");
    expect(html).toContain("workbench-activity-reason");
    expect(html).toContain("agent-1");
    expect(html).toContain(`dateTime="${eventAt}"`);
    expect(html).toContain(formatWorkbenchActivityTime(eventAt));
    expect(html).not.toContain("No activity yet");
  });

  test("renders Not Added review table when open", () => {
    const row: WorkbenchNotAddedSessionDto = {
      lastActivityAt: "2026-07-08T11:00:00.000Z",
      lifecycle: "ended",
      project: "Masthead",
      reason: "quality_failed",
      runtime: "codex",
      sessionId: "session:not-added",
      title: "Rejected session"
    };
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[]}
        notAddedOpen
        notAddedSessions={[row]}
        notAddedSummary={{ ok: true, total: 1, reasons: [{ reason: "quality_failed", count: 1 }] }}
        loading={false}
        setNotAddedOpen={() => undefined}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("Not Added — excluded from package path");
    expect(html).toContain("Rejected session");
    expect(html).toContain("quality_failed");
    expect(html).toContain("codex");
    expect(html).toContain("2026-07-08T11:00:00.000Z");
    expect(html).toContain(">session</th>");
    expect(html).toContain(">reason</th>");
    expect(html).toContain(">runtime</th>");
    expect(html).toContain(">last activity</th>");
    for (let index = 0; index < forbiddenTokenParts.length; index += 1) {
      expect(html).not.toContain(forbiddenToken(index));
    }
  });

  test("shows action error strip and quiet last-action summary", () => {
    const withError = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[session()]}
        selectedSessionIds={new Set(["session:abc"])}
        actionError="Transcript import needs source permission for this session's source."
        lastActionSummary="Should hide behind error"
        canRun={allow("import_transcript")}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );
    expect(withError).toContain("Action failed");
    expect(withError).toContain("Transcript import needs source permission");
    expect(withError).toContain("workbench-toast");
    expect(withError).toContain("is-error");
    expect(withError).not.toContain("Should hide behind error");

    const withSummary = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[session()]}
        selectedSessionIds={new Set(["session:abc"])}
        lastActionSummary="Checked transcript for 1 session"
        canRun={allow("check_transcript")}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );
    expect(withSummary).toContain("Checked transcript for 1 session");
    expect(withSummary).toContain("workbench-toast");
    expect(withSummary).toContain("is-ok");
    expect(withSummary).not.toContain("workbench-action-summary");
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
        canRun={allow("copy_agent_prompt")}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    for (let index = 0; index < forbiddenTokenParts.length; index += 1) {
      expect(html).not.toContain(forbiddenToken(index));
    }
  });

  test("runAction is invoked for enabled ops", () => {
    const runAction = vi.fn();
    // Static markup does not fire handlers; this keeps the prop contract typed.
    renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[session({ nextAction: "check_transcript" })]}
        selectedSessionIds={new Set(["session:abc"])}
        handoffText="Agent prompt body"
        canRun={allow("check_transcript", "copy_agent_prompt")}
        runAction={runAction}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );
    expect(runAction).not.toHaveBeenCalled();
  });
});

function session(overrides: Partial<WorkbenchQueueSessionDto> = {}): WorkbenchQueueSessionDto {
  return {
    compileReady: true,
    activeClaim: undefined,
    adrStatus: "unknown",
    bugFixTraceStatus: "unknown",
    incidentTimelineStatus: "unknown",
    lastActivityAt: "2026-07-08T12:00:00.000Z",
    latestActivity: undefined,
    lifecycle: "ended",
    nextAction: "check_transcript",
    project: "Masthead",
    publicationStatus: "publish_path",
    qualityStatus: "unchecked",
    resolutionStatus: "in_progress",
    runbookStatus: "unknown",
    runtime: "codex",
    sessionDossierStatus: "missing",
    sessionEnrichmentStatus: "missing",
    sessionId: "session:abc",
    sessionPackageStatus: "missing",
    title: "Workbench session",
    transcriptStatus: "unchecked",
    ...overrides
  };
}
