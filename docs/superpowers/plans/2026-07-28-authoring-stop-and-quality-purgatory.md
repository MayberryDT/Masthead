# Authoring Early-Stop + Quality Purgatory — Parallel Issue Plan

> **For agentic workers:** Plan only until Tyler approves. After approval, use
> `superpowers:subagent-driven-development` with **one issue per worktree** unless
> the dependency table says otherwise. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-07-28  
**Status:** approved for execution — Wave 1+  
**Frozen product decisions (2026-07-28 Tyler):**
- **A3:** KEEP finish followUp start payload when packs remain.
- **B7:** WAIT for B1 diagnosis, then implement the recommended path (adapter and/or precheck).
- **B8:** ALLOW stale review aging policy (implement after B2/B3; reversible automatic Not Added).
- **Execution:** sub-agent per issue, isolated worktrees, max parallel Wave 1; quality over rush.

**Sources:** Codex session `019fa678-f83f-7f33-bad9-1e7142268696`; request
`authoring-v5-request:a9e71110-32a1-4ac8-9317-65ac89305615`; newuser e2e DB
`~/.config/masthead-production-newuser-e2e/masthead.sqlite`; diagnosis threads
2026-07-28.

---

## Goal

Prevent two pre-release failures:

1. **Authoring early-stop** — agent finishes one pack, acknowledges remaining packs,
   then calls the job done without a request-complete receipt.
2. **Quality purgatory** — large numbers of package-path sessions sit forever as
   `review_quality` / not agent-ready, never entering Not Added and never becoming
   compile-ready without obscure Pipeline clicks.

Split the work into **many independent issues** so parallel worktrees can land
them quickly, then integrate in a short merge wave.

---

## Architecture (shared, freeze this)

### Problem A — pack early-stop

- Daemon already returns `nextAction.kind = "claim_next"` after non-final pack finish.
- Agent still stops. Soft contract text + thin handoff + pack-scoped `loop` invite
  milestone-as-done behavior.
- Fix shape: harden **agent-facing contract**, **progress/stopRule on every step**,
  **handoff stop rule**, optional **finish auto-chain**, UI **incomplete resume**,
  regression tests. Do **not** auto-author dossiers or write enrichment prose.

### Problem B — quality purgatory

- Three-way quality: `keep` → ready; `review` → stay on package path; `suppress` →
  Not Added. Review never auto-ages out.
- On the e2e corpus, ~538 Grok/OMP-shaped rows are permanent review (no assistant
  messages; tool work not counted from `messages.role='tool'`).
- Fix shape: separate **diagnosis of capture/precheck**, **operator surface for
  review backlog**, **bulk disposition**, optional **policy tweak** for terminal
  vs salvageable review. Do **not** silently force review sessions into authoring
  without a quality decision.

### Product invariants (all issues)

- Logbook remains **published artifacts only**.
- Masthead still does not write enrichment prose.
- Copy Agent Prompt still uses **compile-ready only**; must **disclose** review-left-out counts.
- V5 request still owns full selection; packs remain 5–12.
- Resume remains: same request id + bootstrap/start; completed packs stay published.

---

## Tech stack / seams

| Area | Primary files |
|---|---|
| Handoff clipboard | `src/ui/workbench/workbenchHandoff.ts`, tests under `src/ui/workbench/__tests__/` |
| V5 contract / finish / nextAction | `src/workbench/authoring/workbenchAuthoringV5Service.ts`, `src/shared/workbenchAuthoringV5.ts` |
| CLI next-action surface | `src/cli/guidedAuthoring.ts` (or sibling), CLI tests |
| Workbench selection / copy | `src/app/workbench/useWorkbenchController.ts`, `WorkbenchPanel.tsx` |
| Quality precheck | `src/workbench/qualityPrecheck.ts`, `transcriptQualityReconciler.ts` |
| Quality API | `src/daemon/server.ts` workbench quality routes |
| Pipeline state | `src/daemon/db/workbenchPipelineRepository.ts` |
| Coverage accounting | `src/daemon/db/sessionTranscriptRepository.ts` (`getTranscriptCoverage`) |
| Docs | `openwiki/logbook-and-workbench.md`, `docs/reference/enrichment.md`, ADR 0016 |

---

## Global constraints

