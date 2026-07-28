# Now-tab title diversity — subagent-driven implementation plan

> **For Claude / Grok / Codex:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (or equivalent sequential/parallel task agents) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Now cards from collapsing to the same title for different sessions by fixing offline subject acceptance, live task signal, weak adapter titles, and disposition noise — without reintroducing LLM titles.

**Architecture:** Keep the offline `subject: disposition.` frame. Improve the **subject pipeline** (reject generic project-session fallbacks; prefer first user message; privacy-safe live task preview) and soften disposition when the subject is still weak. Measure with a hook-poverty uniqueness regression so we never silently regress to “Masthead session: in progress.” everywhere.

**Source investigation:** `/tmp/masthead-now-title-investigation-report.md` (Halla corpus: hook poverty 90% exact headline dups, 1 unique subject).

**Tech stack:** TypeScript, Vitest, existing board headline modules (`offlineBoardHeadline`, `boardHeadlineInput`, `liveHookAdapter`, `sessionReducer`, adapters, `SessionCard`).

**Constraints:**

- No LLM title path required for success.
- Live hook privacy: do **not** dump full prompts into projections; only short redacted task previews.
- Headless tests only for CI gates.
- Prefer independent tasks that can run as separate agents/worktrees where noted.

---

## Subagent execution model

| Role | Responsibility |
|------|----------------|
| **Orchestrator** | Assigns tasks, merges, runs full headline+adapter suites, enforces non-goals |
| **Agent T1–T6** | One task each, TDD, focused files |
| **Agent M** (metrics) | After T1–T5 merge: re-run hook-poverty measurement script (optional on Halla) |

**Suggested parallelism:**

```text
Wave 1 (parallel):  T1, T2, T4
Wave 2 (after T1):  T3, T5
Wave 3 (after T1–T5): T6 (CI floor) + optional Halla remeasure
```

T3 depends on T1 (generic subject rules must exist before subject-from-user-message ranking).  
T5 can start after T1 if needed, but prefer after T2 for live fixtures.

---

## File ownership map

| Task | Primary files | Avoid conflicting with |
|------|---------------|------------------------|
| T1 | `src/core/offlineBoardHeadline.ts`, its tests | T3 disposition edits in same file → merge carefully |
| T2 | `src/core/liveHookAdapter.ts`, live fixtures, hook tests | — |
| T3 | `src/core/offlineBoardHeadline.ts` (disposition only), tests | T1 |
| T4 | `src/core/boardHeadlineInput.ts`, tests | — |
| T5 | `src/adapters/codex/adapter.ts`, hermes/omp/pi adapters as needed, adapter tests | — |
| T6 | `src/core/__tests__/nowTitleDiversity.regression.test.ts` (new) | — |

---

## Task 1: Reject generic project-session subjects

**Priority:** P0  
**Wave:** 1  
**Agent type:** general-purpose, isolated worktree OK  

### Problem

`sessionReducer` falls back to `` `${project} session` ``.  
`isGenericSubject` rejects bare `masthead` but **accepts** `Masthead session`, so offline subject sticks on a colliding label.

### Steps

- [ ] **1.1** Write failing tests in `src/core/__tests__/offlineBoardHeadline.test.ts`:
  - Subject candidates / title `Masthead session` must **not** become frame subject when better evidence exists.
  - When **only** `${project} session` / `${project} · harness` style titles exist, subject must **not** remain exactly `X session` (prefer project name alone only if allowed, or a more specific evidence-derived subject, or a non-colliding fallback strategy defined in test).
  - Explicit cases: `Masthead session`, `Nova OS session`, `codex session` (case variants).

- [ ] **1.2** Extend `isGenericSubject` (and/or a new `isProjectSessionFallbackLabel`) in `src/core/offlineBoardHeadline.ts` to treat:
  - `/^(.+)\s+session$/i` when the stem is a project/area label
  - `/^(.+)\s*[·•]\s*(codex|cursor|claude|grok|hermes|opencode|…)$/i` pure project·harness labels as weak when used as **sole** subject without transcript evidence  
  Keep rejecting bare harness names and opaque IDs.

- [ ] **1.3** Optionally tighten `usefulSessionTitle` in `sessionReducer.ts` so `` `${project} session` `` is only used as last-resort stored title **or** leave storage as-is but ensure offline never promotes it (preferred: offline reject + SessionCard still OK).

- [ ] **1.4** Run:  
  `npx vitest run src/core/__tests__/offlineBoardHeadline.test.ts`

### Acceptance

- Hook-poverty style inputs no longer produce subject `Masthead session` when any non-generic evidence exists.
- Existing offline headline tests still pass or are updated with intentional new expectations.
- No UI/CSS changes.

### Commit

```bash
git commit -m "fix(now): reject generic project-session subjects in offline headlines"
```

---

## Task 2: Privacy-safe live task preview for Now subjects

**Priority:** P0  
**Wave:** 1  
**Agent type:** general-purpose, isolated worktree OK  

