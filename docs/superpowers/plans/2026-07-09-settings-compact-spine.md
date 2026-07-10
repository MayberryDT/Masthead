# Settings Compact Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Settings category rail with one centered compact Knowledge-flow-style steel card while preserving every existing Settings action.

**Architecture:** `OperationsPanel` retains data loading, action state, and confirmation dialogs. A new `SettingsSpineCard` owns the compact six-row composition and receives the currently selected detail as a child; existing detail components render unframed inside the card. Shared `masthead.css` card selectors provide the steel shell, while `settings.css` owns only Settings-specific layout and spine rows.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, happy-dom.

## Global Constraints

- No category sidebar, tab bar, dropdown menu, second card, dashboard summary, or new button class.
- All row actions use `AppButton`; Danger zone uses `variant="danger"`.
- Existing data, MCP, destructive-action, feedback, and confirmation behavior remains unchanged.
- The card reuses the shared Knowledge flow steel shell.
- Sources styling remains unchanged.

---

### Task 1: Compact spine surface

**Files:**
- Create: `src/ui/settings/SettingsSpineCard.tsx`
- Modify: `src/ui/OperationsPanel.tsx`
- Modify: `src/styles/settings.css`
- Modify: `src/styles/masthead.css`
- Delete: `src/ui/settings/SettingsCategoryNav.tsx`
- Delete: `src/ui/settings/__tests__/SettingsCategoryNav.test.tsx`
- Modify: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Modify: `src/ui/settings/__tests__/SettingsOperationalStates.test.tsx`
- Modify: `src/ui/__tests__/operationsPanel.test.tsx`
- Modify: `design.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: existing `SettingsToggle`, `AppButton`, Data/MCP/Advanced/Danger detail components, and `SettingsFeedback` state.
- Produces: `SettingsSpineCard` with `activeDetail`, `onDetailChange`, direct preference props, and `children` for the selected detail.

- [ ] **Step 1: Write failing compact-spine integration tests**

Update `SettingsSurface.test.tsx` to require one `.settings-spine-card`, numbered nodes `01` through `06`, direct General toggles, no category nav/pane, AppButton class contracts on all detail buttons, and one selected detail at a time. Update existing tests to query `.settings-spine-detail[data-settings-detail]` after clicking `Open` or `Close`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx src/ui/__tests__/operationsPanel.test.tsx
```

Expected: failure because `.settings-spine-card` does not exist and the category rail still renders.

- [ ] **Step 3: Implement the compact spine**

Create `SettingsSpineCard` using existing `SettingsToggle` and `AppButton`. Replace `SettingsCategoryNav` in `OperationsPanel`, render existing detail components as its child, and delete the orphaned category-nav component/test. Add centered responsive layout and spine row styling to `settings.css`; add `.settings-spine-card` to the existing shared steel shell, `::before`, `::after`, and child-layer selector groups in `masthead.css`.

- [ ] **Step 4: Update the design contract**

Change `design.md` and `AGENTS.md` from category-rail/focused-ledger language to the centered compact steel spine card, while retaining Agent access inside Settings and Sources ownership.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same three-file Vitest command. Expected: all tests pass with no warnings.

- [ ] **Step 6: Run the full serial gate**

Run `npm run verify:no-citations`, product/surface contracts, typecheck, full Vitest, production build, endpoint matrix, and `git diff --check` serially.

- [ ] **Step 7: Commit**

Commit the implementation and tests with `feat: use compact settings spine`.

## Self-review

- Spec coverage: one centered card, exact steel shell, six rows, real buttons, inline details, responsive behavior, and preserved operations are covered.
- Placeholder scan: none.
- Type consistency: `activeDetail` is a closed union shared only by `SettingsSpineCard` and `OperationsPanel`.
