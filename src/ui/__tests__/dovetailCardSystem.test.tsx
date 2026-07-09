// @vitest-environment happy-dom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { UsageStatsDto } from "../../app/daemonClient";
import type { AttentionItem, SessionCardView } from "../../core/types";
import type { SessionDossierDto } from "../../shared/sessionDossier";
import type { SourcesSetupDto } from "../../shared/sourcesSetup";
import { AttentionQueue } from "../AttentionQueue";
import { HistoryPanel } from "../HistoryPanel";
import { MetricCard } from "../MetricCard";
import { OperationsPanel } from "../OperationsPanel";
import { SessionCard } from "../SessionCard";
import { SidebarUsageStats } from "../SidebarUsageStats";
import { SourcesPanel } from "../SourcesPanel";
import { SessionDossier } from "../session-dossier/SessionDossier";
import { ImportJobsTable } from "../sources/ImportJobsTable";
import { UsagePanel } from "../usage/UsagePanel";

describe("dovetail card system", () => {
  test("Board session cards render the selected Dovetail Compression Base mockup structure", () => {
    const active = elementFor(<SessionCard session={sessionFixture()} />, ".session-card");
    const idle = elementFor(<SessionCard session={sessionFixture({ lifecycle: "idle", primaryStatus: "stalled", stateLabel: "Idle" })} />, ".session-card");
    const blocked = elementFor(
      <SessionCard
        session={sessionFixture({
          indicators: ["attention"],
          primaryStatus: "blocked",
          stateLabel: "Blocked"
        })}
       
      />,
      ".session-card"
    );

    expectSessionMockupStructure(active, "is-active");
    expectSessionMockupStructure(idle, "is-idle");
    expectSessionMockupStructure(blocked, "is-blocked");
    expect(active.className).toBe("session-card bottom-variant-card dovetail-card is-active tier-live");
    expect(idle.className).toBe("session-card bottom-variant-card dovetail-card is-idle tier-quiet");
    expect(blocked.className).toBe("session-card bottom-variant-card dovetail-card is-blocked tier-action");
    expect(active.querySelector(":scope > .bottom-signal")).toBeTruthy();
    expect(active.querySelector(":scope > .card-topline .project")?.textContent).toContain("Masthead");
    expect(active.querySelector(":scope > .card-topline .runtime-tag")?.textContent).toBe("OpenCode");
    expect(active.querySelector(":scope > .card-topline .state-pill")?.textContent).toBe("Active");
    expect(active.querySelector(":scope > h3.headline")?.textContent).toBe("Refining the live card hierarchy.");
    expect(active.querySelectorAll(":scope > .fact-grid .fact")).toHaveLength(4);
    expect(active.querySelector(":scope > .footer-line .timestamp")?.textContent).toBe("2m ago");
  });

  test("permission waiting mockups use blocked copy while user waiting does not create a blocked card", () => {
    const approval = elementFor(
      <SessionCard
        session={sessionFixture({
          indicators: ["attention"],
          primaryStatus: "blocked",
          displayState: "blocked",
          runtimeState: "blocked",
          stateLabel: "Blocked"
        })}
       
      />,
      ".session-card"
    );
    const input = elementFor(
      <SessionCard
        session={sessionFixture({
          indicators: ["attention"],
          primaryStatus: "stalled",
          lifecycle: "idle",
          displayState: "idle",
          runtimeState: "idle",
          stateLabel: "Idle"
        })}
       
      />,
      ".session-card"
    );

    expect(approval.className).toBe("session-card bottom-variant-card dovetail-card is-blocked tier-action");
    expect(input.className).toBe("session-card bottom-variant-card dovetail-card is-idle tier-quiet");
    expect(approval.querySelector(":scope > .card-topline .state-pill")?.textContent).toBe("Blocked");
    expect(input.querySelector(":scope > .card-topline .state-pill")?.textContent).toBe("Idle");
  });

  test("idle SessionCard mockups never combine idle state with the action tier", () => {
    const idleMockups = [
      {
        name: "plain idle",
        card: elementFor(
          <SessionCard session={sessionFixture({ lifecycle: "idle", primaryStatus: "stalled", stateLabel: "Idle" })} />,
          ".session-card"
        )
      },
      {
        name: "idle with stale attention",
        card: elementFor(
          <SessionCard
            session={sessionFixture({
              lifecycle: "idle",
              primaryStatus: "stalled",
              stateLabel: "Idle",
              indicators: ["attention"]
            })}
           
          />,
          ".session-card"
        )
      }
    ];

    for (const { name, card } of idleMockups) {
      expect(card.classList.contains("is-idle"), `${name}: ${card.className}`).toBe(true);
      expect(card.classList.contains("tier-quiet"), `${name}: ${card.className}`).toBe(true);
      expect(card.classList.contains("tier-action"), `${name}: ${card.className}`).toBe(false);
    }
  });

  test("secondary app cards stay outside the session-card dovetail treatment", () => {
    const sidebarHtml = renderToStaticMarkup(<SidebarUsageStats stats={usageStatsFixture()} />);
    const usageHtml = renderToStaticMarkup(
      <UsagePanel stats={usageStatsFixture()} window="today" onRetry={() => undefined} onWindowChange={() => undefined} />
    );
    const logbookHtml = renderToStaticMarkup(
      <HistoryPanel
        loadState={{
          state: "ready",
          sessions: [
            {
              project: "Masthead",
              runtime: "opencode",
              sessionId: "session-1",
              state: "ended",
              title: "Masthead data layer"
            }
          ],
          total: 1
        }}
        loading={false}
        onQueryChange={() => undefined}
        query=""
      />
    );
    const sourcesHtml = renderToStaticMarkup(
      <SourcesPanel
        adapters={[]}
        busy={false}
        onExcludePath={() => undefined}
        onRefresh={() => undefined}
        setup={sourcesSetupFixture()}
        sources={[]}
        status="3 sources detected"
      />
    );
    const settingsHtml = renderToStaticMarkup(<OperationsPanel />);

    expect(logbookHtml).not.toContain("logbook-summary-strip");
    expect(logbookHtml).not.toContain("usage-metric sessions");
    expect(sourcesHtml).not.toContain("3 sources detected");
    expectNoDovetailTreatment(sidebarHtml);
    expectNoDovetailTreatment(logbookHtml);
    expectNoDovetailTreatment(sourcesHtml);
    expectNoDovetailTreatment(usageHtml);
    expectNoDovetailTreatment(settingsHtml);
  });

  test("non-targeted cards stay outside the Dovetail treatment", () => {
    const metricHtml = renderToStaticMarkup(<MetricCard label="Active Sessions" source="real" tone="good" value="16" />);
    const attentionHtml = renderToStaticMarkup(<AttentionQueue items={[attentionFixture()]} />);
    const dossierHtml = renderToStaticMarkup(<SessionDossier dossier={dossierFixture()} />);

    expectNoDovetailTreatment(metricHtml);
    expectNoDovetailTreatment(attentionHtml);
    expectNoDovetailTreatment(dossierHtml);
  });

  test("import jobs and raw display surfaces stay untreated", () => {
    const importJobsHtml = renderToStaticMarkup(
      <ImportJobsTable
        imports={[
          {
            discoveredCount: 2,
            failureCount: 0,
            importJobId: "job-1",
            importedCount: 1,
            importKind: "metadata",
            queuedCount: 1,
            sourceId: "opencode-sessions",
            status: "running",
            updatedAt: "2026-06-29T20:00:00.000Z"
          }
        ]}
      />
    );

    expectNoDovetailTreatment(importJobsHtml);
    expect(importJobsHtml).toContain("Import activity");
    expect(importJobsHtml).not.toContain("dovetail-info-card");
    expect(readFileSync("src/styles/primitives.css", "utf8")).not.toContain(".code-block.dovetail");
  });

  test("excluded surfaces and raw display files do not contain dovetail selectors", () => {
    const excludedPaths = [
      "src/ui/primitives/CodeBlock.tsx"
    ];

    for (const filePath of excludedPaths) {
      expect(readFileSync(filePath, "utf8"), filePath).not.toContain("dovetail");
    }
  });

  test("Board session CSS contains the exact selected mockup selectors", () => {
    const mastheadCss = readFileSync("src/styles/masthead.css", "utf8");
    const prototypeHtml = readFileSync("mockups/session-card-directions.html", "utf8");
    expect(sha256(prototypeHtml)).toBe("f6d1a7873fb681fabf1cb1ed7da2ecb30127502a245e107c38899d9d030a1d10");
    const boardVariantRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.bottom-variant-card");
    const compactVariantRule = cssRuleBody(
      mastheadCss,
      ".masthead-shell .observability-card-grid.compact .session-card.bottom-variant-card"
    );
    const dovetailPaletteRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.bottom-variant-card.dovetail-card");
    const quietTierRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.tier-quiet");
    const liveTierRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.tier-live");
    const actionTierRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.tier-action");
    const headlineRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card .headline");
    const headlineTextRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card .headline-text");
    const signalRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card .bottom-signal");
    const signalBeforeRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card .bottom-signal::before");
    const bottomSignalRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.dovetail-card .bottom-signal");
    const activeSignalBeforeRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.dovetail-card.is-active.tier-live .bottom-signal::before");
    const idleSignalRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.dovetail-card.is-idle .bottom-signal");
    const blockedSignalRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.dovetail-card.is-blocked .bottom-signal");
    const blockedSignalBeforeRule = cssRuleBody(mastheadCss, ".masthead-shell .session-card.dovetail-card.is-blocked .bottom-signal::before");
    const reducedMotionRule = cssRuleBodyContaining(
      mastheadCss,
      "@media (prefers-reduced-motion: reduce)",
      ".masthead-shell .session-card.dovetail-card .bottom-signal::before"
    );
    const prototypeDovetailCardRule = cssRuleBody(prototypeHtml, ".dovetail-card");
    const prototypeSignalRule = cssRuleBody(prototypeHtml, ".bottom-signal");
    const prototypeDovetailRule = cssRuleBody(prototypeHtml, ".dovetail-card .bottom-signal");

    expect(mastheadCss).toContain(".bottom-variant-card");
    expect(mastheadCss).toContain(".session-card.dovetail-card .bottom-signal");
    expect(mastheadCss).toContain("view-transition-name: session-card-grid");
    expect(mastheadCss).toContain(".masthead-shell .session-card.is-layout-animating");
    expect(mastheadCss).toContain("--layout-dur: 1300ms;");
    expect(mastheadCss).toContain("--layout-move-dur: 760ms;");
    expect(mastheadCss).toContain("--layout-compact-phase-dur: 420ms;");
    expect(mastheadCss).toContain("--layout-expand-dur: 260ms;");
    expect(mastheadCss).toContain("--layout-ease: cubic-bezier(0.24, 0.08, 0.18, 1);");
    expect(mastheadCss).toContain("transition-property: none;");
    expect(mastheadCss).not.toContain("grid-template-columns var(--layout-dur)");
    expect(mastheadCss).not.toContain("height var(--layout-dur)");
    expect(mastheadCss).not.toContain("min-height var(--layout-dur)");
    expect(mastheadCss).toContain("animation: session-card-created 760ms var(--layout-ease) both;");
    expect(mastheadCss).toContain("animation-delay: calc(var(--new-card-index) * 70ms);");
    expect(boardVariantRule).toContain("min-height: 238px;");
    expect(boardVariantRule).toContain("overflow: visible;");
    expect(boardVariantRule).toContain("padding-bottom: 18px;");
    expect(compactVariantRule).toContain("height: auto;");
    expect(compactVariantRule).toContain("min-height: 238px;");
    expect(compactVariantRule).toContain("overflow: visible;");
    expect(quietTierRule).toContain("--state: var(--blue);");
    expect(quietTierRule).toContain("--state-border: rgba(45, 168, 255, 0.18);");
    expect(liveTierRule).toContain("--state: var(--green);");
    expect(liveTierRule).toContain("--state-border: rgba(54, 216, 105, 0.3);");
    expect(actionTierRule).toContain("--state: var(--red);");
    expect(actionTierRule).toContain("--state-border: rgba(255, 72, 62, 0.44);");
    expect(headlineRule).toContain("overflow: hidden;");
    expect(headlineTextRule).toContain("-webkit-line-clamp: 3;");
    expect(headlineTextRule).toContain("overflow: hidden;");
    expect(prototypeDovetailCardRule).toContain("clip-path: polygon(0 0, 100% 0, 100% calc(100% - 6px), 72% calc(100% - 6px), 67% 100%, 33% 100%, 28% calc(100% - 6px), 0 calc(100% - 6px));");
    expect(prototypeDovetailRule).toContain("height: 10px;");
    expect(prototypeDovetailRule).toContain("clip-path: polygon(0 0, 28% 0, 33% 60%, 67% 60%, 72% 0, 100% 0, 100% 100%, 0 100%);");
    expect(dovetailPaletteRule).toContainDeclarationsFrom(prototypeDovetailCardRule);
    expect(prototypeSignalRule).toContain("linear-gradient(180deg, rgba(246, 251, 255, 0.22), transparent 34%)");
    expect(signalRule).toContain("linear-gradient(180deg, rgba(246, 251, 255, 0.22), transparent 34%)");
    expect(signalRule).toContain("linear-gradient(180deg, var(--state), var(--state))");
    expect(signalRule).toContain("inset 0 -1px 0 rgba(0, 0, 0, 0.52)");
    expect(signalRule).toContain("overflow: hidden;");
    expect(signalRule).toContain("transform-origin: 50% 100%;");
    expect(signalBeforeRule).toContain("content: \"\";");
    expect(signalBeforeRule).toContain("position: absolute;");
    expect(signalBeforeRule).toContain("inset: 0;");
    expect(normalizeCssRule(bottomSignalRule)).toBe(normalizeCssRule(prototypeDovetailRule));
    expect(bottomSignalRule).toContain("right: 0;");
    expect(bottomSignalRule).toContain("bottom: 0;");
    expect(bottomSignalRule).toContain("left: 0;");
    expect(bottomSignalRule).toContain("height: 10px;");
    expect(bottomSignalRule).toContain("clip-path: polygon(0 0, 28% 0, 33% 60%, 67% 60%, 72% 0, 100% 0, 100% 100%, 0 100%);");
    expect(() => cssRuleBody(mastheadCss, ".masthead-shell .session-card.dovetail-card.is-active .bottom-signal::before")).toThrow(
      /Expected CSS to contain rule/
    );
    expect(() => cssRuleBody(mastheadCss, ".masthead-shell .session-card.dovetail-card.is-waiting .bottom-signal::before")).toThrow(
      /Expected CSS to contain rule/
    );
    expect(activeSignalBeforeRule).toContain("animation: calm-lock-active 1300ms linear infinite;");
    expect(activeSignalBeforeRule).toContain("rgba(246, 251, 255, 0.42)");
    expect(activeSignalBeforeRule).toContain("68px 100% repeat-x");
    expect(idleSignalRule).toContain("animation: calm-lock-idle 6400ms ease-in-out infinite;");
    expect(blockedSignalRule).toContain("animation: calm-lock-blocked 2400ms ease-in-out infinite;");
    expect(blockedSignalRule).toContain("filter: drop-shadow(0 0 8px rgba(255, 72, 62, 0.48));");
    expect(blockedSignalRule).toContain("linear-gradient(180deg, rgba(255, 72, 62, 0.22), transparent 34%)");
    expect(blockedSignalBeforeRule).toContain("animation: calm-lock-blocked-warning 2400ms ease-in-out infinite;");
    expect(blockedSignalBeforeRule).toContain("rgba(255, 72, 62, 0.48)");
    expect(blockedSignalBeforeRule).not.toContain("rgba(246, 251, 255, 0.42)");
    expect(mastheadCss).toContain("@keyframes calm-lock-active");
    expect(mastheadCss).toContain("@keyframes calm-lock-idle");
    expect(mastheadCss).toContain("@keyframes calm-lock-blocked");
    expect(mastheadCss).toContain("@keyframes calm-lock-blocked-warning");
    expect(mastheadCss).not.toContain("@keyframes blocked-enter-pulse");
    expect(mastheadCss).not.toContain("dovetail-active-run");
    expect(mastheadCss).not.toContain("dovetail-blocked-pulse");
    expect(mastheadCss).not.toContain("--dovetail-state");
    expect(mastheadCss).not.toContain("dovetail-card-surface");
  });

  test("Secondary app card CSS follows the selected welded sheet metal prototype", () => {
    const mastheadCss = readFileSync("src/styles/masthead.css", "utf8");
    const prototypeHtml = readFileSync("mockups/secondary-card-directions.html", "utf8");
    expect(sha256(prototypeHtml)).toBe("cb46462beee01df57da4ebb079fa37d6742901e2b163b761ede36bac674be38e");

    const prototypeCardRule = withoutCssDeclarations(cssRuleBody(prototypeHtml, ".weld-sheet .metal-card"), [
      "border-color: rgba(46, 167, 255, 0.24);"
    ]);
    const prototypeHoverRule = cssRuleBody(prototypeHtml, ".weld-sheet .metal-card:hover");
    const prototypeSignalRule = withoutCssDeclarations(cssRuleBody(prototypeHtml, ".weld-sheet .signal"), [
      "border-top: 2px solid rgba(46, 167, 255, 0.54);"
    ]);
    const prototypeSheetRule = cssRuleBody(prototypeHtml, ".weld-sheet .metal-card::before");
    const targetSelectors = [
      ".masthead-shell .sidebar-usage",
      ".masthead-shell .usage-summary-strip .usage-metric",
      ".masthead-shell .usage-table-card",
      ".masthead-shell .usage-coverage",
      ".masthead-shell .usage-state",
      ".masthead-shell .settings-section",
      ".masthead-shell .connected-source-row",
      ".masthead-shell .adapter-card"
    ];

    for (const selector of targetSelectors) {
      expect(cssRuleBody(mastheadCss, selector), selector).toContainDeclarationsFrom(prototypeCardRule);
      expect(cssRuleBody(mastheadCss, selector), selector).toContain("border-color: rgba(92, 153, 187, 0.14);");
      expect(cssRuleBody(mastheadCss, `${selector}:hover`), `${selector}:hover`).toContainDeclarationsFrom(prototypeHoverRule);
      expect(cssRuleBody(mastheadCss, `${selector}::before`), `${selector}::before`).toContainDeclarationsFrom(prototypeSheetRule);
      expect(cssRuleBody(mastheadCss, `${selector}::after`), `${selector}::after`).toContainDeclarationsFrom(prototypeSignalRule);
      expect(cssRuleBody(mastheadCss, `${selector}::after`), `${selector}::after`).toContain("border-top: 0;");
    }

    expect(cssRuleBody(mastheadCss, ".masthead-shell .adapter-card.is-connected")).toContain("border-color: rgba(46, 167, 255, 0.24);");
    expect(cssRuleBody(mastheadCss, ".masthead-shell .settings-section-danger")).toContain("border-color: rgba(255, 72, 62, 0.34);");
    expect(cssRuleBody(mastheadCss, ".masthead-shell .secondary-tier-quiet::after")).toContain("border-bottom-color: rgba(46, 167, 255, 0.18);");
    expect(cssRuleBody(mastheadCss, ".masthead-shell .secondary-tier-live::after")).toContain("border-bottom-color: rgba(46, 167, 255, 0.42);");
    expect(cssRuleBody(mastheadCss, ".masthead-shell .secondary-tier-action::after")).toContain("border-bottom-color: rgba(255, 72, 62, 0.48);");

    expect(cssRuleBody(mastheadCss, ".masthead-shell .usage-metric-accent")).toContain("display: none;");
    const sidebarPositionRule = cssRuleBodyContaining(mastheadCss, ".masthead-shell .sidebar-usage", "bottom: 16px;");
    const sidebarMobileRule = cssRuleBodyContaining(
      mastheadCss,
      "@media (max-width: 760px)",
      ".masthead-shell .sidebar-usage"
    );
    expect(sidebarPositionRule).toContain("position: absolute;");
    expect(sidebarPositionRule).toContain("bottom: 16px;");
    expect(sidebarMobileRule).toContain("position: static;");
    expect(mastheadCss).not.toContain(".masthead-shell .import-jobs-section::after");
    expect(mastheadCss).not.toContain(".masthead-shell .session-dossier");
  });

  test("Logbook CSS no longer carries session-era summary strip chrome", () => {
    const logbookCss = readFileSync("src/styles/logbook.css", "utf8");
    expect(logbookCss).not.toContain(".logbook-summary-strip");
    expect(logbookCss).toContain(".logbook-col-kind");
    expect(logbookCss).toContain(".logbook-col-confidence");
    expect(logbookCss).toContain(".logbook-col-provenance");
  });
});

