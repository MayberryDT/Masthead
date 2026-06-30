# Dovetail Card System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for parallel implementation/review work, or `superpowers:executing-plans` if implementing in a single worker. Track progress with the checkbox steps below.

**Goal:** Apply the selected Dovetail Compression Base treatment to Masthead's in-scope card surfaces without changing Settings, Sources, import queue/import job UI, raw JSON/code/session.json-style displays, or Logbook table rows.

**Chosen direction:** A bottom-only structural color accent with a centered dovetail/notched compression base. It should feel like part of the metal card shell, not a left rail, glow, full-card wash, or loading/progress bar.

**Architecture:** Add one opt-in decorative primitive, `DovetailBase`, and explicit `dovetail-card-surface`/tone classes to in-scope React components. Shared CSS styles only the opt-in child (`.dovetail-card-surface > .dovetail-base`). Do not style broad shared selectors such as `.usage-metric` directly, because Sources also uses those class names and is out of scope.

**Tech stack:** React 19, TypeScript, plain CSS in `src/styles/*.css`, Vitest/happy-dom, `npm run dev` with the Codex in-app Browser for visual verification.

---

## Optimizer Record

The baseline plan scored **82/100**. It had strong scope and exclusions, but overfit to long snippets, asserted brittle class-string order, and risked broad CSS selectors affecting Sources because `usage-metric` is shared outside Usage/Logbook.

Final optimized score: **94/100**

Score trajectory: `82 -> 90 -> 94 -> 94`

Rubric:

| Criterion | Weight | Final | Rationale |
| --- | ---: | ---: | --- |
| Scope and exclusion fidelity | 20 | 20 | Explicit in/out list plus source/settings/raw JSON audits. |
| Current-code feasibility | 20 | 18 | Uses real components, avoids broad selector traps, and includes an inventory step for discovered cards. |
| Verification rigor | 20 | 19 | Adds contract tests, exclusion searches, build checks, surface contract checks, and Browser verification. |
| Design fidelity and responsive behavior | 15 | 14 | Keeps Masthead metal language, sparse state color, fixed card density, and mobile overflow checks. |
| Sequencing and rollback | 15 | 14 | Starts with tests/inventory, rolls out by surface, and keeps opt-in rollback simple. |
| Maintainability | 10 | 9 | Central primitive/tone mapping limits duplicate markup and avoids global side effects. |

Substantive improvements from optimization:

- Added a real card inventory gate before implementation so older or shared card-like surfaces are classified deliberately.
- Replaced brittle exact-class snippets with DOM contract assertions and explicit exclusion tests.
- Scoped Usage/Logbook work so Sources can keep using `usage-metric` without inheriting dovetail styling.

---

## Design Contract

The selected treatment comes from `mockups/session-card-directions.html` and the durable project decision `decisions/masthead-dovetail-card-system`.

Use this shape as the basis for the base accent:

```css
clip-path: polygon(
  0 0,
  36% 0,
  42% 58%,
  58% 58%,
  64% 0,
  100% 0,
  calc(100% - 10px) 100%,
  10px 100%
);
```

Constraints:

- Keep the existing Masthead color scheme and metal-surface language from `design.md`.
- Use state color sparsely. The base carries the state signal; the rest of the card stays mostly metal, border, typography, and evidence.
- Keep card radii and density compact. Do not introduce rounded marketing cards or hero-scale typography.
- The base can slightly change the card silhouette at the bottom, but it must not obscure footer text, resize grid tracks unpredictably, or create horizontal overflow.
- The base is decorative only: `aria-hidden="true"`, `pointer-events: none`, no focus target.

---

## Definition Of Done

- In-scope card surfaces render `.dovetail-card-surface`, one semantic tone class, and a direct child `.dovetail-base`.
- Active/running, idle/info, blocked/error, healthy/good, and complete/neutral states are distinguishable at a glance through the bottom base.
- No dovetail class, import, CSS rule, or rendered base appears in Settings, Sources, import queue/import job rows, raw JSON/code/config displays, raw transcript rows, or `session.json`/`session.jsonl` displays.
- Existing live-card FLIP/view-transition behavior still works because `.session-card[data-session-id]` remains the stable card root.
- Dossier panel headers remain outside scrollable panel bodies, and panel body scrolling still works.
- Browser verification passes at 1440px, 768px, 390px, and 320px widths with no clipped base, text overlap, or horizontal overflow.
- `npm run verify:no-citations`, `npm run check:surface-contract`, `npm run typecheck`, focused Vitest suites, and `npm run build` pass.

