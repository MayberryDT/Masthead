# Settings Layout Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one disposable HTML comparison board containing five single-card Masthead Settings layouts.

**Architecture:** A single static document contains shared Masthead design tokens and ten structurally distinct layout specimens. It references the existing sail asset and anodized texture by relative path; no production application code, data, or behavior is involved.

**Tech Stack:** HTML and CSS only.

## Global Constraints

- Create exactly one standalone HTML artifact under `mockups/`.
- Keep the existing user-owned sidebar mockup untouched.
- Reuse the exact Masthead Sidebar Knowledge flow card treatment, including its machining lines, square spine nodes, and blue bottom edge.
- Include no application logic, persistence, routing, or JavaScript.
- Treat the artifact as throwaway after a direction is selected.

---

### Task 1: Build the five-card comparison board

**Files:**
- Create: `mockups/settings-single-card-five-directions.html`

**Interfaces:**
- Consumes: `public/assets/masthead-logo-sail.png`, `public/textures/anodized-noise.svg`, and the approved settings exploration design.
- Produces: a directly openable HTML file with five labeled centered-card specimens.

- [ ] **Step 1: Create the static board with Masthead tokens**

Use a single HTML document with embedded CSS, the exact Knowledge flow steel-card language, and static General/Data/Agent access/Advanced/Danger zone vocabulary. Reference the actual Masthead sail asset.

- [ ] **Step 2: Render five single-card settings layouts**

Include a full spine, grouped ledger, two-column card, dense ledger, and wide-core action-rail option. Each specimen must keep the full stripped settings set inside one centered Knowledge-flow-style card.

- [ ] **Step 3: Verify the artifact is self-contained and non-invasive**

Run:

```bash
test -f mockups/settings-single-card-five-directions.html
rg -n 'script|fetch\(|localStorage|sessionStorage|<aside|nav-item' mockups/settings-single-card-five-directions.html
git status --short
```

Expected: the HTML file exists, no behavior-producing JavaScript or persistence APIs appear, and the existing sidebar mockup remains untouched.

- [ ] **Step 4: Commit**

```bash
git add mockups/settings-single-card-five-directions.html docs/superpowers/plans/2026-07-09-settings-layout-exploration.md
git commit -m "prototype: simplify settings to one steel card"
```

## Self-Review

- Spec coverage: Task 1 covers the one-file, five-card, Knowledge-flow-styling, no-logic, and throwaway constraints.
- Placeholder scan: none.
- Interface consistency: the only output is the documented HTML file.
