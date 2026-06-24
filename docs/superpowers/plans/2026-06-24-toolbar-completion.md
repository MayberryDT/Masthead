# Toolbar Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Masthead session toolbar so it owns search, harness filtering, lifecycle filtering, sort order, last-activity timeframe, refresh cadence, and compact-card density.

**Architecture:** Keep all toolbar state in `src/app/App.tsx`, keep pure filtering and sorting in `src/ui/filterBoard.ts`, and render the controls as controlled inputs in `src/ui/Toolbar.tsx`. Move the time window and refresh controls out of the right rail by no longer rendering `ObservabilityTopbar`; keep the right rail focused on telemetry cards.

**Tech Stack:** React, TypeScript, existing CSS, Vitest, Codex in-app Browser for visual QA.

---

## Optimizer Summary

### Rubric

- UX fidelity to Tyler's request, 25 pts: the toolbar keeps the same visual language, every requested dropdown works, the right-rail controls box is gone, and compact mode clearly fits more cards.
- Functional correctness, 25 pts: filtering, sorting, timeframe, refresh cadence, and density state behave predictably against real `SessionCardView` data.
- Architecture and maintainability, 20 pts: option constants, types, and filtering helpers are centralized and easy to extend later.
- Risk control, 15 pts: no fake harness/model data returns, privacy-sensitive card copy remains protected, and live/demo behavior does not regress.
- Verification quality, 15 pts: failing tests precede implementation and browser QA checks real layout behavior.

### Score Trajectory

- Initial plan: 78/100
- Round 1: 88/100, added `startedAt` so "Recently Started" is a real sort mode and made timeframe filtering apply to last activity consistently.
- Round 2: 92/100, centralized toolbar option definitions and added explicit App/browser verification gates.
- Round 3: 92/100, plateau. No further structural improvement above the +2 acceptance margin.

### Key Optimizations Accepted

- Add `startedAt` to projected session cards instead of pretending `lastActivity` is start time.
- Create `src/ui/toolbarOptions.ts` so labels, values, and millisecond mappings stay consistent across UI and tests.
- Treat timeframe as a true last-activity scan window for visible cards, while preserving the prior recent-ended-to-idle conversion.

---

## File Map

- Create: `src/ui/toolbarOptions.ts`
  - Owns dropdown option arrays, type aliases, label helpers, and millisecond mappings for activity window and refresh cadence.
- Modify: `src/core/types.ts`
  - Adds `startedAt?: string` and `harness?: string` to `SessionCardView`.
- Modify: `src/core/replay.ts`
  - Populates `startedAt` from the first event timestamp for each session and `harness` as `Codex` for live Codex-derived sessions.
- Modify: `src/ui/filterBoard.ts`
  - Adds harness/lifecycle/sort filtering and makes `mainScanCards` use the selected last-activity window.
- Modify: `src/ui/Toolbar.tsx`
  - Replaces static dropdown-looking buttons with controlled native selects and a controlled compact-density toggle.
- Modify: `src/app/App.tsx`
  - Owns toolbar state, passes options to filtering/scanning/polling, removes right-rail controls, and passes density to `SessionBoard`.
- Modify: `src/ui/SessionBoard.tsx`
  - Accepts `density` and emits a compact grid class.
- Modify: `src/styles/masthead.css`
  - Styles real select controls, toolbar time/refresh controls, and compact card grid/card sizing.
- Delete or retire: `src/ui/ObservabilityTopbar.tsx`
  - No longer needed after moving time window and refresh controls into `Toolbar`.
- Modify tests:
  - `src/ui/__tests__/filterBoard.test.ts`
  - `src/ui/__tests__/observabilityToolbar.test.tsx`
  - `src/ui/__tests__/observabilitySessionCard.test.tsx`
  - `src/ui/__tests__/observabilityRightRail.test.tsx`
  - `src/ui/__tests__/liveBoard.test.tsx`
  - `src/core/__tests__/projection.test.ts`

Known constraint: `/home/tyler/Documents/Masthead` is currently not a git repository. Do not run `git commit` from this directory unless execution happens in a real git worktree.