- One GitHub issue (or plan issue ID below) per worktree branch when parallelized.
- Prefer **additive** DTO fields over renames that break the production e2e CLI.
- No force-push; no mutating production DBs in tests.
- Tests first where seams exist (`vitest`).
- Do not start `npm run dev` on port `5173` if Electron Dev owns it; use alternate UI ports for browser checks.
- Leave `VITE_MASTHEAD_DEV_CITATIONS` off and no `DevCite` in commits.
- Instance under diagnosis is e2e only; do not wipe Logbook without explicit order.

---

## Issue catalog (maximize parallelism)

Issues are numbered **ISSUE-A\*** (authoring stop) and **ISSUE-B\*** (quality
purgatory), plus **ISSUE-C\*** (integration / proof). Each is sized for one
sub-agent / worktree unless noted.

### Dependency graph (summary)

```text
Wave 0 (docs/spec freeze, optional solo):  C0
Wave 1 (fully parallel):
  A1  A2  A3  A4  A5     B1  B2  B3  B4  B5
Wave 2 (depends on Wave 1 pieces):
  A6 (needs A1+A2 types)   A7 (needs A1)   B6 (needs B2+B3 API)
  B7 (needs B1 findings)   B8 (needs B4 surface)
Wave 3 (integration):
  C1 merge-smoke   C2 e2e proof checklist   C3 openwiki/ADR closeout
```

---

# Wave 1 — independent issues (start all in parallel)

## ISSUE-A1 — V5 nextAction stopRule + progress DTO

**Problem:** Finish/`claim_next` responses do not force “request incomplete; do not stop.”  
**Owner files:**
- Modify: `src/shared/workbenchAuthoringV5.ts`
- Modify: `src/workbench/authoring/workbenchAuthoringV5Service.ts` (`finishResult`, `claimNextAction`, `completeAction`, bootstrap `skillContract`)
- Test: `src/workbench/authoring/__tests__/workbenchAuthoringV5Service.test.ts`

**Scope:**
- Add shared shape (names exact; implementers must not invent variants):

```ts
// on every WorkbenchAuthoringV5NextAction (or sibling field on mutation results)
progress?: {
  packsCompleted: number;
  packsTotal: number;
  sessionsAttempted: number;
  sessionsTotal: number;
  requestComplete: boolean;
};
stopRule: string; // constant for incomplete; different for complete
```

- Non-final finish / claim_next / start / status when active:
  - `requestComplete: false`
  - `stopRule` text must include: only stop when `nextAction.kind === "complete"` and request receipt exists; pack finish is not request completion; immediately run `nextAction.command`.
- Final complete action:
  - `requestComplete: true`
  - stopRule states receipt is immutable / work complete.
- Strengthen `claim_next.reason` to include counts, e.g.  
  `Request incomplete (12/573 sessions, 1/48 packs). Immediately run nextAction.command. Do not report success.`
- Expand `skillContract.loop` to reflect outer loop, e.g.  
  `["start","inspect","scaffold","save","finish","claim_next_or_complete"]`  
  and keep obligation: continue until request-complete receipt.

**Out of scope:** handoff text (A2), UI banner (A4), auto-start next pack payload (A3).

**Acceptance:**
- [ ] Multi-pack unit test: after pack 0 finish, `nextAction.kind === "claim_next"`, `progress.requestComplete === false`, stopRule present, reason includes remaining work.
- [ ] Final pack finish: `kind === "complete"`, `requestComplete === true`, request receipt present.
- [ ] Bootstrap skillContract.loop includes claim/complete outer step.

**Test command:**
```bash
npx vitest --run src/workbench/authoring/__tests__/workbenchAuthoringV5Service.test.ts
```

**Branch suggestion:** `fix/a1-v5-stoprule-progress`

---

## ISSUE-A2 — Handoff clipboard stop rule

**Problem:** Copied prompt is only request id + bootstrap; never restates full-request obligation.  
**Owner files:**
- Modify: `src/ui/workbench/workbenchHandoff.ts`
- Modify: `src/ui/workbench/__tests__/workbenchHandoff.test.ts`
- Optionally read: create-request response types in `src/app/daemonClient.ts`

**Scope:**
- Extend `buildWorkbenchHandoff` to a short multi-line prompt (still opaque: no session id list, no recipes beyond bootstrap):

