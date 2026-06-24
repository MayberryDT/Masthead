# Reference Mock UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real Masthead observability app match `/home/tyler/Documents/Masthead/mockups/masthead-observability-reference.html` as closely as possible, especially at the 1672x941 desktop reference viewport.

**Architecture:** Keep the existing React data flow and component seams, but replace the rendered observability surface with the final static mock structure: left sidebar, centered single-line headline, top controls, dense toolbar, 3-column session card board, and right telemetry rail. Do not add telemetry integrations or new business logic in this pass; use existing board summary/card fields plus the existing demo telemetry constants where the mock already depends on prototype data.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, plain CSS in `src/styles/masthead.css`, existing Masthead live/fixture board projection.

---

## Optimizer Record

**Rubric used:** Visual fidelity to the static mock (25), scope control/no logic creep (15), sequencing and dependencies (15), codebase fit/blast-radius control (15), tests and visual verification (15), risk mitigation/rollback clarity (10), handoff usability (5).

**Score trajectory:** `86 -> 92 -> 94 -> 94`

**Final score:** `94/100`

**Why it plateaued:** The remaining uncertainty is visual, not plan structure. The real score depends on browser screenshots after implementation, font rendering, and the exact amount of CSS transplant needed.

## Source Of Truth

- Visual contract: `/home/tyler/Documents/Masthead/mockups/masthead-observability-reference.html`
- Logo asset source: `/home/tyler/Documents/Masthead/mockups/masthead-logo-sail.png`
- Desktop acceptance viewport: `1672x941`
- Responsive verification widths: `1366x768`, `1024x768`, `768x900`, `390x844`
- Evidence directory for screenshots and notes: `/home/tyler/Documents/Masthead/docs/superpowers/evidence/reference-mock-ui/`

## Non-Negotiable Visual Requirements

- The app must not look like the earlier redesign. Use the current static mock, not the first screenshot.
- Surfaces must be hard, smooth, and slab-like: low radius, no bubbly plastic shine, no diagonal gray lines, no decorative orbs.
- Top headline is one centered line. No green dot. No subheadline.
- Sidebar logo uses the supplied sail image, not the CSS-drawn placeholder.
- Primary dashboard does not show lower local-history/operations/attention panels.
- Cards use the final compact schema: session id, harness, state badge, headline, Runtime, Model, Worktree, Last activity, Started.
- Cards must not show Files Changed, Commands / Tests, Progress, Host, platform, Blocked State, or Blocked Reason.
- Right rail shows Total Tokens, Top Models, Tokens / Min, and Session Mix. It does not show Total Cost.
- Visible "Demo data" badges are removed from this dashboard surface.

## Scope Boundaries

- This is a UI implementation pass, not a telemetry integration pass.
- Do not add new data adapters, event subscriptions, persistence paths, pricing logic, or app-server logic.
- Do not delete local history, operations, retention, review-disposition, or detail-modal functionality from the codebase. Remove those panels only from the primary dashboard composition unless a compile error forces an import cleanup.
- Do not change core projection, reducer, ingestion, store, retention, or Tauri/native-store behavior.
- Do not add a new icon package. Use existing CSS, inline SVG copied from the mock, or simple text glyphs as a temporary implementation detail.

## Visual Match Gates

The implementation is not complete until these gates pass:

- `1672x941` fixture-mode screenshot matches the static mock in layout, proportions, rhythm, and surface feel.
- Header headline is visually centered between the sidebar and right controls and stays on one line at the reference viewport.
- Sidebar logo/title block is vertically centered within the top brand area and does not touch the viewport edge.
- Session cards are `218px` tall at the reference desktop viewport and use the final compact card schema.
- Session Mix card is tall enough for all legend rows; no text crosses the border.
- No forbidden primary-dashboard text appears: `Demo data`, `Local history`, `Local records`, `needs attention`, `Commands / Tests`, `Files Changed`, `Progress`, `Host`, `Docker`, `Linux`, `Kubernetes`, `Blocked Reason`, `Total Cost`.
- Browser verification uses the Codex in-app Browser first, per repo instructions.