---

## Task 1: Centralize Toolbar Options

**Files:**
- Create: `src/ui/toolbarOptions.ts`
- Test: `src/ui/__tests__/observabilityToolbar.test.tsx`

- [ ] **Step 1: Write the failing toolbar options render test**

Add this test to `src/ui/__tests__/observabilityToolbar.test.tsx`:

```tsx
test("renders all completed toolbar controls from shared options", () => {
  const html = renderToStaticMarkup(
    <Toolbar
      query=""
      filter="all"
      resultCount={8}
      totalCount={12}
      harnessFilter="all"
      lifecycleFilter="all"
      sortMode="recent_activity"
      activityWindow="24h"
      refreshRateMs={10_000}
      density="comfortable"
      onQueryChange={() => undefined}
      onFilterChange={() => undefined}
      onHarnessFilterChange={() => undefined}
      onLifecycleFilterChange={() => undefined}
      onSortModeChange={() => undefined}
      onActivityWindowChange={() => undefined}
      onRefreshRateChange={() => undefined}
      onDensityToggle={() => undefined}
      searchInputRef={createRef<HTMLInputElement>()}
    />
  );

  expect(html).toContain("All Harnesses");
  expect(html).toContain("Codex");
  expect(html).toContain("All Lifecycles");
  expect(html).toContain("Active");
  expect(html).toContain("Idle");
  expect(html).toContain("Blocked");
  expect(html).toContain("Recent Activity");
  expect(html).toContain("Recently Started");
  expect(html).toContain("Last 24 hours");
  expect(html).toContain("5s");
  expect(html).toContain("10s");
  expect(html).toContain("1m");
  expect(html).toContain('aria-label="Compact grid"');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- --run src/ui/__tests__/observabilityToolbar.test.tsx
```

Expected: TypeScript or render failure because `Toolbar` does not yet accept the new props and the options module does not exist.

- [ ] **Step 3: Create the shared toolbar options module**

Create `src/ui/toolbarOptions.ts`:

```ts
export type HarnessFilter = "all" | "codex";
export type LifecycleFilter = "all" | "running" | "idle" | "blocked";
export type SortMode = "recent_activity" | "recently_started";
export type ActivityWindow = "1h" | "12h" | "24h" | "48h" | "3d" | "7d";
export type CardDensity = "comfortable" | "compact";

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
};

export const HARNESS_OPTIONS: Array<SelectOption<HarnessFilter>> = [
  { value: "all", label: "All Harnesses" },
  { value: "codex", label: "Codex" }
];

export const LIFECYCLE_OPTIONS: Array<SelectOption<LifecycleFilter>> = [
  { value: "all", label: "All Lifecycles" },
  { value: "running", label: "Active" },
  { value: "idle", label: "Idle" },
  { value: "blocked", label: "Blocked" }
];

export const SORT_OPTIONS: Array<SelectOption<SortMode>> = [
  { value: "recent_activity", label: "Recent Activity" },
  { value: "recently_started", label: "Recently Started" }
];

export const ACTIVITY_WINDOW_OPTIONS: Array<SelectOption<ActivityWindow>> = [
  { value: "1h", label: "Last hour" },
  { value: "12h", label: "Last 12 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "48h", label: "Last 48 hours" },
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last week" }
];

export const REFRESH_RATE_OPTIONS: Array<SelectOption<number>> = [
  { value: 5_000, label: "5s" },
  { value: 10_000, label: "10s" },
  { value: 15_000, label: "15s" },
  { value: 20_000, label: "20s" },
  { value: 30_000, label: "30s" },
  { value: 60_000, label: "1m" }
];

export function activityWindowMs(window: ActivityWindow): number {
  const hour = 60 * 60_000;
  switch (window) {
    case "1h":
      return hour;
    case "12h":
      return 12 * hour;
    case "24h":
      return 24 * hour;
    case "48h":
      return 48 * hour;
    case "3d":
      return 3 * 24 * hour;
    case "7d":
      return 7 * 24 * hour;
  }
}
```

