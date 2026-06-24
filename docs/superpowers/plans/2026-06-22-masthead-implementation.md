# Masthead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Masthead from the PRD into a locally runnable, tested, fixture-first control tower that proves Codex session state, attention routing, Git conflict evidence, privacy redaction, outcome review, and a session-card Live Board.

**Architecture:** Start with a dependency-light TypeScript core and browser UI so the contracts can be tested immediately in this empty workspace. Keep the domain model and file layout aligned with the intended Tauri/Rust architecture so the native layer can wrap these contracts rather than replace them. Add Tauri metadata and hook/helper/admin scaffolding after the core vertical slice is stable.

**Tech Stack:** TypeScript, Vite, React, Vitest, CSS, JSON fixtures/schemas, Node-based local ingestion/demo scripts, future Tauri 2/Rust shell.

---

## Workstreams

### Task 1: Project Scaffold and Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/styles/masthead.css`
- Create: `src/core/types.ts`
- Create: `src/core/index.ts`
- Create: `src/core/__tests__/fixtureReplay.test.ts`
- Create: `fixtures/v0/replay-three-sessions-board.json`

- [x] Create the Node/Vite/React project metadata.
- [x] Add Vitest and TypeScript commands: `test`, `typecheck`, `build`, `dev`.
- [x] Write the first failing fixture replay test that expects the fixture to project into three or more session cards, a Needs attention item, and a conflict.
- [x] Add the minimum placeholder core API that compiles but fails behavior until Task 2.
- [x] Run `npm install`, `npm test -- --run src/core/__tests__/fixtureReplay.test.ts`, and confirm the first behavior test fails for missing implementation.

### Task 2: Core Event Contracts, Redaction, and Fixture Replay

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/core/redaction.ts`
- Create: `src/core/fixtures.ts`
- Create: `src/core/replay.ts`
- Create: `src/core/__tests__/redaction.test.ts`
- Modify: `src/core/__tests__/fixtureReplay.test.ts`
- Modify: `fixtures/v0/replay-three-sessions-board.json`

- [x] Write failing redaction tests for API keys, bearer tokens, database URLs, private keys, cookie/auth headers, `.env` path content suppression, and bounded command output.
- [x] Implement redaction before projection and evidence-packet generation.
- [x] Define adapter-neutral event, Git snapshot, command run, file change, attention item, conflict card, outcome, and UI projection types.
- [x] Implement fixture loading/replay from typed JSON objects.
- [x] Verify fixture replay redacts sensitive strings by default.

### Task 3: Session Reducer and Attention Engine

**Files:**
- Create: `src/core/sessionReducer.ts`
- Create: `src/core/attention.ts`
- Create: `src/core/__tests__/sessionReducer.test.ts`
- Create: `src/core/__tests__/attention.test.ts`
- Modify: `src/core/replay.ts`

- [x] Write failing tests for approval > running, user question, testing state, repeated failure, transient recovered failure, completed-without-verification, and stale verification.
- [x] Implement deterministic session state reduction.
- [x] Implement deterministic attention queue items with evidence references, severity, support level, suggested next action, coalescing keys, and PRD priority sorting.
- [x] Verify P0 requires deterministic high-blast-radius approval evidence.

### Task 4: Git Conflict Engine and UI Projection

**Files:**
- Create: `src/core/conflicts.ts`
- Create: `src/core/projection.ts`
- Create: `src/core/__tests__/conflicts.test.ts`
- Create: `src/core/__tests__/projection.test.ts`
- Modify: `src/core/replay.ts`

- [x] Write failing tests for exact same-file overlap in the same Git common dir, unrelated repos no hard conflict, same repo disjoint paths no exact conflict, and shared-cwd degraded attribution.
- [x] Implement exact-file conflict detection and degraded shared-workspace warnings.
- [x] Implement Live Board projection with summary counts, sorted session cards, attention queue, conflict cards, safe actions, and expanded-session detail view model.
- [x] Verify safe actions exclude approval, shell execution, Git mutation, browser control, and external-state mutation.

### Task 5: Live Board UI

**Files:**
- Modify: `src/app/App.tsx`
- Create: `src/ui/BoardSummary.tsx`
- Create: `src/ui/AttentionQueue.tsx`
- Create: `src/ui/SessionBoard.tsx`
- Create: `src/ui/SessionCard.tsx`
- Create: `src/ui/ExpandedSessionCard.tsx`
- Create: `src/ui/Toolbar.tsx`
- Modify: `src/styles/masthead.css`
- Create: `src/ui/__tests__/liveBoard.test.tsx`

- [x] Write UI tests for summary counts, priority ordering, compact/expanded card rendering, generic Needs attention language, safe action rendering, and privacy-hidden content.
- [x] Implement the Live Board with compact session cards and one expanded card.
- [x] Implement responsive grid behavior: four, three, two, and one-column layouts.
- [x] Implement keyboard basics: cards are focusable, Enter/Space toggles expansion, Escape collapses, `/` focuses search.
- [x] Preserve the current dark console visual direction without decorative aurora bars or landing-page hero copy.

### Task 6: Hook/Ingestion and Admin Scaffolding

**Files:**
- Create: `src/core/codexAdapter.ts`
- Create: `src/core/ingestion.ts`
- Create: `src/core/__tests__/codexAdapter.test.ts`
- Create: `src/core/__tests__/ingestion.test.ts`
- Create: `scripts/masthead-hook.js`
- Create: `scripts/masthead-ingest-server.js`
- Create: `scripts/masthead-demo.js`
- Create: `docs/hook-onboarding.md`

- [x] Write failing tests for valid Codex hook payload normalization, malformed JSON diagnostics, duplicate provider event dedupe, fail-open hook behavior, and unavailable Masthead behavior.
- [x] Implement Codex hook payload normalization into the adapter-neutral event model.
- [x] Implement a fail-open hook helper that reads stdin, redacts, posts to loopback with a short timeout, and exits 0 on errors.
- [x] Implement a local ingestion/demo server for fixture and hook payload testing.
- [x] Document explicit install/disable/uninstall behavior without mutating Codex config automatically.

### Task 7: Schemas, Persistence Facade, and Release Gates

**Files:**
- Create: `schemas/masthead-event.schema.json`
- Create: `schemas/git-snapshot.schema.json`
- Create: `schemas/attention-item.schema.json`
- Create: `schemas/conflict-card.schema.json`
- Create: `schemas/ui-projection.schema.json`
- Create: `src/core/store.ts`
- Create: `src/core/__tests__/store.test.ts`
- Create: `docs/release-gates.md`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/main.rs`

- [x] Add JSON schemas matching the TypeScript contract names.
- [x] Add an append-only local store facade with in-memory and file-backed implementations for restart/persistence tests.
- [x] Write tests that replay, persist, reload, and preserve unresolved alerts/review dispositions.
- [x] Add thin Tauri metadata and Rust entrypoint placeholders for the future native shell.
- [x] Document release gates and current implementation status against each PRD gate.

### Task 8: Final Verification

**Files:**
- Modify as needed from test failures only.

- [x] Run `npm test -- --run`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.
- [x] Run a local demo server and inspect the browser UI using the in-app Browser plugin if available.
- [x] Verify PRD gate checklist in `docs/release-gates.md`.
- [x] Record any intentionally deferred PRD items as explicit release-gate gaps, not hidden omissions.
