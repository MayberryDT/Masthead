# Authoring Quality, Workbench Clearance & Grok Spam — Parallel Issue Plan

> **For agentic workers:** Plan only until Tyler approves. After approval, use
> subagent-driven development with **one issue per isolated worktree**, max parallel
> in each wave. Checkboxes track progress.

**Date:** 2026-07-28  
**Status:** approved — execution started 2026-07-28 (Tyler: start it; D1–D6 defaults frozen)  
**Diagnosis source:** Codex session `019fa717-3c58-71e3-8f8d-8b8e039f010e`; request
`authoring-v5-request:01b38a4a-aa7d-4e9c-8ac4-e5be57300bc4` on newuser-e2e DB
`d75fe426-0ed3-4cea-a36a-060f64172165` (completed: 237 published, 343 hard-reject,
8 soft-flag; Workbench left with ~343 enrich + ~459 review; Logbook flooded with
`# AGENTS` / system-reminder / JSON summaries; Grok Build session-start every ~5m).

---

## Goal

1. **After select-all authoring finishes, Workbench package path only holds
   genuinely unfinished work** — not hard-rejected sessions, not empty Grok shells.
2. **Published dossiers are human-usable** — no `# AGENTS`, system-reminder, MCP
   boilerplate, or JSON approval payloads as title/summary.
3. **Grok Build heartbeat sessions stop filling Now and Quality review.**
4. **Quality review auto-disposes terminal incomplete shells** (manual bulk remains backup).

---

## Frozen product decisions (defaults — Tyler can override in review)

| # | Decision | Default in this plan |
|---|---|---|
| D1 | Hard-reject after V5 save/finish | **Leave package path** → move to **Not Added** with reason `authoring_hard_reject` (reversible only via explicit re-enroll/quality pass if product already has a path; do not invent a third queue). |
| D2 | Soft-flag sessions | **Stay published** (current); optionally strengthen soft rules in Q-series so fewer bad publishes. |
| D3 | Empty Grok “session start” / single system row | **Suppress → Not Added** (`hook_only` or new `session_start_only`), not `review`. |
| D4 | Incomplete Grok (user-only, import complete / ended, no tools/files) | **Auto Not Added** when evidence is frozen (import complete or session ended), not 7-day wait only. |
| D5 | Existing bad Logbook dossiers on e2e | **Ops issue OPS1** — invalidate/delete titles matching bad patterns after gates land; not mixed into product code issues. |
| D6 | Do not auto-pass incomplete Grok into authoring | Confirmed — never “fix” purgatory by publishing worse dossiers. |

---

## Architecture (shared)

### Ownership

- **Masthead owns:** quality disposition, hard-reject placement, evidence catalog
  filters for scaffold, title/description reject codes, ingest suppress rules,
  Not Added reasons, Workbench queue membership.
- **Agent owns:** prose for sessions that pass gates — but gates must refuse
  instruction-file and approval-JSON shaped fields.

### Seams (do not invent parallel systems)

| Concern | Primary files |
|---|---|
| V5 classify / reject codes | `src/workbench/authoring/workbenchAuthoringV5Quality.ts` |
| V5 finish / publish / reject activity | `src/workbench/authoring/workbenchAuthoringV5Service.ts` |
| Workbench package-path transition on reject | `src/daemon/db/workbenchPipelineRepository.ts` (+ V5 service finish path) |
| Capture quality precheck | `src/workbench/qualityPrecheck.ts`, `transcriptQualityReconciler.ts` |
| Stale review aging | `src/workbench/qualityReviewAging.ts` (extend or complement) |
| Grok ingest / live | `src/adapters/grok/*`, live hook path if present under `src/adapters/live*` / core |
| Scaffold evidence catalog | `src/workbench/authoring/evidenceCatalog.ts`, scaffold builder in V5 service |
| skillContract bootstrap text | `workbenchAuthoringV5Service.ts` `bootstrapWorkbenchAuthoringV5Request` |
| Shared codes / DTO reasons | `src/shared/workbench.ts`, `workbenchAuthoringV5.ts` |
| Now titles (optional polish) | board/headline / session reducer — only if ingest fix insufficient |

### Global constraints

