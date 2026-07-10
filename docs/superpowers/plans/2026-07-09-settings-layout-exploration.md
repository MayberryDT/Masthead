# Settings Layout Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one disposable HTML comparison board containing ten Masthead-native Settings layouts.

**Architecture:** A single static document contains shared Masthead design tokens and ten structurally distinct layout specimens. It references the existing sail asset and anodized texture by relative path; no production application code, data, or behavior is involved.

**Tech Stack:** HTML and CSS only.

## Global Constraints

- Create exactly one standalone HTML artifact under `mockups/`.
- Keep the existing user-owned sidebar mockup untouched.
- Reuse Masthead's existing dark-steel palette, texture, typography, logo asset, compact controls, and settings vocabulary.
- Include no application logic, persistence, routing, or JavaScript.
- Treat the artifact as throwaway after a direction is selected.

---

### Task 1: Build the ten-layout comparison board

**Files:**
- Create: `mockups/settings-layout-ten-directions.html`

**Interfaces:**
- Consumes: `public/assets/masthead-logo-sail.png`, `public/textures/anodized-noise.svg`, and the approved settings exploration design.
- Produces: a directly openable HTML file with ten labeled layout specimens.

- [ ] **Step 1: Create the static board with Masthead tokens**

Use a single HTML document with embedded CSS, shared dark-steel tokens, `@font-face` fallbacks, a title index, and static General/Data/Agent access/Advanced/Danger zone vocabulary. Reference actual Masthead assets using `../public/assets/masthead-logo-sail.png` and `../public/textures/anodized-noise.svg`.

- [ ] **Step 2: Render ten structurally different settings layouts**

Include four utility-grid options, three split-composition options, and three anchored/ledger options. Each specimen must visibly solve the empty-canvas problem differently while using direct controls rather than explanatory copy or KPI dashboards.

- [ ] **Step 3: Verify the artifact is self-contained and non-invasive**

Run:

```bash
test -f mockups/settings-layout-ten-directions.html
rg -n 'script|fetch\(|localStorage|sessionStorage' mockups/settings-layout-ten-directions.html
git status --short
```

Expected: the HTML file exists, no behavior-producing JavaScript or persistence APIs appear, and the existing sidebar mockup remains untouched.

- [ ] **Step 4: Commit**

```bash
git add mockups/settings-layout-ten-directions.html docs/superpowers/plans/2026-07-09-settings-layout-exploration.md
git commit -m "prototype: explore settings layout directions"
```

## Self-Review

- Spec coverage: Task 1 covers the one-file, ten-layout, Masthead-assets, no-logic, and throwaway constraints.
- Placeholder scan: none.
- Interface consistency: the only output is the documented HTML file.