- [ ] **Step 4: Run the toolbar options test again**

Run:

```bash
npm test -- --run src/ui/__tests__/observabilityToolbar.test.tsx
```

Expected: still fails until `Toolbar` consumes the new props in Task 4.

---

## Task 2: Add Real Started Time and Harness Metadata

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/replay.ts`
- Test: `src/core/__tests__/projection.test.ts`

- [ ] **Step 1: Write the failing projection test**

Add this test to `src/core/__tests__/projection.test.ts`:

```ts
test("projects session started time and harness for toolbar sorting and filtering", () => {
  const board = projectFixture({
    events: [
      event("older-start", "older-session", "session.started", "2026-06-23T02:00:00.000Z"),
      event("older-update", "older-session", "command.finished", "2026-06-23T02:10:00.000Z"),
      event("newer-start", "newer-session", "session.started", "2026-06-23T02:05:00.000Z"),
      event("newer-update", "newer-session", "command.finished", "2026-06-23T02:06:00.000Z")
    ],
    gitSnapshots: []
  });

  expect(board.cards.find((card) => card.sessionId === "older-session")).toMatchObject({
    startedAt: "2026-06-23T02:00:00.000Z",
    harness: "Codex"
  });
  expect(board.cards.find((card) => card.sessionId === "newer-session")).toMatchObject({
    startedAt: "2026-06-23T02:05:00.000Z",
    harness: "Codex"
  });
});
```

- [ ] **Step 2: Run the projection test and verify it fails**

Run:

```bash
npm test -- --run src/core/__tests__/projection.test.ts
```

Expected: FAIL because `startedAt` and `harness` are missing from projected cards.

- [ ] **Step 3: Add optional card metadata to the type**

Modify `SessionCardView` in `src/core/types.ts`:

```ts
  durationLabel: string;
  branchOrWorktree?: string;
  model?: string;
  harness?: string;
  startedAt?: string;
  lastActivity: string;
```

- [ ] **Step 4: Populate metadata in projection**

In `src/core/replay.ts`, inside `toCard`, add:

```ts
  const startedAt = firstSessionTimestamp(session.sessionId, events);
```

Add these properties to `card`:

```ts
    harness: "Codex",
    startedAt,
```

Add this helper near `durationLabel`:

```ts
function firstSessionTimestamp(sessionId: string, events: NormalizedEvent[]): string | undefined {
  return events
    .filter((event) => event.sessionId === sessionId)
    .map((event) => event.occurredAt)
    .filter(Boolean)
    .toSorted((a, b) => a.localeCompare(b))
    .at(0);
}
```

- [ ] **Step 5: Run the projection test and verify it passes**

Run:

```bash
npm test -- --run src/core/__tests__/projection.test.ts
```

Expected: PASS.

---

## Task 3: Implement Filter and Sort Semantics

**Files:**
- Modify: `src/ui/filterBoard.ts`
- Test: `src/ui/__tests__/filterBoard.test.ts`

- [ ] **Step 1: Write failing filter and sort tests**

Add tests to `src/ui/__tests__/filterBoard.test.ts`:

```ts
test("filters cards by lifecycle dropdown", () => {
  const cards = [
    { ...baseCard, sessionId: "active", lifecycle: "running", primaryStatus: "editing", indicators: [] },
    { ...baseCard, sessionId: "idle", lifecycle: "idle", primaryStatus: "stalled", indicators: [] },
    { ...baseCard, sessionId: "blocked", lifecycle: "running", primaryStatus: "blocked", indicators: ["attention"] }
  ] satisfies SessionCardView[];

  expect(filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "running", sort: "recent_activity" }).map((card) => card.sessionId)).toEqual(["active"]);
  expect(filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "idle", sort: "recent_activity" }).map((card) => card.sessionId)).toEqual(["idle"]);
  expect(filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "blocked", sort: "recent_activity" }).map((card) => card.sessionId)).toEqual(["blocked"]);
});