- Additive reject codes and Not Added reasons preferred over silent renames.
- No Masthead-written enrichment prose.
- Logbook remains published-artifact-only.
- **Disk hygiene (AGENTS.md):** never archive multi-GB DBs; delete/recreate for clean tests.
- One issue per worktree; merge via integration branch; focused vitest per issue.
- Do not mutate Tyler’s primary `~/.config/masthead-production` unless he orders it;
  e2e/newuser path is the test target for OPS cleanup.

---

## Issue catalog (maximize parallelism)

### Dependency graph

```text
Wave 0 (spec freeze, orchestrator):  C0 confirm D1–D6
Wave 1 (fully parallel):
  Q1  Q2  Q3     W1  W2     G1  G2     E1  E2     T1
Wave 2:
  Q4 (depends Q1+Q2 codes)   W3 (depends W1)   G3 (depends G1)   E3 (depends E1)
  A1 acceptance harness (depends Q1–Q3, W1)
Wave 3:
  OPS1 data cleanup (after Q gates green)   C1 integrate   C2 proof on newuser-e2e
```

---

# Wave 1 — independent issues (run in parallel)

## ISSUE-Q1 — Hard-reject instruction-file and system-prompt titles

**Problem:** 138+ published titles are `# AGENTS` or similar instruction heads.  
**Files:**
- Modify: `src/workbench/authoring/workbenchAuthoringV5Quality.ts`
- Tests: adjacent quality tests / fixtures under `src/workbench/authoring/__tests__/`
- Shared codes list if exported from `workbenchAuthoringV5Service` rejectRules bootstrap

**Scope:**
- Add hard reject code(s), e.g. `instruction_or_policy_title`, covering titles that:
  - equal or start with `# AGENTS` / `AGENTS.md`
  - start with `<system-reminder`
  - start with `MCP servers connected` / `MCP server connected`
  - match other frozen allowlist of system/prompt dumps (keep list explicit in code + tests)
- Do **not** reject legitimate titles that merely mention “agents” in prose (e.g. “Improve agent handoff UX”).

**Acceptance:**
- [ ] Fixture: title `# AGENTS` → hard_reject with new code.
- [ ] Fixture: title `Agent handoff copy improvements` → not rejected solely for “agent”.
- [ ] Bootstrap `rejectRules.hardReject` list includes new code if that list is code-derived.

**Branch:** `fix/q1-reject-instruction-titles`  
**Test:** `npx vitest --run src/workbench/authoring/__tests__/` (narrow to quality tests)

---

## ISSUE-Q2 — Hard-reject JSON / approval-payload descriptions and summaries

**Problem:** Summaries/highlights are raw `{"risk_level":...}` approval JSON.  
**Files:**
- `workbenchAuthoringV5Quality.ts` (+ tests/fixtures)

**Scope:**
- Hard reject when description (and/or title) is primarily a JSON object with keys like
  `risk_level`, `user_authorization`, `outcome` + `allow`/`deny`, or looks like a
  pure JSON blob (`trim` starts with `{` and parses as object).
- New code e.g. `approval_or_json_payload_description` (or split title vs description if cleaner).
- Soft-flag alone is insufficient — these must not publish.

**Acceptance:**
- [ ] Description = approval JSON → hard_reject.
- [ ] Normal multi-sentence description → not rejected by this rule.

**Branch:** `fix/q2-reject-json-descriptions`

---

## ISSUE-Q3 — Harden context/metadata title heuristics

**Problem:** Only 4 rejects on `context_or_metadata_title` while dozens of system-reminder titles published.  
**Files:**
- `workbenchAuthoringV5Quality.ts` (+ tests)

**Scope:**
- Expand `context_or_metadata_title` (or Q1 codes) so system-reminder / permissions-instructions
  / “You are Codex…” / “You are reviewing…” heads hard-reject.
- Coordinate with Q1: either Q1 owns discrete patterns or Q3 owns a broader classifier —
  **no duplicate conflicting codes for the same string** (pick one code per fixture in tests).

**Acceptance:**
- [ ] Table-driven fixtures for ≥6 bad titles and ≥3 good titles.
- [ ] Does not fire on ordinary product titles from real user asks.

**Branch:** `fix/q3-metadata-title-heuristics`

---

## ISSUE-W1 — Hard-reject removes session from package path