### Problem

`liveHookAdapter` suppresses `prompt` / message bodies. Summaries become `Claude Code: User Prompt Submit` / `Grok Build hook event`. Offline has nothing task-specific to rank.

### Design (do not re-LLM)

- Extract a **short redacted task preview** (e.g. first ~80–120 chars of user prompt / last user message) for **title/subject candidates only**.
- Still suppress full prompt from general payload fields if privacy requires.
- Prefer fields already present on UserPromptSubmit / session start / first user message events per runtime profile.
- Apply existing redaction/sensitive filters (tokens, URLs, secrets) — reuse patterns from `SessionCard` / redaction helpers.

### Steps

- [ ] **2.1** Failing tests:
  - `src/core/__tests__/` for liveHookAdapter (extend existing if present) **or** new `liveHookAdapter.taskPreview.test.ts`
  - Given a Claude/Codex/Cursor-like hook payload with user prompt `"Implement Logbook pagination spacing"`, normalized event summary or title candidate must contain a non-generic snippet (e.g. includes `Logbook` / `pagination`), not only `User Prompt Submit`.
  - Sensitive prompt containing `sk-` / password-like text must not leak into summary.

- [ ] **2.2** Implement in `src/core/liveHookAdapter.ts`:
  - After redaction, for user-turn / prompt-submit events, set `summary` (or a dedicated field that flows into session title / subjectCandidates — prefer existing `summary`/`title` channels) via a `taskPreviewFromHook(...)` helper.
  - Keep full prompt out of arbitrary payload keys if currently suppressed.

- [ ] **2.3** Wire so `toBoardHeadlineInput` / facts can see the preview as a subject candidate (via session title or transcript/facts path — choose the least invasive).

- [ ] **2.4** Run live hook adapter tests + offline headline tests that consume projected live fixtures.

### Acceptance

- Live fixture with user prompt no longer yields only `masthead-live-fixture session` as subject when offline headline is built from resulting events.
- No full unrestricted prompt in projection cards.

### Commit

```bash
git commit -m "fix(now): derive privacy-safe live task preview for offline subjects"
```

---

## Task 3: Prefer first user message; demote domain-map singletons

**Priority:** P0/P1  
**Wave:** 2 (after T1)  
**Agent type:** general-purpose  

### Problem

With transcript present, `domainSubjectCandidates` maps many prompts to the same product labels (`Logbook`, `Settings UI`). `capitalizedPhrase` picks assistant filler (`I will inspect`).

### Steps

- [ ] **3.1** Failing tests in `boardHeadlineInput` / offline integration:
  - User message `"Fix the Logbook artifact detail loading spinner"` should prefer a **specific** subject containing more than the singleton domain label `Logbook` when enough words exist.
  - Assistant-only `"I will inspect the repository"` must not become subject if a user message exists.
  - Domain map may still contribute candidates but must not outrank a specific user phrase.

- [ ] **3.2** Adjust `src/core/boardHeadlineInput.ts`:
  - Rank **first/latest meaningful user** message phrases above domain-map labels.
  - Filter subjects matching `/^I (will|can|am going to)\b/i` and similar assistant openers.
  - Optionally require domain-map hits to co-occur with file/path evidence before using as sole subject.

- [ ] **3.3** Ensure `offlineSubject` candidate order matches: specific user phrase → workContext → files → title → project.

- [ ] **3.4** Run:  
  `npx vitest run src/core/__tests__/boardHeadlineInput.test.ts src/core/__tests__/offlineBoardHeadline.test.ts`

### Acceptance

- Diverse-prompt corpus style cases produce more unique subjects than domain-map collapse (asserted via unit cases, not full 120-row corpus).

### Commit

```bash
git commit -m "fix(now): prefer user-task phrases over domain-map singleton subjects"
```

---

## Task 4: Disposition when subject is weak

**Priority:** P1  
**Wave:** 1 (parallel) or 2  
**Agent type:** general-purpose  

### Problem

Even with different subjects, disposition is one of ~4–8 templates (`in progress`, `stalled with no new turns`, …), so cards still look identical.

### Steps

- [ ] **4.1** Failing tests:
  - When subject is project-level or generic-adjacent, frame disposition should include a **distinguishing evidence token** (recent file basename, tool name, or short failure snippet) **or** omit disposition per product decision (prefer evidence token to keep state readable).
  - When subject is already specific (multi-word task phrase), disposition may stay short state label.

- [ ] **4.2** Implement in `offlineBoardHeadline.ts` `offlineDisposition*`:
  - If subject is weak/short/project-only, append/select evidence from `input.evidence`, recent files, or last tool (already partially used for subject).
  - Cap length; avoid sensitive paths.

- [ ] **4.3** Keep frame validation (`validateBoardHeadlineFrame`) passing — update validator if needed for longer dispositions.

- [ ] **4.4** Run offlineBoardHeadline + boardHeadlineFrame tests.

### Acceptance