test("filters cards by harness dropdown without inventing non-Codex harnesses", () => {
  const cards = [
    { ...baseCard, sessionId: "codex", harness: "Codex" },
    { ...baseCard, sessionId: "missing-harness", harness: undefined }
  ] satisfies SessionCardView[];

  expect(filterCards(cards, { query: "", filter: "all", harness: "codex", lifecycle: "all", sort: "recent_activity" }).map((card) => card.sessionId)).toEqual(["codex", "missing-harness"]);
});

test("sorts cards by recently started when selected", () => {
  const cards = [
    { ...baseCard, sessionId: "old-start", startedAt: "2026-06-24T06:00:00.000Z", lastActivity: "2026-06-24T07:59:00.000Z" },
    { ...baseCard, sessionId: "new-start", startedAt: "2026-06-24T07:00:00.000Z", lastActivity: "2026-06-24T07:30:00.000Z" }
  ] satisfies SessionCardView[];

  expect(filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "all", sort: "recently_started" }).map((card) => card.sessionId)).toEqual(["new-start", "old-start"]);
});

test("main scan window filters by last activity across visible scan cards", () => {
  const cards = [
    { ...baseCard, sessionId: "inside", lastActivity: "2026-06-24T07:30:00.000Z" },
    { ...baseCard, sessionId: "outside", lastActivity: "2026-06-24T05:59:00.000Z" }
  ] satisfies SessionCardView[];

  const scanCards = mainScanCards(cards, {
    now: new Date("2026-06-24T08:00:00.000Z"),
    activityWindowMs: 60 * 60_000
  });

  expect(scanCards.map((card) => card.sessionId)).toEqual(["inside"]);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- --run src/ui/__tests__/filterBoard.test.ts
```

Expected: FAIL because `filterCards` does not accept or apply the new options.

- [ ] **Step 3: Extend filter option types**

Modify imports and option types in `src/ui/filterBoard.ts`:

```ts
import type { HarnessFilter, LifecycleFilter, SortMode } from "./toolbarOptions";

export type BoardFilterOptions = {
  query: string;
  filter: BoardFilter;
  harness?: HarnessFilter;
  lifecycle?: LifecycleFilter;
  sort?: SortMode;
};
```

- [ ] **Step 4: Apply harness, lifecycle, and sort**

Replace `filterCards` with:

```ts
export function filterCards(cards: SessionCardView[], options: BoardFilterOptions): SessionCardView[] {
  const query = normalize(options.query);
  const harness = options.harness ?? "all";
  const lifecycle = options.lifecycle ?? "all";
  const sort = options.sort ?? "recent_activity";

  return cards
    .filter((card) => {
      if (options.filter === "needs_attention" && !card.indicators.includes("attention")) return false;
      if (options.filter === "conflicts" && !card.indicators.includes("conflict")) return false;
      if (harness === "codex" && normalizedHarness(card) !== "codex") return false;
      if (lifecycle !== "all" && !matchesLifecycle(card, lifecycle)) return false;
      if (!query) return true;

      return searchableText(card).includes(query);
    })
    .sort((a, b) => compareCardsForSort(a, b, sort));
}
```

Add helpers:

```ts
function normalizedHarness(card: SessionCardView): string {
  return normalize(card.harness ?? "Codex");
}

function matchesLifecycle(card: SessionCardView, lifecycle: LifecycleFilter): boolean {
  if (lifecycle === "running") return card.lifecycle === "running" && !isBlockedScanCard(card);
  if (lifecycle === "idle") return card.lifecycle === "idle" && !isBlockedScanCard(card);
  if (lifecycle === "blocked") return isBlockedScanCard(card);
  return true;
}

function compareCardsForSort(a: SessionCardView, b: SessionCardView, sort: SortMode): number {
  if (sort === "recently_started") {
    const startedDelta = timestampForSort(b.startedAt ?? b.lastActivity) - timestampForSort(a.startedAt ?? a.lastActivity);
    if (startedDelta !== 0) return startedDelta;
  }

  return compareLastActivityDesc(a, b);
}

function timestampForSort(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
```

- [ ] **Step 5: Apply last-activity window to all scan cards**

Change `scanCardForMainView` to exclude cards outside the selected window before lifecycle conversion:

```ts
function scanCardForMainView(card: SessionCardView, now: Date, activityWindowMs: number): SessionCardView[] {
  if (!isRecentActivity(card.lastActivity, now, activityWindowMs)) return [];
  if (card.lifecycle !== "ended") return [card];
  if (isBlockedScanCard(card)) return [card];

  return [
    {
      ...card,
      lifecycle: "idle",
      primaryStatus: "stalled",
      stateLabel: "Idle",
      outcomeLabel: undefined,
      endReason: undefined,
      attentionReason: undefined,
      indicators: []
    }
  ];
}
```

- [ ] **Step 6: Run filter tests and verify they pass**

Run:

```bash
npm test -- --run src/ui/__tests__/filterBoard.test.ts
```

Expected: PASS.

---

## Task 4: Render Real Toolbar Controls

**Files:**
- Modify: `src/ui/Toolbar.tsx`
- Test: `src/ui/__tests__/observabilityToolbar.test.tsx`

- [ ] **Step 1: Update `Toolbar` props**

In `src/ui/Toolbar.tsx`, import toolbar option types and constants:

```ts
import {
  ACTIVITY_WINDOW_OPTIONS,
  HARNESS_OPTIONS,
  LIFECYCLE_OPTIONS,
  REFRESH_RATE_OPTIONS,
  SORT_OPTIONS,
  type ActivityWindow,
  type CardDensity,
  type HarnessFilter,
  type LifecycleFilter,
  type SortMode
} from "./toolbarOptions";
```

Extend `Props`:

```ts
  harnessFilter: HarnessFilter;
  lifecycleFilter: LifecycleFilter;
  sortMode: SortMode;
  activityWindow: ActivityWindow;
  refreshRateMs: number;
  density: CardDensity;
  onHarnessFilterChange: (filter: HarnessFilter) => void;
  onLifecycleFilterChange: (filter: LifecycleFilter) => void;
  onSortModeChange: (sort: SortMode) => void;
  onActivityWindowChange: (window: ActivityWindow) => void;
  onRefreshRateChange: (rateMs: number) => void;
  onDensityToggle: () => void;
```

- [ ] **Step 2: Replace static `DemoSelect` buttons**

Use controlled native selects:

```tsx
<div className="toolbar-select-row" aria-label="Filter controls">
  <ToolbarSelect
    label="Harness"
    value={harnessFilter}
    options={HARNESS_OPTIONS}
    onChange={(value) => onHarnessFilterChange(value as HarnessFilter)}
  />
  <ToolbarSelect
    label="Lifecycle"
    value={lifecycleFilter}
    options={LIFECYCLE_OPTIONS}
    onChange={(value) => onLifecycleFilterChange(value as LifecycleFilter)}
  />
  <ToolbarSelect
    label="Sort"
    value={sortMode}
    options={SORT_OPTIONS}
    className="sort"
    onChange={(value) => onSortModeChange(value as SortMode)}
  />
  <ToolbarSelect
    label="Time range"
    value={activityWindow}
    options={ACTIVITY_WINDOW_OPTIONS}
    className="time"
    onChange={(value) => onActivityWindowChange(value as ActivityWindow)}
  />
  <ToolbarSelect
    label="Refresh rate"
    value={String(refreshRateMs)}
    options={REFRESH_RATE_OPTIONS.map((option) => ({ ...option, value: String(option.value) }))}
    className="refresh"
    onChange={(value) => onRefreshRateChange(Number(value))}
  />
</div>
<button
  type="button"
  className={`toolbar-icon-button ${density === "compact" ? "active" : ""}`}
  aria-label={density === "compact" ? "Comfortable grid" : "Compact grid"}
  aria-pressed={density === "compact"}
  onClick={onDensityToggle}
>
  <GridIcon />
</button>
```

Add this helper:

```tsx
function ToolbarSelect<T extends string>({
  label,
  value,
  options,
  className = "",
  onChange
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  className?: string;
  onChange: (value: T) => void;
}) {
  return (
    <label className={`toolbar-select ${className}`} aria-label={label}>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 3: Remove `DemoSelect`**

Delete the old `DemoSelect` function from `src/ui/Toolbar.tsx`.

- [ ] **Step 4: Run toolbar tests**

Run:

```bash
npm test -- --run src/ui/__tests__/observabilityToolbar.test.tsx
```

Expected: PASS.

---

## Task 5: Wire Toolbar State in App

**Files:**
- Modify: `src/app/App.tsx`
- Test: `src/ui/__tests__/liveBoard.test.tsx`

- [ ] **Step 1: Write failing App shell test**

Update `src/ui/__tests__/liveBoard.test.tsx` in the observability shell test:

```ts
expect(html).toContain("Last 24 hours");
expect(html).toContain("10s");
expect(html).not.toContain("Demo");
expect(html).not.toContain("Offline");
expect(html).not.toContain("rail-controls");
```

Expected behavior: time and refresh controls appear in the toolbar, while live/demo/filter right-rail controls disappear.

- [ ] **Step 2: Run the App shell test and verify it fails**

Run:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx
```

Expected: FAIL because those controls still live in `ObservabilityTopbar`.

- [ ] **Step 3: Import toolbar option types and helpers**

In `src/app/App.tsx`, add:

```ts
import {
  activityWindowMs,
  type ActivityWindow,
  type CardDensity,
  type HarnessFilter,
  type LifecycleFilter,
  type SortMode
} from "../ui/toolbarOptions";
```

- [ ] **Step 4: Add controlled toolbar state**

Inside `App`, add:

```ts
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent_activity");
  const [activityWindow, setActivityWindow] = useState<ActivityWindow>("24h");
  const [refreshRateMs, setRefreshRateMs] = useState(10_000);
  const [density, setDensity] = useState<CardDensity>("comfortable");
```

- [ ] **Step 5: Replace hardcoded scan and filter calls**

Change:

```ts
  const scanCards = useMemo(() => (showDemoData ? board.cards : mainScanCards(board.cards)), [board.cards, showDemoData]);
  const filteredCards = useMemo(() => filterCards(scanCards, { query, filter }), [scanCards, query, filter]);
```

To:

```ts
  const selectedActivityWindowMs = activityWindowMs(activityWindow);
  const scanCards = useMemo(
    () => (showDemoData ? board.cards : mainScanCards(board.cards, { activityWindowMs: selectedActivityWindowMs })),
    [board.cards, selectedActivityWindowMs, showDemoData]
  );
  const filteredCards = useMemo(
    () =>
      filterCards(scanCards, {
        query,
        filter,
        harness: harnessFilter,
        lifecycle: lifecycleFilter,
        sort: sortMode
      }),
    [filter, harnessFilter, lifecycleFilter, query, scanCards, sortMode]
  );
```

- [ ] **Step 6: Replace polling interval**

Remove the module-level `const livePollMs = 1_000;`.

Change:

```ts
        if (!cancelled) timeoutId = window.setTimeout(loadLiveProjection, livePollMs);
```

To:

```ts
        if (!cancelled) timeoutId = window.setTimeout(loadLiveProjection, refreshRateMs);
```

Change the effect dependency list from:

```ts
  }, [selectedSessionId]);
```

To:

```ts
  }, [refreshRateMs, selectedSessionId]);
```

- [ ] **Step 7: Pass state to `Toolbar` and `SessionBoard`**

Update `<Toolbar />` props:

```tsx
              harnessFilter={harnessFilter}
              lifecycleFilter={lifecycleFilter}
              sortMode={sortMode}
              activityWindow={activityWindow}
              refreshRateMs={refreshRateMs}
              density={density}
              onHarnessFilterChange={setHarnessFilter}
              onLifecycleFilterChange={setLifecycleFilter}
              onSortModeChange={setSortMode}
              onActivityWindowChange={setActivityWindow}
              onRefreshRateChange={setRefreshRateMs}
              onDensityToggle={() => setDensity((current) => (current === "compact" ? "comfortable" : "compact"))}
```

Update `<SessionBoard />`:

```tsx
              density={density}
```

- [ ] **Step 8: Remove right-rail controls usage**

Change:

```tsx
          <ObservabilityRightRail
            summary={visibleSummary}
            showDemoTelemetry={showDemoData}
            controls={
              <ObservabilityTopbar
                liveLabel={boardSource}
                showDemoData={showDemoData}
                onToggleDemoData={handleToggleDemoData}
              />
            }
          />
```

To:

```tsx
          <ObservabilityRightRail summary={visibleSummary} showDemoTelemetry={showDemoData} />
```

Remove the `ObservabilityTopbar` import. If `boardSource` and `handleToggleDemoData` are no longer used after this change, remove those as well.

- [ ] **Step 9: Update empty state filter checks**

Replace `query || filter !== "all"` checks with a helper:

```ts
function hasActiveSessionFilter({
  query,
  filter,
  harnessFilter,
  lifecycleFilter
}: {
  query: string;
  filter: BoardFilter;
  harnessFilter: HarnessFilter;
  lifecycleFilter: LifecycleFilter;
}): boolean {
  return Boolean(query) || filter !== "all" || harnessFilter !== "all" || lifecycleFilter !== "all";
}
```

Pass `harnessFilter` and `lifecycleFilter` into `emptyBoardTitle` and `emptyBoardMessage`.

- [ ] **Step 10: Run App shell tests**

Run:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx
```

Expected: PASS.

---

## Task 6: Add Compact Density Mode

**Files:**
- Modify: `src/ui/SessionBoard.tsx`
- Modify: `src/styles/masthead.css`
- Test: `src/ui/__tests__/observabilitySessionCard.test.tsx`

- [ ] **Step 1: Write the failing density class test**

Add to `src/ui/__tests__/observabilitySessionCard.test.tsx`:

```tsx
test("marks the observability grid as compact when density is compact", () => {
  const html = renderToStaticMarkup(
    <SessionBoard cards={[session()]} variant="observability" density="compact" onOpenSession={() => undefined} />
  );

  expect(html).toContain("observability-card-grid compact");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- --run src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected: FAIL because `density` is not accepted.

- [ ] **Step 3: Add density prop**

In `src/ui/SessionBoard.tsx`, import:

```ts
import type { CardDensity } from "./toolbarOptions";
```

Extend props:

```ts
  density?: CardDensity;
```

Default it:

```ts
  density = "comfortable"
```

Change the observability grid class:

```tsx
          <div className={`observability-card-grid ${density === "compact" ? "compact" : ""}`.trim()}>
```

- [ ] **Step 4: Add compact CSS**

In `src/styles/masthead.css`, add:

```css
.observability-card-grid.compact {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.observability-card-grid.compact .session-card {
  height: 176px;
  min-height: 176px;
}

.observability-card-grid.compact .observability-card-head {
  left: 16px;
  right: 10px;
  top: 12px;
}

.observability-card-grid.compact .session-card h2 {
  left: 16px;
  right: 16px;
  top: 43px;
  max-height: 40px;
  font-size: 14.5px;
  line-height: 1.34;
}

.observability-card-grid.compact .observability-card-facts {
  left: 16px;
  right: 16px;
  top: 96px;
  column-gap: 10px;
}

.observability-card-grid.compact .observability-card-facts dd,
.observability-card-grid.compact .observability-card-facts dt {
  font-size: 10.5px;
  line-height: 16px;
}

.observability-card-grid.compact .card-rule {
  left: 16px;
  right: 16px;
  top: 134px;
}

.observability-card-grid.compact .observability-card-footer {
  left: 16px;
  right: 16px;
  top: 147px;
  font-size: 11.5px;
}
```

- [ ] **Step 5: Run density test**

Run:

```bash
npm test -- --run src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected: PASS.

---

## Task 7: Retire the Right-Rail Topbar

**Files:**
- Modify: `src/ui/__tests__/observabilityRightRail.test.tsx`
- Delete: `src/ui/ObservabilityTopbar.tsx`
- Delete or remove from test suite: `src/ui/__tests__/observabilityTopbar.test.tsx`

- [ ] **Step 1: Update right rail test expectation**

In `src/ui/__tests__/observabilityRightRail.test.tsx`, remove the test that expects `rail-controls` when controls are provided, or change it to assert the default right rail has no controls:

```tsx
test("does not render toolbar controls in the right rail by default", () => {
  const html = renderToStaticMarkup(
    <ObservabilityRightRail
      summary={{ active: 16, needsAttention: 3, conflicts: 0, completed: 0, running: 16, idle: 5, needsAction: 3 }}
    />
  );

  expect(html).not.toContain("rail-controls");
});
```

- [ ] **Step 2: Delete obsolete topbar component and test**

Remove:

```text
src/ui/ObservabilityTopbar.tsx
src/ui/__tests__/observabilityTopbar.test.tsx
```

- [ ] **Step 3: Run right rail and live board tests**

Run:

```bash
npm test -- --run src/ui/__tests__/observabilityRightRail.test.tsx src/ui/__tests__/liveBoard.test.tsx
```

Expected: PASS.

---

## Task 8: Full Verification and Browser QA

**Files:**
- No code changes in this task.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- --run src/ui/__tests__/filterBoard.test.ts src/ui/__tests__/observabilityToolbar.test.tsx src/ui/__tests__/observabilitySessionCard.test.tsx src/ui/__tests__/observabilityRightRail.test.tsx src/ui/__tests__/liveBoard.test.tsx src/core/__tests__/projection.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 2: Run full suite**

Run with loopback permission if the sandbox blocks local ingest server tests:

```bash
npm test -- --run
```

Expected: all Vitest files pass.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: `tsc --noEmit` and `vite build` pass.

- [ ] **Step 4: Run doctor**

Run with loopback permission if needed:

```bash
npm run doctor
```

Expected: collector and Codex hooks are reported as ok.

- [ ] **Step 5: Browser QA in the in-app Browser**

Open:

```text
http://127.0.0.1:5173/
```

Verify:

- Search still filters sessions.
- Harness dropdown has `All Harnesses` and `Codex`; selecting `Codex` keeps real live Codex sessions visible.
- Lifecycle dropdown filters active, idle, and blocked sessions.
- Sort dropdown changes ordering between `Recent Activity` and `Recently Started`.
- Timeframe dropdown changes visible sessions for `Last hour`, `Last 12 hours`, `Last 24 hours`, `Last 48 hours`, `Last 3 days`, and `Last week`.
- Refresh dropdown visibly displays `5s`, `10s`, `15s`, `20s`, `30s`, and `1m`; selected value drives the polling interval.
- Square grid button toggles compact mode on and off.
- Compact mode fits more cards per row on desktop and has no title/fact/footer overlap.
- Right rail no longer contains `rail-controls`, `Live`, or the filter icon.
- Right rail still shows Live Sessions, Session Source, and Session Mix.
- No horizontal overflow on desktop.
- At narrow widths, toolbar controls wrap or fit without overlapping card content.

---

## Self-Review

- Spec coverage: all requested controls are represented by tasks: harness, lifecycle, sort, timeframes, refresh rates, compact grid, and right-rail controls removal.
- Placeholder scan: no task relies on unspecified behavior. Each code-changing step names files and shows the intended code shape.
- Type consistency: `HarnessFilter`, `LifecycleFilter`, `SortMode`, `ActivityWindow`, and `CardDensity` are defined once in `toolbarOptions.ts` and reused by App, Toolbar, SessionBoard, and filter helpers.
- Main risk: compact card CSS may need visual tuning after browser QA. Keep any adjustment scoped to `.observability-card-grid.compact`.

---

Plan complete and saved to `docs/superpowers/plans/2026-06-24-toolbar-completion.md`.

Execution options:

1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution: execute tasks in this session using `superpowers:executing-plans`, with checkpoints.