**Problem:** 343 hard-rejects stayed `publish_path` + `enrich`, so Workbench stayed full after a “complete” campaign.  
**Files:**
- `workbenchAuthoringV5Service.ts` (finish / outcome application)
- `workbenchPipelineRepository.ts` (`markWorkbenchQuality` failed path or dedicated helper)
- `workbenchAuthoringV5Repository.ts` if request session state needs consistency
- Tests: `workbenchAuthoringV5Service.test.ts`

**Scope:**
- When finish records `hard_reject` for a session:
  - Do **not** publish dossier (already).
  - Transition Workbench state off package path: `publication_status = not_added_to_logbook`,
    `quality_status` appropriate (`failed` or keep history — prefer failed + reason
    `authoring_hard_reject`), `next_action = none`.
  - Activity event already `authoring_session_rejected`; ensure details include finding codes.
- Soft-flag + publishable still publish and leave package path as today.
- **Idempotent** re-finish must not error.

**Out of scope:** changing soft-flag publish behavior; UI redesign.

**Acceptance:**
- [ ] Multi-pack or single-pack test: after finish with mixed outcomes, hard_reject sessions
      are **not** in package-path query; published sessions are `published`.
- [ ] Select-all compile-ready count no longer includes hard-rejected sessions.

**Branch:** `fix/w1-hard-reject-off-package-path`

---

## ISSUE-W2 — Document + Activity clarity for reject clearance

**Problem:** Operators think “complete request” empties Workbench.  
**Files:**
- `openwiki/logbook-and-workbench.md`, `docs/reference/enrichment.md` (and ADR 0016 consequences if needed)
- Optional: activity label for reject → not_added

**Scope:**
- Document: after V5 finish, hard-rejects leave package path (Not Added);
  only new/unauthored ready work remains.
- One-line Activity summary if labels currently imply “still enrich.”

**Branch:** `docs/w2-workbench-clearance-docs`

---

## ISSUE-G1 — Suppress Grok session-start-only units at quality/ingest

**Problem:** `Grok Build: session start` every ~5 minutes with a single system message → review purgatory.  
**Files:**
- `qualityPrecheck.ts` (+ tests)
- Possibly Grok adapter if unit should never enroll Workbench

**Scope:**
- Precheck: if only system/low-value session-start rows and no user/assistant/tool/file evidence →
  **suppress** (not review). Prefer existing `hook_only` / `diagnostic_only` or add
  `session_start_only` if clearer.
- Ensure reconciler marks Not Added for suppress (existing path).
- Do **not** suppress real Grok conversations with user+assistant content.

**Acceptance:**
- [ ] Fixture: one system “session start” → suppress.
- [ ] Fixture: Grok with user+assistant → keep or review by existing rules, not suppress.

**Branch:** `fix/g1-suppress-session-start-only`

---

## ISSUE-G2 — Diagnose & document Grok 5-minute heartbeat (read-only + docs)

**Problem:** Need to know if live hook vs import is creating empties.  
**Files:**
- Read: `src/adapters/grok/*`, live adapters, hook docs
- Write: short note under `docs/superpowers/plans/` or `docs/reference/` — findings only

**Scope:**
- Identify code path that emits ~5m session start records.
- Recommend: disable heartbeat at source vs suppress-only (G1).
- No product behavior change beyond documentation unless a one-line obvious bug is proven
  (if one-line fix is safe, land it here; else G3).

**Branch:** `docs/g2-grok-heartbeat-diagnosis`

---

## ISSUE-E1 — Scaffold evidence catalog: demote instruction/system rows

**Problem:** Catalog surfaces AGENTS.md and approval wrappers first; agents title from them.  
**Files:**
- `evidenceCatalog.ts` and/or scaffold assembly in V5 service
- Tests for catalog ordering/filtering

**Scope:**
- When building authoring evidence catalog / usable ranking:
  - Prefer substantive user + assistant messages.
  - Demote or flag: AGENTS/skill instruction dumps, developer sandbox policy,
    “approval assessment” wrapper user turns, pure JSON assistant allows.
- Must not hide all evidence for sessions that only have bad rows (then save should hard-reject).

**Acceptance:**
- [ ] Catalog for mixed session lists a real user ask before AGENTS dump when both exist.
- [ ] Existing coverage accounting still complete (do not break inspect page completeness).

**Branch:** `fix/e1-catalog-demote-instructions`

---

## ISSUE-E2 — skillContract synthesisRule / objective hardening

