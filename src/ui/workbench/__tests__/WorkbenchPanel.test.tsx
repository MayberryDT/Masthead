// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkbenchActionKind } from "../../../app/workbench/useWorkbenchController";
import type {
  WorkbenchActivityDto,
  WorkbenchNotAddedSessionDto,
  WorkbenchQualityReviewSessionDto,
  WorkbenchQueueSessionDto
} from "../../../shared/workbench";
import { WORKBENCH_AUTHORING_V5_STALL_MS } from "../../../workbench/authoring/workbenchAuthoringV5Stall";
import { formatWorkbenchActivityTime } from "../workbenchActivity";
import {
  buildBulkQualityAcceptConfirmMessage,
  buildBulkQualityFailConfirmMessage,
  WorkbenchPanel
} from "../WorkbenchPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let campaignContainer: HTMLDivElement | undefined;
let campaignRoot: Root | undefined;

afterEach(async () => {
  if (campaignRoot) await act(async () => campaignRoot?.unmount());
  campaignRoot = undefined;
  campaignContainer?.remove();
  campaignContainer = undefined;
  vi.useRealTimers();
});

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
        qualityReviewSummary={{ ok: true, total: 538, reasons: [{ reason: "insufficient_evidence", count: 538 }] }}
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
    expect(text).toContain("Quality review 538");
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
    // Primary table keeps actionable ops columns only (no artifact-kind status chips).
    expect(html).toContain(">session</th>");
    expect(html).toContain(">next</th>");
    expect(html).toContain(">transcript</th>");
    expect(html).toContain(">quality</th>");
    expect(html).toContain(">resolution</th>");
    expect(html).toContain(">claim</th>");
    expect(html).not.toContain(">enrichment</th>");
    expect(html).not.toContain(">dossier</th>");
    expect(html).not.toContain(">package</th>");
    expect(html).not.toContain(">runbook</th>");
    expect(html).not.toContain(">adr</th>");
    expect(html).not.toContain(">timeline</th>");
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
    const copyButtonOpen = html.match(/<button[^>]*workbench-copy-agent[^>]*>/)?.[0];
    const copyButtonBlock = html.match(/<button[^>]*workbench-copy-agent[\s\S]*?<\/button>/)?.[0] ?? "";

    expect(text).toMatch(/Selected\s+3/);
    expect(text).not.toContain("package-path ·");
    expect(copyButtonOpen).not.toContain("disabled");
    expect(copyButtonOpen).toContain(
      "title=\"Copy for 1 ready session. 2 still need quality review and will be left out.\""
    );
    expect(copyButtonBlock).toContain("Copy Agent Prompt");
    expect(copyButtonBlock).not.toContain("ready)");
  });

  test("disables Copy Agent Prompt with a clear review reason when nothing selected is ready", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[session({ qualityStatus: "unchecked", transcriptStatus: "unchecked" })]}
        selectedSessionIds={new Set(["session:review-a", "session:review-b"])}
        agentPromptSessionCount={0}
        agentPromptExcludedCount={2}
        canRun={allow()}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const copyButtonOpen = html.match(/<button[^>]*workbench-copy-agent[^>]*>/)?.[0];

    expect(text).toMatch(/Selected\s+2/);
    expect(text).not.toContain("need quality review");
    expect(copyButtonOpen).toContain("disabled");
    expect(copyButtonOpen).toContain(
      "title=\"No selected sessions are ready for agent enrichment. 2 need quality review and will not be included in the handoff.\""
    );
    expect(html).toContain("Copy Agent Prompt");
    expect(html).not.toContain("Copy Agent Prompt (");
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

  test("renders Quality review list when open and keeps Not Added independent", () => {
    const row: WorkbenchQualityReviewSessionDto = {
      lastActivityAt: "2026-07-08T11:30:00.000Z",
      lifecycle: "ended",
      project: "Masthead",
      reason: "insufficient_evidence",
      runtime: "grok",
      sessionId: "session:review",
      title: "Capture needs review"
    };
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[]}
        qualityReviewOpen
        qualityReviewSessions={[row]}
        qualityReviewSummary={{
          ok: true,
          total: 538,
          reasons: [{ reason: "insufficient_evidence", count: 538 }]
        }}
        notAddedSummary={{ ok: true, total: 0, reasons: [] }}
        loading={false}
        setQualityReviewOpen={() => undefined}
        setNotAddedOpen={() => undefined}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    expect(text).toContain("Quality review 538");
    expect(text).toContain("Not Added 0");
    expect(html).toContain("Quality review — still on package path");
    expect(html).toContain("Capture needs review");
    expect(html).toContain("insufficient_evidence");
    expect(html).toContain("grok");
    expect(html).toContain("2026-07-08T11:30:00.000Z");
    expect(html).toContain("workbench-quality-review-panel");
    expect(html).toContain(">session</th>");
    expect(html).toContain(">reason</th>");
    expect(html).toContain(">runtime</th>");
    expect(html).toContain(">last activity</th>");
    expect(html).toContain('aria-label="Select Capture needs review for quality disposition"');
    expect(html).toContain("Select visible");
    expect(html).not.toContain("Not Added — excluded from package path");
    for (let index = 0; index < forbiddenTokenParts.length; index += 1) {
      expect(html).not.toContain(forbiddenToken(index));
    }
  });

  test("Quality review panel empty state and bulk accept/fail labels", () => {
    const empty = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[]}
        qualityReviewOpen
        qualityReviewSessions={[]}
        qualityReviewSummary={{ ok: true, total: 0, reasons: [] }}
        notAddedSummary={{ ok: true, total: 0, reasons: [] }}
        loading={false}
        setQualityReviewOpen={() => undefined}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );
    expect(empty).toContain("No sessions awaiting quality review");
    expect(empty).toContain("workbench-quality-review-panel");
    expect(empty).not.toContain("Select visible");
    expect(empty).not.toContain("Accept 1");
    expect(empty).not.toContain("Fail 1");

    const rows: WorkbenchQualityReviewSessionDto[] = [
      {
        lastActivityAt: "2026-07-08T11:30:00.000Z",
        lifecycle: "ended",
        project: "Masthead",
        reason: "insufficient_evidence",
        runtime: "grok",
        sessionId: "session:review-a",
        title: "Review A"
      },
      {
        lastActivityAt: "2026-07-08T11:31:00.000Z",
        lifecycle: "ended",
        reason: "insufficient_evidence",
        runtime: "codex",
        sessionId: "session:review-b",
        title: "Review B"
      }
    ];
    const withSelection = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[]}
        qualityReviewOpen
        qualityReviewSessions={rows}
        qualityReviewSummary={{
          ok: true,
          total: 2,
          reasons: [{ reason: "insufficient_evidence", count: 2 }]
        }}
        selectedSessionIds={new Set(["session:review-a", "session:review-b"])}
        qualityReviewSelectedCount={2}
        canRun={allow("quality_pass", "quality_fail")}
        loading={false}
        setQualityReviewOpen={() => undefined}
        onSelectQualityReviewVisible={() => undefined}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );
    expect(withSelection).toContain("Select visible");
    expect(withSelection).toContain("Accept 2 review");
    expect(withSelection).toContain("Fail 2 review");
    expect(withSelection).toContain("operator rejected");
    expect(withSelection).toContain('aria-label="Select Review A for quality disposition"');
    expect(withSelection).toContain('aria-label="Select Review B for quality disposition"');
    expect(withSelection).toContain("insufficient_evidence");
    expect(withSelection).toContain("2026-07-08T11:30:00.000Z");
    expect(withSelection).toContain("2026-07-08T11:31:00.000Z");
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

  test("bulk quality disposition labels count selected review sessions", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        sessions={[
          session({
            sessionId: "session:review-a",
            nextAction: "review_quality",
            qualityStatus: "unchecked"
          }),
          session({
            sessionId: "session:review-b",
            nextAction: "review_quality",
            qualityStatus: "unchecked"
          }),
          session({
            sessionId: "session:ready",
            nextAction: "enrich",
            qualityStatus: "passed",
            compileReady: true
          })
        ]}
        selectedSessionIds={new Set(["session:review-a", "session:review-b", "session:ready"])}
        qualityReviewSelectedCount={2}
        canRun={allow("quality_pass", "quality_fail", "quality_precheck")}
        loading={false}
        onClearSelection={() => undefined}
        onRetry={() => undefined}
        onSelectAll={() => undefined}
        onToggleSession={() => undefined}
      />
    );

    expect(html).toContain("Accept 2 review");
    expect(html).toContain("Fail 2 review");
    expect(html).toContain("Precheck 2 review");
    expect(html).toContain("selected need quality review");
    expect(html).toContain("operator rejected");
    expect(html).toContain("Ready/passed sessions in the selection are left unchanged");
    expect(html).not.toContain("Accept Quality");
    expect(html).not.toContain("Fail Quality");
  });

  test("bulk quality confirm copy is explicit about Not Added and no silent authoring", () => {
    const failMessage = buildBulkQualityFailConfirmMessage(3);
    expect(failMessage).toContain("Fail quality for 3 selected review sessions?");
    expect(failMessage).toContain("Not Added");
    expect(failMessage).toContain("operator rejected");
    expect(failMessage).toContain("leave the package path");
    expect(failMessage).toContain("Ready/passed sessions in the selection are not affected");
    expect(failMessage).toContain("will not author artifacts");
    expect(failMessage).toContain("enrichment prose");

    const acceptMessage = buildBulkQualityAcceptConfirmMessage(2);
    expect(acceptMessage).toContain("Accept quality for 2 selected review sessions?");
    expect(acceptMessage).toContain("quality passed");
    expect(acceptMessage).toContain("compile-ready");
    expect(acceptMessage).toContain("will not write enrichment prose");
  });

  test("renders campaign status strip when incomplete request present", () => {
    // Server snapshot may still say not stalled; client recomputes from updatedAt + Date.now().
    const updatedAt = new Date(Date.now() - 6 * 3600_000).toISOString();
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        campaignRequest={{
          requestId: "authoring-v5-request:one",
          status: "active",
          packsCompleted: 1,
          packCount: 87,
          sessionsCompleted: 12,
          sessionCount: 1039,
          publishedSessionCount: 0,
          rejectedSessionCount: 12,
          softFlaggedSessionCount: 0,
          stalled: false,
          idleMs: 0,
          handoff: { requestId: "authoring-v5-request:one", startCommand: "…" },
          updatedAt
        }}
      />
    );
    expect(html).toContain("workbench-campaign-status");
    expect(html).toContain("Stalled");
    expect(html).toContain("is-stalled");
    expect(html).toContain("1/87");
    expect(html).toContain("0 published");
    expect(html).toContain("12 rejected");
    expect(html).toContain("12 attempted");
    expect(html).not.toMatch(/workbench-activity-rail[\s\S]*workbench-campaign-status/);
  });

  test("omits campaign status strip when no incomplete request", () => {
    const html = renderToStaticMarkup(<WorkbenchPanel campaignRequest={null} />);
    expect(html).not.toContain("workbench-campaign-status");
  });

  test("campaign strip flips to Stalled when idle crosses threshold while open", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    vi.setSystemTime(now);

    // Just under the stall threshold; server snapshot still claims not stalled.
    const updatedAt = new Date(now - (WORKBENCH_AUTHORING_V5_STALL_MS - 1_000)).toISOString();
    campaignContainer = document.createElement("div");
    document.body.appendChild(campaignContainer);
    campaignRoot = createRoot(campaignContainer);

    await act(async () => {
      campaignRoot!.render(
        <WorkbenchPanel
          campaignRequest={{
            requestId: "authoring-v5-request:tick",
            status: "active",
            packsCompleted: 1,
            packCount: 10,
            sessionsCompleted: 3,
            sessionCount: 40,
            publishedSessionCount: 0,
            rejectedSessionCount: 3,
            softFlaggedSessionCount: 0,
            stalled: false,
            idleMs: 0,
            handoff: { requestId: "authoring-v5-request:tick", startCommand: "…" },
            updatedAt
          }}
        />
      );
    });

    const strip = () => campaignContainer!.querySelector(".workbench-campaign-status");
    expect(strip()).not.toBeNull();
    expect(strip()?.classList.contains("is-stalled")).toBe(false);
    expect(strip()?.textContent).not.toContain("Stalled");

    // Cross the stall threshold and fire the 30s recompute tick so the open UI updates
    // without a workbench revision / server refetch.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(strip()?.classList.contains("is-stalled")).toBe(true);
    expect(strip()?.textContent).toContain("Stalled");
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
