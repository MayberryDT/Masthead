# Masthead Skill Authoring V5 — Implementation Plan

Date: 2026-07-22
Status: plan only — do not implement until Tyler approves
Governing decision: GBrain `decisions/2026-07-22-masthead-skill-authoring-v5`
Source grill: Codex task "Fix batch artifact publishing" + production dogfood thread `019f8371-4cdd-7fc1-b500-60e3e4f1ea9e`

## Shared understanding (frozen)

### Product promise
User selects Workbench sessions → **Copy Agent Prompt** → pastes into a coding agent → walks away → that agent finishes the **entire** selection via Masthead CLI → Logbook has useful, MCP-findable **session dossiers**. Optional runbooks/ADRs/incident timelines appear when the agent considers them useful; they are never required.

### Ownership split
- **Agent owns all meaning:** title, description/summary, keywords, purpose, outcome, key work, honest verification, optional-artifact judgment.
- **Masthead owns infrastructure only:** durable request, fixed packs (~5–12), evidence catalog + blank scaffold, validation gates, Workbench Activity flags, atomic publish of passers, skill-primary search index, crash resume by request id.
- **Masthead does not write enrichment prose.** Scaffold is identity + evidence catalog + empty skill fields. No hints that agents can latch onto.

### Quality and flow
- Extend live `session-capsule-v4` / durable enrichment with **`keywords: string[]`** (do not invent a third dossier schema).
- Daemon still rebuilds `canonical-session-dossier-v1` for Logbook rendering from enrichment + canonical graph.
- Hybrid grounding: agent must inspect session evidence; explicit claim support only on core fields (title, summary, purpose, outcome, keyWork, verification) — not per-leaf theater.
- **Flag-and-continue:** hard-reject → do not publish that session, Activity reason, keep going; soft-flag → may publish with warning; never stall the request in needs_revision loops.
- Optional kinds: same pack, forced consider (yes/no + grounded one-line reason); draft only on yes.
- Search/MCP: skill fields primary (title, description, keywords); full snapshot secondary.
- Handoff: thin clipboard (request id + instance-bound start) + `author bootstrap` returns full contract once.
- Resume: same request id after crash; completed packs stay published; agent still obligated to finish the full selection.
- Dogfood proof: clean Logbook → **10** sessions → **50** → full selection (~3.5k). Full selection is the real job, not optional.

### Kill list (must not ship in the release path)
- Operator canary / approval gates
- Required opportunity dispositions
- Campaign-stopping needs_revision
- Masthead-written prose enrichment
- Mandatory runbook/ADR/incident per session
- Supervisor / worker / nested-author as product architecture

### Hard reject vs soft flag
**Hard reject (skip publish, flag, continue):** empty/generic title; summary is protocol-slop or compaction/cron boilerplate; empty keywords; purpose clearly not the user ask.
**Soft flag (publish + Activity warning):** weak verification wording; thin keyWork; missing decisions when none existed is fine.

### CLI loop (agent)
1. `author bootstrap --request <id>`
2. claim/start next assignment pack
3. `inspect` evidence (cursors)
4. `scaffold --file` blanks + evidence catalog
5. agent fills skill fields (+ optional consider/draft)
6. `save --file` → per-session publishable / soft-flag / hard-reject (no campaign stop)
7. `finish` → publish passers + soft-flags; record rejects; release next pack
8. repeat until immutable **request complete** receipt

No separate required `review` command. `save` owns findings; `finish` stays explicit.

### Activity minimum events
request created · pack claimed · session published · session soft-flagged · session rejected · optional artifact published · optional considered-no · pack finished · request completed · daemon/identity errors

### Selection rules
Copy Agent Prompt uses **compile-ready only**; disclose excluded review-needed sessions. Do not block the handoff on dirty rows.

### Contract version
Ship as **`workbench-authoring-v5`**. V1–V4 mutation paths remain audit-only / retired so poisoned V4 state cannot resume into the new path.

### Pass gates
- **10-session:** all attempted; ≥8 published; each published has specific title + description + ≥3 keywords; MCP search hits ≥3 distinct sessions by keyword; Activity shows rejects without stopping; zero intervention after paste.
- **50-session:** same funnel; ≥45/50 published; keyword retrieval still works; ≥1 optional consider (yes or no + reason) per pack; wall-clock recorded, no hard SLA yet.
- **Full selection:** same autonomy; immutable request receipt with attempted / published / soft-flagged / rejected / optional published / considered-no.

