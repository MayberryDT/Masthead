# Quality review corpus diagnosis (ISSUE-B1)

**Date:** 2026-07-28  
**Branch:** `docs/b1-quality-review-diagnosis`  
**Scope:** Investigation + findings only (no B7 implementation).  
**DB (read-only):** `~/.config/masthead-production-newuser-e2e/masthead.sqlite`  
**Code base:** worktree at diagnosis time on plan base `c5a49dec`.

---

## Verdict

**Primary B7 path: adapter fix (OMP), not precheck loosening.**

1. **~85% of the purgatory (459 Grok)** is *faithful capture of incomplete sessions*: on-disk `chat_history.jsonl` really has only `system` + `user`. Precheck correctly returns `review` / `insufficient_evidence`. **Do not auto-keep.**
2. **~14% (73 OMP)** is *mis-capture*: import uses generic JSONL `parseTranscriptUnit`, which **bypasses** the custom OMP `backfill` that emits `tool_call` / `tool_result`. Disk has rich assistant+tool work; DB has `messages.role='tool'` and **zero** structured tools. Current custom backfill + existing precheck would keep **71/73**.
3. **~1% (6 other runtimes)** are thin user-only rows. Leave as review (or operator bulk fail).

Precheck rules in `qualityPrecheck.ts` are doing their job for true thin sessions. The OMP mass-review is an **ingest wiring bug**, not a coverage-policy bug.

---

## Corpus snapshot (e2e DB)

### Workbench quality state

| next_action | quality_status | suppression_category | publication_status | n |
|---|---|---|---|---|
| enrich | passed | null | publish_path | 561 |
| **review_quality** | **unchecked** | **insufficient_evidence** | **publish_path** | **538** |
| none | passed | null | published | 12 |

### Review by runtime

| runtime_kind | review_quality n | share of 538 |
|---|---:|---:|
| grok | 459 | 85.3% |
| omp | 73 | 13.6% |
| claude_code | 2 | 0.4% |
| cursor | 2 | 0.4% |
| opencode | 2 | 0.4% |
| **total** | **538** | 100% |

Package path total: 1099 → review is **49%** of package path.

---

## Precheck / coverage contract (what “keep” needs)

From `src/workbench/qualityPrecheck.ts` + `getTranscriptCoverage`:

| Keep reason | Condition |
|---|---|
| `durable_file_effect` | `file_effects > 0` |
| `substantial_tool_work` | `tool_calls + tool_results >= 4` **and** `userMessages >= 1` |
| `meaningful_conversation` | `userMessages >= 1` **and** `assistantMessages >= 1` |

Coverage counts **only**:

- `messages.role = 'user' | 'assistant'` for conversation,
- structured **`tool_calls` / `tool_results` tables** for tool work.

It does **not** treat `messages.role = 'tool'` as tool work. That is intentional given correct adapters; it becomes a false negative when OMP tools are mis-stored as messages.

Default fall-through: `review` / `insufficient_evidence`.

---

## Subclass A — Grok incomplete prompts (459)

### DB shape (all 459 identical profile)

| Signal | Value |
|---|---|
| Message roles | exactly `system=1`, `user=1` per session |
| assistant messages | **0** |
| tool_calls / tool_results | **0** |
| file_effects / checkpoints / runtime_signals | **0** |
| import work unit | `succeeded`, `imported_records=3` (session meta + 2 messages) |
| title | all `"tyler session"` |
| project_label | all `"tyler"` |
| lifecycle | all `unknown` |

### On-disk truth (all 459 paths readable)

| On-disk type in `chat_history.jsonl` | Sessions with type |
|---|---:|
| system | 459 |
| user | 459 |
| assistant | **0** |
| reasoning / tool_result / backend_tool_call | **0** |

Auxiliary files (`updates.jsonl`, `events.jsonl`, `summary.json`) do not hold recoverable assistant turns. `summary.json` for samples: `agent_name=grok-build-plan`, `num_chat_messages=2`, empty `session_summary`.

### Comparison: Grok that *did* keep (41)

| quality | n | typical shape |
|---|---:|---|
| passed / enrich | 41 | assistant + user present; tool_calls often dozens–hundreds |
| review | 459 | system+user only |

Passed agents (from summary): mostly `general-purpose` (34), some completed `grok-build-plan` (7).  
Review agents: **100% `grok-build-plan`** with `num_chat_messages=2`.

Full `~/.grok/sessions` tree scan (~1040 chat histories): only ~170 have assistant on disk; ~813 are user-only-ish. The e2e import pulled the incomplete cohort onto package path.

### Grok adapter assessment

`src/adapters/grok/transcriptUnit.ts` correctly maps `type/role` ∈ {system,user,assistant}, `tool_calls` on assistant rows, `tool_result`, `backend_tool_call`, `reasoning`→checkpoint. Fixture + live keep sessions prove the adapter is fine when content exists.

**Root cause:** not adapter mapping. **Sessions never received assistant output into chat_history** (aborted / stuck `grok-build-plan` spawns under `/home/tyler` with large skill-stuffed user prompts; median user text length 14 117 chars).

