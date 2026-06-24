# Corrected AI Agent Observability Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retarget the Masthead observability redesign to the corrected screenshot: a dense three-column session board with status-first header, compact toolbar, and right-side telemetry panels, while preserving clearly marked demo data for metrics Masthead does not collect yet.

**Architecture:** Reuse the observability scaffolding already implemented in `src/ui/observabilityDemo.ts`, `DemoBadge`, `MetricCard`, `ObservabilityConsoleShell`, `ObservabilitySidebar`, `ObservabilityTopbar`, `ObservabilityRightRail`, `Toolbar`, `SessionBoard`, and `SessionCard`. The correction is mostly composition and visual hierarchy: remove the center KPI strip, move system status into the top header, make the toolbar a single compact row, constrain the session board to three columns on desktop, and rebuild the right rail around metric cards plus model/token panels.

**Tech Stack:** React 19, TypeScript, Vite, Vitest server-render tests, CSS in `src/styles/masthead.css`, existing fixture/live projection data, Codex in-app Browser with the `iab` backend for local visual QA.

---

**Optimized with:** `plan-optimizer`

**Score trajectory:** `87 -> 92 -> 95 -> 96 -> 96`

**Final score:** `96 / 100`

## Optimizer Rubric

| Criterion | Weight | Final | What changed |
| --- | ---: | ---: | --- |
| Corrected reference fidelity | 25 | 24 | Converted the plan from the wrong KPI-heavy target to a status-header, toolbar, three-column-board, right-rail target with explicit absence checks. |
| Reuse of existing partial work | 15 | 15 | Treats the already-built observability components as scaffolding to reshape instead of restarting or reverting blindly. |
| Demo-data honesty and restraint | 15 | 14 | Keeps source tagging strict while adding clustered-label rules so the design does not become badge-noisy. |
| Sequencing and dependencies | 15 | 14 | Orders data shape, header/sidebar/toolbar, right rail, cards, composition, CSS, browser QA, then full verification. |
| Testability and verification | 15 | 15 | Adds targeted tests, app-level absence checks, duplicate-ID checks, build/typecheck/full-suite gates, and in-app Browser visual gates. |
| Responsive craft | 10 | 9 | Requires desktop, 1280, tablet, and phone checks with no overflow and phone-first workspace order. |
| Rollback and risk control | 5 | 5 | Keeps old shell components and data contracts intact; rollback remains UI composition only. |

**Substantive optimizer changes:**

- Added a partial-implementation audit so the executor starts from the wrong-reference code currently in the tree and reshapes it deliberately.
- Added non-negotiable visual absence checks for the center KPI strip, large status banner, `Recent Errors`, and `Resource Utilization`.
- Strengthened data mapping for per-card file deltas and demo-source labeling.
- Added concrete desktop and responsive pass/fail gates, including right rail panel order and three-column card density.
- Added execution-split guidance for subagents without overlapping write scopes.

## Corrected Reference Delta

The previous plan targeted the wrong screenshot. Keep the useful work already done, but update the visual target to this corrected image:

- Left sidebar stays permanent on desktop with Masthead identity, version `v1.8.3`, nav groups, session count, alert count, system status/API, and update notice.
- The main header is no longer an "AI Agent Observability" title block. It is a status header:
  - green live dot
  - `System status: 16 active, 5 idle, 3 blocked sessions across 3 environments.`
  - supporting line: `Work is progressing with low latency and stable performance. 3 sessions require attention.`
  - controls on the right: Last 24 hours, Live, 10s, filter icon, settings icon.
- The center KPI row from the wrong implementation must be removed from the main column.
- The toolbar sits directly below the status header and is one dense row: search, All Agents, All Lifecycles, All Environments, All Hosts, Recently Started, grid icon.
- Session cards are the main visual. Desktop target is three columns by three rows in the first board area, not five compact columns.
- Each session card must show the agent/harness runtime, such as `Codex`, `Claude Code`, `OpenClaw`, or `Hermes`. The corrected reference image does not show this yet, but Masthead needs it to make cross-harness observability useful.
- The right rail starts at the toolbar/card area and contains:
  - Total Tokens (24h)
  - Total Cost (24h)
  - Top Models (24h)
  - Tokens / Min sparkline
- Remove the previous `Recent Errors` and `Resource Utilization` right-rail treatment from the first viewport for this target.
- Demo-data labels remain required by Tyler, but they should be clustered and quiet: one small `Demo data` marker per fake-control group, per fake metric panel, or per card fake telemetry cluster, not repeated after every tiny value.

## Non-Negotiable Visual Checks

The corrected implementation fails visual acceptance if any of these are true at desktop reference width:

- The main column still starts with an `AI Agent Observability` title block.
- A center KPI grid appears before the session cards.
- A large blue system-status banner appears below KPI cards.
- The right rail contains `Recent Errors` or the old three-row `Resource Utilization` panel in the first viewport.
- The session board renders five narrow columns instead of three wide cards.
- Session cards do not show a visible `Harness`/runtime value.
- Demo badges appear after most individual card values instead of one quiet badge per fake-data cluster.

The corrected implementation passes the primary visual gate when the scan order is:

```text
sidebar -> status header -> toolbar -> three-column card board -> right telemetry rail
```

## Current Work To Reuse

These pieces already exist from the previous pass and should be reshaped rather than restarted:

- `src/ui/observabilityDemo.ts`
- `src/ui/DemoBadge.tsx`
- `src/ui/MetricCard.tsx`
- `src/ui/ObservabilityConsoleShell.tsx`
- `src/ui/ObservabilitySidebar.tsx`
- `src/ui/ObservabilityTopbar.tsx`
- `src/ui/ObservabilityMetricGrid.tsx`
- `src/ui/ObservabilityStatusBanner.tsx`
- `src/ui/ObservabilityRightRail.tsx`
- `src/ui/Toolbar.tsx`
- `src/ui/SessionBoard.tsx`
- `src/ui/SessionCard.tsx`
- Observability tests under `src/ui/__tests__/`
- Existing observability CSS section in `src/styles/masthead.css`

Expected implementation shape: keep the files, but stop rendering `ObservabilityMetricGrid` and `ObservabilityStatusBanner` in the first viewport. Their tests may either be adjusted for unused component behavior or left intact if the components remain valid and unused.

## Current Partial Implementation Audit

Before editing, assume the working tree may already contain the wrong-reference implementation. The executor should verify the actual state instead of assuming a clean baseline.

Check these current-state facts:

- `src/app/App.tsx` likely still renders `ObservabilityMetricGrid` and `ObservabilityStatusBanner`; those must leave the first viewport.
- `src/ui/ObservabilityTopbar.tsx` likely still renders `AI Agent Observability`; it must become the status header.
- `src/ui/ObservabilityRightRail.tsx` likely still renders `Recent Errors` and `Resource Utilization`; those must be replaced for the corrected target.
- `src/ui/Toolbar.tsx` may still expose old state chips; those must not dominate the first-viewport toolbar.
- `src/styles/masthead.css` likely contains responsive fixes from the first pass; keep useful no-overflow/mobile-order rules while retargeting desktop density.

Do not delete the previous components just because they are no longer first-viewport elements. Leave them unused or below-fold unless removing them is required to pass typecheck.

## Execution Split Guidance

If executing with subagents, use disjoint ownership to avoid conflicts:

- Agent A: `ObservabilityTopbar.tsx`, `ObservabilitySidebar.tsx`, and their tests.
- Agent B: `observabilityDemo.ts`, `SessionCard.tsx`, `SessionBoard.tsx`, and their tests.
- Agent C: `ObservabilityRightRail.tsx`, `MetricCard.tsx` only if needed, and right-rail tests.
- Main agent: `App.tsx`, `Toolbar.tsx`, `src/styles/masthead.css`, browser QA, and final verification.

Do not assign multiple agents to `src/styles/masthead.css`; it is the highest-conflict file.

## Scope

### Real data to preserve

- `board.summary.running`, `summary.active`, `summary.idle`, `summary.needsAttention`, `summary.needsAction`, `summary.conflicts`, `summary.completed`.
- `board.cards` for session identity, headline, status, reason, lifecycle state, changed file count, duration, last activity, indicators, and safe actions.
- `board.attentionQueue`, `historyRecords`, local retention/export/delete actions, and `SessionDetailModal`.
- `liveConnection` for live/demo/offline source labeling.

### Demo data to preserve or add

- Token totals and deltas.
- Total cost and delta.
- Model ranking.
- Tokens/min value and sparkline.
- Per-card model labels, harness/runtime labels, host labels, commands/tests, progress, platform.
- Per-card added/removed file counts and file-strip bars, because the screenshot shows `+18`, `-4`, and mini changed-file bars but Masthead only has total changed-file count today.
- Sidebar counts where current projection does not exactly provide the screenshot counts.

### Source-labeling rules

- Real projection values do not get demo badges.
- A fake metric panel gets one badge in the panel header or metric-card header.
- A fake toolbar control group gets one badge at the end of the group.
- A fake session-card telemetry cluster gets one badge in the footer.
- Do not place a `Demo data` badge after every model, harness, host, command count, progress value, platform label, or file-delta number.

### Non-goals

- No collector/schema changes.
- No token/cost/latency calculation.
- No LLM calls.
- No external browser automation. Use Codex in-app Browser with `iab`.
- No new icon dependency unless the repo already has one. Use text/icon-like CSS or existing local patterns.
- Do not delete old shell components; keep rollback cheap.

