# Masthead brain-dump fix plan — 2026-07-26

## Goal

Diagnose and fix five independent product issues reported while walking the live app. Each issue gets its own agent, branch/worktree, tests, and PR-ready commit. The supervisor does not implement; it coordinates, unblocks, and verifies.

## Shared rules for every agent

- Read `AGENTS.md` and OpenWiki quickstart first.
- Work only on your assigned issue; do not touch unrelated surfaces.
- Prefer the current clean `main` (`261bd34b` or later).
- Test-first where feasible: reproduce with a failing test, implement, re-run focused tests + typecheck for touched area.
- Do not start UI on port `5173` (Electron Dev reserved). Use `MASTHEAD_UI_PORT=5180+` if needed.
- Do not claim done without evidence (tests, typecheck, and a short diagnosis note in the PR/commit body).
- Leave main clean; work on an isolated branch/worktree.

## Issue map

| ID | Surface | Severity | Independence |
|----|---------|----------|--------------|
| A | Now / Grok live sessions | High | Adapter + projection/title |
| B | Workbench table columns | Medium | UI-only |
| C | Logbook pagination spacing | Low | CSS/layout |
| D | Dossier transcript kind filters | High | Logbook inspector + transcript API wiring |
| E | Dossier stays open across Logbook page change | High | Logbook controller selection lifecycle |

---

## Issue A — Now: Grok Build spams same-title “stalled” sessions

### User report
- Many Grok Build sessions on Now.
- Looks like a **new session per turn** instead of continuing one conversation.
- All share the **same title**.
- Titles/status say **“Tyler stalled with no new turns”** even when a session is active / a new one just started.

### Diagnose (ordered)
1. Inspect live projection cards for runtime=`grok` (or Grok Build): `sessionId`, `sourceSessionId`, `title`/`liveSummary`/`headline`, lifecycle, `primaryStatus`, last event times.
2. Trace Grok adapter identity: `src/adapters/grok/{adapter,discovery,parser,transcriptUnit}.ts` — is unit/session id derived from conversation dir vs per-file/per-turn fragment?
3. Compare with fixture/tests in `src/adapters/__tests__/grokAdapter.test.ts` and live hook profile for grok.
4. Trace board/title pipeline: projection → board headline / live summary → SessionCard. Find exact string path for “stalled” / “no new turns”.
5. Determine whether bad titles come from:
   - wrong session splitting (identity bug), and/or
   - headline/title generator using idle/stalled heuristics on active sessions, and/or
   - stale import of auxiliary Grok files (`updates.jsonl`, rewind points, etc.).

### Success criteria
- One Grok conversation maps to one stable Masthead session id across turns.
- Active Grok sessions do not display “stalled with no new turns”.
- Titles differ when conversations differ; continued turns do not mint duplicate same-title sessions.
- Tests cover identity stability + title/status for active vs idle Grok units.

### Likely code areas
- `src/adapters/grok/**`
- `src/adapters/live/**` (if hook path involved)
- `src/core/sessionReducer.ts`, projection/headline modules
- `src/ui/SessionCard.tsx`, `src/ui/format.ts`

---

## Issue B — Workbench: drop useless pipeline columns; give space to useful fields

### User report
Workbench shows low-value columns: enrichment, dossier, package, runbook, ADR, timeline. Prefer more space for session title, ID, runtime, and other useful fields.

### Diagnose (ordered)
1. Inventory Workbench table headers/cells in `src/ui/workbench/WorkbenchPanel.tsx` (+ CSS).
2. Confirm which columns are pipeline artifact-kind status chips vs real operator signals.
3. Check tests that **assert** those headers (`WorkbenchPanel.test.tsx` expects `package`, `runbook`, `timeline`, etc.) — update contract intentionally.
4. Check design.md surface archetype: Workbench = dense ops table; remove noise without losing actionable quality/transcript/selection affordances.

### Success criteria
- Columns enrichment / dossier / package / runbook / ADR / timeline removed from the primary table (or replaced only if design requires a single compact “artifacts” signal — default is **remove**).
- Title, session id, runtime (and remaining useful ops columns) get more horizontal space.
- Tests updated to the new column contract; surface contract checks still pass if applicable.

### Likely code areas
- `src/ui/workbench/WorkbenchPanel.tsx`
- related CSS / design tokens
- `src/ui/workbench/__tests__/WorkbenchPanel*.tsx`

---

## Issue C — Logbook: spacing between artifact inspector and bottom page navigator

### User report
Bottom page navigator lacks correct spacing relative to the artifact viewing area. Apply **global spacing** used elsewhere.