### Safe to auto-keep?

| Question | Answer |
|---|---|
| Auto-keep as authoring-ready? | **No** |
| Auto-suppress / Not Added as noise? | **Plausible later (B8 / bulk fail)** — thin evidence, no durable work; not B7 keep |
| Precheck change to keep user-only long prompts? | **No** — floods Logbook pipeline with empty shells |

---

## Subclass B — OMP tool-heavy, zero assistant in DB (73)

### DB shape

| Signal | Value |
|---|---|
| Sessions | 73 review + 20 passed OMP total |
| Review: assistant messages | **0** (all 73) |
| Review: user messages | ≥1 (all 73) |
| Review: `messages.role='tool'` | 72/73 sessions; **2 905** tool messages total; median ~37 / session; 70 sessions have ≥4 |
| Review: tool_calls table | **0** |
| Review: tool_results table | **0** |
| **All OMP in DB** tool_calls / tool_results | **0 / 0** (even the 20 keep sessions!) |
| Keep path for the 20 | `meaningful_conversation` (assistant text present), not tool work |

### On-disk truth (all 73 readable)

| On-disk signal | Sessions |
|---|---:|
| `message.role = assistant` | **73** |
| `message.role = user` | **73** |
| `message.role = toolResult` | **72** |
| content part `type=toolCall` | **72** |
| Non-empty assistant **text** parts | **~0** for review set (assistant turns are thinking + toolCall; final text often empty) |

Sample (`FullSuiteSemanticsTests.jsonl`): 31 toolCall parts, 31 toolResult, 1 user, many assistant roles with no text.

### Adapter dual-path bug (root cause)

OMP adapter construction:

```ts
// src/adapters/omp/adapter.ts
const baseOmpAdapter = createLocalAdapter({ runtime: "omp", ..., jsonlProfile: genericCodingProfile("omp") });
export const ompAdapter = {
  ...baseOmpAdapter,
  backfill: backfillOmpSource   // custom rich parser
  // parseTranscriptUnit NOT overridden → still generic localAdapterFactory path
};
```

Import runner **prefers** `parseTranscriptUnit` (`src/daemon/server.ts` ~1498–1500 → `importWorkUnitRunner.ts`).

Generic `createLocalAdapter.parseTranscriptUnit` calls **`backfillLocalSource`**, not the overridden `backfill`:

```ts
// localAdapterFactory.ts
parseTranscriptUnit: async (unit, cursor) => {
  const records = await collectAdapterRecords(backfillLocalSource(unit.source, cursor, options));
  return parsedTranscriptUnit(unit, records);
},
```

**Measured on the same e2e source file:**

| Path | kinds | message roles | sample sourceRecordKey |
|---|---|---|---|
| `ompAdapter.parseTranscriptUnit` (import path) | usage + **message only** | user=1, **tool=31** | `path:9` (no suffix) |
| `ompAdapter.backfill` (custom) | session, message, **tool_call×31**, **tool_result×31**, usage | user=1 only | `path:9:tool_result` |

e2e `messages.source_ref_json` keys match the **generic** form (`path:line`) for all OMP rows — proof the production import used the broken path.

Generic JSONL effects:

1. `toolResult` → `normalizeRole` → `tool` → stored as **message** (needs text).
2. `toolCall` content parts **never** become `tool_call` records.
3. Assistant rows with only thinking/toolCall (no text) produce **no** assistant message.
4. Precheck sees user + (optional) tool **messages**, zero structured tools, zero assistant → **permanent review**.

### Re-simulation with current custom backfill + existing precheck

Over all 73 review source paths via `ompAdapter.backfill`:

| Simulated disposition | n |
|---|---:|
| `keep:substantial_tool_work` | **71** |
| `review:insufficient_evidence` | **2** (1 tool-call total; 1 user-only) |
| assistant messages still 0 | 73 (no non-empty assistant text on disk) |

### Safe to auto-keep?

| Subclass | n | Safe auto-keep? | Notes |
|---|---:|---|---|
| OMP after correct re-ingest (structured tools ≥4 + user) | 71 | **Yes** | Existing `substantial_tool_work` |
| OMP residual thin (0–1 tools, no assistant text) | 2 | **No** | Stay review / bulk fail |
| OMP as currently stored (`role=tool` only) without re-ingest | 70+ | **No as “keep for authoring quality”** | Disposition-only precheck count of `role=tool` would unstick pipeline but leave broken tool tables for dossiers/MCP |

---

## Subclass C — Other runtimes (6)

| runtime | n | DB shape | Safe auto-keep? |
|---|---:|---|---|
| cursor | 2 | user=1 only, no tools | **No** |
| claude_code | 2 | user=2 only | **No** |
| opencode | 2 | user=1 only | **No** |

Likely partial imports or empty shells. Out of scope for adapter primary fix; operator bulk disposition (B3) is enough.

---

## Role / coverage histograms (review sessions)

### Message role totals in DB