## Acceptance Criteria

- At desktop width similar to the corrected reference, the first viewport shows: sidebar, status header, toolbar, three-column session board, and right rail telemetry.
- There is no center KPI row above the status/toolbar area.
- There is no large blue status banner below a KPI row. Status lives in the header.
- The right rail has `Total Tokens (24h)`, `Total Cost (24h)`, `Top Models (24h)`, and `Tokens / Min`.
- Session cards visually differentiate active, idle, and blocked states with green, blue, and red left borders/tokens.
- Every session card shows a visible `Harness` value so operators can distinguish Codex, Claude Code, OpenClaw, Hermes, or future runtimes.
- Missing data remains visibly marked as demo data, but the labels do not dominate the card layout.
- Card clicks still open `SessionDetailModal`.
- App has no duplicate IDs and no horizontal overflow at `390`, `768`, `1280`, and desktop widths.
- `npm run typecheck`, `npm run build`, and `npm test -- --run` pass. The full test suite may need escalation because ingest tests bind `127.0.0.1`.

## Data Mapping Table

| Screenshot element | Source now | Demo label rule |
| --- | --- | --- |
| Active count | `summary.running ?? summary.active` | Real; no badge. |
| Idle count | `summary.idle ?? 0` | Real if present; no badge. |
| Blocked count | `summary.needsAction ?? summary.needsAttention` | Real; no badge. |
| Environment count | hardcoded `3` until environment telemetry exists | No badge in header; this is contextual demo text covered by the overall corrected-target prototype. |
| Session headline/status/duration | `board.cards` | Real; no badge. |
| Changed file total | `session.changedFileCount` | Real; no badge. |
| Added/removed file deltas and file bars | `sessionDemoTelemetry(...).filesChanged` | One badge in card footer. |
| Harness/runtime label | demo from `sessionDemoTelemetry(...).harness` until `SessionCardView` exposes adapter-derived runtime | One badge in card footer. |
| Model/host/platform labels | `sessionDemoTelemetry(...)` | One badge in card footer. |
| Commands/tests and progress | `sessionDemoTelemetry(...)` | One badge in card footer. |
| Total Tokens, Total Cost, Top Models, Tokens / Min | `observabilityDemoTelemetry` | One badge per right-rail panel or metric card. |
| Toolbar agent/lifecycle/environment/harness/host/sort controls | inert UI-only controls | One badge at the end of the toolbar control group. |
| Sidebar alert count | demo default until backed by real alert data | Quiet marker or `data-source="demo"` on the count element. |

## Rollback Path

Rollback is UI-composition-only. No storage, collector, schema, or projection contract changes are in scope.

If the corrected target cannot pass typecheck or browser visual QA after Task 8:

1. Restore `src/app/App.tsx` to the last passing observability composition.
2. Leave corrected components in place but unused if they compile.
3. Keep `observabilityDemo.ts` additions only if no runtime code depends on removed fields.
4. Re-run:

```bash
npm run typecheck
npm test -- --run src/ui/__tests__/liveBoard.test.tsx
```

Rollback is required if:

- `SessionDetailModal` can no longer open from cards.
- App-level tests cannot avoid duplicate IDs without a larger refactor.
- The desktop first viewport still cannot fit sidebar, status header, toolbar, three-column board, and right rail after the CSS pass.

## File Plan

- Modify `src/app/App.tsx`
  - Remove `ObservabilityMetricGrid` and `ObservabilityStatusBanner` from first-screen composition.
  - Pass summary/connection state into `ObservabilityTopbar`.
  - Keep `SessionDetailModal`, history, operations, and attention sections below the fold.

- Modify `src/ui/ObservabilityTopbar.tsx`
  - Convert from title/header to status-first header.
  - Render the exact status summary from real counts.
  - Keep controls aligned right.

- Modify `src/ui/ObservabilitySidebar.tsx`
  - Align labels/counts with corrected screenshot: `Logbook`, alert count, `v1.8.3`, API footer, update notice.
  - Use demo markers only where counts are fake.

- Modify `src/ui/Toolbar.tsx`
  - Remove old visible `All sessions`, `Needs attention`, `Conflicts` pills from the first viewport.
  - Keep search behavior.
  - Render fake dropdown-style controls for agents, lifecycles, environments, harnesses, hosts, and sort order as inert buttons and mark the group once as demo.
  - Add a grid-view icon button.

- Modify `src/ui/ObservabilityRightRail.tsx`
  - Replace previous recent-errors/resource-utilization panel set with corrected right rail.
  - Reuse `MetricCard` for Total Tokens and Total Cost.
  - Add a compact `Tokens / Min` sparkline panel.
  - Keep top models table.