---

## Non-goals for this plan
- Redesigning Now / Sources / Settings UI
- Rebuilding import from scratch (only unblock compile-ready selection if required for the 10/50 gates)
- Making Masthead an LLM enricher
- Keeping V4 canary product behavior

---

## Execution model (after plan approval — not now)

When Tyler says go:

1. Create **one new Codex thread per section below**, each on a **fresh git worktree** from current main.
2. Model for every section thread: **`gpt-5.6-sol` / High** (user: "GPT 5.6 sole high").
3. Threads may use sub-agents sparingly for parallel research/tests inside their section.
4. This coordinator task sets a **15-minute heartbeat**, reads section threads, unblocks, and keeps them on contract.
5. As each section finishes and is verified in its worktree, **merge into main** (coordinator).
6. After each merge (or after dependency groups), run a **main-branch verification sub-agent** against the frozen gates for that slice.
7. Do not start later sections that hard-depend on earlier merges until those merges land, unless the section is explicitly parallelizable (see graph).

### Dependency graph

```
S1 Schema+search ──┐
S2 Protocol/CLI  ──┼──► S4 Quality/gates ──► S5 Workbench UX ──► S6 Production cutover ──► S7 Dogfood
S3 Kill V4 / migration ─┘
```

- **S1, S2, S3** can start in parallel once the shared contract text below is pasted into each thread prompt.
- **S4** needs S1+S2 merged (schema + CLI shapes).
- **S5** needs S2+S3 merged (handoff/bootstrap + no canary UI).
- **S6** needs S1–S5.
- **S7** is dogfood/ops on production after S6; not a code worktree unless fixes are required.

---

## Section S1 — Capsule schema, keywords, skill-primary search

**Goal:** Extend live durable enrichment with `keywords` and make Logbook/MCP search prefer skill fields.

**Worktree / thread:** one thread, one worktree
**Depends on:** none
**Touches (expected):**
- `src/shared/sessionEnrichment.ts`
- enrichment materialization / apply paths
- `session_artifact_search` indexing / projection
- MCP `search_artifacts` ranking or query construction if needed
- tests for schema + search

**Deliverables**
1. `keywords: string[]` on durable session enrichment (capsule), required for publishable guided enrichment.
2. Published dossier / search projection stores keywords for retrieval.
3. Search/MCP: title + summary + keywords primary; full body secondary.
4. Migration or dual-read so existing capsules without keywords remain readable (unpublished/legacy ok).
5. Unit/integration tests green in worktree.

**Acceptance**
- Fixture enrichment with keywords round-trips into store and search hits by keyword.
- No Masthead-generated keyword invention in production path.

**Out of scope:** CLI loop, Workbench UI, canary removal.

---

## Section S2 — V5 authoring protocol + CLI loop

**Goal:** Implement `workbench-authoring-v5` agent loop: bootstrap → start → inspect → scaffold → save → finish → request receipt.

**Worktree / thread:** one thread, one worktree
**Depends on:** none to start; merge before S4
**Touches (expected):**
- `src/shared/guidedAuthoring.ts` (or v5 sibling types)
- `src/cli/workbenchAuthoring.ts`, `authoringClient.ts`
- `src/workbench/authoring/guidedAuthoringService.ts` (v5 path)
- `src/workbench/authoring/authoringSchemas.ts`
- daemon HTTP routes for guided authoring
- CLI tests

**Deliverables**
1. Advertise `workbench-authoring-v5` capabilities.
2. Commands: `bootstrap`, `start`/`claim`, `inspect`, `scaffold`, `save`, `finish`; request status/receipt.
3. Bootstrap returns skill contract, pack policy, reject rules, instance identity, first nextAction.
4. Fixed packs of 5–12; no opportunity-join requirement for packing.
5. Scaffold: blanks + evidence catalog only (no prose).
6. Save returns **per-session** publishable | soft_flag | hard_reject; does not freeze the request.
7. Finish publishes passers + soft-flags for the pack; records rejects; releases next pack; idempotent receipts.
8. Request-complete receipt with counts.
9. Crash resume by request id.
10. Tests for loop, mixed pack finish, resume.