**Problem:** Bootstrap text did not stop agents from using instruction files as the ask.  
**Files:**
- `bootstrapWorkbenchAuthoringV5Request` skillContract in `workbenchAuthoringV5Service.ts`
- Handoff tests if any assert contract text
- `docs/reference/enrichment.md` one paragraph

**Scope:**
- Extend `synthesisRule` (and optional obligation line) with explicit bans:
  - Do not use AGENTS.md / skill dumps / system-reminder / MCP connection prose as title or primary ask.
  - Do not paste approval JSON (`risk_level`, `outcome: allow`) into description.
  - Prefer last substantive user ask and retained outcome from assistant work, not first metadata row.
- Keep scaffold prose-free (no Masthead-written field values).

**Branch:** `fix/e2-skillcontract-synthesis-hardening`

---

## ISSUE-T1 — Focused regression fixtures for the failed corpus shapes

**Problem:** Need durable red-capable tests for this incident’s shapes.  
**Files:**
- New or extended fixtures under `src/workbench/authoring/__fixtures__/`
- Tests importing Q1–Q3 rules (may land first as soft-fail until Q merges — prefer land after Q1–Q3 or use shared fixture file only)

**Scope:**
- Fixtures: `# AGENTS` title, system-reminder title, JSON description, good session.
- If Wave 1 parallel: create **fixture module only** + tests marked to match Q codes once merged;
  or implement as pure data file with no failing CI until Q1–Q3 land.

**Preferred:** pure fixtures in Wave 1; Q issues import them.

**Branch:** `test/t1-authoring-quality-corpus-fixtures`

---

# Wave 2 — dependent issues

## ISSUE-Q4 — Classifier consistency + rejectRules list sync

**Depends on:** Q1, Q2, Q3  
**Scope:** Single export of hard-reject code list used by bootstrap `rejectRules.hardReject` and classifier; no drift.  
**Branch:** `fix/q4-reject-code-list-sync`

---

## ISSUE-W3 — Request completion summary Activity / counts

**Depends on:** W1  
**Scope:** On request complete, Activity (or finish response already has counts) should make clear
`published / soft_flagged / rejected_to_not_added`. Ensure finish `receipt.counts` still accurate.  
**Branch:** `fix/w3-completion-counts-clarity`

---

## ISSUE-G3 — Live Grok heartbeat fix (if G2 finds a product bug)

**Depends on:** G2  
**Scope:** If G2 shows Masthead or hook creating empty sessions on a timer, stop creating
Workbench units until first user message (or drop the event). If external Grok-only, document
and rely on G1.  
**Branch:** `fix/g3-grok-heartbeat-source-fix` (cancel if G2 says suppress-only)

---

## ISSUE-E3 — Optional: local pre-save agent checklist in scaffold file header comment

**Depends on:** E1  
**Scope:** Daemon-owned scaffold JSON remains machine schema; if a short `warnings[]` or
catalog `flags` field can mark demoted rows without prose enrichment, add it.  
**YAGNI:** skip if E1 ordering is enough.  
**Branch:** `fix/e3-catalog-flags` (optional)

---

## ISSUE-A1 — Scripted acceptance: full select-all clears package path

**Depends on:** Q1–Q3, W1 (and ideally G1)  
**Files:** integration-style test with temp DB  

**Scope:**
- Seed N compile-ready sessions (mix good + would-be-AGENTS-bad).
- Run create → packs → save outcomes → finish.
- Assert: all hard-rejects not on package path; published only good; package-path count
  equals only unattempted (0 if all selected).

**Branch:** `test/a1-select-all-clears-workbench`

---

# Wave 3 — integration & ops

## ISSUE-OPS1 — Clean newuser-e2e Logbook + Workbench leftovers (ops, not product)

**When:** After Q1–Q3 and W1 merged and tested.  
**Scope (explicit Tyler approval for this DB path):**
1. Stop daemon if needed for exclusive write.
2. Invalidate/delete published dossiers whose title/description match new hard-reject patterns
   (or all 237 from the failed request if simpler and Tyler agrees).
3. Ensure hard-rejected enrich leftovers from that request are Not Added (if W1 not retroactive,
   one-shot migration script or re-run disposition).
4. **Do not** leave DB archives (AGENTS.md disk hygiene).
5. Do **not** touch `~/.config/masthead-production` unless ordered.

