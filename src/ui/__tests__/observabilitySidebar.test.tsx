import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilitySidebar } from "../ObservabilitySidebar";
import { APP_VERSION_LABEL } from "../../app/version";
import { iconRegistry } from "../icons/icon-registry";

describe("ObservabilitySidebar", () => {
  test("renders Masthead identity and session product nav", () => {
    const html = renderToStaticMarkup(<ObservabilitySidebar version={APP_VERSION_LABEL} activeCount={24} />);

    expect(html).toContain("Masthead");
    expect(html).toContain(APP_VERSION_LABEL);
    expect(html).toContain("Now");
    expect(html).toContain("Workbench");
    expect(html).toContain("24");
    expect(html).not.toContain("Traces");
    expect(html).not.toContain("Models");
    expect(html).not.toContain("Alerts");
    expect(html).toContain("Logbook");
    expect(html).toContain("Sources");
    expect(html).not.toContain("Usage");
    expect(html).not.toContain("Agent Access");
    expect(html).toContain('aria-label="Knowledge flow"');
    expect(html).not.toContain("Workspace");
    expect(html).not.toContain("Overview");
    expect(html).not.toContain("Analysis");
    expect(html).not.toContain("Configuration");
    expect(html).not.toContain("Performance");
    expect(html).toContain("Settings");
    expect(html).not.toContain("Costs");
    expect(html).not.toContain("Agents");
    expect(html).not.toContain("Environments");
    expect(html).not.toContain("Status");
    expect(html).not.toContain("API");
    expect(html).not.toContain("Update available");
    expect(html).not.toContain("Live collector");
    expect(html).not.toContain("Demo");
    expect(html).toContain("<img");
    expect(html).toContain("brand-sail");
    expect(html).toContain("<button");
    expect(html).not.toContain("href=\"#");
  });

  test("Workbench and Logbook use distinct registry icons", () => {
    expect(iconRegistry.workbench).not.toBe(iconRegistry.logbook);
  });

  test("renders knowledge flow at the bottom of the sidebar", () => {
    const html = renderToStaticMarkup(
      <ObservabilitySidebar
        version={APP_VERSION_LABEL}
        activeCount={24}
        knowledgeFlowSummary={{
          capturedSessions: 17,
          workbenchSessions: 6,
          publishedArtifacts: 11,
          automaticallyResolvedSessions: 4
        }}
      />
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(html).toContain('aria-label="Knowledge flow"');
    expect(html).toContain("Capture sessions");
    expect(text).toContain("4 automatically resolved");
    expect(html.indexOf('aria-label="Knowledge flow"')).toBeGreaterThan(html.indexOf('aria-label="Masthead sections"'));
  });

  test("renders active history imports as a distinct card", () => {
    const html = renderToStaticMarkup(
      <ObservabilitySidebar
        version={APP_VERSION_LABEL}
        activeCount={0}
        imports={[
          { importJobId: "codex-job", importKind: "transcript", sourceId: "codex:one", status: "running", discoveredCount: 0, processedCount: 18151, importedCount: 18151, queuedCount: 0, failureCount: 0, totalWorkUnits: 1701, completedWorkUnits: 3, skippedWorkUnits: 1201, updatedAt: "2026-07-11T00:45:00.000Z" },
          { importJobId: "claude-job", importKind: "transcript", sourceId: "claude_code:one", status: "queued", discoveredCount: 0, importedCount: 0, queuedCount: 0, failureCount: 0, updatedAt: "2026-07-11T00:42:00.000Z" }
        ]}
      />
    );
    expect(html).toContain('class="sidebar-import-activity is-updating"');
    expect(html).toContain("Updating history");
    expect(html).toContain("Codex");
    expect(html).toContain("3 / 1,701 discovered");
    expect(html).toContain("500 scheduled");
    expect(html).toContain("1,201 outside this pass");
    expect(html).toContain("1 harness waiting");
    expect(html).not.toContain("Claude Code 0");

    const css = readFileSync("src/styles/masthead.css", "utf8");
    expect(css).toMatch(/\.sidebar-import-activity \{[\s\S]*?border: 1px solid rgba\(46, 167, 255, 0\.2\);[\s\S]*?background: #03121c;/);
    expect(css).toMatch(/\.sidebar-import-activity\.is-updating \{[\s\S]*?box-sizing: border-box;[\s\S]*?height: 100%;/);
    expect(css).not.toMatch(/\.sidebar-import-activity\.is-updating \{[^}]*background: transparent;/);
  });

  test("bounds import health between navigation and Knowledge flow across sidebar layouts", () => {
    const html = renderToStaticMarkup(
      <ObservabilitySidebar
        version={APP_VERSION_LABEL}
        activeCount={0}
        imports={[issueImport("codex-job", "codex:one")]}
      />
    );
    const css = readFileSync("src/styles/masthead.css", "utf8");
    const navIndex = html.indexOf('aria-label="Masthead sections"');
    const importRegionIndex = html.indexOf('class="sidebar-import-region"');
    const knowledgeIndex = html.indexOf('aria-label="Knowledge flow"');

    expect(importRegionIndex).toBeGreaterThan(navIndex);
    expect(knowledgeIndex).toBeGreaterThan(importRegionIndex);
    expect(html).toContain('class="sidebar-import-activity is-health"');

    expect(css).toContain("grid-template-rows: auto auto minmax(0, 1fr) auto;");
    expect(css).toContain(".sidebar-import-region {\n  position: static;\n  min-height: 0;\n  margin: 16px 16px 0;\n  overflow: hidden;");
    expect(css).toContain(".sidebar-import-region .sidebar-import-activity {\n  position: static;\n  max-height: 100%;\n  overflow-y: auto;");
    expect(css).not.toContain(".masthead-shell .sidebar-group > div");
    expect(css).toContain(".masthead-shell .sidebar-link,");
    expect(css).toMatch(/\.sidebar-link \{[^}]*border: 1px solid rgba\(92, 153, 187, 0\.18\);/);
    expect(css).toContain(".masthead-shell .sidebar-knowledge-flow {\n  position: relative;\n  margin: 10px 16px 16px;");
    expect(css).toContain("@media (max-width: 760px) {\n  .sidebar-shell {\n    display: block;\n    height: auto;\n    overflow: visible;");
    expect(css).not.toContain("@media (max-height: 720px)");
  });
});

function issueImport(importJobId: string, sourceId: string) {
  return {
    completionReport: {
      anomalies: [], cappedUnits: 0, dossierReadySessions: 0, enrichedSessions: 0, failedUnits: 0,
      generatedAt: "2026-07-17T12:00:00.000Z", importJobId, logbookSearchableSessions: 0,
      mcpVisibleSessions: 0, nextActions: ["repair_import" as const], outOfRangeSessions: 0,
      recordsFailed: 1, recordsImported: 1, recordsRecognized: 1, recordsRejected: 1,
      recordsSkipped: 0, runtime: "codex" as const, sessionsCreated: 1, sessionsDiscovered: 1,
      sessionsFinalized: 1, sessionsOnPackagePath: 0, sessionsRepairRequired: 1,
      sessionsSuppressed: 0, sessionsUpdated: 0, skippedUnits: 0, status: "succeeded_with_issues" as const,
      timestampBasis: { file_modified: 0, semantic: 1, source_path: 0, unknown: 0 }, transcriptsImported: 1
    },
    discoveredCount: 1, failureCount: 0, importJobId, importKind: "transcript" as const,
    importedCount: 1, queuedCount: 0, sourceId, status: "succeeded_with_issues" as const,
    updatedAt: "2026-07-17T12:00:00.000Z"
  };
}