```text
Masthead authoring request: <id>
Start: <bootstrap command>
Stop rule: Do not stop until nextAction.kind is "complete" and a request receipt exists.
Pack finish is not request completion. Always run the returned nextAction.command next.
```

- If create response already exposes `sessionCount` / `packCount` without extra round-trips, add one line:  
  `Scope: N sessions in M fixed packs (daemon-owned).`  
  If not available without API change, skip counts here (A1 owns runtime progress).
- Keep forbidden-token sanitization behavior.

**Out of scope:** changing which session ids are selected (B-series).

**Acceptance:**
- [ ] Unit test asserts stop-rule lines present.
- [ ] Still no session id list / worker / multi-agent language.
- [ ] Existing two-line-only assertion in test is updated deliberately.

**Test command:**
```bash
npx vitest --run src/ui/workbench/__tests__/workbenchHandoff.test.ts
```

**Branch suggestion:** `fix/a2-handoff-stop-rule`

---

## ISSUE-A3 — Finish response embeds next start command payload (optional auto-chain)

**Problem:** After finish, agent must invent a new turn to run `claim_next`; easy to celebrate and stop.  
**Owner files:**
- Modify: `src/workbench/authoring/workbenchAuthoringV5Service.ts` (`finishResult` / finish path)
- Test: `src/workbench/authoring/__tests__/workbenchAuthoringV5Service.test.ts`
- Types: `src/shared/workbenchAuthoringV5.ts`

**Scope:**
- When finish leaves request active, include either:
  - `nextAction` remains `claim_next` **and**
  - `followUp: { kind: "start", command: "<same start command>", reason: "..." }`  
  **or** document and implement `nextAction` already being the start command with reason that still says incomplete (prefer keeping `claim_next` + explicit `followUp` to avoid breaking clients that switch on kind).
- Do **not** auto-mutate claim the next pack inside finish (claim stays explicit start). Only return the command payload.
- When request completes, no followUp; include request receipt as today.

**Depends lightly on:** A1 types if `progress` lives on same object — coordinate field names via shared type file; if A1 not merged, define followUp only and leave progress to A1.

**Acceptance:**
- [ ] Non-final finish JSON includes runnable next start command string matching `workbench author start --request …`.
- [ ] Final finish has no followUp / claim_next.

**Branch suggestion:** `fix/a3-finish-followup-start`

---

## ISSUE-A4 — Workbench UI: incomplete request + resume prompt

**Problem:** After agent early-stop, UI does not scream “request still active; copy resume.”  
**Owner files:**
- Modify: `src/app/workbench/useWorkbenchController.ts` (status fetch if needed)
- Modify: `src/ui/workbench/WorkbenchPanel.tsx` (+ CSS if required under existing workbench styles)
- Tests: controller/panel tests under `src/app/workbench/__tests__/`, `src/ui/workbench/__tests__/`
- Client: `src/app/daemonClient.ts` if a status endpoint helper is missing

**Scope:**
- When an active V5 request exists for this instance (status endpoint or lightweight list if already present):
  - Show a non-blocking banner/toast strip:  
    `Authoring incomplete: P/Q packs · X/Y sessions. Copy resume prompt to continue.`
  - Button reuses same bootstrap handoff as Copy Agent Prompt (request id bound).
- Do not invent a second authoring system. Read-only observation + copy resume.
- If no “list active requests” API exists, add the **smallest** read endpoint or reuse existing status-by-id only if UI already knows id from last copy — prefer a tiny `GET` summary if missing (if that balloons, split API to ISSUE-A4b; default: use any existing status/list already on daemon).

**Out of scope:** Live supervision tower; changing Logbook.

**Acceptance:**
- [ ] With active incomplete request fixture/mock, banner visible and copy works.
- [ ] With completed/no request, banner absent.
- [ ] Panel tests stay green.

**Branch suggestion:** `fix/a4-incomplete-authoring-banner`

---

## ISSUE-A5 — Regression tests: multi-pack “not done until complete”

**Problem:** Tests prove pack finish but not that agent-facing payload forbids early success framing.  
**Owner files:**
- Modify/extend: `src/workbench/authoring/__tests__/workbenchAuthoringV5Service.test.ts`
- Optional CLI: tests near guided authoring CLI if JSON contract is asserted there