**Branch:** ops script on main or one-shot `scripts/` with `--confirm` + path flags.

---

## ISSUE-C0 — Spec freeze checklist (orchestrator)

- [ ] Tyler confirms D1–D6.
- [ ] Confirm OPS1 allowed on newuser-e2e only.
- [ ] Confirm G3 optional after G2.

---

## ISSUE-C1 — Integration merge

- Merge Wave 1–2 in order: Q fixtures → Q1–Q3 → Q4 → W1 → W2 → G1 → G2/G3 → E1–E2 → A1.
- Resolve conflicts in `workbenchAuthoringV5Quality.ts` and pipeline repository carefully.
- Run focused + authoring service tests; `tsc --noEmit`.

---

## ISSUE-C2 — Live proof (newuser-e2e or fresh empty)

1. Import a **small** mixed corpus (or synthetic seeds via tests only if import too heavy).
2. Confirm Grok session-start alone → Not Added / not review.
3. Author 10–20 real sessions; score titles by eye (zero `# AGENTS` / JSON summaries).
4. After complete: package-path count == only new non-selected / new arrivals.
5. Package production only after C2 pass if Tyler wants a release build.

---

## Parallel staffing matrix

| Issue | Wave | Parallel? | Size | Conflict hotspot |
|---|---|---|---|---|
| Q1 instruction titles | 1 | yes | S | quality.ts |
| Q2 JSON descriptions | 1 | yes | S | quality.ts — rebase with Q1 |
| Q3 metadata titles | 1 | yes | S | quality.ts — rebase with Q1/Q2 |
| W1 reject off path | 1 | yes | M | V5 service + pipeline |
| W2 docs | 1 | yes | S | docs |
| G1 suppress session-start | 1 | yes | S–M | qualityPrecheck |
| G2 heartbeat diagnosis | 1 | yes | S | docs / read adapters |
| E1 catalog demote | 1 | yes | M | evidenceCatalog |
| E2 skillContract text | 1 | yes | S | V5 service bootstrap |
| T1 fixtures | 1 | yes | S | fixtures only |
| Q4 / W3 / G3 / E3 / A1 | 2 | after deps | S–M | — |
| OPS1 / C1 / C2 | 3 | sequential | M | ops |

**Note:** Q1+Q2+Q3 all touch the same classifier file — still launch in parallel worktrees but
**merge serially** (Q1 then Q2 then Q3) or assign one agent “Q-bundle” if conflicts waste more
time than parallelism saves. Recommended: **one agent for Q1+Q2+Q3 as a single worktree** if
Tyler prefers less merge pain; otherwise three agents + careful rebase.

**Alternate bundling for speed:**

| Bundle | Issues | One agent |
|---|---|---|
| **QB** | Q1+Q2+Q3+Q4 | Quality gates |
| **WB** | W1+W2+W3 | Workbench clearance |
| **GB** | G1+G2(+G3) | Grok spam |
| **EB** | E1+E2(+E3) | Evidence + contract |
| **TB** | T1+A1 | Tests |

Either **10-way Wave 1** or **4-way bundled Wave 1** is acceptable; pick at approval time.

---

## Non-goals

- Auto-generating good titles in Masthead (agent still authors).
- Softening precheck to auto-pass incomplete Grok.
- Full production DB wipe/cleanup without order.
- Rewriting Now UI architecture (ingest fix first).
- Re-running 580-session authoring as a merge gate.

---

## Success criteria

| Failure mode (incident) | After this program |
|---|---|
| 343 rejects still on Workbench | Hard-rejects → Not Added; package path clears for finished campaign |
| `# AGENTS` / JSON Logbook | Hard-reject before publish; skillContract + catalog reduce agent mistakes |
| 459 Grok review forever | Session-start suppress + auto incomplete dispose |
| 5m Grok spam | Suppress and/or source fix from G2/G3 |
| “Authoring complete but queue full” | Documented + behavior matches operator expectation |

---

## Execution handoff (after Tyler approves)

1. Confirm D1–D6 and bundle vs fine-grained parallel choice.  
2. Spawn Wave 1 agents (or 4 bundles).  
3. Merge integration branch; Wave 2; OPS1 if approved.  
4. C2 proof; optional production package.

**Do not implement until Tyler says go.**
