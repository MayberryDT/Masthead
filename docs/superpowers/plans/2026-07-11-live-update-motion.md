# Live Update Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace refresh blinking with restrained changed-number and new-item-only motion across the Masthead sidebar and Workbench.

**Architecture:** Keep server state rendering stable and add two focused presentation primitives: `AnimatedNumber` for value changes and `useNewItemIds` for post-mount collection additions. Components opt into those primitives without changing their data flow, ordering, or layout.

**Tech Stack:** React 19, TypeScript, CSS keyframes, Vitest, in-app Browser.

## Global Constraints

- Existing content stays mounted during refresh.
- Initial render is static.
- Queue and Activity entrances move at most 2px and last 180ms.
- Counter changes last 200ms, move 2px, use zero blur, and stagger digits by 12ms.
- No height, scale, whole-panel, or layout animation.
- `prefers-reduced-motion: reduce` disables new motion.
- No new dependency and no `transition: all`.

---

### Task 1: Stable changed-number primitive

**Files:**
- Create: `src/ui/motion/AnimatedNumber.tsx`
- Test: `src/ui/motion/__tests__/AnimatedNumber.test.tsx`
- Modify: `src/ui/SidebarKnowledgeFlow.tsx`
- Modify: `src/ui/__tests__/sidebarKnowledgeFlow.test.tsx`
- Modify: `src/styles/masthead.css`

**Interfaces:**
- Produces: `AnimatedNumber({ value, className?, format? }: { value: number; className?: string; format?: (value: number) => string })`.
- Consumes: numeric knowledge-flow values and the exact Transitions.dev `.t-digit-group` / `.t-digit` hooks.

- [ ] Write a component test proving the first render has no `is-animating` class and a rerendered value does.
- [ ] Write a sidebar test proving `summary` values remain visible when `loading` is true.
- [ ] Run `npx vitest --run src/ui/motion/__tests__/AnimatedNumber.test.tsx src/ui/__tests__/sidebarKnowledgeFlow.test.tsx` and confirm the new assertions fail.
- [ ] Implement `AnimatedNumber` with a previous-value ref, a post-mount change effect, per-character spans, forced reflow, and timer cleanup.
- [ ] Replace sidebar string formatting with `AnimatedNumber`, using placeholders only when no summary exists or the endpoint is unavailable.
- [ ] Copy the exact number-pop CSS hooks and reduced-motion guard, then scope the approved Masthead variable values to `.masthead-shell`.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: New-item-only collection motion

**Files:**
- Create: `src/ui/motion/useNewItemIds.ts`
- Test: `src/ui/motion/__tests__/useNewItemIds.test.tsx`
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`
- Modify: `src/styles/masthead.css`

**Interfaces:**
- Consumes: ordered string IDs from the current render.
- Produces: `useNewItemIds(ids: readonly string[]): ReadonlySet<string>`, containing only IDs absent from the prior committed render and never initial IDs.

- [ ] Write a hook test proving initial IDs are not new, appended IDs are new for one committed render, and an unchanged rerender clears the set.
- [ ] Write Workbench tests proving post-mount session/activity additions receive `is-new` while initial items do not.
- [ ] Run `npx vitest --run src/ui/motion/__tests__/useNewItemIds.test.tsx src/ui/workbench/__tests__/WorkbenchPanel.test.tsx` and confirm failure.
- [ ] Implement `useNewItemIds` with committed previous-ID state and no timers.
- [ ] Apply it independently to session IDs and activity IDs in `WorkbenchPanel`.
- [ ] Add 180ms, 2px queue/activity entrance keyframes, a restrained temporary queue-row inset edge, and a reduced-motion override. Do not animate row height or existing items.
- [ ] Re-run focused Workbench tests and confirm they pass.

### Task 3: Visual and production verification

**Files:**
- Temporarily modify and then restore: `src/ui/SidebarKnowledgeFlow.tsx`
- Temporarily modify and then restore: `src/ui/workbench/WorkbenchPanel.tsx`

**Interfaces:**
- Consumes: `DevCite` development overlays.
- Produces: no permanent citation markers.

- [ ] Wrap the knowledge card, Workbench queue, and Activity rail in uniquely named `DevCite` wrappers.
- [ ] Run a non-production UI on a non-reserved port and inspect desktop, tablet, and narrow mobile widths in the in-app Browser.
- [ ] Trigger repeated live refreshes and confirm no counter placeholders, no whole-region blink, no initial-load motion, and only minimal entrances for new IDs.
- [ ] Remove every temporary `DevCite` wrapper.
- [ ] Run `npm run verify:no-citations`, focused tests, `npm run typecheck`, `npm run check:surface-contract`, and `npm run build`.
- [ ] Rebuild packaged Electron production, replace the sole AppMenu bundle, relaunch, and confirm the production view remains stable during active import updates.