**Scope:**
- Scripted multi-pack path (already partially present): assert after pack 0:
  - no `requestReceipt`
  - `nextAction.kind !== "complete"`
  - stopRule / progress incomplete (consume A1 fields once merged; if landing first, assert current `claim_next` + absence of request receipt, then extend when A1 merges)
- Assert request receipt only after last pack.

**Note:** Can land as pure test hardening before A1, then rebased to assert new fields.

**Branch suggestion:** `fix/a5-multipack-not-done-tests`

---

## ISSUE-B1 — Capture/precheck diagnosis report (Grok/OMP no-assistant)

**Problem:** ~459 Grok + ~73 OMP sessions have user/tool messages but zero assistant + zero structured tools → permanent review. Root cause may be adapter mapping, not only policy.  
**Owner files (read-heavy):**
- `src/workbench/qualityPrecheck.ts`
- `src/daemon/db/sessionTranscriptRepository.ts`
- harness adapters under `src/daemon/` / sources for grok/omp
- Write: `docs/superpowers/plans/2026-07-28-quality-review-corpus-diagnosis.md` (findings only)

**Scope (investigation + written findings, minimal code):**
- Quantify on e2e DB (or fixture export): role histograms, runtime breakdown, whether tool rows should have been `tool_calls`.
- Determine if Grok adapter stores assistant text under non-`assistant` roles or omits it.
- Produce **recommended fix issue split**: e.g. B1a adapter fix vs B7 precheck rule change — do not implement both here.

**Acceptance:**
- [ ] Written diagnosis with evidence tables and a single recommended primary fix path.
- [ ] Explicit “safe to auto-keep?” yes/no per subclass.

**Branch suggestion:** `docs/b1-quality-review-diagnosis` (docs-only OK)

---

## ISSUE-B2 — First-class Quality review count (not Not Added)

**Problem:** Operators only see Not Added=0 while 500+ review rows clog package path.  
**Owner files:**
- Daemon summary API near not-added summary in `src/daemon/server.ts`
- Client: `src/app/daemonClient.ts`
- UI facts row: `WorkbenchPanel.tsx`
- Controller: `useWorkbenchController.ts`
- Tests: workbench API + panel/controller

**Scope:**
- Add summary DTO, e.g. `{ total: number, reasonBreakdown?: Record<string, number> }` for
  `publication_status='publish_path' AND next_action='review_quality'` (or quality unchecked + insufficient_evidence).
- Toolbar fact: **Quality review** with count, analogous to Not Added.
- Clicking opens a panel or filters queue to review-only (minimal: open panel listing like Not Added).

**Out of scope:** bulk fail/pass (B3).

**Acceptance:**
- [ ] With 538 review sessions, fact shows 538 not 0.
- [ ] Not Added remains independent.
- [ ] API + UI tests.

**Branch suggestion:** `fix/b2-quality-review-count`

---

## ISSUE-B3 — Bulk quality disposition for review sessions

**Problem:** Pipeline quality pass/fail is per-selected and buried; cannot drain 500 rows sanely.  
**Owner files:**
- `useWorkbenchController.ts` actions
- `WorkbenchPanel.tsx` Pipeline or Quality review panel actions
- Daemon: may add bulk endpoint **or** loop existing per-session quality API with bounded concurrency (prefer bulk if perf matters; loop is OK for v1 with progress toast)
- Tests: controller + API

**Scope:**
- From Quality review panel (or selection of review rows):  
  - **Accept all visible/selected review** → quality passed  
  - **Fail all visible/selected review** → Not Added with reason `operator_rejected` or `insufficient_evidence_confirmed`
- Confirm copy must be explicit (destructive for fail).
- Respect existing `markWorkbenchQuality` semantics; no silent authoring.

**Depends lightly on:** B2 panel is nicer; can ship bulk on current selection + `nextAction===review_quality` filter without B2, but UX is worse. Prefer implement bulk actions that work on selection first so B2 can wire buttons later.

**Acceptance:**
- [ ] Selecting N review sessions + Fail → N move to Not Added.
- [ ] Selecting N review + Accept → N compile-ready (`quality passed`, next enrich).
- [ ] Passed/published sessions unaffected.

**Branch suggestion:** `fix/b3-bulk-quality-disposition`

---

## ISSUE-B4 — Selection honesty: ready vs review vs package path