- Modify `src/ui/observabilityDemo.ts`
  - Keep existing demo telemetry.
  - Add per-session `filesChanged.added`, `filesChanged.removed`, and `fileBars`.
  - Add per-session `harness` values from `Codex`, `Claude Code`, `OpenClaw`, and `Hermes`.
  - Keep `errors24h` only if tests still need it, but do not show it in the corrected first viewport.

- Modify `src/ui/SessionCard.tsx`
  - Make card bodies state-specific:
    - Active: files changed added/removed strip, commands/tests, progress percentage.
    - Idle: last activity and progress.
    - Blocked: blocked reason and blocked-at value.
  - Display `Harness` in the primary facts row or as a compact chip near the model/host values.
  - Keep one quiet demo marker per card footer when demo telemetry is present.

- Modify `src/ui/SessionBoard.tsx`
  - Keep the `observability` variant.
  - Ensure the desktop board lays out as three columns in the main content area.

- Modify `src/styles/masthead.css`
  - Retarget layout to `sidebar | main board | right rail`.
  - Remove top KPI grid spacing from the first viewport.
  - Make the header, toolbar, card grid, and right rail match the corrected screenshot density.
  - Keep mobile order as workspace first, sidebar later.

- Modify tests under `src/ui/__tests__/`
  - Update topbar, toolbar, right rail, session card, and app composition expectations.
  - Keep demo telemetry tests strict about source marking.

## Task 0: Confirm Baseline From Current Partial Implementation

- [ ] **Step 1: Run typecheck.**

```bash
npm run typecheck
```

Expected: PASS before starting the correction.

- [ ] **Step 2: Run current observability tests.**

```bash
npm test -- --run src/ui/__tests__/observabilityDemo.test.ts src/ui/__tests__/demoBadge.test.tsx src/ui/__tests__/metricCard.test.tsx src/ui/__tests__/observabilityConsoleShell.test.tsx src/ui/__tests__/observabilitySidebar.test.tsx src/ui/__tests__/observabilityTopbar.test.tsx src/ui/__tests__/observabilityMetricGrid.test.tsx src/ui/__tests__/observabilityStatusBanner.test.tsx src/ui/__tests__/observabilityToolbar.test.tsx src/ui/__tests__/observabilitySessionCard.test.tsx src/ui/__tests__/observabilityRightRail.test.tsx src/ui/__tests__/liveBoard.test.tsx
```

Expected: PASS. If failures exist from the interrupted prior pass, record them and fix only when they overlap this corrected target.

- [ ] **Step 3: Audit current wrong-reference artifacts.**

Run:

```bash
rg -n "AI Agent Observability|Agent health metrics|Recent Errors|Resource Utilization|ObservabilityMetricGrid|ObservabilityStatusBanner" src/app src/ui src/styles
```

Expected before correction: at least some matches exist because the previous pass used the wrong reference. Required outcome by Task 10:

- `AI Agent Observability` is not rendered in the first viewport header.
- `aria-label="Agent health metrics"` is not rendered by `App`.
- `Recent Errors` is not rendered by the corrected right rail.
- `Resource Utilization` is not rendered by the corrected right rail.
- `ObservabilityMetricGrid` and `ObservabilityStatusBanner` are not imported or rendered by `src/app/App.tsx`.

## Task 1: Retarget Demo Telemetry For Corrected Cards

**Files:**
- Modify: `src/ui/observabilityDemo.ts`
- Modify: `src/ui/__tests__/observabilityDemo.test.ts`

- [ ] **Step 1: Update the demo telemetry test to cover file deltas.**

Add assertions to the per-session test:

```ts
expect(telemetry.filesChanged.source).toBe("demo");
expect(telemetry.filesChanged.value.added).toBeGreaterThanOrEqual(0);
expect(telemetry.filesChanged.value.removed).toBeGreaterThanOrEqual(0);
expect(telemetry.filesChanged.value.bars.length).toBe(10);
expect(telemetry.harness.source).toBe("demo");
expect(["Codex", "Claude Code", "OpenClaw", "Hermes"]).toContain(telemetry.harness.value);
```

- [ ] **Step 2: Update `DemoSessionTelemetry`.**

Add this field:

```ts
filesChanged: DemoSourcedValue<{
  added: number;
  removed: number;
  bars: Array<"add" | "remove" | "neutral">;
}>;
harness: DemoSourcedValue<"Codex" | "Claude Code" | "OpenClaw" | "Hermes">;
```

- [ ] **Step 3: Populate deterministic file deltas.**

Near the existing demo lookup arrays, add:

```ts
const harnesses = ["Codex", "Claude Code", "OpenClaw", "Hermes"] as const;
```

