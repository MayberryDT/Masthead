// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { SessionDetailView } from "../../../core/types";
import type { SessionDossierDto } from "../../../shared/sessionDossier";
import { DossierTranscript } from "../DossierTranscript";
import { SessionDossier } from "../SessionDossier";
import { SessionDossierContent } from "../SessionDossierContent";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SessionDossier", () => {
  test("shares the original dossier evidence presentation without the modal shell", () => {
    const html = renderToStaticMarkup(
      <SessionDossierContent
        compactShell
        dossier={dossier()}
        transcript={{
          coverage: dossier().coverage.transcript,
          items: [],
          total: 0
        }}
      />
    );

    expect(html).toContain("Transcript evidence");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Tools");
    expect(html).toContain("Timeline");
    expect(html).not.toContain("session-dossier stage");
    expect(html).not.toContain("Close session dossier");
  });

  test("uses the selected prototype grid and scroll-window classes", () => {
    const css = readFileSync("src/styles/session-dossier.css", "utf8");
    const backdropRule = css.match(/\.session-dossier\s+\.backdrop\s*\{[^}]+\}/)?.[0] ?? "";
    const dossierRule = css.match(/\.session-dossier\s+\.dossier\s*\{[^}]+\}/)?.[0] ?? "";
    const gridRule = css.match(/\.session-dossier\s+\.content-grid\s*\{[^}]+\}/)?.[0] ?? "";
    const summaryRule = css.match(/\.session-dossier\s+\.summary\s*\{[^}]+\}/)?.[0] ?? "";
    const summaryScrollRule = css.match(/\.session-dossier\s+\.summary-scroll\s*\{[^}]+\}/)?.[0] ?? "";
    const advancedPanelRule = css.match(/\.session-dossier\s+\.advanced-details-panel\s*\{[^}]+\}/)?.[0] ?? "";
    const closeRule = css.match(/\.session-dossier\s+\.close\s*\{[^}]+\}/)?.[0] ?? "";

    expect(backdropRule).toContain("border: 0;");
    expect(backdropRule).toContain("background: transparent;");
    expect(dossierRule).toContain("max-height: calc(100vh - 48px);");
    expect(dossierRule).toContain("overflow-y: auto;");
    expect(gridRule).toContain("grid-template-areas:");
    expect(gridRule).toContain('"summary metrics"');
    expect(summaryRule).toContain("height: 626px;");
    expect(summaryScrollRule).toContain("overflow-y: auto;");
    expect(advancedPanelRule).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(closeRule).toContain("height: 30px;");
    expect(closeRule).toContain("min-height: 30px;");
  });

  test("moves token and coverage stats to a secondary diagnostics rail", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    const metricsRail = host.querySelector(".metrics");
    expect(metricsRail?.textContent).toContain("Source confidence");
    expect(metricsRail?.textContent).toContain("Total tokens");
    expect(metricsRail?.textContent).toContain("Input tokens");
    expect(metricsRail?.textContent).toContain("Output tokens");
    expect(metricsRail?.textContent).toContain("Usage rows");
    expect(metricsRail?.textContent).toContain("Attention rows");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const advancedHeadings = [...host.querySelectorAll(".advanced-details-panel .advanced-detail-card h4")].map((heading) => heading.textContent);
    expect(advancedHeadings).not.toContain("Token usage");
    expect(advancedHeadings).not.toContain("Review actions");
    expect(host.querySelectorAll(".advanced-details-panel .advanced-detail-card.is-compact")).toHaveLength(3);
    root.unmount();
  });

  test("orders enrichment as stats, signals, transcript summary, and first prompt", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    const panel = host.querySelector(".panel.summary");
    expect(panel?.querySelector("h3")?.textContent).toBe("Enrichment summary");
    const sections = [...(panel?.querySelectorAll("[data-dossier-section]") ?? [])].map((section) => section.getAttribute("data-dossier-section"));
    expect(sections.slice(0, 6)).toEqual(["summary", "latest-prompt", "retrieval", "continuation", "unresolved", "signals"]);
    expect(sections).toContain("diagnostic-coverage");
    expect(panel?.textContent).toContain("Diagnostic coverage");
    expect(panel?.textContent).toContain("System events");
    expect(panel?.textContent).not.toContain("Runtime signals");
    expect(panel?.textContent).not.toContain("Low-value rows");
    expect(panel?.textContent).not.toContain("Topics and signals");
    root.unmount();
  });

  test("renders durable title, summary, purpose, outcome, verification, and continuation before diagnostics", () => {
    const currentDossier = dossier();
    currentDossier.durableEnrichment = {
      sessionDossier: {
        blockers: [],
        continuation: {
          constraints: ["Keep diagnostics below durable memory."],
          nextStep: "Run the full Dossier verification suite.",
          openQuestions: []
        },
        decisions: ["Use durable memory before live transcript summary."],
        evidenceRefs: [],
        keyWork: ["Added durable Dossier work capsule."],
        outcome: "Dossier durable memory appears before diagnostics.",
        purpose: "Prioritize durable work memory in the Dossier.",
        verification: {
          commands: ["vitest"],
          evidenceRefs: [],
          failures: [],
          status: "passed",
          summary: "Dossier durable memory tests passed."
        },
        warnings: []
      },
      sessionSummary: {
        confidence: "high",
        evidenceRefs: [],
        state: "completed",
        text: "Moved durable Dossier purpose, outcome, verification, and continuation above diagnostics."
      },
      sessionTitle: {
        basis: "dominant_work",
        confidence: "high",
        evidenceRefs: [],
        text: "Durable Dossier memory priority"
      },
      version: "session-capsule-v4"
    };

    const html = renderToStaticMarkup(<SessionDossier dossier={currentDossier} />);
    const memoryIndex = html.indexOf('data-dossier-section="durable-memory"');
    const diagnosticIndex = html.indexOf('data-dossier-section="diagnostic-coverage"');

    expect(memoryIndex).toBeGreaterThan(-1);
    expect(diagnosticIndex).toBeGreaterThan(memoryIndex);
    expect(html).toContain("Durable Dossier memory priority");
    expect(html).toContain("Prioritize durable work memory in the Dossier.");
    expect(html).toContain("Dossier durable memory tests passed.");
    expect(html).toContain("Run the full Dossier verification suite.");
  });

  test("renders current Workbench artifacts in the enrichment summary", () => {
    const currentDossier = dossier();
    currentDossier.artifacts = [
      {
        artifactId: "artifact-1",
        artifactKind: "session_dossier",
        confidence: "medium",
        content: {
          outcome: "Workbench artifacts persist locally.",
          title: "Persist Workbench dossier"
        },
        createdAt: "2026-06-25T23:15:00.000Z",
        evidenceRefs: ["message:canonical-session-1:message"],
        status: "current",
        title: "Persist Workbench dossier",
        updatedAt: "2026-06-25T23:15:00.000Z"
      }
    ];

    const html = renderToStaticMarkup(<SessionDossier dossier={currentDossier} />);

    expect(html).toContain("Workbench artifacts");
    expect(html).toContain("Persist Workbench dossier");
    expect(html).toContain("Session Dossier");
    expect(html).toContain("1 refs");
    expect(html).toContain("Workbench artifacts persist locally.");
  });

  test("renders durable memory as paragraphs instead of summary fact cards", () => {
    const currentDossier = dossier();
    currentDossier.durableEnrichment = {
      sessionDossier: {
        blockers: ["Missing saved live Google-auth state for PRD flow"],
        continuation: {
          constraints: [],
          nextStep: "Restore corrected launch-polish commit to production.",
          openQuestions: []
        },
        decisions: ["Proceed with restore plan after regression fix."],
        evidenceRefs: [],
        keyWork: ["Created launch-polish branches in two repos."],
        outcome: "Deployment changes implemented; production go/no-go pending live auth state.",
        purpose: "Document a durable record of the launch polish effort.",
        verification: {
          commands: [],
          evidenceRefs: [],
          failures: [],
          status: "mixed",
          summary: "Local and automated gates passed except paid flow proof."
        },
        warnings: []
      },
      sessionSummary: {
        confidence: "high",
        evidenceRefs: [],
        state: "completed",
        text: "Imported historical Pip session evidence with durable enrichment context."
      },
      sessionTitle: {
        basis: "dominant_work",
        confidence: "high",
        evidenceRefs: [],
        text: "Pip launch polish deploy session"
      },
      version: "session-capsule-v4"
    };

    const html = renderToStaticMarkup(<SessionDossier dossier={currentDossier} />);
    const memoryStart = html.indexOf('data-dossier-section="durable-memory"');
    const memoryEnd = html.indexOf('data-dossier-section="summary"', memoryStart);
    const memoryHtml = html.slice(memoryStart, memoryEnd);

    expect(memoryHtml).toContain("durable-paragraph");
    expect(memoryHtml).toContain("Document a durable record of the launch polish effort.");
    expect(memoryHtml).toContain("Proceed with restore plan after regression fix.");
    expect(memoryHtml).not.toContain("summary-grid");
    expect(memoryHtml).not.toContain("summary-fact");
  });

  test("uses neutral durable summary and plain-language retrieval notes in default dossier", () => {
    const currentDossier = dossier();
    currentDossier.narrative.finalAssistantMessage = "I found a precise root cause and fix: the app does not support hash routes, but it leaves #settings in the address bar.";
    currentDossier.reuse.copyableContext = ["# Masthead Session Context", "Canonical session: session:06850bab04dbc2101a3a380fd866b66d7", "Files:", "- src/app/App.tsx", "Tools:", "- shell: succeeded"].join("\n");
    currentDossier.durableEnrichment = {
      sessionDossier: {
        blockers: [],
        continuation: {
          constraints: ["Keep the visible Dossier copy in plain language."],
          nextStep: "Verify the Settings route opens without a lingering hash.",
          openQuestions: []
        },
        decisions: ["Use startup cleanup instead of supporting hash routes."],
        evidenceRefs: [],
        keyWork: ["Removed the unsupported Settings hash from the startup path."],
        outcome: "The Settings route no longer leaves an unsupported hash in the address bar.",
        purpose: "Clean up unsupported Settings hash routing.",
        verification: {
          commands: [],
          evidenceRefs: [],
          failures: [],
          status: "passed",
          summary: "App route behavior was verified."
        },
        warnings: []
      },
      sessionSummary: {
        confidence: "high",
        evidenceRefs: [],
        state: "completed",
        text: "The session cleaned up unsupported Settings hash routing and verified the app no longer leaves the hash behind."
      },
      sessionTitle: {
        basis: "dominant_work",
        confidence: "high",
        evidenceRefs: [],
        text: "Settings hash route cleanup"
      },
      version: "session-capsule-v4"
    };

    const html = renderToStaticMarkup(<SessionDossier dossier={currentDossier} />);

    expect(html).toContain("The session cleaned up unsupported Settings hash routing");
    expect(html).not.toContain("I found a precise root cause");
    expect(html).toContain("Clean up unsupported Settings hash routing.");
    expect(html).toContain("Removed the unsupported Settings hash from the startup path.");
    expect(html).toContain("Verify the Settings route opens without a lingering hash.");
    expect(html).not.toContain("# Masthead Session Context");
    expect(html).not.toContain("session:06850bab04dbc2101a3a380fd866b66d7");
    expect(html).not.toContain("src/app/App.tsx");
    expect(html).not.toContain("shell: succeeded");
  });

  test("keeps transcript filter loading state out of the enrichment summary", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SessionDossier
          dossier={dossier()}
          transcript={{
            coverage: dossier().coverage.transcript,
            items: [],
            total: 0
          }}
          transcriptLoading
        />
      );
    });

    const summary = host.querySelector(".panel.summary");
    const transcript = host.querySelector(".panel.transcript");
    expect(summary?.textContent).not.toContain("Transcript loading");
    expect(summary?.textContent).not.toContain("Loading transcript evidence");
    expect(transcript?.textContent).toContain("Loading transcript");
    root.unmount();
  });

  test("renders Dossier enrichment status without a native enrich action", () => {
    const currentDossier = dossier();
    currentDossier.enrichment = { status: "not_enriched" };

    const html = renderToStaticMarkup(<SessionDossier dossier={currentDossier} />);

    expect(html).toContain("Not enriched");
    expect(html).toContain("Workbench");
    expect(html).toContain("Use Workbench to prepare an agent handoff for this session.");
    expect(html).not.toContain("mastheadctl workbench");
    expect(html).not.toContain("--kind");
    expect(html).not.toContain("Enrich data");
    expect(html).not.toContain("dossier-enrich-button");
    expect(html).not.toContain("session-capsule-v4");
  });

  test("shows enrichment running as status text only", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} dossierEnrichmentBusy />);
    });

    expect(host.textContent).toContain("Enriching");
    expect(host.querySelector(".dossier-enrich-button")).toBeNull();
    root.unmount();
  });

  test("shows Dossier loading state in the enrichment header before dossier data arrives", () => {
    const html = renderToStaticMarkup(<SessionDossier loading />);

    expect(html).toContain("Loading");
    expect(html).not.toContain("Enrich data");
    expect(html).not.toContain("dossier-loading-state");
    expect(html).not.toContain("Loading canonical session dossier");
  });

  test("sanitizes forbidden Workbench artifact preview strings from rendered output", () => {
    const currentDossier = dossier();
    currentDossier.artifacts = [
      {
        artifactId: "artifact-forbidden-preview",
        artifactKind: "runbook",
        confidence: "high",
        content: {
          command: "mastheadctl workbench",
          files: ["output.json", "schema.json", "apply.sh"],
          notes: "Run npm run workbench before reviewing output.json."
        },
        createdAt: "2026-06-25T23:15:00.000Z",
        evidenceRefs: [],
        status: "current",
        title: "Forbidden preview strings",
        updatedAt: "2026-06-25T23:15:00.000Z"
      }
    ];

    const html = renderToStaticMarkup(<SessionDossier dossier={currentDossier} />);

    expect(html).toContain("Workbench artifacts");
    expect(html).toContain("Forbidden preview strings");
    expect(html).not.toContain("mastheadctl");
    expect(html).not.toContain("npm run");
    expect(html).not.toContain("output.json");
    expect(html).not.toContain("schema.json");
    expect(html).not.toContain("apply.sh");
  });

  test("does not render legacy capsule copy as current enrichment", () => {
    const legacy = dossier();
    legacy.durableEnrichment = undefined;
    legacy.enrichment = { status: "not_enriched" };
    legacy.identity.title = "Codex hook event";
    legacy.narrative.narrativeDebug = {
      model: "gpt-5-nano",
      promptVersion: "session-capsule-v2",
      provider: "openai",
      providerStatus: "success",
      sourceRefs: [],
      validationWarnings: []
    };
    legacy.narrative.liveSummary = "completed";
    legacy.narrative.outcome = "completed";

    const html = renderToStaticMarkup(<SessionDossier dossier={legacy} />);

    expect(html).toContain("Not enriched");
    expect(html).not.toContain("session-capsule-v2 / current");
    expect(html).not.toContain("<p>completed.</p>");
    expect(html).not.toContain("<p>completed</p>");
    expect(html).not.toContain('data-dossier-section="technologies"');
    expect(html).not.toContain("<span>auth</span>");
    expect(html).not.toContain("<strong>success</strong>");
    expect(html).not.toContain("<strong>Provider</strong><span>openai</span>");
  });

  test("uses enriched dossier values for evidence blocks instead of hard-coded topics", () => {
    const currentDossier = dossier();
    currentDossier.narrative.topics = ["local import", "session capsule"];
    currentDossier.narrative.technologies = ["vite"];
    currentDossier.narrative.unresolved = ["verification missing"];
    currentDossier.coverage.warnings = [{ code: "tool_details_partial", message: "Tool details are partial." }];

    const html = renderToStaticMarkup(<SessionDossier dossier={currentDossier} />);

    expect(html).toContain("local import");
    expect(html).toContain("session capsule");
    expect(html).toContain("Agent retrieval ready");
    expect(html).toContain("verification missing");
    expect(html).toContain("tool details partial");
    expect(html).not.toContain("launcher cleanup path patched");
    expect(html).toContain("Technologies");
    expect(html).toContain("vite");
  });

  test("uses the prototype transcript evidence rows instead of the old transcript panel frame", () => {
    const css = readFileSync("src/styles/session-dossier.css", "utf8");
    const transcriptScrollRule = css.match(/\.session-dossier\s+\.transcript-scroll\s*\{[^}]+\}/)?.[0] ?? "";
    const transcriptRule = css.match(/\.session-dossier\s+\.transcript\s+li\s*\{[^}]+\}/)?.[0] ?? "";
    const transcriptToolbarRule = css.match(/\.session-dossier\s+\.transcript-toolbar\s*\{[^}]+\}/)?.[0] ?? "";

    expect(transcriptScrollRule).toContain("height: 360px;");
    expect(transcriptScrollRule).toContain("overflow-y: auto;");
    expect(transcriptRule).toContain("grid-template-columns: 72px 112px minmax(0, 1fr);");
    expect(transcriptToolbarRule).toContain("justify-content: space-between;");
    expect(css).not.toContain(".dossier-panel-transcript");
  });

  test("keeps timeline and raw transcript as readable scroll windows", async () => {
    const css = readFileSync("src/styles/session-dossier.css", "utf8");
    const compactRule = css.match(/\.session-dossier\s+\.advanced-detail-card\.is-compact\s*\{[^}]+\}/)?.[0] ?? "";
    const scrollBodyRule = css.match(/\.session-dossier\s+\.advanced-scroll-body\s*\{[^}]+\}/)?.[0] ?? "";
    const timelineRule = css.match(/\.session-dossier\s+\.advanced-detail-card\.is-timeline\s*\{[^}]+\}/)?.[0] ?? "";
    const rawRule = css.match(/\.session-dossier\s+\.advanced-detail-card\.is-raw\s*\{[^}]+\}/)?.[0] ?? "";
    const host = document.createElement("div");
    const root = createRoot(host);
    const currentDossier = dossier();
    currentDossier.timeline = Array.from({ length: 32 }, (_, index) => ({
      eventId: `event-${index}`,
      kind: "tool" as const,
      label: "tool",
      observedAt: `2026-06-25T23:${String(index % 60).padStart(2, "0")}:00.000Z`,
      summary: `Command ${index}`
    }));

    await act(async () => {
      root.render(<SessionDossier dossier={currentDossier} />);
    });

    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector(".advanced-detail-card.is-timeline .advanced-scroll-body")).toBeTruthy();
    expect(host.querySelector(".advanced-detail-card.is-raw .advanced-scroll-body")).toBeTruthy();
    expect(compactRule).toContain("height: 112px;");
    expect(compactRule).toContain("overflow-y: auto;");
    expect(scrollBodyRule).toContain("overflow-y: auto;");
    expect(timelineRule).toContain("height: 360px;");
    expect(rawRule).toContain("height: 440px;");
    root.unmount();
  });

  test("keeps advanced details in the selected card order", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const advancedHeadings = [...host.querySelectorAll(".advanced-details-panel .advanced-detail-card h4")].map((heading) => heading.textContent);
    expect(advancedHeadings).toEqual(["Verification", "Needs attention", "Tools", "Provenance", "Narrative evidence", "Timeline", "Raw transcript"]);
    expect(host.textContent).not.toContain("Transcript excerpts");
    root.unmount();
  });

  test("caps dossier scroll surfaces instead of nesting panel scrollbars", () => {
    const css = readFileSync("src/styles/session-dossier.css", "utf8");
    const summaryScrollRule = css.match(/\.session-dossier\s+\.summary-scroll\s*\{[^}]+\}/)?.[0] ?? "";
    const transcriptScrollRule = css.match(/\.session-dossier\s+\.transcript-scroll\s*\{[^}]+\}/)?.[0] ?? "";
    const scrollBodyRule = css.match(/\.session-dossier\s+\.advanced-scroll-body\s*\{[^}]+\}/)?.[0] ?? "";
    const transcriptRule = css.match(/\.session-dossier\s+\.transcript\s+li\s*\{[^}]+\}/)?.[0] ?? "";

    expect(summaryScrollRule).toContain("overflow-y: auto;");
    expect(transcriptScrollRule).toContain("overflow-y: auto;");
    expect(scrollBodyRule).toContain("overflow-y: auto;");
    expect(transcriptRule).toContain("grid-template-columns: 72px 112px minmax(0, 1fr);");
  });

  test("keeps advanced card headers outside the scrollable bodies", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const panels = [...host.querySelectorAll(".advanced-detail-card.is-scroll-window")];
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((panel) => panel.children[0]?.classList.contains("advanced-scroll-head"))).toBe(true);
    expect(panels.every((panel) => panel.children[1]?.classList.contains("advanced-scroll-body"))).toBe(true);
    root.unmount();
  });

  test("renders canonical session evidence in the prototype modal structure", () => {
    const currentDossier = dossier();
    const html = renderToStaticMarkup(
      <SessionDossier
        dossier={currentDossier}
        transcript={{
          coverage: currentDossier.coverage.transcript,
          items: [
            {
              itemId: "message-1",
              kind: "message",
              label: "user",
              lowValue: false,
              observedAt: "2026-06-25T23:01:00.000Z",
              role: "user",
              sessionId: "canonical-session-1",
              sourceRef: {},
              text: "Please repair the OAuth callback."
            },
            {
              itemId: "file-effect-1",
              kind: "file_effect",
              label: "src/app/App.tsx",
              lowValue: false,
              observedAt: "2026-06-25T23:04:00.000Z",
              role: "tool",
              sessionId: "canonical-session-1",
              sourceRef: {},
              text: "src/app/App.tsx"
            }
          ],
          total: 2
        }}
      />
    );

    expect(html).toContain("Session identity");
    expect(html).not.toContain("<h3>Repair OAuth callback</h3>");
    expect(html).toContain("Total tokens");
    expect(html).toContain("Input tokens");
    expect(html).toContain("Output tokens");
    expect(html).toContain("Enrichment summary");
    expect(html).toContain("panel summary");
    expect(html).toContain("Transcript summary");
    expect(html).toContain("OAuth route still fails for missing state.");
    expect(html).not.toContain("Objective:");
    expect(html).not.toContain("Outcome:");
    expect(html).not.toContain(">Objective<");
    expect(html).not.toContain(">Outcome<");
    expect(html).toContain("Transcript");
    expect(html).toContain("panel transcript");
    expect(html).toContain("Transcript evidence");
    expect(html).toContain("Relevant transcript evidence");
    expect(html).not.toContain("filtered to useful card/prototype rows");
    expect(html).toContain("Please repair the OAuth callback.");
    expect(html).toContain("Advanced details");
    expect(html).toContain("meta-rail");
    expect(html).toContain("title-block");
    expect(html).toContain("app-button");
    expect(html).toContain("advanced-details-panel");
    expect(html).toContain('hidden=""');
    expect(html).not.toContain("dossier-hero-actions");
    expect(html).not.toContain("<h4>Context packet</h4>");
    expect(html).not.toContain("<h4>Files</h4>");
    expect(html).toContain("<h4>Tools</h4>");
    expect(html).toContain("<h4>Timeline</h4>");
    expect(html).toContain("<h4>Verification</h4>");
    expect(html).toContain("<h4>Needs attention</h4>");
    expect(html).not.toContain("Open source");
    expect(html).not.toContain("Open repo");
  });

  test("keeps the identity header and centers advanced details below the dossier", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    expect(host.textContent).not.toContain("Copies canonical session context for reuse.");
    expect(host.querySelector(".dossier-header")).toBeTruthy();
    expect(host.querySelector(".meta-rail")).toBeTruthy();
    expect(host.querySelector(".title-block")).toBeTruthy();

    const advancedButton = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(advancedButton).toBeTruthy();
    expect(advancedButton?.closest(".title-block")).toBeNull();
    expect(advancedButton?.closest(".advanced")).toBeTruthy();
    root.unmount();
  });

  test("hides raw system and bracket metadata from the default transcript but keeps raw access in advanced details", async () => {
    const rawPrompt = ["# AGENTS.md instructions for /tmp/Masthead", "<INSTRUCTIONS>", "# Codex Behavioral Guidelines", "Do not show this repository instruction block by default.", "</INSTRUCTIONS>", "<environment_context>", "<cwd>/tmp/Masthead</cwd>", "</environment_context>", "Please repair [system: hidden metadata] the OAuth callback and keep array[index] readable."].join("\n");
    const rawPermissions = "Filesystem sandboxing defines which files can be read or written. Network access is restricted.";
    const currentDossier = dossier();
    currentDossier.narrative.firstUserPrompt = rawPrompt;
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SessionDossier
          dossier={currentDossier}
          transcript={{
            coverage: currentDossier.coverage.transcript,
            items: [
              {
                itemId: "message-raw",
                kind: "message",
                label: "user",
                lowValue: false,
                observedAt: "2026-06-25T23:01:00.000Z",
                role: "user",
                sessionId: "canonical-session-1",
                sourceRef: {},
                text: rawPrompt
              },
              {
                itemId: "message-permissions",
                kind: "message",
                label: "unknown",
                lowValue: false,
                observedAt: "2026-06-25T23:02:00.000Z",
                role: "unknown",
                sessionId: "canonical-session-1",
                sourceRef: {},
                text: rawPermissions
              }
            ],
            total: 2
          }}
        />
      );
    });

    const visibleDossierText = `${host.querySelector(".summary")?.textContent ?? ""} ${host.querySelector(".transcript")?.textContent ?? ""}`;
    expect(visibleDossierText).toContain("Please repair the OAuth callback and keep array[index] readable.");
    expect(visibleDossierText).not.toContain("AGENTS.md");
    expect(visibleDossierText).not.toContain("Codex Behavioral Guidelines");
    expect(visibleDossierText).not.toContain("system: hidden metadata");
    expect(visibleDossierText).not.toContain("Filesystem sandboxing defines");

    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();
    const panel = host.querySelector(".advanced-details-panel") as HTMLElement | null;
    expect(panel?.hidden).toBe(true);
    expect(panel?.textContent).toContain("AGENTS.md");
    expect(panel?.textContent).toContain("system: hidden metadata");
    expect(panel?.textContent).toContain("Filesystem sandboxing defines");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(panel?.hidden).toBe(false);
    expect(host.textContent).toContain("Raw transcript");
    expect(host.textContent).toContain("AGENTS.md");
    expect(host.textContent).toContain("system: hidden metadata");
    expect(host.textContent).toContain("Filesystem sandboxing defines");
    root.unmount();
  });

  test("opens advanced evidence on demand", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    const panel = host.querySelector(".advanced-details-panel") as HTMLElement | null;
    expect(panel?.hidden).toBe(true);
    expect(panel?.textContent).toContain("Narrative evidence");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(panel?.hidden).toBe(false);
    expect(host.textContent).toContain("Verification");
    expect(host.textContent).toContain("Tools");
    expect(host.textContent).toContain("Timeline");
    expect(host.textContent).toContain("Narrative evidence");
    expect(host.textContent).not.toContain("Files");
    expect(host.textContent).not.toContain("File ");
    expect(host.textContent).not.toContain("src/app/App.tsx");
    root.unmount();
  });

  test("renders coverage warning and sparse transcript CTA", () => {
    const openSources = vi.fn();
    const sparse = dossier();
    sparse.coverage = {
      level: "hook_only",
      transcript: {
        assistantMessages: 0,
        checkpoints: 0,
        fileEffects: 0,
        hasUsableTranscript: false,
        lowValueItems: 4,
        messages: 1,
        runtimeSignals: 2,
        toolCalls: 1,
        toolResults: 0,
        userMessages: 1
      },
      warnings: [
        {
          action: { label: "Open Workbench", target: "workbench" },
          code: "transcript_missing",
          message: "Full transcript messages are not available for this session."
        }
      ]
    };

    const html = renderToStaticMarkup(
      <SessionDossier
        dossier={sparse}
        onOpenSources={openSources}
        transcript={{
          coverage: sparse.coverage.transcript,
          items: [
            {
              itemId: "m1",
              kind: "message",
              label: "user",
              lowValue: true,
              observedAt: "2026-06-25T23:01:00.000Z",
              role: "user",
              sessionId: "canonical-session-1",
              sourceRef: {},
              text: "Codex hook event"
            }
          ],
          total: 1
        }}
      />
    );

    expect(html).toContain("hook only");
    expect(html).toContain("transcript missing");
    expect(html).toContain("Codex hook event");
    expect(html).not.toContain("Import transcripts in Sources");
  });

  test("renders repeated low-value transcript rows as prototype evidence rows", () => {
    const transcriptItems = Array.from({ length: 4 }, (_, index) => ({
      itemId: `low-${index}`,
      kind: "message" as const,
      label: "user",
      lowValue: true,
      observedAt: `2026-06-25T23:0${index}:00.000Z`,
      role: "user" as const,
      sessionId: "canonical-session-1",
      sourceRef: {},
      text: "Codex hook event"
    }));
    const html = renderToStaticMarkup(
      <SessionDossier
        dossier={dossier()}
        transcript={{
          coverage: {
            assistantMessages: 0,
            checkpoints: 0,
            fileEffects: 0,
            hasUsableTranscript: false,
            lowValueItems: 4,
            messages: 4,
            runtimeSignals: 0,
            toolCalls: 0,
            toolResults: 0,
            userMessages: 4
          },
          items: transcriptItems,
          total: 4
        }}
      />
    );

    expect(html).toContain("Codex hook event");
    expect(html).not.toContain("low-value Codex hook event events captured");
    expect((html.match(/Codex hook event/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  test("renders all loaded useful transcript evidence in a fixed scroll window", () => {
    const transcriptItems = Array.from({ length: 12 }, (_, index) => ({
      itemId: `message-${index}`,
      kind: "message" as const,
      label: "assistant",
      lowValue: false,
      observedAt: `2026-06-25T23:${String(index).padStart(2, "0")}:00.000Z`,
      role: "assistant" as const,
      sessionId: "canonical-session-1",
      sourceRef: {},
      text: `Transcript evidence row ${index}`
    }));

    const html = renderToStaticMarkup(
      <SessionDossier
        dossier={dossier()}
        transcript={{
          coverage: dossier().coverage.transcript,
          items: transcriptItems,
          total: transcriptItems.length
        }}
      />
    );

    expect(html).toContain("transcript-scroll");
    expect(html).toContain("Transcript evidence row 0");
    expect(html).toContain("Transcript evidence row 11");
  });

  test("loads more transcript evidence from the scroll sentinel", async () => {
    const onLoadMore = vi.fn();
    const OriginalIntersectionObserver = globalThis.IntersectionObserver;
    const observers: MockIntersectionObserver[] = [];
    const host = document.createElement("div");
    const root = createRoot(host);
    globalThis.IntersectionObserver = class extends MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options);
        observers.push(this);
      }
    } as typeof IntersectionObserver;

    try {
      await act(async () => {
        root.render(
          <SessionDossier
            dossier={dossier()}
            onTranscriptLoadMore={onLoadMore}
            transcript={{
              coverage: dossier().coverage.transcript,
              items: [
                {
                  itemId: "message-1",
                  kind: "message",
                  label: "user",
                  lowValue: false,
                  observedAt: "2026-06-25T23:01:00.000Z",
                  role: "user",
                  sessionId: "canonical-session-1",
                  sourceRef: {},
                  text: "Please repair the OAuth callback."
                }
              ],
              nextCursor: "cursor-2",
              total: 2
            }}
          />
        );
      });

      expect(host.querySelector(".transcript-scroll")).toBeTruthy();
      expect(host.querySelector(".transcript-sentinel")).toBeTruthy();
      expect(observers.length).toBe(1);

      await act(async () => {
        observers[0]?.trigger(true);
      });

      expect(onLoadMore).toHaveBeenCalledTimes(1);
    } finally {
      root.unmount();
      globalThis.IntersectionObserver = OriginalIntersectionObserver;
    }
  });

  test("does not render review actions in advanced details", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier live={liveSession()} onAction={() => undefined} actionStatus="Marked reviewed." />);
    });

    expect(host.textContent).toContain("Live session title");
    expect(host.textContent).toContain("live-session-1");
    expect(host.querySelector(".meta-rail")).toBeTruthy();
    expect(host.textContent).not.toContain("Dismiss");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).not.toContain("Dismiss");
    expect(host.textContent).not.toContain("Mark reviewed");
    expect(host.textContent).not.toContain("Marked reviewed.");
    expect(host.textContent).not.toContain("Review actions");
    expect(host.textContent).not.toContain("Open source");
    expect(host.textContent).not.toContain("Open repo");
    root.unmount();
  });

  test("wires the prototype close control to the caller", async () => {
    const onClose = vi.fn();
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} onClose={onClose} />);
    });
    const button = host.querySelector(".title-block .close");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    root.unmount();
  });

  test("wires prototype transcript filters to the caller", async () => {
    const onFilterChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SessionDossier
          dossier={dossier()}
          onTranscriptFilterChange={onFilterChange}
          transcript={{
            coverage: dossier().coverage.transcript,
            items: [],
            total: 0
          }}
        />
      );
    });

    const button = [...host.querySelectorAll(".filter")].find((item) => item.textContent === "User");
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onFilterChange).toHaveBeenCalledWith("user");
    root.unmount();
    host.remove();
  });

  test("loads more transcript items from the scroll sentinel instead of a button", async () => {
    const onLoadMore = vi.fn();
    const OriginalIntersectionObserver = globalThis.IntersectionObserver;
    const observers: MockIntersectionObserver[] = [];
    const host = document.createElement("div");
    const root = createRoot(host);
    globalThis.IntersectionObserver = class extends MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options);
        observers.push(this);
      }
    } as typeof IntersectionObserver;

    try {
      await act(async () => {
        root.render(
          <DossierTranscript
            filter="all"
            query=""
            onFilterChange={() => undefined}
            onLoadMore={onLoadMore}
            onQueryChange={() => undefined}
            onRetry={() => undefined}
            sessionId="canonical-session-1"
            transcript={{
              coverage: dossier().coverage.transcript,
              items: [
                {
                  itemId: "message-1",
                  kind: "message",
                  label: "user",
                  lowValue: false,
                  observedAt: "2026-06-25T23:01:00.000Z",
                  role: "user",
                  sessionId: "canonical-session-1",
                  sourceRef: {},
                  text: "Please repair the OAuth callback."
                }
              ],
              nextCursor: "cursor-2",
              total: 2
            }}
          />
        );
      });

      expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Load more")).toBe(false);
      expect(host.querySelector(".dossier-transcript-sentinel")).toBeTruthy();
      expect(observers.length).toBe(1);

      await act(async () => {
        observers[0]?.trigger(true);
      });

      expect(onLoadMore).toHaveBeenCalledTimes(1);
    } finally {
      root.unmount();
      globalThis.IntersectionObserver = OriginalIntersectionObserver;
    }
  });
});

class MockIntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;
  private callback: IntersectionObserverCallback;
  private target?: Element;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? "";
    this.thresholds = Array.isArray(options?.threshold) ? options.threshold : [options?.threshold ?? 0];
  }

  disconnect() {
    this.target = undefined;
  }

  observe(target: Element) {
    this.target = target;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element) {
    if (this.target === target) this.target = undefined;
  }

  trigger(isIntersecting: boolean) {
    if (!this.target) return;
    this.callback([{ isIntersecting, target: this.target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function dossier(): SessionDossierDto {
  return {
    attention: [
      {
        kind: "missing_verification",
        severity: "P2",
        sourceRefs: [],
        title: "Verification not captured"
      }
    ],
    artifacts: [],
    coverage: {
      level: "complete",
      transcript: {
        assistantMessages: 1,
        checkpoints: 0,
        fileEffects: 1,
        hasUsableTranscript: true,
        lowValueItems: 0,
        messages: 2,
        runtimeSignals: 0,
        toolCalls: 1,
        toolResults: 1,
        userMessages: 1
      },
      warnings: []
    },
    enrichment: { status: "current" },
    files: [
      {
        basename: "App.tsx",
        displayPath: "src/app/App.tsx",
        effectKind: "modified",
        fileEffectId: "file-1",
        observedAt: "2026-06-25T23:05:00.000Z",
        path: "src/app/App.tsx",
        sourceRef: {},
        staged: false
      }
    ],
    identity: {
      hostId: "host:test",
      lastActivityAt: "2026-06-25T23:12:00.000Z",
      lifecycle: "idle",
      model: "gpt-5",
      models: ["gpt-5"],
      project: "Masthead",
      runtime: "codex",
      sessionId: "canonical-session-1",
      sourceConfidence: "authoritative",
      sourceSessionId: "source-session-1",
      startedAt: "2026-06-25T22:42:00.000Z",
      title: "Repair OAuth callback"
    },
    narrative: {
      finalAssistantMessage: "OAuth route still fails for missing state.",
      firstUserPrompt: "Please repair the OAuth callback.",
      latestUserPrompt: "Can you verify the missing state edge case?",
      liveSummary: "Callback repair is being verified.",
      narrativeDebug: {
        model: "gpt-5-nano",
        promptVersion: "session-capsule-v4",
        provider: "openai",
        sourceRefs: [
          {
            id: "source-ref-1",
            kind: "event",
            observedAt: "2026-06-25T23:00:00.000Z",
            source: "codex"
          }
        ],
        subjectConfidence: "high",
        subjectSource: "message",
        titleSource: "objective",
        validationWarnings: []
      },
      objective: "Fix the OAuth return path.",
      outcome: "OAuth route still fails in one edge case.",
      technologies: ["vite"],
      topics: ["auth"],
      unresolved: ["missing state"]
    },
    excerpts: [
      {
        excerptId: "excerpt-1",
        kind: "message",
        observedAt: "2026-06-25T23:01:00.000Z",
        role: "user",
        sourceRef: {},
        text: "Please repair the OAuth callback."
      },
      {
        excerptId: "excerpt-2",
        kind: "message",
        observedAt: "2026-06-25T23:08:00.000Z",
        role: "assistant",
        sourceRef: {},
        text: "OAuth route still fails for missing state."
      }
    ],
    reuse: {
      canonicalSessionId: "canonical-session-1",
      copyableContext: "# Masthead Session Context\nSummary: OAuth route still fails in one edge case.\nAgent retrieval: included",
      mcpIncluded: true,
      sourceConfidence: "authoritative",
      sourceRuntime: "codex",
      sourceSessionId: "source-session-1"
    },
    timeline: [
      {
        eventId: "event-user",
        kind: "user",
        label: "user",
        observedAt: "2026-06-25T23:01:00.000Z",
        summary: "Please repair the OAuth callback."
      },
      {
        eventId: "event-assistant",
        kind: "assistant",
        label: "assistant",
        observedAt: "2026-06-25T23:08:00.000Z",
        summary: "OAuth route still fails for missing state."
      },
      {
        eventId: "event-1",
        kind: "tool",
        label: "succeeded",
        observedAt: "2026-06-25T23:07:00.000Z",
        sourceRef: { id: "event-1", kind: "tool", source: "timeline" },
        summary: "npm test"
      },
      {
        eventId: "event-file",
        kind: "file",
        label: "file changed",
        observedAt: "2026-06-25T23:06:00.000Z",
        sourceRef: { id: "event-file", kind: "file", source: "timeline" },
        summary: "src/app/App.tsx"
      }
    ],
    tools: [
      {
        completedAt: "2026-06-25T23:07:00.000Z",
        outputPreview: "tests passed",
        sourceRef: {},
        status: "succeeded",
        toolCallId: "tool-1",
        toolName: "npm test"
      }
    ],
    usage: {
      inputTokens: 120,
      outputTokens: 40,
      totalTokens: 160,
      usageRows: 1
    },
    verification: {
      commands: [
        {
          completedAt: "2026-06-25T23:07:00.000Z",
          outputPreview: "tests passed",
          sourceRef: {},
          status: "succeeded",
          toolCallId: "tool-1",
          toolName: "npm test"
        }
      ],
      status: "passed",
      summary: "Verification commands passed."
    }
  };
}

function liveSession(): SessionDetailView {
  return {
    attentionItems: [],
    changedFileCount: 1,
    conflicts: [],
    headline: {
      headline: "Live session title",
      frame: {
        subject: "Live session title",
        disposition: "review shared edits",
        state: "active",
        subjectKind: "feature",
        confidence: "high",
        evidence: ["Work is active."]
      },
      source: "llm",
      status: "ready"
    },
    currentActivity: "Editing files",
    durationLabel: "4m",
    evidence: { inferred: [], missing: [], observed: [] },
    identityConfidence: "direct",
    indicators: [],
    isExpanded: true,
    lastActivity: "2026-06-25T23:12:00.000Z",
    lastActivityLabel: "0s ago",
    lifecycle: "running",
    primaryStatus: "editing",
    priorityRank: 10,
    project: "Masthead",
    reviewAnnotations: [],
    safeActions: ["open_source_session", "open_repo", "dismiss", "mark_reviewed"],
    sessionId: "live-session-1",
    stateLabel: "Editing",
    timeline: [],
    title: "Raw live title"
  };
}