**Acceptance**
- Scripted agent-less test drives a multi-pack request to complete receipt with mixed outcomes.
- Thin handoff contains only request id + start command; bootstrap is the thick contract.

**Out of scope:** full quality rule implementation (wire hooks only if needed); UI canary removal.

---

## Section S3 — Retire V4 campaign poison (canary, dispositions, stop-the-world revision)

**Goal:** Make V4 mutation paths inert for new work; remove canary and campaign-stopping revision from the product path; preserve audit history.

**Worktree / thread:** one thread, one worktree
**Depends on:** none to start; merge before S5
**Touches (expected):**
- guided request creation / assignment planning
- canary approval APIs and Workbench hooks
- opportunity disposition requirements
- `authoring_contract_retired` boundaries for v1–v4 mutations
- ADR/docs notes (short; OpenWiki if needed)

**Deliverables**
1. New requests only create V5 campaigns.
2. Canary construction/approval not required (and not present) for V5.
3. High-signal opportunity disposition no longer blocks dossier publish.
4. V4 open campaigns cannot be continued as V4; document migration: abandon or convert-read-only.
5. Activity remains observe-only — no operator approval control for normal publish.
6. Tests prove retired mutations fail closed; V5 create works without canary.

**Acceptance**
- Creating a guided request never returns `guided_canary_not_constructible`.
- No code path stages V5 packs for operator approval.

**Out of scope:** implementing full V5 save quality (S4); deep UI polish.

---

## Section S4 — Quality gates: hard reject / soft flag / hybrid grounding / optional consider

**Goal:** Encode the release quality bar so agents produce skill-shaped dossiers without revision death spirals.

**Worktree / thread:** one thread, one worktree
**Depends on:** **S1 + S2 merged**
**Touches (expected):**
- `guidedAuthoringQuality.ts` / `artifactQuality.ts` / verification semantics
- optional-artifact consider schema
- Activity event emission for reject/soft-flag/consider-no
- tests with real failure fixtures from production patterns (compaction banners, protocol slop, empty keywords)

**Deliverables**
1. Hard-reject rules as frozen.
2. Soft-flag rules as frozen.
3. Hybrid grounding checks on core fields only.
4. Protocol-slop / compaction / cron-boilerplate detectors on title/summary/purpose.
5. Optional consider object: `{ kind, decision: yes|no, reason, evidenceRef? }`; yes may attach artifact draft.
6. Save/finish integration: mixed packs work; request never enters global needs_revision halt.
7. Regression fixtures from last-24h failure codes (`unsupported_completion` thrash patterns) prove campaign continues.

**Acceptance**
- Fixture pack: 8 good, 1 soft, 1 hard → finish publishes 9, rejects 1, request continues.
- Protocol-narration dossier hard-rejects.
- Empty keywords hard-rejects.

**Out of scope:** production deploy; UI beyond Activity event plumbing if already present.

---

## Section S5 — Workbench handoff + Activity UX

**Goal:** Make Copy Agent Prompt and Activity match the frozen product: thin V5 handoff, bootstrap-capable, observe-only progress.

**Worktree / thread:** one thread, one worktree
**Depends on:** **S2 + S3 merged**
**Touches (expected):**
- `src/ui/workbench/workbenchHandoff.ts`
- `useWorkbenchController.ts` / WorkbenchPanel
- Activity tone/labels for new event types
- controller/handoff tests

**Deliverables**
1. Copy Agent Prompt creates V5 request from compile-ready selection; discloses excluded review-needed.
2. Clipboard packet is thin and instance-bound; documents that agent runs bootstrap/start.
3. Remove/disable canary approve/reject UI for normal enrichment.
4. Activity rail shows the minimum event set with clear reject reasons.
5. No "workers" or multi-agent recipe in the prompt.
6. Tests for handoff packet shape and button enablement rules.

**Acceptance**
- Focused UI/controller tests green.
- Handoff snapshot does not include session id lists or multi-step shell recipes.
- No canary CTA on V5 requests.

**Out of scope:** Electron daemon lifecycle (S6); dogfood.

---

## Section S6 — Production lifecycle, cutover, and release wiring

**Goal:** Ship a production build where daemon stays up under large history, V5 is the only live authoring path, and dogfood can run without launcher self-kills.

