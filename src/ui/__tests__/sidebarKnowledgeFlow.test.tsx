import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { KnowledgeFlowSummaryDto } from "../../shared/knowledgeFlow";
import { SidebarKnowledgeFlow } from "../SidebarKnowledgeFlow";

const summary: KnowledgeFlowSummaryDto = {
  capturedSessions: 17,
  workbenchSessions: 6,
  publishedArtifacts: 11,
  automaticallyResolvedSessions: 4
};

describe("SidebarKnowledgeFlow", () => {
  test("renders loaded inventory values in the approved flow order", () => {
    const html = renderToStaticMarkup(<SidebarKnowledgeFlow summary={summary} />);

    expect(html).toContain('aria-label="Knowledge flow"');
    expect(html).toContain("Captured sessions");
    expect(html).toContain("In Workbench");
    expect(html).toContain("Published artifacts");
    expect(html).toContain(">17<");
    expect(html).toContain(">6<");
    expect(html).toContain(">11<");
    expect(html).toContain("4 automatically resolved");
  });

  test("renders zero as valid inventory", () => {
    const html = renderToStaticMarkup(
      <SidebarKnowledgeFlow
        summary={{
          capturedSessions: 0,
          workbenchSessions: 0,
          publishedArtifacts: 0,
          automaticallyResolvedSessions: 0
        }}
      />
    );

    expect(html.match(/>0</g)).toHaveLength(3);
    expect(html).toContain("0 automatically resolved");
    expect(html).not.toContain("Summary unavailable");
  });

  test("renders em dashes while loading", () => {
    const html = renderToStaticMarkup(<SidebarKnowledgeFlow loading />);

    expect(html.match(/>—</g)).toHaveLength(3);
    expect(html).toContain("— automatically resolved");
    expect(html).not.toContain("Summary unavailable");
  });

  test("renders the unavailable state without stale values", () => {
    const html = renderToStaticMarkup(<SidebarKnowledgeFlow summary={summary} error="offline" />);

    expect(html).toContain('class="sidebar-knowledge-flow unavailable"');
    expect(html.match(/>—</g)).toHaveLength(3);
    expect(html).toContain("Summary unavailable");
    expect(html).not.toContain("4 automatically resolved");
  });
});
