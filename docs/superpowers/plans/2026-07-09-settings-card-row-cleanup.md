# Settings Card Row Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the decorative flow rail and simplify the two direct preference rows without changing Settings behavior.

**Architecture:** `SettingsSpineCard` keeps the existing card and detail state, but `SpineRow` becomes a two-column label/control row with no index or description API. The existing `SettingsToggle` markup remains unchanged; card-scoped CSS reverses only the direct toggle presentation so state text precedes the switch.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, happy-dom.

## Global Constraints

- Keep the existing steel card, `AppButton`, `SettingsToggle`, inline detail behavior, and callbacks.
- Remove every numbered node, connecting rail, and preference subtitle.
- Apply label-left/switch-right ordering only inside `.settings-spine-card`.
- Preserve a minimum 40px interactive hit area.

---

### Task 1: Simplify compact Settings rows

**Files:**
- Modify: `src/ui/settings/SettingsSpineCard.tsx`
- Modify: `src/styles/settings.css`
- Test: `src/ui/settings/__tests__/SettingsSurface.test.tsx`

**Interfaces:**
- Consumes: existing `SettingsToggle`, `AppButton`, `activeDetail`, and preference callbacks.
- Produces: the same `SettingsSpineCard` public props and detail behavior with simplified row markup.

- [ ] **Step 1: Write the failing surface assertions**

Require static markup to omit `.settings-spine-node`, `Interface transitions`, and `Session attention signals`. Require CSS to use `grid-template-columns: minmax(0, 1fr) auto` for rows and `flex-direction: row-reverse` for `.settings-spine-card .settings-toggle`.

- [ ] **Step 2: Run the focused test and verify RED**

Run `npx vitest run src/ui/settings/__tests__/SettingsSurface.test.tsx -t "renders one compact steel spine with Masthead action buttons"`.

Expected: failure because numbered nodes and subtitles remain and the toggle override does not exist.

- [ ] **Step 3: Implement the minimal markup and CSS change**

Remove `index` and `description` from `SpineRow` and `DetailRow`, delete the node element, change the row grid to two columns, delete node/rail/subtitle rules, and add:

```css
.settings-spine-card .settings-toggle {
  flex-direction: row-reverse;
}
```

- [ ] **Step 4: Run focused and full verification**

Run the Settings/Operations/Sources focused suite, typecheck, product and surface contracts, full Vitest, build, endpoint matrix, citation check, and `git diff --check`.

Expected: all checks pass with unchanged Settings operations.

- [ ] **Step 5: Commit**

Commit the plan and implementation with `feat: simplify compact settings rows`.

## Self-review

- Spec coverage: rail removal, subtitle removal, toggle ordering, scoped CSS, and behavior preservation are covered.
- Placeholder scan: no placeholders.
- Type consistency: the public `SettingsSpineCard` interface remains unchanged.