## File Map

- Modify: `/home/tyler/Documents/Masthead/src/app/App.tsx`
  - Keep polling, filtering, modal opening, demo/live toggle.
  - Stop rendering lower panels and the attention queue on the main dashboard.
  - Pass `summary` and `brief` to the topbar, and `summary` to the right rail.
- Modify: `/home/tyler/Documents/Masthead/src/ui/ObservabilityConsoleShell.tsx`
  - Keep landmarks, but ensure shell class structure supports the mock layout.
- Modify: `/home/tyler/Documents/Masthead/src/ui/ObservabilitySidebar.tsx`
  - Replace placeholder sail with image logo.
  - Match final nav groups and remove visible demo pills.
- Modify: `/home/tyler/Documents/Masthead/src/ui/ObservabilityTopbar.tsx`
  - Replace system-status block with a single headline and compact controls.
- Modify: `/home/tyler/Documents/Masthead/src/ui/Toolbar.tsx`
  - Match final toolbar controls: search, All Harnesses, All Lifecycles, Recently Started, grid button.
- Modify: `/home/tyler/Documents/Masthead/src/ui/SessionCard.tsx`
  - Replace current dense telemetry card with final compact card schema.
- Modify: `/home/tyler/Documents/Masthead/src/ui/SessionBoard.tsx`
  - Preserve filtering/opening behavior and keep the 3-column observability variant.
- Modify: `/home/tyler/Documents/Masthead/src/ui/ObservabilityRightRail.tsx`
  - Render final right rail panels and compute Session Mix from real summary.
- Modify: `/home/tyler/Documents/Masthead/src/ui/observabilityDemo.ts`
  - Keep existing demo model/token values, but remove unused visible-cost dependency from right rail.
- Modify: `/home/tyler/Documents/Masthead/src/styles/masthead.css`
  - Replace observability-specific styles with the static mock visual system.
- Create: `/home/tyler/Documents/Masthead/src/ui/assets/masthead-logo-sail.png`
  - Copy from `mockups/masthead-logo-sail.png`.
- Modify tests in `/home/tyler/Documents/Masthead/src/ui/__tests__/`.

---

### Task 1: Capture Baseline Evidence

**Files:**
- Create directory: `/home/tyler/Documents/Masthead/docs/superpowers/evidence/reference-mock-ui/`

- [ ] **Step 1: Create the evidence directory**

Run:

```bash
mkdir -p docs/superpowers/evidence/reference-mock-ui
```

Expected: command exits `0`.

- [ ] **Step 2: Capture or record the static reference**

Use the Codex in-app Browser at viewport `1672x941`.

Open:

```text
file:///home/tyler/Documents/Masthead/mockups/masthead-observability-reference.html
```

Save the screenshot as:

```text
/home/tyler/Documents/Masthead/docs/superpowers/evidence/reference-mock-ui/reference-1672x941.png
```

If the Browser tool cannot save the file directly, manually record in `docs/superpowers/evidence/reference-mock-ui/visual-notes.md` that the static reference was opened and inspected at `1672x941`.

- [ ] **Step 3: Capture current app state before implementation**

Run fixture mode:

```bash
npm run dev:fixture
```

Open:

```text
http://127.0.0.1:5173
```

Save or record the current screenshot as:

```text
/home/tyler/Documents/Masthead/docs/superpowers/evidence/reference-mock-ui/before-1672x941.png
```

Expected: there is a visible before-state artifact or note before source edits begin.

---

### Task 2: Preserve The Reference Asset

**Files:**
- Create: `/home/tyler/Documents/Masthead/src/ui/assets/masthead-logo-sail.png`

- [ ] **Step 1: Copy the logo into app-owned source assets**

Run:

```bash
mkdir -p src/ui/assets
cp mockups/masthead-logo-sail.png src/ui/assets/masthead-logo-sail.png
```

Expected: `src/ui/assets/masthead-logo-sail.png` exists and is a PNG.

- [ ] **Step 2: Verify the asset exists**

Run:

```bash
test -f src/ui/assets/masthead-logo-sail.png
```