**Problem:** “Select all” feels like “author all”; half silently drop from handoff.  
**Owner files:**
- `WorkbenchPanel.tsx` (facts, toast, tooltips)
- `useWorkbenchController.ts` (summaries already have `agentPromptSessionCount` / `agentPromptExcludedCount`)
- Tests: panel/controller

**Scope:**
- After Select all, durable summary (not only toast):  
  `Selected S package-path · R ready · Q need quality review`
- Copy Agent Prompt button subtitle/title always shows ready count; if excluded > 0, primary label may read `Copy Agent Prompt (R ready)`.
- Empty ready: disabled with clear reason (already partly true) — strengthen copy.
- Do not auto-include review sessions in handoff.

**Acceptance:**
- [ ] Mixed selection UI always shows ready vs review split.
- [ ] Existing selectAll handoff-only-ready tests remain green and are extended for visible copy.

**Branch suggestion:** `fix/b4-selection-honesty`

---

## ISSUE-B5 — Docs: quality states + authoring stop rule

**Problem:** OpenWiki/ADR under-explain purgatory and full-request obligation.  
**Owner files:**
- `openwiki/logbook-and-workbench.md`
- `openwiki/data-and-integrations.md` and/or `docs/reference/enrichment.md`
- Optionally short note under `docs/adr/0016-…` “Consequences” or a new light ADR only if behavior change is policy-level (prefer update 0016 consequences + openwiki; full ADR only if B7 changes disposition rules)

**Scope:**
- Document three quality exits: ready / review hold / Not Added.
- Document operator bulk disposition once B3 exists (write as intended behavior).
- Document agent stop rule: request receipt only; pack ≠ done.
- Document resume bootstrap for incomplete requests.

**Acceptance:**
- [ ] Docs answer “why Not Added is 0 but I can’t author half the queue.”
- [ ] Docs answer “agent finished one pack — is the request done?”

**Branch suggestion:** `docs/b5-quality-and-authoring-docs`

---

# Wave 2 — dependent issues

## ISSUE-A6 — CLI human-readable incomplete guard (optional but small)

**Depends on:** A1 progress fields.  
**Owner files:** CLI guided authoring output path when `--json` false (if any) or stderr note when json true is only path — prefer: when `finish` returns claim_next, ensure JSON is the contract (already) and add `mastheadctl workbench author status` emphasis in help text.

**Scope:** Help text + status command examples; if non-json finish prints prose, print incomplete warning.

**Branch:** `fix/a6-cli-incomplete-help`

---

## ISSUE-A7 — Activity event when pack finishes but request remains active

**Depends on:** existing activity pipeline; soft dep A1.  
**Owner files:**
- `workbenchAuthoringV5Service.ts` finish activity recording
- Activity tone mapping if needed
- Tests for activity event types

**Scope:**
- Emit/retain clear activity: `authoring_pack_finished` with details `{ remainingPacks, remainingSessions }` or ensure existing pack finished event includes incomplete flag.
- UI Activity rail should show “pack done, request open” not only success green that reads like campaign complete.

**Branch:** `fix/a7-pack-finished-incomplete-activity`

---

## ISSUE-B6 — Quality review panel parity with Not Added

**Depends on:** B2 summary + list endpoint.  
**Owner files:** Workbench panel not-added twin for review.

**Scope:**
- Table: session, reason (`insufficient_evidence`), runtime, updated_at.
- Actions: open bulk accept/fail (B3).
- Empty state copy.

**Branch:** `fix/b6-quality-review-panel`

---

## ISSUE-B7 — Precheck / coverage fix from B1 (pick one path)

**Depends on:** B1 diagnosis recommendation.  
**Do not start until B1 names the path.**

### Path B7-adapter (if capture is wrong)
- Fix Grok/OMP ingest so assistant and structured tools land correctly.
- Re-reconcile quality for affected sessions (evidence revision change should reopen/re-run).
- Tests: adapter fixtures + quality precheck keeps after fix.

### Path B7-precheck (if capture is right, rules too blind)
- Count `messages.role='tool'` toward tool work **only if** B1 says that is faithful.
- Or: user-only with substantial redacted user text + tools → keep with new reason.
- Tests: fixtures for borderline cases; must not keep empty/hook-only.

**Out of scope:** forcing all review to pass.

**Branch:** `fix/b7-precheck-or-adapter` (rename when path chosen)