Inside `sessionDemoTelemetry`, add:

```ts
const added = 3 + ((seed * 7) % 40);
const removed = seed % 12;
const bars = Array.from({ length: 10 }, (_, barIndex) => {
  if (barIndex < Math.min(5, Math.ceil(added / 10))) return "add" as const;
  if (barIndex < Math.min(8, Math.ceil(added / 10) + Math.ceil(removed / 4))) return "remove" as const;
  return "neutral" as const;
});
```

Return:

```ts
filesChanged: { value: { added, removed, bars }, source: "demo" },
harness: { value: harnesses[seed % harnesses.length], source: "demo" },
```

- [ ] **Step 4: Verify.**

```bash
npm test -- --run src/ui/__tests__/observabilityDemo.test.ts
npm run typecheck
```

Expected: PASS.

## Task 2: Convert Topbar To Status Header

**Files:**
- Modify: `src/ui/ObservabilityTopbar.tsx`
- Modify: `src/ui/__tests__/observabilityTopbar.test.tsx`

- [ ] **Step 1: Update the topbar test.**

Expected rendered strings:

```tsx
expect(html).toContain("System status:");
expect(html).toContain("16 active, 5 idle, 3 blocked sessions across 3 environments.");
expect(html).toContain("Work is progressing with low latency and stable performance. 3 sessions require attention.");
expect(html).toContain("Last 24 hours");
expect(html).toContain("Live");
expect(html).toContain("10s");
```

- [ ] **Step 2: Change `ObservabilityTopbar` props.**

Use:

```ts
import type { LiveBoardProjection } from "../core/types";

type Props = {
  summary: LiveBoardProjection["summary"];
  liveLabel: string;
  environmentCount?: number;
  onToggleDemoData: () => void;
  showDemoData: boolean;
};
```

- [ ] **Step 3: Render the corrected header.**

Implementation shape:

```tsx
const active = summary.running ?? summary.active;
const idle = summary.idle ?? 0;
const blocked = summary.needsAction ?? summary.needsAttention;

<div className="status-heading">
  <span className="live-dot" aria-hidden="true" />
  <div>
    <h1>System status: {active} active, {idle} idle, {blocked} blocked sessions across {environmentCount} environments.</h1>
    <p>Work is progressing with low latency and stable performance. {blocked} sessions require attention.</p>
  </div>
</div>
```

Keep the right-side controls as buttons.

- [ ] **Step 4: Verify.**

```bash
npm test -- --run src/ui/__tests__/observabilityTopbar.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 3: Retarget Sidebar Copy And Counts

**Files:**
- Modify: `src/ui/ObservabilitySidebar.tsx`
- Modify: `src/ui/__tests__/observabilitySidebar.test.tsx`

- [ ] **Step 1: Update the test expectations.**

Expect:

```tsx
expect(html).toContain("v1.8.3");
expect(html).toContain("Sessions");
expect(html).toContain("24");
expect(html).toContain("Logbook");
expect(html).toContain("Alerts");
expect(html).toContain("3");
expect(html).toContain("API");
expect(html).toContain("Update available");
```

- [ ] **Step 2: Add props for screenshot counts.**

Use:

```ts
type Props = {
  version: string;
  activeCount: number;
  connectionLabel: string;
  alertCount?: number;
};
```

Render `activeCount` in the Sessions pill. Use `alertCount = 3` only as demo/default and mark that count with a quiet demo attribute or nearby demo marker if not real.

- [ ] **Step 3: Verify.**

```bash
npm test -- --run src/ui/__tests__/observabilitySidebar.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 4: Correct The Toolbar

**Files:**
- Modify: `src/ui/Toolbar.tsx`
- Modify: `src/ui/__tests__/observabilityToolbar.test.tsx`

- [ ] **Step 1: Update the toolbar test.**

Keep expectations for:

```tsx
expect(html).toContain("Filter sessions...");
expect(html).toContain("All Agents");
expect(html).toContain("All Lifecycles");
expect(html).toContain("All Environments");
expect(html).toContain("All Harnesses");
expect(html).toContain("All Hosts");
expect(html).toContain("Recently Started");
expect(html).toContain("Demo data");
```

Remove expectations that `All sessions`, `Needs attention`, and `Conflicts` appear in the first viewport toolbar.

- [ ] **Step 2: Simplify toolbar markup.**

Render:

```tsx
<section className="board-toolbar observability-toolbar" aria-label="Board controls">
  <label className="search-field">
    <span className="mono-label">Search</span>
    <input
      ref={searchInputRef}
      type="search"
      placeholder="Filter sessions..."
      value={query}
      onChange={(event) => onQueryChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onQueryChange("");
        }
      }}
    />
  </label>
  <div className="toolbar-select-row" aria-label="Demo filter controls">
    <DemoSelect label="All Agents" />
    <DemoSelect label="All Lifecycles" />
    <DemoSelect label="All Environments" />
    <DemoSelect label="All Harnesses" />
    <DemoSelect label="All Hosts" wide />
    <DemoSelect label="Recently Started" />
    <DemoBadge />
  </div>
  <button type="button" className="toolbar-icon-button" aria-label="Grid view">
    <span aria-hidden="true">::</span>
  </button>
</section>
```

Keep `query`, `onQueryChange`, and Escape-to-clear behavior. Keep `filter` props for compatibility even if the state chips are no longer visible.

- [ ] **Step 3: Verify.**

```bash
npm test -- --run src/ui/__tests__/observabilityToolbar.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 5: Rebuild The Corrected Right Rail

**Files:**
- Modify: `src/ui/ObservabilityRightRail.tsx`
- Modify: `src/ui/__tests__/observabilityRightRail.test.tsx`

- [ ] **Step 1: Update the right-rail test.**

Expect:

```tsx
expect(html).toContain("Total Tokens (24h)");
expect(html).toContain("48.7M");
expect(html).toContain("Total Cost (24h)");
expect(html).toContain("$123.47");
expect(html).toContain("Top Models (24h)");
expect(html).toContain("Tokens / Min");
expect(html).toContain("12.4K");
expect(html).not.toContain("Recent Errors");
expect(html).not.toContain("Resource Utilization");
```

- [ ] **Step 2: Render corrected panel order.**

Implementation shape:

```tsx
<MetricCard label="Total Tokens (24h)" value={observabilityDemoTelemetry.tokens24h.value} delta="+12.1M" tone="good" source="demo" />
<MetricCard label="Total Cost (24h)" value={observabilityDemoTelemetry.totalCost24h.value} delta="+$18.22" tone="good" source="demo" />
<section id="top-models" className="telemetry-panel">
  <PanelHead title="Top Models (24h)" demo />
  <div className="model-table">
    <span>Model</span>
    <span>Tokens</span>
    <span>Cost</span>
    {observabilityDemoTelemetry.topModels.map((model) => (
      <div key={model.model} className="model-row">
        <strong>{model.model}</strong>
        <span>{model.tokens}</span>
        <span>{model.cost}</span>
      </div>
    ))}
  </div>
</section>
<section id="tokens-per-minute" className="telemetry-panel tokens-minute-panel">
  <PanelHead title="Tokens / Min" demo />
  <div className="tokens-minute-value">
    <strong>12.4K</strong>
    <span>+1.8K</span>
  </div>
  <div className="tokens-sparkline" aria-label="Tokens per minute demo sparkline">
    {observabilityDemoTelemetry.resourceSeries
      .find((series) => series.label === "Tokens / min")
      ?.points.map((point, index) => (
        <span key={index} style={{ height: `${point}%` }} />
      ))}
  </div>
</section>
```

Do not render `recent-errors` or `resource-utilization` in the corrected first-viewport rail.

- [ ] **Step 3: Verify.**

```bash
npm test -- --run src/ui/__tests__/observabilityRightRail.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 6: Correct Session Cards

**Files:**
- Modify: `src/ui/SessionCard.tsx`
- Modify: `src/ui/__tests__/observabilitySessionCard.test.tsx`

- [ ] **Step 1: Update the card test for corrected content.**

Expect active-card markup to contain:

```tsx
expect(html).toContain("Commands / Tests");
expect(html).toContain("Files Changed");
expect(html).toContain("Harness");
expect(html).toContain("Demo data");
expect(html).toContain("Started");
```

Add a blocked-card case that expects:

```tsx
expect(html).toContain("Blocked Reason");
expect(html).toContain("Blocked At");
```

- [ ] **Step 2: Add file delta strip.**

In active/running cards, render:

```tsx
<div className="file-delta-row">
  <span className="delta-add">+{demoTelemetry.filesChanged.value.added}</span>
  <span className="delta-remove">-{demoTelemetry.filesChanged.value.removed}</span>
</div>
<div className="file-bars" aria-hidden="true">
  {demoTelemetry.filesChanged.value.bars.map((bar, index) => (
    <span key={index} className={bar} />
  ))}
</div>
```

- [ ] **Step 3: Add the harness fact.**

In the shared card facts row, render:

```tsx
<Fact label="Harness" value={demoTelemetry?.harness.value ?? "Unknown"} />
```

Preferred card fact order:

```text
Runtime -> Harness -> Model -> Host
```

If four facts are too tight at `390px`, CSS should wrap to two columns on narrow screens rather than hiding the harness value.

- [ ] **Step 4: Split card body by lifecycle state.**

Use `session.indicators.includes("attention")` or `stateClassName(session)` to branch:

- Running/active: files changed, commands/tests, progress.
- Stalled/idle: last activity, progress.
- Needs attention/conflict: blocked reason, blocked at.

Keep the headline, top identity/status rows, and harness fact shared.

- [ ] **Step 5: Verify.**

```bash
npm test -- --run src/ui/__tests__/observabilitySessionCard.test.tsx src/ui/__tests__/liveBoard.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 7: Correct App Composition

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/ui/__tests__/liveBoard.test.tsx`

- [ ] **Step 1: Update app-level test expectations.**

Expect:

```tsx
expect(html).toContain("System status:");
expect(html).toContain("Total Tokens (24h)");
expect(html).toContain("Total Cost (24h)");
expect(html).toContain("Top Models (24h)");
expect(html).toContain("Tokens / Min");
expect(html).toContain("Harness");
expect(html).not.toContain('aria-label="Agent health metrics"');
```

Keep duplicate-ID assertion.

- [ ] **Step 2: Remove the wrong-reference first-viewport components.**

In `App.tsx`, remove these from the first-screen `main` content:

```tsx
<ObservabilityMetricGrid summary={board.summary} />
<ObservabilityStatusBanner summary={board.summary} brief={board.brief} />
```

Pass summary into topbar:

```tsx
topbar={
  <ObservabilityTopbar
    summary={board.summary}
    liveLabel={boardSource}
    onToggleDemoData={handleToggleDemoData}
    showDemoData={showDemoData}
  />
}
```

Keep:

```tsx
<Toolbar
  query={query}
  filter={filter}
  resultCount={filteredCards.length}
  totalCount={board.cards.length}
  onQueryChange={setQuery}
  onFilterChange={setFilter}
  searchInputRef={searchInputRef}
/>
<SessionBoard cards={filteredCards} lanes={board.lanes} onOpenSession={handleOpenSession} variant="observability" />
```

- [ ] **Step 3: Keep below-fold utility panels.**

History, operations, and attention can remain below the session board. They should not appear before the three-column card grid in desktop visual order.

- [ ] **Step 4: Verify.**

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx
npm run typecheck
```

Expected: PASS.

## Task 8: Correct CSS To Match The New Image

**Files:**
- Modify: `src/styles/masthead.css`

- [ ] **Step 1: Update desktop grid.**

Target:

```css
.observability-console {
  grid-template-columns: 220px minmax(0, 1fr) 280px;
  gap: 28px;
  width: min(1760px, calc(100vw - 32px));
}
```

Keep the right rail sticky on desktop.

- [ ] **Step 2: Retarget topbar styles.**

Add or update:

```css
.observability-topbar {
  min-height: 72px;
  border-bottom: 0;
  padding: 0;
}

.status-heading {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 10px;
}

.status-heading h1 {
  font-size: 19px;
  line-height: 1.2;
}

.status-heading p {
  margin-top: 5px;
  color: var(--mute);
}
```

- [ ] **Step 3: Remove main KPI-grid first-viewport spacing.**

Keep `.metric-card` because the right rail uses it. Do not rely on `.observability-metric-grid` for the corrected first viewport.

- [ ] **Step 4: Set board columns.**

Use:

```css
.observability-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
```

At `max-width: 1320px`, switch to two columns. At `max-width: 760px`, switch to one column.

Card facts should support four items on desktop:

```css
.observability-card-facts {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
```

At phone widths, switch card facts to two columns or one column if labels still overflow. Do not hide `Harness`.

- [ ] **Step 5: Compact toolbar.**

Use one desktop row:

```css
.observability-toolbar {
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr) 38px;
  min-height: 60px;
  align-items: center;
}
```

Ensure the fake select row scrolls internally only if needed and never creates page-level horizontal overflow.

- [ ] **Step 6: Right rail panel sizing.**

Style the two right-rail `metric-card` panels as full-width rail cards, not main-grid cards:

```css
.observability-right-rail > .metric-card {
  min-height: 106px;
}
```

Tokens/min sparkline should be a thin green line or compact bar series, not the old resource-utilization three-row block.

- [ ] **Step 7: Verify CSS build.**

```bash
npm run build
```

Expected: PASS.

## Task 9: Browser QA With Corrected Reference

**Files:**
- No source edits unless visual QA finds a concrete issue.

- [ ] **Step 1: Start or reuse local dev server.**

```bash
npm run dev:fixture
```

Expected: app is available at `http://127.0.0.1:5173`. If the port is already in use by the Masthead dev server, reuse it.

- [ ] **Step 2: Use Codex in-app Browser with `iab`.**

Navigate to:

```text
http://127.0.0.1:5173
```

Do not use standalone Playwright or external browser-control fallbacks.