Expected: command exits `0`.

---

### Task 3: Recompose The Real App Surface

**Files:**
- Modify: `/home/tyler/Documents/Masthead/src/app/App.tsx`

- [ ] **Step 1: Remove primary-dashboard panels that are not in the mock**

In `App.tsx`, remove the main-dashboard render of `<AttentionQueue items={filteredAttentionItems} variant="scan" />`.

Also remove the entire `<section className="lower-console-panels" aria-label="History and operations">` block, including its nested `<HistoryPanel />` and `<OperationsPanel />` children.

Do not delete the local history, operations, retention, or review-disposition logic from the codebase as part of this UI pass. Remove imports or local variables only when TypeScript or a test fails because they are impossible to keep.

- [ ] **Step 2: Pass the right props to topbar and right rail**

Update the shell call to this shape:

```tsx
<ObservabilityConsoleShell
  sidebar={
    <ObservabilitySidebar
      version="v1.8.3"
      activeCount={observabilitySessionTotal(board.summary)}
      connectionLabel={boardSource}
    />
  }
  topbar={
    <ObservabilityTopbar
      summary={board.summary}
      brief={board.brief}
      liveLabel={boardSource}
      showDemoData={showDemoData}
      onToggleDemoData={handleToggleDemoData}
    />
  }
  main={
    <>
      <Toolbar
        query={query}
        filter={filter}
        resultCount={filteredCards.length}
        totalCount={board.cards.length}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        searchInputRef={searchInputRef}
      />
      <SessionBoard
        cards={filteredCards}
        lanes={board.lanes}
        variant="observability"
        emptyTitle={emptyBoardTitle({ showDemoData, query, filter, liveConnection })}
        emptyMessage={emptyBoardMessage({ showDemoData, query, filter, liveConnection })}
        onOpenSession={handleOpenSession}
      />
    </>
  }
  rightRail={<ObservabilityRightRail summary={board.summary} />}
/>
```

- [ ] **Step 3: Record the known dependent updates**

After this task, the app composition intentionally depends on later updates to `ObservabilityTopbar` and `ObservabilityRightRail`. Do not run the full typecheck yet if those components have not been updated.

Expected: `App.tsx` reflects the final dashboard composition, and full typechecking is deferred until Tasks 5 and 8 are complete.

---

### Task 4: Match The Sidebar

**Files:**
- Modify: `/home/tyler/Documents/Masthead/src/ui/ObservabilitySidebar.tsx`

- [ ] **Step 1: Replace the generated logo placeholder with the PNG logo**

Use a Vite-resolved asset URL:

```tsx
import sailLogoUrl from "./assets/masthead-logo-sail.png";
```

If TypeScript does not already know PNG modules, add this in `/home/tyler/Documents/Masthead/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

Then render:

```tsx
<img className="brand-sail" src={sailLogoUrl} alt="" aria-hidden="true" />
```

- [ ] **Step 2: Remove visible demo labels from sidebar links**

Use this `SidebarLink` body:

```tsx
<a className={`sidebar-link ${active ? "active" : ""}`} href={href} aria-current={active ? "page" : undefined}>
  <span className="sidebar-icon" aria-hidden="true">{icon}</span>
  <span>{label}</span>
  {count !== undefined ? <strong className={alertCount ? "alert-count" : ""}>{count}</strong> : null}
</a>
```

- [ ] **Step 3: Match the final groups and labels**

Use these groups exactly:

```tsx
<SidebarGroup title="Overview">
  <SidebarLink href="#sessions" icon="⌘" label="Sessions" count={activeCount} active />
  <SidebarLink href="#traces" icon="⌘" label="Traces" />
  <SidebarLink href="#top-models" icon="⌁" label="Models" />
  <SidebarLink href="#attention" icon="△" label="Alerts" count={alertCount} alertCount />
  <SidebarLink href="#logbook" icon="▱" label="Logbook" />
</SidebarGroup>
<SidebarGroup title="Analysis">
  <SidebarLink href="#tokens-per-minute" icon="▱" label="Performance" />
  <SidebarLink href="#costs" icon="◷" label="Costs" />
  <SidebarLink href="#usage" icon="ⓘ" label="Usage" />