---

## ISSUE-B8 — Aging / stale review policy (optional product decision)

**Depends on:** Tyler product call + B2/B3.  
**Scope options (choose one in approval):**
1. No auto-age; only bulk human (B3) — **default if Tyler wants zero policy risk**.
2. After N days in review with unchanged evidence revision, auto-move to Not Added with reason `stale_insufficient_evidence` (reversible if evidence changes — already true for automatic not-added).
3. Soft “suggest fail” badge only.

**Do not implement option 2 without explicit Tyler approval in the issue.**

**Branch:** `fix/b8-review-aging` (only if approved)

---

# Wave 3 — integration

## ISSUE-C0 — Spec freeze checklist (orchestrator, before merge wave)

**Owner:** orchestrating agent / Tyler.  
- [ ] Confirm A3 auto-chain is in-scope or deferred.  
- [ ] Confirm B7 path from B1.  
- [ ] Confirm B8 aging allowed or out.  
- [ ] Confirm no production DB writes in e2e proof without approval.

---

## ISSUE-C1 — Merge smoke (sequential after Wave 1–2)

**Owner:** one integrator worktree on `main` or release branch.  
**Steps:**
- [ ] Merge A1→A5, B2→B6 (and B7 if ready) resolving type conflicts in `workbenchAuthoringV5.ts` first.
- [ ] Run focused vitest suites listed per issue, then broader:

```bash
npx vitest --run \
  src/workbench/authoring/__tests__/workbenchAuthoringV5Service.test.ts \
  src/ui/workbench/__tests__/workbenchHandoff.test.ts \
  src/ui/workbench/__tests__/WorkbenchPanel.test.tsx \
  src/app/workbench/__tests__/useWorkbenchController.test.tsx \
  src/workbench/__tests__/qualityPrecheck.test.ts \
  src/workbench/__tests__/transcriptQualityReconciler.test.ts
```

- [ ] Typecheck/build as repo standard (`npm test` / package scripts — use whatever CI uses).

---

## ISSUE-C2 — Pre-release proof on e2e instance (manual / agent-assisted)

**Not a code issue; runbook.**

### Authoring early-stop proof
- [ ] Create small multi-pack request (≥2 packs, ≤24 sessions compile-ready).
- [ ] Paste handoff into agent (or scripted CLI loop that only stops on `complete`).
- [ ] Assert agent-facing finish after pack 1 includes stopRule + claim_next/followUp.
- [ ] Complete all packs; assert request receipt; Logbook counts match published.

### Quality purgatory proof
- [ ] Quality review count matches SQL review rows.
- [ ] Bulk fail sample (e.g. 10) → Not Added increases by 10; package path drops.
- [ ] Bulk accept sample (e.g. 10) → ready for Copy Agent Prompt.
- [ ] Select all shows ready vs review honesty; handoff session count = ready only.

**Do not** require full 573-session agent marathon for C2; multi-pack ≥2 is sufficient for stop-rule; separate optional soak.

---

## ISSUE-C3 — Closeout docs + acceptance gate pointers

- [ ] Point `docs/acceptance/product-release-gate.md` (or add a short subsection) at multipack autonomy + quality review drain.
- [ ] Session closeout note for Tyler (GBrain if available): request ids, pack counts, issue list status.

---

## Parallel staffing matrix (for sub-agents)

| Issue | Parallel wave | Worktree isolation | Estimated size | Risk |
|---|---|---|---|---|
| A1 stopRule/progress | 1 | yes | M | contract churn |
| A2 handoff | 1 | yes | S | low |
| A3 finish followUp | 1 | yes | S–M | DTO overlap with A1 — rebase on shared types |
| A4 incomplete banner | 1 | yes | M | API discovery |
| A5 multipack tests | 1 | yes | S | low |
| B1 diagnosis | 1 | yes | M | docs-only |
| B2 review count | 1 | yes | M | API+UI |
| B3 bulk disposition | 1 | yes | M | destructive ops — tests critical |
| B4 selection honesty | 1 | yes | S | low |
| B5 docs | 1 | yes | S | low |
| A6 CLI help | 2 | yes | S | after A1 |
| A7 activity | 2 | yes | S | after A1 |
| B6 review panel | 2 | yes | M | after B2/B3 |
| B7 adapter/precheck | 2 | yes | L | after B1 |
| B8 aging | 2 | yes | M | needs product OK |
| C1–C3 | 3 | integrator | M | sequential |