---

## Scope

### In Scope

- Now board live session cards: `src/ui/SessionCard.tsx`
- Now metric cards: `src/ui/MetricCard.tsx`
- Needs-attention item cards: `src/ui/AttentionQueue.tsx`
- Usage summary metrics: `src/ui/usage/UsageSummaryStrip.tsx`
- Usage table cards, coverage card, and loading/error/empty state cards: `src/ui/usage/UsageBreakdownTable.tsx`, `src/ui/usage/UsageActivityTable.tsx`, `src/ui/usage/UsagePanel.tsx`
- Logbook summary metrics only: `src/ui/HistoryPanel.tsx`
- Session dossier identity hero and dossier panels: `src/ui/session-dossier/SessionDossier.tsx`

### Explicitly Out Of Scope

- Settings surface and all settings cards/sections: `src/app/surfaces/SettingsSurface.tsx`, `src/ui/settings/**`, `src/styles/settings.css`
- Sources surface, adapter/source cards, onboarding cards, source detail modal cards, source summary metrics, import queue, and import job rows: `src/app/surfaces/SourcesSurface.tsx`, `src/ui/sources/**`, `src/styles/sources.css`
- Raw JSON/code/config/session.json-style displays: `src/ui/primitives/CodeBlock.tsx`, `.code-block`, MCP JSON config output, raw transcript rows, and raw session JSON views
- Logbook table rows and table frames: `src/ui/logbook/LogbookTable.tsx`, `src/ui/logbook/LogbookRow.tsx`
- Empty state panels outside Usage unless an inventory step identifies them as true cards and they are not in an excluded surface
- Legacy or unused CSS selectors unless a corresponding live component still renders them

---

## Card Inventory Rules

Before migrating components, classify every card-like selector found in current source:

```bash
rg -n "session-card|metric-card|attention-item|usage-metric|usage-table-card|usage-coverage|dossier-hero|dossier-panel|surface-fixed-card|empty-session-state|adapter-card|settings-section|code-block" src/ui src/app src/styles --glob '*.{tsx,ts,css}'
```

Classification rules:

- **Migrate:** repeated data cards or framed tool cards in Now, Usage, Logbook summary, and Session Dossier.
- **Do not migrate:** Settings, Sources, imports, raw JSON/code/config, Logbook rows, and session.json/session.jsonl displays.
- **Defer and mention in closeout:** ambiguous panels that are not repeated cards and are not required by Tyler's scope.
- **Do not use class-name inheritance as scope.** A component only receives the new treatment if its JSX explicitly opts in.

Expected known trap:

- `usage-metric` is used by Usage/Logbook and by Sources. Only Usage/Logbook summary metrics should opt in; Sources summary metrics must remain unchanged.

---

## File Map

Create:

- `src/ui/primitives/DovetailBase.tsx`
- `src/ui/__tests__/dovetailCardSystem.test.tsx`

Modify:

- `src/styles/masthead.css`
- `src/styles/session-dossier.css`
- `src/ui/SessionCard.tsx`
- `src/ui/MetricCard.tsx`
- `src/ui/AttentionQueue.tsx`
- `src/ui/usage/UsageSummaryStrip.tsx`
- `src/ui/usage/UsageBreakdownTable.tsx`
- `src/ui/usage/UsageActivityTable.tsx`
- `src/ui/usage/UsagePanel.tsx`
- `src/ui/HistoryPanel.tsx`
- `src/ui/session-dossier/SessionDossier.tsx`

Focused tests likely needing updates:

- `src/ui/__tests__/observabilitySessionCard.test.tsx`
- `src/ui/__tests__/metricCard.test.tsx`
- `src/ui/__tests__/liveBoard.test.tsx`
- `src/ui/__tests__/historyPanel.test.tsx`
- `src/ui/usage/__tests__/UsagePanel.test.tsx`
- `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`
- `src/ui/logbook/__tests__/LogbookTable.test.tsx`
- `src/ui/sources/__tests__/AdapterRow.test.tsx`
- `src/ui/sources/__tests__/ImportJobsTable.test.tsx`
- `src/ui/settings/__tests__/SettingsSurface.test.tsx`

---

## Phase 1: Baseline Inventory And Failing Contract Tests

### Step 1: Create the card inventory

- [ ] Run the card inventory command from the "Card Inventory Rules" section.
- [ ] Confirm every hit is either listed in scope, listed out of scope, or documented as deferred.
- [ ] Pay special attention to `usage-metric`, `empty-session-state`, and any currently unused `surface-fixed-card` CSS.