</SidebarGroup>
<SidebarGroup title="Configuration">
  <SidebarLink href="#agents" icon="⌘" label="Agents" />
  <SidebarLink href="#environments" icon="▤" label="Environments" />
  <SidebarLink href="#settings" icon="⚙" label="Settings" />
</SidebarGroup>
```

The icons can be replaced with inline SVGs during implementation if that better matches the mock; do not add a new icon dependency.

- [ ] **Step 4: Update sidebar tests**

Run:

```bash
npm test -- src/ui/__tests__/observabilitySidebar.test.tsx
```

Expected: PASS after updating expectations for the image logo and absence of visible `Demo`.

---

### Task 5: Match The Top Headline And Controls

**Files:**
- Modify: `/home/tyler/Documents/Masthead/src/ui/ObservabilityTopbar.tsx`
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilityTopbar.test.tsx`

- [ ] **Step 1: Change props to accept the board brief**

Use:

```tsx
import type { BoardBrief, LiveBoardProjection } from "../core/types";

type Props = {
  summary: LiveBoardProjection["summary"];
  brief?: BoardBrief;
  liveLabel: string;
  showDemoData: boolean;
  onToggleDemoData: () => void;
};
```

- [ ] **Step 2: Render one headline only**

Use:

```tsx
const active = summary.running ?? summary.active;
const idle = summary.idle ?? 0;
const blocked = summary.needsAction ?? summary.needsAttention;
const headline =
  brief?.text ??
  `${active} active sessions, ${idle} idle sessions, and ${blocked} blocked sessions are visible across the Codex workspace.`;

return (
  <>
    <div className="status-heading">
      <h1>{headline}</h1>
    </div>
    <div className="topbar-controls">
      <button type="button" className="topbar-control">Last 24 hours</button>
      <button type="button" className="topbar-control live-control" onClick={onToggleDemoData}>
        <span className="live-dot" aria-hidden="true" />
        {showDemoData ? "Demo replay" : liveLabel}
      </button>
      <button type="button" className="topbar-control">10s</button>
      <button type="button" className="topbar-icon-button" aria-label="Filters">≡</button>
    </div>
  </>
);
```

Do not render `System status:`. Do not render a paragraph under the headline.

- [ ] **Step 3: Update test expectations**

The test must assert:

```ts
expect(html).toContain("16 active sessions");
expect(html).not.toContain("System status:");
expect(html).not.toContain("Work is progressing");
expect(html).toContain("Last 24 hours");
expect(html).toContain("10s");
```

- [ ] **Step 4: Run the topbar test**

Run:

```bash
npm test -- src/ui/__tests__/observabilityTopbar.test.tsx
```

Expected: PASS.

---

### Task 6: Match The Toolbar

**Files:**
- Modify: `/home/tyler/Documents/Masthead/src/ui/Toolbar.tsx`
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilityToolbar.test.tsx`

- [ ] **Step 1: Remove the visible demo badge and extra selects**

Toolbar should render:

```tsx
<section className="board-toolbar observability-toolbar" aria-label="Board controls">
  <label className="search-field">
    <span className="search-icon" aria-hidden="true">⌕</span>
    <input
      ref={searchInputRef}
      type="search"
      placeholder="Filter sessions..."
      value={query}
      onChange={(event) => onQueryChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onQueryChange("");
      }}
    />
  </label>
  <div className="toolbar-select-row" aria-label="Filter controls">
    <DemoSelect label="All Harnesses" />
    <DemoSelect label="All Lifecycles" />
    <DemoSelect label="Recently Started" className="sort" />
  </div>
  <button type="button" className="toolbar-icon-button" aria-label="Grid view">
    <span aria-hidden="true">▦</span>
  </button>
