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

    expect(html).toContain('aria-label="Knowledge flow"');
    expect(html).toContain("Capture sessions");
    expect(html).toContain("4 automatically resolved");
    expect(html.indexOf('aria-label="Knowledge flow"')).toBeGreaterThan(html.indexOf('aria-label="Masthead sections"'));
  });

  test("renders active history imports as compact background activity", () => {
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
    expect(html).toContain("Updating history");
    expect(html).toContain("Codex");
    expect(html).toContain("3 / 1,701 discovered");
    expect(html).toContain("500 scheduled");
    expect(html).toContain("1,201 outside this pass");
    expect(html).toContain("1 harness waiting");
    expect(html).not.toContain("Claude Code 0");
  });
});
