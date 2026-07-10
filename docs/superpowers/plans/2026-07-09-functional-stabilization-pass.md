# Masthead Functional Stabilization Pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one stable Masthead Dev candidate for Tyler's personal testing by integrating the UI branch and proving the core product path plus its supporting controls.

**Architecture:** Merge the verified interface branch into `main`, reinstall the Electron Dev launcher from `main`, then verify the installed runtime at its real database identity. Exercise one bounded Source → Now → Workbench → Logbook → MCP path without destructive data operations; use existing smoke and dogfood programs where UI automation is unavailable.

**Tech Stack:** Git, Electron Dev launcher, Masthead daemon/CLI, SQLite, Vitest smoke programs, in-app Browser when available.

## Global Constraints

- Preserve `/home/tyler/Documents/Masthead/mockups/sidebar-bottom-five-directions.html` untouched.
- Do not delete data, clear the database, change retention, or reinstall every connector.
- Use the active Masthead dev database only for bounded non-destructive product actions.
- Use temporary SQLite databases for synthetic pipeline dogfood.
- Use only the required `iab` in-app Browser backend for browser automation; do not substitute another backend without approval.

---

### Task 1: Integrate and reconnect the test candidate

- [ ] Commit this plan on `feature/interface-cleanup-settings`.
- [ ] Merge `feature/interface-cleanup-settings` into local `main`, preserving the unrelated untracked mockup.
- [ ] Run `npm run install:electron-dev-launcher` from `/home/tyler/Documents/Masthead`.
- [ ] Verify the launcher service points at `/home/tyler/Documents/Masthead` and reaches a current compatible daemon.

### Task 2: Prove runtime and supporting controls

- [ ] Run `npm run doctor:json`, `npm run smoke`, and `npm run smoke:electron` from merged `main`.
- [ ] Confirm Sources connector inventory, Settings state, MCP status/tools/audit reads, and current database identity through read-only APIs.
- [ ] Record counts before and after one controlled restart to prove sessions and published artifacts do not duplicate.

### Task 3: Prove the product path

- [ ] Run `node scripts/dogfood-workbench-ops.js` and `node scripts/dogfood-workbench-v1.js` against their temporary databases.
- [ ] Inspect the real Workbench queue without destructive operations and select one existing publish-path session only if it can be advanced safely.
- [ ] Verify the resulting or already-published artifact through Logbook artifact APIs and read it through the artifact-primary MCP surface.
- [ ] Use the in-app Browser for Now, Sources, Workbench, Logbook, and Settings click-through if `iab` is available; otherwise report that visual limitation without substituting a backend.

### Task 4: Fix concrete blockers and close out

- [ ] For each reproduced blocker, write a failing focused test before changing product code, then implement the smallest fix.
- [ ] Run `npm run verify`, `npm run smoke:electron`, the affected dogfood programs, and `git diff --check` after any fixes.
- [ ] Review the final diff against repository standards and this stabilization plan.
- [ ] Commit fixes on `main`, update the product release gate only where fresh evidence changes it, and write a concise GBrain session closeout.

## Self-review

- Spec coverage: integration, launcher identity, support controls, restart persistence, Workbench publication, Logbook visibility, MCP retrieval, and visual inspection are covered.
- Placeholder scan: no placeholders.
- Scope check: destructive lifecycle tests, seven-runtime real turns, packaged installation, and Tyler's subjective product testing remain outside this bounded pass.