Verification:

```bash
rg -n "surface-fixed-card" src/ui src/app --glob '*.{tsx,ts}'
rg -n "usage-metric" src/ui src/app --glob '*.{tsx,ts}'
```

Expected:

- `surface-fixed-card` has no live JSX usage unless the codebase changes before implementation.
- `usage-metric` appears in both in-scope Usage/Logbook code and out-of-scope Sources code.

### Step 2: Add contract tests before implementation

Create `src/ui/__tests__/dovetailCardSystem.test.tsx`.

Test style requirements:

- Prefer DOM/classList assertions over exact string-order assertions.
- Use existing test fixture shapes from nearby tests as the source of truth for DTO fields.
- Assert direct child base placement with selectors such as `.session-card > .dovetail-base`.
- Assert one tone class per card family with `classList.contains(...)`.
- Assert excluded files do not contain `dovetail`.

Minimum test coverage:

- Active/running session card opts in with active/good tone.
- Idle session card opts in with idle/info tone.
- Blocked session card opts in with attention/error tone.
- `MetricCard` opts in and maps `tone="good"`, `tone="bad"`, and neutral tone.
- `AttentionQueue` item cards opt in with attention tone.
- Usage summary, usage table, coverage, and usage state cards opt in.
- Logbook summary metrics opt in, while Logbook rows do not.
- Dossier hero and dossier panels opt in.
- Raw transcript rows, code blocks, Settings CSS, Sources CSS, source adapter cards, source summary metrics, and import job rows do not opt in.

Verification:

```bash
npx --no-install vitest --run src/ui/__tests__/dovetailCardSystem.test.tsx
```

Expected:

- Fails because `DovetailBase`, `dovetail-card-surface`, and tone classes do not exist yet.

---

## Phase 2: Shared Primitive And CSS

### Step 1: Add the primitive

Create `src/ui/primitives/DovetailBase.tsx`:

```tsx
export function DovetailBase() {
  return <span className="dovetail-base" aria-hidden="true" />;
}
```

### Step 2: Add opt-in CSS

Add shared CSS in `src/styles/masthead.css` near the metal surface/card rules.

Implementation requirements:

- Style only `.dovetail-card-surface` and `.dovetail-card-surface > .dovetail-base`.
- Use CSS variables for width, height, bottom offset, and color.
- Keep `position: relative` and `isolation: isolate` on the surface.
- Use `overflow: visible` only on opted-in card surfaces that need the base to extend below the border.
- Reserve bottom space with `padding-bottom`, `margin-bottom`, or component-specific spacing so the base never overlaps card content.
- Use `min-width` and `max-width` to keep the base stable on narrow cards.
- Add compact sizing for summary metrics and attention cards.
- Add reduced-motion handling only if a base transition is introduced.

Tone classes:

- `dovetail-active`
- `dovetail-idle`
- `dovetail-attention`
- `dovetail-good`
- `dovetail-bad`
- `dovetail-info`
- `dovetail-neutral`
- `dovetail-complete`
- `dovetail-compact`

Color mapping should use existing tokens where possible:

- Active/good/healthy: green token
- Idle/info/neutral operational state: blue token
- Attention/bad/error/blocked: red token
- Complete/archived/passive: muted metal/ink token

### Step 3: Verify CSS does not leak

Run:

```bash
rg -n "dovetail" src/styles/sources.css src/styles/settings.css src/ui/sources src/ui/settings src/ui/primitives/CodeBlock.tsx
```

Expected: no output.

Run the contract test again:

```bash
npx --no-install vitest --run src/ui/__tests__/dovetailCardSystem.test.tsx
```

Expected:

- Still fails because components have not opted in yet.

---

## Phase 3: Now Surface Cards

### Step 1: Migrate `SessionCard`

Modify `src/ui/SessionCard.tsx`:

- Import `DovetailBase`.
- Add `dovetail-card-surface` to the root `<article>`.
- Add a tone helper near the existing state helpers.
- Append `<DovetailBase />` as the last child of the article.
- Keep `.session-card[data-session-id]` on the same root element for layout animation.

Session tone mapping:

- Blocked session according to `isBlockedSessionCard(session)`: `dovetail-attention`
- Idle/stalled session: `dovetail-idle`
- Completed ended session: `dovetail-complete`
- Failed/ended-needs-action session: `dovetail-attention`
- Running/editing/default active session: `dovetail-active`

CSS cleanup:

- Remove the visible left status rail from in-scope session cards.
- Do not remove state token color.
- Do not remove layout transition, hover, active, new-card, or compact-density behavior.

Verification:

```bash
npx --no-install vitest --run src/ui/__tests__/dovetailCardSystem.test.tsx src/ui/__tests__/observabilitySessionCard.test.tsx src/ui/__tests__/liveBoard.test.tsx
```

Expected:

- Session-card tests pass after updating expectations only for the new opt-in classes/base.

### Step 2: Migrate `MetricCard`

Modify `src/ui/MetricCard.tsx`:

- Import `DovetailBase`.
- Add `dovetail-card-surface dovetail-compact` to the root card.
- Map `tone="good"` to `dovetail-good`, `tone="bad"` to `dovetail-bad`, and neutral/default to `dovetail-info` or `dovetail-neutral`.
- Append `<DovetailBase />` as the last child.

Verification:

```bash
npx --no-install vitest --run src/ui/__tests__/metricCard.test.tsx src/ui/__tests__/dovetailCardSystem.test.tsx
```

Expected: pass.

### Step 3: Migrate `AttentionQueue`

Modify `src/ui/AttentionQueue.tsx`:

- Import `DovetailBase`.
- Add `dovetail-card-surface dovetail-compact dovetail-attention` to `.attention-item`.
- Append `<DovetailBase />` as the last child of each attention item.
- Keep scan/detail variants visually dense.

Verification:

```bash
npx --no-install vitest --run src/ui/__tests__/liveBoard.test.tsx src/ui/__tests__/dovetailCardSystem.test.tsx
```

Expected: pass.

---

## Phase 4: Usage And Logbook Summary Cards

### Step 1: Migrate Usage summary metrics without affecting Sources

Modify `src/ui/usage/UsageSummaryStrip.tsx`:

- Import `DovetailBase`.
- Add `dovetail-card-surface dovetail-compact` and a tone class to each Usage metric.
- Remove the in-component `usage-metric-accent` span from Usage metrics, or hide it only under a `.usage-panel` scoped selector.
- Do not change `src/ui/sources/SourcesConnectedDashboard.tsx`.

Use a helper for tone mapping from the existing metric type/class to dovetail tone:

- sessions/rate/tools/files/mcp: `dovetail-info`
- tokens or healthy coverage: `dovetail-good`
- warning/empty/error state metrics if introduced: `dovetail-attention`

### Step 2: Migrate Usage table cards, coverage card, and state cards

Modify:

- `src/ui/usage/UsageBreakdownTable.tsx`
- `src/ui/usage/UsageActivityTable.tsx`
- `src/ui/usage/UsagePanel.tsx`

Requirements:

- Table card roots receive `dovetail-card-surface dovetail-info`.
- `usage-coverage` receives `dovetail-card-surface dovetail-good` or `dovetail-info` based on current design semantics.
- Loading, empty, no-token, and error states should use a small local helper such as `UsageStateCard` to avoid duplicated markup.
- Error state uses `dovetail-attention`/`dovetail-bad`.
- Do not style table rows or cells as dovetail cards.

CSS cleanup:

- Scope any old accent removal to `.usage-panel`, not global `.usage-metric`, so Sources summary metrics are not affected.
- Scope top-stripe removal to `.usage-panel .usage-table-card::before` and `.usage-panel .usage-coverage::before`.

### Step 3: Migrate Logbook summary metrics only

Modify `src/ui/HistoryPanel.tsx`:

- Import `DovetailBase`.
- Add dovetail classes and base to `LogbookSummaryStrip` metrics.
- Do not add dovetail to `LogbookTable`, skeleton rows, pagination, filter popovers, empty panels, or table cells.

Verification:

```bash
npx --no-install vitest --run \
  src/ui/__tests__/dovetailCardSystem.test.tsx \
  src/ui/usage/__tests__/UsagePanel.test.tsx \
  src/ui/__tests__/historyPanel.test.tsx \
  src/ui/logbook/__tests__/LogbookTable.test.tsx \
  src/ui/sources/__tests__/AdapterRow.test.tsx
```

Expected:

- Usage and Logbook summary cards pass dovetail assertions.
- Sources adapter tests still pass and do not render dovetail classes.

---

## Phase 5: Session Dossier Cards

### Step 1: Migrate dossier hero

Modify `src/ui/session-dossier/SessionDossier.tsx`:

- Import `DovetailBase`.
- Add `dovetail-card-surface` and a tone class to `.dossier-hero`.
- Append `<DovetailBase />` as the final child of the hero section.
- Keep identity metrics and copy actions in the hero.