**Max parallel at Wave 1:** 10 worktrees (A1–A5, B1–B5).

**Conflict hotspots (serialize or rebase carefully):**
- `workbenchAuthoringV5.ts` + service — A1, A3, A5, A7
- `WorkbenchPanel.tsx` / controller — A4, B2, B3, B4, B6
- `qualityPrecheck.ts` — B1 (read), B7 (write)

---

## Per-issue implementation template (for each sub-agent)

Every sub-agent prompt must include:

1. Issue ID + this plan path.  
2. In scope / out of scope from the issue section.  
3. Files list.  
4. TDD: failing test → implement → pass → commit.  
5. Forbidden: drive-by refactors, unrelated formatting, production data wipes.  
6. Done = acceptance checkboxes + test command output pasted.  
7. Open PR or leave branch ready; do not merge without integrator (C1).

---

## Suggested GitHub issue titles (copy/paste)

1. `A1: V5 nextAction progress + stopRule on pack finish/claim_next`  
2. `A2: Copy Agent Prompt handoff stop rule for full request`  
3. `A3: Finish response followUp start command when packs remain`  
4. `A4: Workbench incomplete authoring banner + resume copy`  
5. `A5: Multi-pack regression — no request receipt until last pack`  
6. `B1: Diagnose Grok/OMP permanent quality review corpus`  
7. `B2: Quality review count API + toolbar fact`  
8. `B3: Bulk accept/fail for quality-review sessions`  
9. `B4: Select-all ready vs review honesty in Workbench UI`  
10. `B5: Docs for quality purgatory + authoring stop rule`  
11. `A6: CLI status/help incomplete-request wording`  
12. `A7: Activity event pack finished but request open`  
13. `B6: Quality review panel (Not Added parity)`  
14. `B7: Fix capture or precheck per B1 diagnosis`  
15. `B8: (optional) Stale review aging policy`  
16. `C1: Integrate authoring-stop + quality-purgatory branches`  
17. `C2: E2E multipack + review-drain proof`  
18. `C3: Acceptance gate + closeout`

---

## Explicit non-goals (entire program)

- Auto-writing dossier prose in Masthead  
- Nested multi-agent supervisors as product architecture  
- Forcing review sessions into V5 requests without quality pass  
- Wiping Logbook / full 573 soak as merge gate  
- Changing pack size policy or abandoning fixed packs  
- Silent switch of quality `review` → `suppress` without Tyler approval (B8/B7 policy)

---

## What success looks like

| Failure mode (today) | After this program |
|---|---|
| Agent stops after 1 pack with 12/573 | Contract + handoff + tests make early stop a failed run; UI offers resume; finish points hard at next start |
| Half of Workbench not authorable, Not Added=0 | Quality review is visible, bulk-drainable, documented; capture/precheck fixed for false-review if B1 proves it |
| Operator confusion | Selection honesty + docs explain ready vs review vs Not Added |

---

## Execution handoff (after Tyler approves this plan)

**Do not implement until Tyler says go.**

Recommended execution:

1. **Wave 1:** spawn up to 10 worktree sub-agents (A1–A5, B1–B5).  
2. **B1 read-out:** Tyler picks B7 path (+ B8 yes/no).  
3. **Wave 2:** A6, A7, B6, B7, optional B8.  
4. **Wave 3:** integrator C1 → proof C2 → docs C3.

**Two execution options when approved:**

1. **Subagent-Driven (recommended)** — one issue per worktree, review between merges.  
2. **Inline sequential** — single agent walks issues in dependency order (slower).

---

## Self-review (plan author)

| Diagnosis finding | Covered by |
|---|---|
| Agent stopped despite claim_next | A1, A2, A3, A5, A7 |
| Thin handoff | A2 |
| skillContract.loop pack-only | A1 |
| Soft claim_next reason | A1 |
| No incomplete UI | A4 |
| Review ≠ Not Added by design | B2, B5, B6 |
| Permanent review no auto-progress | B3, B7, optional B8 |
| Grok/OMP capture shape | B1 → B7 |
| Select-all / ready split confusion | B4 |
| Multipack proof | C2 |

No implementation performed in this plan-only step.