expect.extend({
  toContainDeclarationsFrom(received: string, expected: string) {
    const missing = cssDeclarations(expected).filter((declaration) => !cssDeclarations(received).includes(declaration));
    return {
      message: () => `expected CSS rule to contain declarations:\n${missing.join("\n")}`,
      pass: missing.length === 0
    };
  }
});

declare module "vitest" {
  interface Assertion<T = any> {
    toContainDeclarationsFrom(expected: string): T;
  }
}

function normalizeCssRule(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cssDeclarations(value: string): string[] {
  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => `${declaration};`);
}

function withoutCssDeclarations(value: string, declarations: string[]): string {
  const excluded = new Set(declarations);
  return cssDeclarations(value)
    .filter((declaration) => !excluded.has(declaration))
    .join("\n");
}

function cssRuleBody(css: string, selector: string, options: { nestedSelector?: string } = {}): string {
  const body = findCssRuleBody(css, selector);
  return options.nestedSelector ? findCssRuleBody(body, options.nestedSelector) : body;
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

function findCssRuleBody(css: string, selector: string): string {
  const selectorIndex = findCssSelectorIndex(css, selector);
  if (selectorIndex === -1) throw new Error(`Expected CSS to contain rule for ${selector}`);

  return extractCssRuleBodyAt(css, selector, selectorIndex);
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function elementFor(ui: ReactElement, selector: string): Element {
  return requiredElement(documentFor(ui), selector);
}

function documentFor(ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(ui);
  return host;
}

function requiredElement(root: ParentNode, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Expected rendered markup to contain ${selector}`);
  return element;
}

function expectSessionMockupStructure(element: Element, stateClassName: string): void {
  expect(element.classList.contains("session-card")).toBe(true);
  expect(element.classList.contains("bottom-variant-card")).toBe(true);
  expect(element.classList.contains("dovetail-card")).toBe(true);
  expect(element.classList.contains(stateClassName)).toBe(true);
  expect(element.querySelector(":scope > .bottom-signal")).toBeTruthy();
  expect(element.querySelector(":scope > .card-topline")).toBeTruthy();
  expect(element.querySelector(":scope > h3.headline")).toBeTruthy();
  expect(element.querySelector(":scope > .fact-grid")).toBeTruthy();
  expect(element.querySelector(":scope > .footer-line")).toBeTruthy();
  expect(element.querySelector(":scope > .dovetail-base")).toBeNull();
}

function expectNoDovetailTreatment(html: string): void {
  expect(html).not.toContain("dovetail-info-card");
  expect(html).not.toContain("bottom-variant-card");
  expect(html).not.toContain("dovetail-card");
  expect(html).not.toContain("bottom-signal");
  expect(html).not.toContain("dovetail-card-surface");
  expect(html).not.toContain("dovetail-base");
}

function sessionFixture(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    changedFileCount: 1,
    headline: {
      headline: "Refining the live card hierarchy.",
      frame: {
        subject: "Live card hierarchy",
        disposition: "uses canonical session evidence",
        state: "active",
        subjectKind: "component",
        confidence: "high",
        evidence: []
      },
      source: "llm",
      status: "ready"
    },
    harness: "OpenCode",
    durationLabel: "24m",
    identityConfidence: "direct",
    indicators: [],
    isExpanded: false,
    lastActivity: "2026-06-29T20:24:00.000Z",
    lastActivityLabel: "2m ago",
    lifecycle: "running",
    primaryStatus: "editing",
    priorityRank: 10,
    project: "Masthead",
    safeActions: [],
    sessionId: "session-1",
    stateLabel: "Active",
    title: "Masthead session",
    totalTokens: 18400,
    ...overrides
  };
}

function attentionFixture(): AttentionItem {
  return {
    affectedCommandIds: ["cmd-1"],
    affectedPaths: [],
    createdAt: "2026-06-29T20:24:00.000Z",
    evidence: [{ id: "event-1", kind: "event", observedAt: "2026-06-29T20:24:00.000Z", source: "test" }],
    itemId: "attention-1",
    project: "Masthead",
    sessionId: "session-1",
    severity: "P1",
    suggestedNextAction: "Inspect the failed command before continuing.",
    support: "deterministic",
    title: "Command failed",
    type: "command_failed"
  };
}

function usageStatsFixture(overrides: Partial<UsageStatsDto["totals"]> = {}): UsageStatsDto {
  const totals = {
    fileEffects: 1,
    inputTokens: 8000,
    mcpQueries: 1,
    messages: 2,
    models: 1,
    outputTokens: 4500,
    projects: 1,
    runtimes: 1,
    sessions: 1,
    tokenCoverageSessions: 1,
    tokenRows: 1,
    tokensPerMinute: 17,
    toolCalls: 3,
    totalTokens: 12500,
    ...overrides
  };

  return {
    activity: [{ bucketStart: "2026-06-29T20:00:00.000Z", fileEffects: 1, messages: 2, sessions: totals.sessions, toolCalls: 3, totalTokens: totals.totalTokens }],
    byModel: [{ inputTokens: totals.inputTokens, model: "gpt-5-opencode", outputTokens: totals.outputTokens, provider: "openai", sessions: totals.sessions, totalTokens: totals.totalTokens }],
    byProject: [{ fileEffects: 1, messages: 2, project: "Masthead", sessions: totals.sessions, toolCalls: 3, totalTokens: totals.totalTokens }],
    byRuntime: [{ fileEffects: 1, messages: 2, runtime: "opencode", sessions: totals.sessions, toolCalls: 3, totalTokens: totals.totalTokens }],
    coverage: {
      currentEnrichments: 1,
      importedSessions: totals.sessions,
      mcpQueries: 1,
      sessionsWithTokenUsage: totals.tokenCoverageSessions,
      sessionsWithoutTokenUsage: Math.max(0, totals.sessions - totals.tokenCoverageSessions),
      sources: 1
    },
    generatedAt: "2026-06-29T20:30:00.000Z",
    range: { from: "2026-06-29T00:00:00.000Z", to: "2026-06-29T20:30:00.000Z" },
    totals,
    window: "today"
  };
}

function dossierFixture(): SessionDossierDto {
  return {
    attention: [],
    artifacts: [],
    coverage: {
      level: "complete",
      transcript: {
        assistantMessages: 1,
        checkpoints: 0,
        fileEffects: 0,
        hasUsableTranscript: true,
        lowValueItems: 0,
        messages: 1,
        runtimeSignals: 0,
        toolCalls: 0,
        toolResults: 0,
        userMessages: 1
      },
      warnings: []
    },
    enrichment: { status: "current" },
    excerpts: [],
    files: [],
    identity: {
      hostId: "host:test",
      lastActivityAt: "2026-06-29T20:24:00.000Z",
      lifecycle: "ended",
      model: "gpt-5-opencode",
      models: ["gpt-5-opencode"],
      project: "Masthead",
      runtime: "opencode",
      sessionId: "canonical-session-1",
      sourceConfidence: "authoritative",
      sourceSessionId: "source-session-1",
      title: "Masthead session"
    },
    narrative: {
      finalAssistantMessage: "Implemented the selected card treatment.",
      firstUserPrompt: "Apply the dovetail card treatment.",
      latestUserPrompt: "Apply the dovetail card treatment.",
      liveSummary: "Session card work completed.",
      objective: "Apply dovetail card treatment.",
      outcome: "Implementation plan created.",
      technologies: ["React"],
      topics: ["UI"],
      unresolved: []
    },
    reuse: {
      canonicalSessionId: "canonical-session-1",
      copyableContext: "Session context.",
      mcpIncluded: true,
      sourceConfidence: "authoritative",
      sourceRuntime: "opencode",
      sourceSessionId: "source-session-1"
    },
    timeline: [],
    tools: [],
    usage: { inputTokens: 8000, outputTokens: 4500, totalTokens: 12500, usageRows: 1 },
    verification: { commands: [], status: "missing", summary: "No verification captured." }
  };
}

function sourcesSetupFixture(): SourcesSetupDto {
  const connectedSource = {
    discoveredSessions: 742,
    importedSessions: 120,
    label: "OpenCode sessions",
    runtime: "opencode",
    sourceId: "opencode-sessions",
    state: "connected" as const
  };

  return {
    advanced: {
      adapters: [],
      imports: [],
      sources: [connectedSource]
    },
    connectedSources: [connectedSource],
    coverage: {
      enrichedSessions: 320,
      metadataSessions: 120,
      missingEnrichment: 14,
      missingTranscripts: 20,
      queued: 14,
      sessions: 742,
      transcriptSessions: 100
    },
    setupId: "setup-1",
    status: "ready",
    updatedAt: "2026-06-29T20:00:00.000Z"
  };
}