- Two same-project sessions with different last tools/files produce different full headlines even if subjects match.

### Commit

```bash
git commit -m "fix(now): diversify offline disposition when subject is weak"
```

---

## Task 5: Adapter titles for weak harness metadata

**Priority:** P1  
**Wave:** 2  
**Agent type:** general-purpose  

### Problem

Codex uses `basename(cwd)` as title → many `Masthead` titles. Hermes/Omp/Pi often empty → `${project} session`.

### Steps

- [ ] **5.1** Failing adapter tests per harness with fixtures:
  - **Codex:** when transcript has a user message, session title/metadata should prefer a short user-derived label over pure cwd basename (or expose user text so reducer/offline can use it — prefer adapter metadata `title` or first user message already imported).
  - **Hermes / Omp / Pi:** if first user turn exists in parse output, set a non-empty title candidate.

- [ ] **5.2** Implement minimal changes in:
  - `src/adapters/codex/adapter.ts` (and parse path if needed)
  - `src/adapters/hermes/`, `omp/`, `pi/` only if empty titles are clearly fixable without large refactors

- [ ] **5.3** Grok already uses `summary.json` titles — add a regression test only if missing; no break.

- [ ] **5.4** Run:  
  `npx vitest run src/adapters/__tests__/`

### Acceptance

- Codex fixture with user narrative no longer titles solely as cwd basename when user text is available.
- No harness loses existing good titles (Grok).

### Commit

```bash
git commit -m "fix(adapters): prefer user-turn titles when harness metadata is weak"
```

---

## Task 6: Hook-poverty diversity regression gate

**Priority:** P2 (ship with P0/P1)  
**Wave:** 3  
**Agent type:** general-purpose  

### Problem

Without a CI floor, title collapse returns unnoticed.

### Steps

- [ ] **6.1** Add `src/core/__tests__/nowTitleDiversity.regression.test.ts` that:
  - Builds N offline headline views for same project, varying only tools/files/user phrases (and, if T2 landed, live-hook-normalized events).
  - Asserts **unique subjects ≥ threshold** (e.g. ≥ 50% unique for diverse-user corpus; for pure hook-poverty without user text, assert we no longer have **1** unique subject if task preview exists).
  - Document thresholds in test comments tied to investigation metrics.

- [ ] **6.2** Optionally script under `scripts/` only if needed; prefer pure vitest for CI.

- [ ] **6.3** Run full related suite:

```bash
npx vitest run \
  src/core/__tests__/offlineBoardHeadline.test.ts \
  src/core/__tests__/boardHeadlineInput.test.ts \
  src/core/__tests__/boardHeadlineFacts.test.ts \
  src/core/__tests__/boardHeadlineFrame.test.ts \
  src/core/__tests__/nowTitleDiversity.regression.test.ts \
  src/core/__tests__/grokSessionIdentityTitles.test.ts \
  src/adapters/__tests__/
```

### Acceptance

- CI fails if hook-poverty unique-subject rate collapses again.

### Commit

```bash
git commit -m "test(now): add offline title diversity regression gate"
```

---

## Orchestrator closeout

- [ ] Merge T1–T6 on a branch `fix/now-title-diversity` (or stack PRs).
- [ ] Run typecheck: `npm run typecheck`
- [ ] Optional Halla remeasure: re-run investigation measurement script; report unique headline/subject rates before/after.
- [ ] Manual Now tab spot-check on **dev** (not required for merge if headless gate is strong): multiple live Grok/Codex sessions should no longer all show the same string.
- [ ] Do **not** require production redeploy for merge; include in next production build.

### Definition of done

1. Generic `${project} session` is not a stable offline subject.  
2. Live sessions with user prompts surface a privacy-safe, task-related subject candidate.  
3. User phrases beat domain-map singletons and assistant filler.  
4. Weak-subject cards still differ via disposition/evidence when possible.  
5. Weak adapter titles improved for Codex (+ others if cheap).  
6. Regression test prevents return to 1-subject hook poverty.

### Non-goals

- Re-enable board LLM enricher as default  
- Perfect uniqueness across all sessions  
- Changing Logbook durable `sessionTitle` enrichment (separate path)  
- Production packaging in this plan  

---

## Risk notes

| Risk | Mitigation |
|------|------------|
| Privacy regression leaking prompts | Redaction helpers + tests with secrets; length cap |
| Over-filtering subjects → all “Session” | Disposition evidence tokens (T4); keep project as last resort only for UI not offline subject |
| Merge conflicts T1/T3 on same file | T3 rebases on T1; disposition-only hunks |
| Adapter changes break import | Keep parse identity stable; only title/metadata fields |

---

## Handoff one-liner for orchestrator

```text
Implement docs/superpowers/plans/2026-07-28-now-title-diversity.md via subagent-driven-development.
Wave1: T1 T2 T4 parallel. Wave2: T3 T5. Wave3: T6 + full vitest suite above.
Do not reintroduce LLM titles. Privacy-safe task previews only.
```