</section>
```

Keep the `BoardFilter` props even if the mock controls are not functional yet; do not add new filter logic in this task.

- [ ] **Step 2: Update toolbar tests**

Assert:

```ts
expect(html).toContain("Filter sessions...");
expect(html).toContain("All Harnesses");
expect(html).toContain("All Lifecycles");
expect(html).toContain("Recently Started");
expect(html).not.toContain("All Environments");
expect(html).not.toContain("All Hosts");
expect(html).not.toContain("Demo data");
```

- [ ] **Step 3: Run toolbar test**

Run:

```bash
npm test -- src/ui/__tests__/observabilityToolbar.test.tsx
```

Expected: PASS.

---

### Task 7: Match The Session Cards

**Files:**
- Modify: `/home/tyler/Documents/Masthead/src/ui/SessionCard.tsx`
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilitySessionCard.test.tsx`

- [ ] **Step 1: Replace the card body with final compact markup**

Use the existing props. Keep `demoTelemetry` for model/harness only.

```tsx
export function SessionCard({ session, onToggle, demoTelemetry }: Props) {
  const className = stateClassName(session);
  const model = demoTelemetry?.model.value ?? "gpt-5";
  const harness = demoTelemetry?.harness.value ?? "Codex";
  const worktree = session.workContext?.label ?? session.branchOrWorktree ?? session.project;

  return (
    <article
      className={`session-card ${className}`}
      role="button"
      aria-label={`Open ${session.copy.headline} details`}
      tabIndex={0}
      onClick={() => onToggle?.(session.sessionId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle?.(session.sessionId);
        }
      }}
    >
      <header className="observability-card-head">
        <span className="card-session-id">{shortSessionId(session.sessionId)}</span>
        <span className="card-harness">{harness}</span>
        <span className={`state-token ${session.indicators.includes("attention") ? "attention" : ""}`}>
          {statusTokenLabel(session)}
        </span>
      </header>

      <h2>{session.copy.headline}</h2>

      <dl className="observability-card-facts">
        <Fact label="Runtime" value={session.durationLabel} />
        <Fact label="Model" value={model} />
        <Fact label="Worktree" value={worktree} />
      </dl>

      <footer className="observability-card-footer">
        <span>Last activity {session.lastActivityLabel}</span>
        <span>Started {startedLabel(session.lastActivity)}</span>
      </footer>
    </article>
  );
}
```

- [ ] **Step 2: Delete obsolete card subcomponents**

Remove these functions from `SessionCard.tsx`:

```tsx
ActiveFacts
IdleFacts
BlockedFacts
```

Do not render `session.copy.status` in the card. Detail views can still show richer copy later.

- [ ] **Step 3: Update card tests**

The primary card test must assert:

```ts
expect(html).toContain("s-1");
expect(html).toContain("Refactor auth flow");
expect(html).toContain("Active");
expect(html).toContain("8m 42s");
expect(html).toContain("Harness");
expect(html).toContain("Model");
expect(html).toContain("Worktree");
expect(html).toContain("Last activity");
expect(html).toContain("Started");
expect(html).not.toContain("Files Changed");
expect(html).not.toContain("Commands / Tests");
expect(html).not.toContain("Progress");
expect(html).not.toContain("Host");
expect(html).not.toContain("Blocked Reason");
expect(html).not.toContain("Demo data");
```

The blocked-card test must assert `Blocked` is still shown in the badge but `Blocked Reason` is not shown.

- [ ] **Step 4: Run the card test**

Run:

```bash
npm test -- src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected: PASS.

---

### Task 8: Match The Right Rail

**Files:**
- Modify: `/home/tyler/Documents/Masthead/src/ui/ObservabilityRightRail.tsx`
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilityRightRail.test.tsx`

- [ ] **Step 1: Change props**

Use:

```tsx
import type { LiveBoardProjection } from "../core/types";

type Props = {
  summary: LiveBoardProjection["summary"];
};
```

- [ ] **Step 2: Render only final mock panels**

Use this component shape:

```tsx
export function ObservabilityRightRail({ summary }: Props) {
  const active = summary.running ?? summary.active;
  const idle = summary.idle ?? 0;
  const blocked = summary.needsAction ?? summary.needsAttention;
  const total = active + idle + blocked;
  const tokensPerMinute = observabilityDemoTelemetry.resourceSeries.find((series) => series.label === "Tokens / min");

  return (
    <>
      <section className="rail-card metric">
        <p className="rail-title"><span className="ring" aria-hidden="true" />Total Tokens (24h)</p>
        <div className="metric-row"><span className="metric-value">{observabilityDemoTelemetry.tokens24h.value}</span><span className="metric-delta">↑ 12.1M</span></div>
      </section>
      <section id="top-models" className="rail-card models">
        <h2 className="rail-heading">Top Models (24h)</h2>
        <div className="model-head"><span>Model</span><span>Tokens</span></div>
        {observabilityDemoTelemetry.topModels.slice(0, 2).map((model) => (
          <div key={model.model} className="model-row">
            <span>{model.model}</span>
            <span>{model.tokens}</span>
          </div>
        ))}
        <a href="#top-models">View all models →</a>
      </section>
      <section id="tokens-per-minute" className="rail-card tokens">
        <h2 className="rail-heading">Tokens / Min</h2>
        <div className="metric-row"><span className="metric-value">{tokensPerMinute?.value ?? "12.4K"}</span><span className="metric-delta">↑ 1.8K</span></div>
        <div className="tokens-sparkline" aria-label="Tokens per minute sparkline">
          {(tokensPerMinute?.points ?? []).map((point, index) => <span key={index} style={{ height: `${point}%` }} />)}
        </div>
      </section>
      <section className="rail-card lifecycle">
        <h2 className="rail-heading">Session Mix</h2>
        <div className="mix-total"><span>Visible sessions</span><strong>{total}</strong></div>
        <div className="mix-bar" aria-hidden="true">
          <span className="mix-active" style={{ width: percent(active, total) }} />
          <span className="mix-idle" style={{ width: percent(idle, total) }} />
          <span className="mix-blocked" style={{ width: percent(blocked, total) }} />
        </div>
        <div className="mix-legend">
          <div><span><i className="active-dot" />Active</span><strong>{active}</strong></div>
          <div><span><i className="idle-dot" />Idle</span><strong>{idle}</strong></div>
          <div><span><i className="blocked-dot" />Blocked</span><strong>{blocked}</strong></div>
        </div>
      </section>
    </>
  );
}

function percent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${(value / total) * 100}%`;
}
```

- [ ] **Step 3: Update right rail tests**

Assert:

```ts
expect(html).toContain("Total Tokens (24h)");
expect(html).toContain("Top Models (24h)");
expect(html).toContain("Tokens / Min");
expect(html).toContain("Session Mix");
expect(html).toContain("Visible sessions");
expect(html).not.toContain("Total Cost");
expect(html).not.toContain("Cost</span>");
expect(html).not.toContain("Demo data");
```

- [ ] **Step 4: Run right rail test**

Run:

```bash
npm test -- src/ui/__tests__/observabilityRightRail.test.tsx
```

Expected: PASS.

---

### Task 9: Transplant The Hard Blue Visual System

**Files:**
- Modify: `/home/tyler/Documents/Masthead/src/styles/masthead.css`

- [ ] **Step 1: Scope the final mock tokens to the observability shell**

Keep non-observability legacy styles above the observability section intact unless tests require otherwise. Do not rewrite the global `:root` token set as the first move, because older screens and tests still reference those variables. Instead, scope the final mock tokens to `.observability-console` so the redesign is isolated to the dashboard surface:

```css
.observability-console {
  --canvas: #03111d;
  --surface: #071d2d;
  --surface-elevated: #071a29;
  --surface-card: #071c2b;
  --line: rgba(194, 221, 241, 0.13);
  --line-strong: rgba(196, 226, 248, 0.2);
  --ink: #f6fbff;
  --body: #d6e4ef;
  --mute: #91a8ba;
  --ash: #61798e;
  --green: #36d869;
  --blue: #2ea7ff;
  --red: #ff483e;
  --yellow: #ffcf36;
  --slab: linear-gradient(180deg, #071b2a 0%, #061725 100%);
  --slab-hard: linear-gradient(180deg, #071c2b 0%, #061827 100%);
  --shadow-border: 0 0 0 1px rgba(255, 255, 255, 0.065), inset 0 1px 0 rgba(255, 255, 255, 0.016), inset 0 -1px 0 rgba(0, 0, 0, 0.55);
}
```

If implementation proves the whole app is now only the observability console, a later cleanup can move these values to `:root`; do not do that in this pass.

- [ ] **Step 2: Replace shell layout**

Use CSS grid, not absolute positioning, but match the mock measurements:

```css
.observability-console {
  display: grid;
  grid-template-columns: 215px minmax(0, 1fr);
  width: min(1672px, 100vw);
  min-height: 100vh;
  margin: 0 auto;
  padding: 0;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.012), transparent 18%, rgba(0, 0, 0, 0.22) 100%),
    linear-gradient(180deg, #031421 0%, #03111d 44%, #020b15 100%);
}

.observability-sidebar {
  min-height: 100vh;
  border-right: 1px solid rgba(96, 145, 183, 0.16);
  background: linear-gradient(180deg, #031320, #020c17);
}

.observability-workspace {
  display: grid;
  grid-template-rows: 82px 1fr;
  min-width: 0;
}

.observability-content {
  display: grid;
  grid-template-columns: minmax(0, 1139px) 267px;
  gap: 19px;
  align-items: start;
  padding: 13px 20px 18px 13px;
}
```

Do not add pseudo-elements that produce diagonal line artifacts.

- [ ] **Step 3: Match cards**

Use the mock card proportions:

```css
.observability-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.observability-console .session-card {
  position: relative;
  height: 218px;
  min-height: 218px;
  overflow: hidden;
  border: 1px solid rgba(151, 188, 216, 0.13);
  border-radius: 4px;
  background: var(--slab-hard);
  box-shadow: var(--shadow-border);
  padding: 14px 16px 16px 20px;
}

.observability-console .session-card.running { border-left: 3px solid var(--green); }
.observability-console .session-card.stalled { border-left: 3px solid var(--blue); }
.observability-console .session-card.needs-attention,
.observability-console .session-card.conflict { border-left: 3px solid var(--red); }
```

Use exact-property transitions only:

```css
.observability-console .session-card {
  transition-property: box-shadow, transform;
  transition-duration: 140ms;
  transition-timing-function: ease-out;
}
```

- [ ] **Step 4: Match right rail**

Use:

```css
.observability-right-rail {
  display: grid;
  align-content: start;
  gap: 12px;
  width: 267px;
  overflow: visible;
}

.rail-card {
  width: 267px;
  border: 1px solid rgba(151, 188, 216, 0.13);
  border-radius: 4px;
  background: var(--slab);
  box-shadow: var(--shadow-border);
}

.rail-card.metric { height: 100px; padding: 20px 20px 16px; }
.rail-card.models { height: 228px; padding: 22px 17px 17px; }
.rail-card.tokens { height: 151px; padding: 22px 17px; }
.rail-card.lifecycle { height: 194px; padding: 21px 17px 18px; }
```

- [ ] **Step 5: Match responsive behavior without breaking the desktop**

At `max-width: 1320px`, keep the sidebar but stack the right rail under the board:

```css
@media (max-width: 1320px) {
  .observability-content {
    grid-template-columns: 1fr;
  }

  .observability-right-rail {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rail-card {
    width: 100%;
  }
}
```

At `max-width: 760px`, stack sidebar after workspace and use one-card columns:

```css
@media (max-width: 760px) {
  .observability-console {
    grid-template-columns: 1fr;
  }

  .observability-workspace {
    grid-row: 1;
  }

  .observability-sidebar {
    grid-row: 2;
    min-height: auto;
    border-right: 0;
  }

  .observability-card-grid,
  .observability-right-rail {
    grid-template-columns: 1fr;
  }
}
```

---

### Task 10: Update Tests To Guard The Final Mock Contract

**Files:**
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilityConsoleShell.test.tsx`
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilitySidebar.test.tsx`
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilityTopbar.test.tsx`
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilityToolbar.test.tsx`
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilitySessionCard.test.tsx`
- Modify: `/home/tyler/Documents/Masthead/src/ui/__tests__/observabilityRightRail.test.tsx`

- [ ] **Step 1: Add forbidden-visible-text assertions to component tests**

Do not source-grep for these strings because some removed labels may still exist in non-rendered detail/history components. Assert against rendered static markup for the primary dashboard components instead.

Use this forbidden list where relevant:

```ts
const forbiddenPrimaryDashboardText = [
  "Demo data",
  "Local history",
  "Local records",
  "Commands / Tests",
  "Files Changed",
  "Progress",
  "Host",
  "Docker",
  "Linux",
  "Kubernetes",
  "Blocked Reason",
  "Total Cost"
];
```

In each primary-dashboard component test, render the component and run:

```ts
for (const text of forbiddenPrimaryDashboardText) {
  expect(html).not.toContain(text);
}
```

Limit the assertions to components where the string would actually be user-visible: `ObservabilityTopbar`, `Toolbar`, `SessionCard`, and `ObservabilityRightRail`.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- src/ui/__tests__/observabilityConsoleShell.test.tsx src/ui/__tests__/observabilitySidebar.test.tsx src/ui/__tests__/observabilityTopbar.test.tsx src/ui/__tests__/observabilityToolbar.test.tsx src/ui/__tests__/observabilitySessionCard.test.tsx src/ui/__tests__/observabilityRightRail.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build pass.

---

### Task 11: Visual Verification Against The Static Mock

**Files:**
- No source edits unless visual QA finds a mismatch.

- [ ] **Step 1: Start fixture app**

Run:

```bash
npm run dev:fixture
```

Expected: Vite serves the app at `http://127.0.0.1:5173`.

- [ ] **Step 2: Open the real app in the in-app Browser**

Use the Codex in-app Browser with viewport `1672x941`.

Open:

```text
http://127.0.0.1:5173
```

Acceptance:
- The app first viewport matches the static mock composition.
- Top headline sits centered in the available top bar.
- Logo/title are vertically centered and not touching the top.
- Session Mix legend stays inside the card.
- No lower history/operations/attention panels are visible in the first viewport.
- Save or record the final app screenshot as `/home/tyler/Documents/Masthead/docs/superpowers/evidence/reference-mock-ui/after-1672x941.png`.

- [ ] **Step 3: Open the static reference in the in-app Browser**

Use the same viewport `1672x941`.

Open:

```text
file:///home/tyler/Documents/Masthead/mockups/masthead-observability-reference.html
```

Acceptance:
- Compare the app screenshot to the reference screenshot side by side.
- Differences should be limited to live/demo text values that come from actual board state.
- Spacing, surface feel, card proportions, rail proportions, sidebar rhythm, and headline alignment should match.
- Record the final visual pass/fail notes in `/home/tyler/Documents/Masthead/docs/superpowers/evidence/reference-mock-ui/visual-notes.md`.

- [ ] **Step 4: Check responsive widths**

Use the in-app Browser at:

```text
1366x768
1024x768
768x900
390x844
```

Acceptance:
- No text overflows out of cards or rail panels.
- No horizontal page scrollbar on mobile.
- Toolbar controls wrap or scroll cleanly.
- Cards remain readable and do not collapse into cramped mixed blank space.

---

## Self-Review Checklist

- [ ] Every visible element in the static mock has a real-app equivalent.
- [ ] Every visible element removed during mock polishing stays removed in the real app.
- [ ] No visible `Demo data`, `Local history`, `Local records`, `needs attention`, `Commands / Tests`, `Files Changed`, `Progress`, `Host`, `Docker`, `Linux`, `Kubernetes`, `Blocked Reason`, or `Total Cost` text remains on the primary dashboard.
- [ ] The implementation does not add a new telemetry integration.
- [ ] The implementation keeps existing click-to-open card details.
- [ ] The implementation passes `npm test` and `npm run build`.
- [ ] The in-app Browser screenshot at `1672x941` visually matches the standalone mock.