Suggested tone:

- `dovetail-info` for normal identity hero.
- `dovetail-attention` only if an existing dossier-level error/attention state is already represented on that hero.

### Step 2: Migrate `DossierPanel`

Modify the local `DossierPanel` helper:

- Add `dovetail-card-surface` to the panel root.
- Add a tone class derived from panel purpose.
- Append `<DovetailBase />` after `.dossier-panel-body`.
- Preserve child order required by existing tests: heading first, `.dossier-panel-body` second.

Suggested panel tones:

- Primary/enrichment panel: `dovetail-good`
- Transcript and transcript excerpts: `dovetail-info`
- Raw transcript, timeline, provenance, and neutral panels: `dovetail-neutral`
- Failed verification or attention panels if surfaced later: `dovetail-attention`

### Step 3: Preserve scroll behavior

Modify `src/styles/session-dossier.css`:

- Keep the existing base `.dossier-panel { overflow: hidden; }` behavior if tests rely on it.
- Add a later, scoped override for `.dossier-panel.dovetail-card-surface` only if required for the base to show.
- Keep `.dossier-panel-body { overflow: auto; }`.
- Keep transcript-specific visible body overflow.
- Do not add dovetail to `.dossier-raw-transcript-item`, code blocks, raw transcript lines, or session JSON displays.

Verification:

```bash
npx --no-install vitest --run \
  src/ui/__tests__/dovetailCardSystem.test.tsx \
  src/ui/session-dossier/__tests__/SessionDossier.test.tsx \
  src/ui/__tests__/sessionLibraryDetail.test.tsx \
  src/ui/__tests__/liveBoard.test.tsx
```

Expected:

- Dossier card assertions pass.
- Existing scroll/header/body tests still pass.

---

## Phase 6: Exclusion Audit And CSS Cleanup

### Step 1: Search for forbidden dovetail usage

Run:

```bash
rg -n "dovetail|dovetail-base|dovetail-card-surface" src/ui/sources src/styles/sources.css src/ui/settings src/styles/settings.css src/ui/primitives/CodeBlock.tsx
```

Expected: no output.

Run:

```bash
rg -n "dovetail|dovetail-base|dovetail-card-surface" src/ui src/styles --glob '*.{tsx,css}'
```

Expected:

- Hits only in the primitive, in-scope component files, in-scope tests, `src/styles/masthead.css`, and `src/styles/session-dossier.css`.

### Step 2: Search for shared selector leaks

Run:

```bash
rg -n "usage-metric-accent|usage-table-card::before|usage-coverage::before|border-left" src/styles/masthead.css src/styles/sources.css src/styles/settings.css
```

Expected:

- Any in-scope old accents are removed or scoped under `.usage-panel`/`.logbook-summary-strip`.
- Sources and Settings styling remains intentionally unchanged.
- Session-card left rail is removed from in-scope session cards.

### Step 3: Run focused regression tests

Run:

```bash
npx --no-install vitest --run \
  src/ui/__tests__/dovetailCardSystem.test.tsx \
  src/ui/__tests__/observabilitySessionCard.test.tsx \
  src/ui/__tests__/metricCard.test.tsx \
  src/ui/__tests__/liveBoard.test.tsx \
  src/ui/__tests__/historyPanel.test.tsx \
  src/ui/usage/__tests__/UsagePanel.test.tsx \
  src/ui/session-dossier/__tests__/SessionDossier.test.tsx \
  src/ui/logbook/__tests__/LogbookTable.test.tsx \
  src/ui/sources/__tests__/AdapterRow.test.tsx \
  src/ui/sources/__tests__/ImportJobsTable.test.tsx \
  src/ui/settings/__tests__/SettingsSurface.test.tsx
```

Expected: pass.

---

## Phase 7: Static Verification And Browser Review

### Step 1: Run static checks

Run:

```bash
npm run verify:no-citations
npm run check:surface-contract
npm run typecheck
npm run build
```

Expected: all exit 0.

### Step 2: Use dev citations during visual review, then remove them

For visual verification only, temporarily wrap affected JSX with `DevCite` names such as:

- `SessionCard`
- `MetricCard`
- `AttentionItem`
- `UsageMetric`
- `UsageTableCard`
- `LogbookSummaryMetric`
- `DossierPanel`

Launch with the project-approved live launcher and citation flag:

```bash
VITE_MASTHEAD_DEV_CITATIONS=1 npm run dev
```