**Worktree / thread:** one thread, one worktree
**Depends on:** **S1–S5 merged**
**Touches (expected):**
- Electron `daemonLauncher` startup budgets / stale sentinel cleanup (known 8s vs 5min failure)
- production packaging / version sync if needed
- instance identity binding for V5 CLI
- OpenWiki / ADR 0015 supersession note for V5 (short, accurate)
- release gate checklist updates in `docs/acceptance/`

**Deliverables**
1. Daemon startup wait aligned with large DB open (no 8-second self-kill).
2. Proven-stale sentinel auto-clear; healthy restart path.
3. Production package advertises V5 authoring.
4. Doctor/health shows authoring contract version.
5. Acceptance doc updated to frozen gates (10/50/full) and kill list.
6. Regression tests for launcher timeout + sentinel.

**Acceptance**
- Automated lifecycle tests pass.
- Manual smoke on a large DB: app start → daemon healthy → V5 capabilities → copy prompt works.

**Out of scope:** running the full 3.5k enrichment (S7).

---

## Section S7 — Dogfood conductor (ops, not parallel feature work)

**Goal:** Prove the product promise on production data after S6.

**Thread:** one ops/dogfood thread (worktree only if fixes needed)
**Depends on:** **S6 production build installed**
**Model:** same Sol High supervisor-friendly agent

**Script**
1. Wipe or isolate Logbook for clean dogfood if Tyler confirms (per grill: clean for proof).
2. Select 10 compile-ready sessions → Copy Agent Prompt → projectless agent paste → no intervention.
3. Verify 10-session pass gate + Activity + MCP keyword hits.
4. Repeat for 50.
5. Only then start full selection; monitor receipts/Activity; fix only true product bugs via new surgical threads.
6. Record request receipt counts and sample dossiers Tyler can hate-check.

**Acceptance**
- 10 and 50 gates pass without supervisor nextAction relays.
- Full selection either completes or fails with a **product** bug filed/fixed (not agent babysitting).

---

## Coordinator checklist (this task, after approval)

- [ ] Paste frozen contract into every section prompt
- [ ] Create S1–S3 threads+worktrees (parallel)
- [ ] 15-minute heartbeat supervision
- [ ] Merge S1, S2, S3 when each is green
- [ ] Start S4 after S1+S2; S5 after S2+S3
- [ ] Merge S4, S5; start S6
- [ ] Merge S6; run main verification sub-agent
- [ ] Start S7 dogfood
- [ ] Stop when 10+50 gates pass and full path is either green or blocked on a clear product defect

### Section thread prompt template (use on execute)

```
You are implementing ONLY section <ID> of docs/superpowers/plans/2026-07-22-skill-authoring-v5.md
in a fresh worktree off main. Model: gpt-5.6-sol High.

Frozen product contract (do not renegotiate):
- Agent-led enrichment only; Masthead never writes enrichment prose
- V5 workbench-authoring; no canary; flag-and-continue; skill-shaped dossiers with keywords
- Full selection is the job; resume is crash recovery only
- Kill list: canary, required dispositions, stop-the-world revision, workers-as-product

Read the section acceptance criteria and implement only that section.
Use sub-agents sparingly for tests/research.
Do not start other sections. Do not deploy production unless the section says so.
When done: summarize files changed, tests run, and residual risks.
```

---

## Risks (explicit)

1. **Hybrid grounding still too heavy** — if save thrash returns, cut support requirements further before inventing more CLI.
2. **Optional consider still yields zero artifacts** — acceptable for dossier release; tune prompt/bootstrap copy after 50-gate, don't block ship.
3. **Parallel worktree merge conflicts** on authoring service — S2 owns protocol core; S3/S4 must rebase carefully; coordinator sequences merges.
4. **Daemon lifecycle** may still fail under 11GB DB — S6 is not optional for dogfood.
5. **Existing mediocre published dossiers** — clean dogfood Logbook for proof; product default for users is leave-and-supersede later.

---

## Definition of done for the overall effort

A user (or dogfood agent) can: import history → select compile-ready sessions → Copy Agent Prompt → paste into one coding agent → leave → return to Logbook dossiers that are skill-shaped (title, description, keywords, purpose/outcome/key work) and MCP-findable — without canary clicks, without Masthead writing the enrichment, and without a supervisor feeding nextActions.
