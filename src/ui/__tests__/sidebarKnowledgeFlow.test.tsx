import { readFileSync } from "node:fs";
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
    const text = visibleText(html);

    expect(html).toContain('aria-label="Knowledge flow"');
    expect(html).toContain("Capture sessions");
    expect(html).toContain("Workbench");
    expect(html).toContain("Publish artifacts");
    expect(html).not.toContain("sidebar-knowledge-flow-title");
    expect(text).toContain("Capture sessions17");
    expect(text).toContain("Workbench6");
    expect(text).toContain("Publish artifacts11");
    expect(text).toContain("4 automatically resolved");
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
    const text = visibleText(html);

    expect(text).toContain("Capture sessions0");
    expect(text).toContain("Workbench0");
    expect(text).toContain("Publish artifacts0");
    expect(text).toContain("0 automatically resolved");
    expect(html).not.toContain("Summary unavailable");
  });

  test("renders em dashes while loading", () => {
    const html = renderToStaticMarkup(<SidebarKnowledgeFlow loading />);

    expect(html.match(/>—</g)).toHaveLength(3);
    expect(html).toContain("— automatically resolved");
    expect(html).not.toContain("Summary unavailable");
  });

  test("keeps loaded values visible during a background refresh", () => {
    const html = renderToStaticMarkup(<SidebarKnowledgeFlow summary={summary} loading />);
    const text = visibleText(html);

    expect(text).toContain("Capture sessions17");
    expect(text).toContain("Workbench6");
    expect(text).toContain("Publish artifacts11");
    expect(text).toContain("4 automatically resolved");
    expect(html).not.toContain(">—<");
  });

  test("renders the unavailable state without stale values", () => {
    const html = renderToStaticMarkup(<SidebarKnowledgeFlow summary={summary} error="offline" />);

    expect(html).toContain('class="sidebar-knowledge-flow unavailable"');
    expect(html.match(/>—</g)).toHaveLength(3);
    expect(html).toContain("Summary unavailable");
    expect(html).not.toContain("4 automatically resolved");
  });

  test("uses the approved green resolution note in a flat navigation rail", () => {
    const css = readFileSync(new URL("../../styles/masthead.css", import.meta.url), "utf8");
    const resolvedRule = cssRuleBody(css, ".sidebar-knowledge-resolved");
    const unavailableRule = cssRuleBody(css, ".sidebar-knowledge-flow.unavailable .sidebar-knowledge-resolved");
    const railRule = cssRuleBody(css, ".sidebar-knowledge-flow");

    expect(resolvedRule).toContain("color: var(--green);");
    expect(unavailableRule).toContain("color: var(--ash);");
    expect(railRule).toContain("border-top: 1px solid var(--line);");
    expect(railRule).toContain("background: transparent;");
    expect(css).not.toMatch(/\.masthead-shell \.sidebar-knowledge-flow::(?:before|after)/);
    expect(css).not.toMatch(/\.observability-console \.sidebar-knowledge-flow::(?:before|after)/);
  });
});

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function cssRuleBody(css: string, selector: string): string {
  const selectorIndex = findCssSelectorIndex(css, selector);
  if (selectorIndex === -1) throw new Error(`Expected CSS to contain rule for ${selector}`);
  return extractCssRuleBodyAt(css, selector, selectorIndex);
}

function cssRuleBodyContaining(css: string, selector: string, containedText: string): string {
  let fromIndex = 0;
  while (fromIndex < css.length) {
    const selectorIndex = findCssSelectorIndex(css, selector, fromIndex);
    if (selectorIndex === -1) break;
    const body = extractCssRuleBodyAt(css, selector, selectorIndex);
    if (body.includes(containedText)) return body;
    fromIndex = selectorIndex + selector.length;
  }

  throw new Error(`Expected CSS rule for ${selector} to contain ${containedText}`);
}

function findCssSelectorIndex(css: string, selector: string, fromIndex = 0): number {
  let searchIndex = fromIndex;
  while (searchIndex < css.length) {
    const selectorIndex = css.indexOf(selector, searchIndex);
    if (selectorIndex === -1) return -1;
    const nextSignificantChar = css.slice(selectorIndex + selector.length).trimStart()[0];
    if (nextSignificantChar === "{" || nextSignificantChar === ",") return selectorIndex;
    searchIndex = selectorIndex + selector.length;
  }

  return -1;
}

function extractCssRuleBodyAt(css: string, selector: string, selectorIndex: number): string {
  const openBraceIndex = css.indexOf("{", selectorIndex + selector.length);
  if (openBraceIndex === -1) throw new Error(`Expected CSS rule for ${selector} to have a body`);

  let depth = 0;
  for (let index = openBraceIndex; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(openBraceIndex + 1, index);
    }
  }

  throw new Error(`Expected CSS rule for ${selector} to close`);
}