- [ ] **Step 3: Desktop visual QA.**

Check at `1784 x 950` or similar:

- Sidebar visible.
- Status header visible.
- Toolbar directly below header.
- No center KPI row.
- Three-column session board.
- Session cards show Harness values.
- Right rail shows Total Tokens, Total Cost, Top Models, Tokens / Min.
- Demo labels are visible but quiet.
- No horizontal overflow.
- No duplicate IDs.

Run this read-only page audit in the in-app Browser:

```ts
const audit = await tab.playwright.evaluate(() => {
  const doc = document.documentElement;
  const body = document.body;
  const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  return {
    horizontalOverflow: Math.max(doc.scrollWidth, body.scrollWidth) > doc.clientWidth + 1,
    duplicateIds: Array.from(new Set(duplicateIds)),
    hasWrongTitle: document.body.textContent?.includes("AI Agent Observability") ?? false,
    hasAgentHealthMetrics: document.querySelector('[aria-label="Agent health metrics"]') !== null,
    hasRecentErrors: document.body.textContent?.includes("Recent Errors") ?? false,
    hasResourceUtilization: document.body.textContent?.includes("Resource Utilization") ?? false,
    hasHarnessLabel: document.body.textContent?.includes("Harness") ?? false,
    cardCount: document.querySelectorAll(".session-card").length,
    rightRailText: document.querySelector(".observability-right-rail")?.textContent ?? ""
  };
});
```

Expected audit:

```ts
expect(audit.horizontalOverflow).toBe(false);
expect(audit.duplicateIds).toEqual([]);
expect(audit.hasWrongTitle).toBe(false);
expect(audit.hasAgentHealthMetrics).toBe(false);
expect(audit.hasRecentErrors).toBe(false);
expect(audit.hasResourceUtilization).toBe(false);
expect(audit.hasHarnessLabel).toBe(true);
expect(audit.cardCount).toBeGreaterThanOrEqual(9);
expect(audit.rightRailText).toContain("Total Tokens (24h)");
expect(audit.rightRailText).toContain("Total Cost (24h)");
expect(audit.rightRailText).toContain("Top Models (24h)");
expect(audit.rightRailText).toContain("Tokens / Min");
```

Save screenshot:

```text
/tmp/masthead-corrected-observability-desktop.png
```

- [ ] **Step 4: Responsive QA.**

Check:

```text
1280 x 800
768 x 900
390 x 844
```

Expected:

- No horizontal overflow.
- Workspace content appears before sidebar on phone.
- Session cards do not overlap.
- Right rail stacks below the board on small widths.

Responsive pass/fail matrix:

| Width | Expected board columns | Expected rail behavior | Expected sidebar behavior |
| --- | ---: | --- | --- |
| `1784` | 3 | Sticky right rail visible beside board | Sticky left rail visible. |
| `1280` | 2 or 3, whichever avoids overflow | Rail may move below main if needed | Left rail remains visible if there is room. |
| `768` | 2 | Rail below main content | Sidebar may remain left if no overflow; otherwise stacks below workspace. |
| `390` | 1 | Rail below board | Workspace appears before sidebar. |

Save:

```text
/tmp/masthead-corrected-observability-1280.png
/tmp/masthead-corrected-observability-768.png
/tmp/masthead-corrected-observability-390.png
```

## Task 10: Final Verification

- [ ] **Step 1: Run typecheck.**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run build.**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run full tests.**

```bash
npm test -- --run
```

Expected: PASS. If sandbox blocks `127.0.0.1` with `EPERM`, rerun with approved escalation for loopback-binding tests.

## Risks And Guardrails

- **Risk:** Old `ObservabilityMetricGrid` remains rendered and keeps the wrong screenshot structure.
  - **Guard:** App-level test must assert the first viewport no longer contains `aria-label="Agent health metrics"`.

- **Risk:** Demo labels become visually noisy.
  - **Guard:** Label by cluster, not by every fake value.

- **Risk:** Removing visible state filter chips drops useful behavior.
  - **Guard:** Search remains live. If state filtering must stay visible later, add it as a compact secondary control after matching the corrected screenshot.

- **Risk:** Three-column cards overflow at intermediate widths.
  - **Guard:** Browser QA must check `1280`, `768`, and `390` widths and inspect `document.documentElement.scrollWidth <= clientWidth + 1`.

- **Risk:** Right rail IDs collide with existing sections.
  - **Guard:** Use `top-models` and `tokens-per-minute`; avoid reusing `attention`, `history`, or `operations`.

## Completion Definition

This corrected redesign is complete when the app visually matches the new reference at desktop scale, remains usable on tablet/mobile, preserves real Masthead session behavior, clearly marks demo-only telemetry, and passes typecheck, build, full tests, and in-app Browser verification.