| runtime | user | assistant | system | tool (messages) | tool_calls | tool_results |
|---|---:|---:|---:|---:|---:|---:|
| grok | 459 | 0 | 459 | 0 | 0 | 0 |
| omp | 181 | 0 | 0 | 2905 | 0 | 0 |
| claude_code | 4 | 0 | 0 | 0 | 0 | 0 |
| cursor | 2 | 0 | 0 | 0 | 0 | 0 |
| opencode | 2 | 0 | 0 | 0 | 0 | 0 |

### Grok per-session role profile

| Profile | n |
|---|---:|
| `user=1,system=1` | 459 |

### OMP per-session role profile (top pattern)

Nearly all: `user≥1` + many `tool` messages; **no** `assistant`. Tool-message count roughly tracks on-disk `toolResult` count (import stored results as messages).

---

## Root-cause summary

| ID | Subclass | Root cause class | Mechanism |
|---|---|---|---|
| A | Grok 459 | **Source incompleteness** | `grok-build-plan` sessions with only system+user on disk; adapter OK |
| B | OMP 73 | **Adapter / import wiring** | `parseTranscriptUnit` ignores custom `backfill`; generic JSONL drops tool_calls and assistant-less tool turns; tools → `messages.role=tool` |
| C | Other 6 | Thin / partial capture | User-only rows |

**Not root causes:**

- Precheck “too strict” for correct structured evidence (keep rules already fire on Grok keep + would fire on fixed OMP).
- Grok omitting assistant under another role (on-disk types confirm absence).

---

## Recommended B7 primary path

### **B7-adapter (primary)** — single recommended path

1. **Wire OMP `parseTranscriptUnit` (and preferably `planTranscriptUnits` if needed) through `backfillOmpSource`**, same pattern as Grok (`transcriptUnit` overrides both plan + parse). Minimum fix: `parseTranscriptUnit` must not call `backfillLocalSource`.
2. **Regression test:** import path / `parseTranscriptUnit` on a fixture with assistant(thinking+toolCall) + toolResult must yield `tool_call` + `tool_result` rows and sourceRecordKeys with suffixes; quality precheck → `keep` / `substantial_tool_work`.
3. **Repair e2e/production OMP sessions:** re-import or import-repair so structured tools land; re-run quality reconcile (evidence revision).
4. **Do not** loosen precheck to keep Grok user-only shells.
5. **Optional migration convenience (not primary):** if re-import is deferred, a temporary precheck count of `messages.role='tool'` can drain OMP review — but mark as migration-only and still schedule adapter repair so authoring/transcript UI see real tool_calls.

### Explicitly not primary: B7-precheck-only

Counting `role=tool` as tool work without fixing ingest:

- Unsticks ~70 OMP rows but leaves **authoring/MCP/transcript** on a lie (no tool_calls table).
- Does nothing for 459 Grok.
- Risks future adapters that legitimately store tool narrative as messages.

### Split for later issues (not B7 code here)

| Follow-on | Action |
|---|---|
| B3 bulk disposition | Fail/suppress Grok incomplete 459 + residual 2 OMP + 6 others |
| B8 aging (if approved) | Auto Not Added for long-lived incomplete review with unchanged evidence |
| Optional B7a | After OMP fix: consider emitting synthetic assistant placeholders from thinking-only turns for narrative — **not required** for keep once tools are structured |

---

## Safe-to-auto-keep matrix (acceptance)

| Subclass | n | Safe to auto-keep? | Recommended disposition |
|---|---:|---|---|
| Grok incomplete (system+user only, no tools) | 459 | **No** | Stay review → bulk Not Added / aging |
| OMP after adapter re-ingest (≥4 structured tools + user) | 71 | **Yes** | Auto keep via existing precheck |
| OMP residual thin | 2 | **No** | Review / bulk fail |
| OMP current DB shape (role=tool only) | 73 | **No** (for quality authoring) | Fix capture first |
| cursor / claude_code / opencode user-only | 6 | **No** | Review / bulk fail |

---

## Evidence references (code)

| Area | Path |
|---|---|
| Precheck | `src/workbench/qualityPrecheck.ts` |
| Coverage | `src/daemon/db/sessionTranscriptRepository.ts` (`getTranscriptCoverage`) |
| OMP custom backfill | `src/adapters/omp/adapter.ts` (`backfillOmpSource`, `ompRecordsFromPayload`) |
| OMP generic leak | `src/adapters/generic/localAdapterFactory.ts` (`parseTranscriptUnit` → `backfillLocalSource`) |
| Import uses parse | `src/daemon/server.ts` (~1498), `src/daemon/import/importWorkUnitRunner.ts` |
| Grok (correct dual override) | `src/adapters/grok/adapter.ts` + `transcriptUnit.ts` |
| Ingest of kinds | `src/daemon/db/sessionRepository.ts` (`tool_call` / `tool_result` / `message`) |

---

## Acceptance checklist (B1)

- [x] Written diagnosis with evidence tables.
- [x] Single recommended primary fix path for B7: **adapter (OMP parseTranscriptUnit wiring + re-ingest)**.
- [x] Explicit safe-to-auto-keep yes/no per subclass.
- [x] e2e DB read-only; no B7 code changes in this issue.