After Browser review:

- Remove all temporary `DevCite` wrappers.
- Re-run `npm run verify:no-citations`.

### Step 3: Verify in the Codex in-app Browser

Use the in-app Browser, not standalone Playwright or an external browser tool.

Viewports:

- Desktop: 1440px wide
- Tablet: 768px wide
- Mobile: 390px wide
- Narrow mobile: 320px wide

In-scope checks:

- Now board: active, idle, and blocked session cards show distinct bottom dovetail bases.
- Now board: no visible left rail remains on session cards.
- Now compact density: card height remains stable and footer text does not collide with the base.
- Metrics: summary metric cards show compact bases without becoming decorative KPI blocks.
- Attention queue: attention cards are clearly red/attention-toned through the base.
- Usage: summary metrics, table cards, coverage, and state cards show bases.
- Logbook: summary metrics show bases; table rows remain dense rows.
- Session detail modal/dossier: hero and panels show bases; panel bodies still scroll correctly.

Out-of-scope checks:

- Sources adapter cards remain unchanged.
- Sources summary metrics remain unchanged even though they use `usage-metric`.
- Import queue/import job rows remain unchanged.
- Settings sections and MCP JSON/code blocks remain unchanged.
- Raw transcript rows and raw JSON/session.json/session.jsonl displays remain unchanged.

Layout checks at each viewport:

- No horizontal overflow.
- No clipped base on in-scope cards.
- No base overlapping footer text, buttons, tables, or scrollbars.
- No glow or middle-of-card color wash.
- No loading-bar-looking base pattern.

### Step 4: Stop the dev server

Stop `npm run dev` after verification unless Tyler asks to keep it running.

---

## Rollback Plan

If the design causes unacceptable layout regressions:

1. Remove `DovetailBase` imports/usages and `dovetail-*` classes from the affected surface only.
2. Keep the primitive and CSS if other surfaces have already passed verification.
3. For dossier scroll regressions, roll back dossier opt-in first; do not roll back Now/Usage work unless those surfaces fail independently.
4. Restore any old in-scope accent only if the surface loses essential state scannability and Tyler wants a temporary fallback.
5. Re-run the exclusion audit after any rollback.

Because the system is opt-in, rollback should not require changing Settings, Sources, import queue, or raw display code.

---

## Closeout

### Step 1: Final command evidence

Run:

```bash
npm run verify:no-citations
npm run check:surface-contract
npm run typecheck
npx --no-install vitest --run \
  src/ui/__tests__/dovetailCardSystem.test.tsx \
  src/ui/__tests__/observabilitySessionCard.test.tsx \
  src/ui/__tests__/metricCard.test.tsx \
  src/ui/__tests__/liveBoard.test.tsx \
  src/ui/__tests__/historyPanel.test.tsx \
  src/ui/usage/__tests__/UsagePanel.test.tsx \
  src/ui/session-dossier/__tests__/SessionDossier.test.tsx \
  src/ui/logbook/__tests__/LogbookTable.test.tsx \
  src/ui/sources/__tests__/AdapterRow.test.tsx \
  src/ui/sources/__tests__/ImportJobsTable.test.tsx \
  src/ui/settings/__tests__/SettingsSurface.test.tsx
npm run build
```

Expected: all exit 0.

### Step 2: Durable memory

After implementation and visual acceptance:

- Update GBrain page `sessions/2026/06/masthead-dovetail-card-system-plan` with actual verification results.
- Update GBrain decision `decisions/masthead-dovetail-card-system` only if Tyler accepts this as the app-wide in-scope card standard.

### Step 3: Commit only if requested

Only commit if Tyler asks for a commit:

```bash
git add src/ui src/styles docs/superpowers/plans/2026-06-29-dovetail-card-system.md
git commit -m "feat: apply dovetail card system"
```

---

## Self-Review Checklist

- [ ] Every in-scope surface has explicit JSX opt-in rather than inherited/global styling.
- [ ] Settings has no dovetail classes, imports, or CSS.
- [ ] Sources has no dovetail classes, imports, or CSS, including source summary metrics.
- [ ] Import queue/import job rows are unchanged.
- [ ] Raw JSON/code/session.json/session.jsonl displays are unchanged.
- [ ] Logbook table rows remain table rows.
- [ ] Session-card animation selectors still target `.session-card[data-session-id]`.
- [ ] Dossier panel tests still prove headers are outside scroll bodies.
- [ ] Browser screenshots/inspection confirm no overlap or overflow at all required widths.