### Diagnose (ordered)
1. Find Logbook layout: table/list + inspector + bottom pagination chrome.
2. Compare spacing tokens/gaps with Workbench/Now/Settings (design.md + shared CSS variables).
3. Reproduce at desktop width; ensure inspector open/closed both look correct.

### Success criteria
- Consistent gap between artifact body region and bottom pager matching app chrome spacing.
- No regression at narrow widths.
- Prefer CSS/token fix over one-off magic numbers.

### Likely code areas
- Logbook panel components under `src/ui/` / `src/app/logbook/`
- global layout CSS / design tokens
- optional Browser visual check if available

---

## Issue D — Dossier: User / Assistant / Tools transcript filter buttons dead

### User report
Inside an open dossier’s **Transcript evidence** section, the user / assistant / tools buttons do nothing.

### Diagnose (ordered)
1. Find Transcript evidence UI in dossier/logbook inspector (`SessionDossierContent`, Logbook inspector model, related components).
2. Trace click handlers → controller state → `SessionTranscriptKindFilter` (`all` | `user` | `assistant` | `tools` | …).
3. Verify daemon client and `/sessions/.../transcript` (or equivalent) pass `kind` query; server `transcriptKindFromUrl` maps correctly.
4. Confirm UI re-renders filtered items (or refetches with kind).

### Success criteria
- Clicking User / Assistant / Tools filters the evidence list (or reloads with that kind).
- “All” restores full list.
- Tests cover click → filter/request wiring and result.

### Likely code areas
- `src/ui/session-dossier/**`, logbook inspector components
- `src/app/logbook/useLogbookController.ts`, `logbookInspectorModel.ts`
- `src/app/daemonClient.ts` transcript APIs
- `src/daemon/server.ts` transcript kind parsing
- existing tests in `useLogbookController.test.tsx`, `LogbookInspector.test.tsx`

---

## Issue E — Logbook: page change closes open dossier

### User report
With a dossier open, clicking next page on Logbook pagination **auto-closes** the artifact. Should stay open until user clicks **X** or selects another artifact.

### Diagnose (ordered)
1. Read `useLogbookController` page change path (`changePage` / `setPageIndex`) and selection clearing.
2. Find whether page change resets `selectedArtifact` / `selectedSessionId` intentionally.
3. Decide product rule: keep selection even if the selected artifact is **not on the new page** (inspector stays bound to selection; list selection highlight may be off-page — acceptable). Only X or explicit other-artifact select closes/replaces.

### Success criteria
- Open dossier remains open across prev/next page.
- X closes it; selecting another artifact switches content.
- Filter/query changes may still reset page to 0; document whether they clear selection (prefer: **do not** clear on page-only changes; filter/query can clear or keep — default keep unless existing product rule says otherwise; page-only must keep).
- Regression test in `useLogbookController.test.tsx`.

### Likely code areas
- `src/app/logbook/useLogbookController.ts`
- History/Logbook panel wiring
- controller tests

---

## Execution model

### Agents
- **Agent A** — Issue A only (worktree recommended; may touch adapters + projection)
- **Agent B** — Issue B only (UI worktree)
- **Agent C** — Issue C only (UI/CSS worktree)
- **Agent D** — Issue D only (logbook transcript worktree)
- **Agent E** — Issue E only (logbook controller worktree; coordinate with D if same files — prefer sequential merge of D then E, or one agent owns both logbook selection files if conflict risk is high)

**Conflict note:** D and E both touch Logbook controller/UI. Prefer:
- Agent D owns transcript filter wiring
- Agent E owns page-change selection lifecycle  
If both edit `useLogbookController.ts`, supervisor merges carefully (E after D, or single combined logbook agent). Initial launch: separate agents with explicit file ownership:
  - D: inspector transcript UI + fetch-by-kind helpers
  - E: `changePage` / selection retention only

### Supervisor cadence
Every ~5–10 minutes until all five report done or blocked:
1. Poll agent status
2. Unblock merge conflicts / clarify product decisions
3. When an agent finishes: verify tests + review scope creep
4. Land commits on feature branches; stack or sequential PRs onto main

### Landing order (suggested)
1. C (tiny CSS)  
2. B (Workbench columns)  
3. E (selection retention)  
4. D (filters — may share logbook files with E; rebase)  
5. A (Grok identity/title — highest risk, may need live fixtures)

Or land A in parallel if fully isolated to adapters/projection.

## Out of scope
- Public release packaging  
- New artifact quality corpus work  
- Unrelated Workbench authoring V5 features  
---
