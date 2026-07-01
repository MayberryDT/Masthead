# Headline Enrichment Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. If subagents are unavailable, use `superpowers:executing-plans`. Keep checkbox state current as each task completes.

**Last optimized:** 2026-07-01 with `plan-optimizer`.

**Goal:** Make Masthead session headlines and Logbook titles reliable enough to be a product selling point by fixing failure storms, improving canonical facts, making deterministic enrichment concrete, and ensuring remote AI failures fail softly.

**Architecture:** Masthead remains local-first and harness-neutral. Remote AI copy is an optional enrichment layer over canonical session data, not the source of truth. Deterministic enrichment must produce useful Now and Logbook copy when remote enrichment is disabled, slow, invalid, or unavailable.

**Tech Stack:** TypeScript, Node daemon, SQLite repositories, Vite React UI, Vitest, existing Masthead enrichment pipeline.

---

## Optimization Record

Rubric used by `plan-optimizer`:

| Criterion | Weight | High-quality bar | Final score |
| --- | ---: | --- | ---: |
| Reproduction and measurement | 15 | The plan starts with fixtures and metrics that reproduce `AI headline failed`, weak Logbook titles, failed enrichment storms, and missing file effects. | 15 |
| Architecture fit | 15 | The plan keeps canonical data primary, remote AI optional, and product hierarchy aligned with Masthead as a session data layer. | 14 |
| Root-cause completeness | 20 | The plan covers live copy, durable enrichment, failure backoff, transcript facts, git snapshots, deterministic copy, Logbook fallback, diagnostics, and repair. | 19 |
| Sequencing and TDD | 15 | The work is ordered by dependency, each phase has tests before implementation, and high-risk changes are isolated. | 15 |
| Data safety and privacy | 15 | The plan avoids automatic real DB mutation, limits path leakage, preserves local-first behavior, and provides rollback controls. | 15 |
| Operability and rollout | 10 | The plan includes health diagnostics, manual re-enrichment, rollout gates, and post-change verification. | 9 |
| Specificity for implementers | 10 | The plan names files, tests, invariants, commands, and acceptance thresholds. | 8 |

Score trajectory:

```text
83 -> 91 -> 95 -> 95
```

Accepted optimizer changes:

- Added a baseline fixture and health phase before code changes.
- Added a shared title/copy quality helper so weak-title logic is not duplicated across enrichment, Logbook, live projection, and UI.
- Added explicit use of existing `session_enrichments` uniqueness for failed-row dedupe.
- Added a git-snapshot-to-file-effects path because `masthead-git-observer` raw records existed but durable `file_effects` were empty.
- Added rollout gates, rollback levers, and stronger post-change health thresholds.

---

## Current Failure Model

The investigation found two overlapping failures.

1. The Now session card can display `AI headline failed` when live OpenAI headline refresh fails validation or times out.
2. Durable Logbook enrichment is weak because canonical facts are often too sparse, so deterministic and remote enrichment both start from generic inputs.

Observed data in `/home/tyler/.local/share/masthead-dev/masthead.sqlite`:

- 402 non-deleted sessions.
- 2,780 failed OpenAI `session_capsule` rows on 2026-07-01.
- 2,141 failures were `timeout`.
- 638 failures were `validation_failed`.
- 347 of 397 current session capsules contained weak patterns such as `codex hook event`, `session narrative`, or `recent activity`.
- 326 sessions had no title.
- 66 sessions had title `Codex hook event`.
- 297 sessions had no project.
- 0 sessions had durable `file_effects`.
- 136 sessions had messages.
- 3,041 `masthead-git-observer` raw records existed, but they did not populate durable file effects.

Primary code paths:

- `src/ui/SessionCard.tsx` displays the copy refresh failure badge.
- `src/core/openaiSessionCopy.ts` rewrites live session card copy and validates model output.
- `src/core/sessionCopy.ts` validates live copy quality.
- `src/enrichment/openAIProvider.ts` performs durable OpenAI enrichment and currently defaults to a 2 second timeout.
- `src/enrichment/enrichmentCoordinator.ts` retries failed enrichments and currently makes repeated failed fingerprints too easy.
- `src/daemon/db/enrichmentRepository.ts` already upserts by `(session_id, enrichment_kind, prompt_version, content_fingerprint)`.
- `src/daemon/db/migrations/001_initial.sql` confirms that unique key, so stable failed fingerprints can dedupe without a schema migration.
- `src/daemon/server.ts` wires both live copy and durable enrichment.
- `src/daemon/config.ts` currently couples remote behavior through `llmCopyEnabled`.
- `src/daemon/db/sessionRepository.ts` stores transcript messages and tool calls, and only writes `file_effects` from normalized `file.changed` events.
- `src/daemon/server.ts` stores `masthead-git-observer` raw git snapshots separately from durable file effects.
- `src/enrichment/sessionFacts.ts` builds facts from messages, commands, files, checkpoints, and narrative facts.
- `src/enrichment/sessionNarrativeFacts.ts` builds richer narrative facts but depends on useful canonical rows.
- `src/enrichment/sessionNarrativeDraft.ts` can fall back to generic deterministic phrases.
- `src/enrichment/sessionCompiler.ts` builds the canonical session capsule.
- `src/enrichment/__tests__/titleQuality.test.ts` already contains useful title-quality regression coverage and should be extended.
- `src/daemon/db/sessionQueryRepository.ts` chooses Logbook titles and must filter weak candidates.

---

## Product Constraints

- Masthead is a canonical session database first, then Logbook/search, read-only MCP, live Now view, and source/import administration.
- Do not turn this into a live monitoring console or AI-first copy generator.
- Remote AI must never be required for useful Logbook headlines.
- Read-only diagnostics and plans are allowed by project instruction, but implementation must not mutate real user data without explicit operator action.
- UI verification must use `npm run dev` and the Codex in-app Browser when visual behavior is affected.

---

## Definition Of Done

The implementation is done when all of these are true:

- `OPENAI_API_KEY` alone does not enable durable remote enrichment.
- Live AI copy and durable remote enrichment can be enabled and disabled independently.
- Durable OpenAI enrichment uses a configurable timeout, defaulting to a realistic durable value, not 2 seconds.
- Repeated remote failures for unchanged facts do not create unbounded failed rows.
- The coordinator backs off recent failed enrichments for unchanged facts.
- Validation failure details are retained in a diagnostic field or message visible to health tooling.
- Transcript imports can derive safe file effects and command summaries from representative tool calls.
- Git snapshots from `masthead-git-observer` produce durable `file_effects` or an equivalent canonical fact source used by enrichment.
- Deterministic enrichment produces concrete titles from user intent, files, commands, or git facts.
- Now cards do not prominently show `AI headline failed` when acceptable fallback copy exists.
- Logbook rows and inspector titles skip weak enrichment titles in favor of better local candidates.
- A read-only health diagnostic reports weak-title rate, failed enrichment rate, duplicate failure patterns, missing file-effect coverage, and remote enrichment state.
- A controlled re-enrichment path can repair existing weak sessions without automatic startup mutation.
- Targeted tests, typecheck, surface contract, and Browser verification pass.

---

## Non-Goals

- Do not add a new remote provider.
- Do not loosen validation to accept low-quality AI output.
- Do not auto-run remote re-enrichment on startup.
- Do not rewrite the full import system.
- Do not add broad analytics or monitoring features beyond the focused enrichment health diagnostic.
- Do not expose private absolute paths or secrets in canonical facts.

---

## Acceptance Thresholds

Use these thresholds for local verification and as future release-gate candidates:

- Failed OpenAI `session_capsule` rows should not increase by more than one row per unchanged session/fingerprint/backoff window.
- Running the same enrichment attempt twice inside the backoff window should not call the remote provider twice.
- Fixture sessions with file/tool/git evidence should produce no titles matching:
  - `Codex hook event`
  - `Session narrative`
  - `Recent activity`
  - `Masthead session`
  - `Untitled session`
- Fixture sessions with only boilerplate should produce an honest fallback and no fake progress claim.
- Sessions with messages plus file/tool/git evidence should have at least one concrete title candidate.
- Session cards with acceptable fallback copy should not render visible `AI headline failed` text.
- The enrichment health diagnostic should report `sessionsWithMessagesButNoEffects` before and after deterministic repair.

---

## Dependency Map

Implementation order matters:

1. Baseline fixtures and health metrics define the failing behavior.
2. Config split prevents new remote failure storms while other fixes land.
3. Timeout, stable failed fingerprints, and backoff contain remote failure cost.
4. Shared quality predicates keep title validation consistent.
5. Transcript and git facts improve canonical data.
6. Narrative and deterministic drafts convert better facts into better copy.
7. Live card and Logbook selection use the shared quality predicates.
8. Diagnostics and re-enrichment repair existing data.
9. Browser verification confirms the product-facing result.

---

## Phase 0: Baseline Reproduction And Measurement

This phase prevents the implementation from drifting into cosmetic fixes. Write or extend tests before changing behavior.

Files:

- `src/enrichment/__tests__/titleQuality.test.ts`
- `src/enrichment/__tests__/enrichmentQualityRegression.test.ts`
- `src/enrichment/__tests__/enrichmentCoordinator.test.ts`
- `src/daemon/db/__tests__/sessionRepository.test.ts`
- `src/daemon/db/__tests__/sessionQueryRepository.test.ts`
- Optional fixture files under `fixtures/enrichment/`

Tasks:

- [ ] Add or extend a regression fixture for a session whose title is `Codex hook event`, with the real user request `work on the headline refreshes and data enrichment`.
- [ ] Add or extend a fixture for a transcript that contains tool calls but no `file.changed` events.
- [ ] Add or extend a fixture for a git snapshot with changed paths such as `src/ui/SessionCard.tsx` and `src/enrichment/enrichmentCoordinator.ts`.
- [ ] Add a coordinator regression test showing repeated failed enrichment attempts currently create or attempt too many failed rows.
- [ ] Add a Logbook regression test showing weak enrichment title candidates must be skipped.
- [ ] Add a live card regression test for visible `AI headline failed` when fallback copy is acceptable.

Preferred test placement:

- Extend `src/enrichment/__tests__/titleQuality.test.ts` for title-source and Logbook quality cases.
- Extend `src/enrichment/__tests__/enrichmentQualityRegression.test.ts` for deterministic headline regressions.
- Add new test files only when an existing file would become confused or too broad.

Verify:

```bash
npm test -- --run \
  src/enrichment/__tests__/titleQuality.test.ts \
  src/enrichment/__tests__/enrichmentQualityRegression.test.ts \
  src/enrichment/__tests__/enrichmentCoordinator.test.ts \
  src/daemon/db/__tests__/sessionRepository.test.ts \
  src/daemon/db/__tests__/sessionQueryRepository.test.ts \
  src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected result:

- New tests should fail before implementation for the behavior they cover.

---

## Phase 1: Preserve The Read-Only Exception Rule

This is already a repo instruction change, but implementation agents should verify it before using the plan.

Files:

- `AGENTS.md`

Tasks:

- [ ] Confirm `AGENTS.md` contains the read-only exception rule:

```md
## Read-Only Run Exceptions

When Tyler asks for a read-only run, do not change product code, data, or runtime state.
Writing implementation plans and concise GBrain session closeouts is still allowed unless Tyler
explicitly excludes them.
```

- [ ] Do not make further instruction changes unless Tyler asks.

Verify:

```bash
rg -n "Read-Only Run Exceptions|GBrain session closeouts" AGENTS.md
```

Expected result:

- The exception exists exactly once.

---

## Phase 2: Split Live Copy From Durable Remote Enrichment

Remote live card copy and durable remote enrichment have different latency, durability, and UX requirements. Split the config so a key does not accidentally create a durable failure storm.

Files:

- `src/daemon/config.ts`
- `src/daemon/server.ts`
- `src/daemon/settingsService.ts`
- `src/daemon/__tests__/config.test.ts`
- Any app DTO or shared type that exposes enrichment settings.
- Documentation or setup copy if it currently describes enrichment setup.

Design:

- Keep backward compatibility for `MASTHEAD_LLM_COPY`.
- Add explicit live setting:
  - `MASTHEAD_LIVE_COPY=1|0`
- Add explicit durable remote setting:
  - `MASTHEAD_REMOTE_ENRICHMENT=1|0`
- Do not auto-enable durable remote enrichment solely because `OPENAI_API_KEY` exists.
- Specific flags override legacy flags.
- Legacy `MASTHEAD_LLM_COPY=1` enables both only when no specific flag is set.
- Remote enabled without an API key should surface a disabled/setup-needed state, not silently create provider failures.

Precedence table:

| Env state | `liveCopyEnabled` | `remoteEnrichmentEnabled` |
| --- | --- | --- |
| no key, no flags | false | false |
| `OPENAI_API_KEY` only | true, if existing live-copy behavior requires it | false |
| `MASTHEAD_LIVE_COPY=0` plus key | false | false unless remote flag is set |
| `MASTHEAD_LIVE_COPY=1` plus key | true | false unless remote flag is set |
| `MASTHEAD_REMOTE_ENRICHMENT=1` plus key | live follows live rules | true |
| `MASTHEAD_REMOTE_ENRICHMENT=0` plus key | live follows live rules | false |
| `MASTHEAD_LLM_COPY=1` plus key | true unless `MASTHEAD_LIVE_COPY=0` | true unless `MASTHEAD_REMOTE_ENRICHMENT=0` |

Suggested type shape:

```ts
export interface DaemonConfig {
  // existing fields...
  liveCopyEnabled: boolean;
  remoteEnrichmentEnabled: boolean;
  remoteEnrichmentTimeoutMs: number;

  /**
   * Deprecated compatibility alias. Keep only if removing it would cause a wide
   * churn. New code should use liveCopyEnabled or remoteEnrichmentEnabled.
   */
  llmCopyEnabled?: boolean;
}
```

Suggested parsing shape:

```ts
const legacyLlmCopy = readBooleanEnv(env.MASTHEAD_LLM_COPY);

const liveCopyEnabled =
  readBooleanEnv(env.MASTHEAD_LIVE_COPY) ??
  legacyLlmCopy ??
  Boolean(env.OPENAI_API_KEY);

const remoteEnrichmentEnabled =
  readBooleanEnv(env.MASTHEAD_REMOTE_ENRICHMENT) ??
  legacyLlmCopy ??
  false;
```

Server wiring:

```ts
const sessionCopyEnricher = createOpenAISessionCopyEnricher({
  enabled: config.liveCopyEnabled,
  apiKey: config.openaiApiKey,
  model: config.openaiModel,
  ttlMs: config.liveCopyCacheMs,
  timeoutMs: config.liveCopyTimeoutMs,
  projectionBudgetMs: config.liveCopyProjectionBudgetMs,
  maxConcurrent: config.liveCopyMaxConcurrent && config.liveCopyMaxConcurrent > 0 ? config.liveCopyMaxConcurrent : undefined
});

const enrichmentProvider = config.remoteEnrichmentEnabled
  ? createOpenAIEnrichmentProvider({
      apiKey: config.openaiApiKey,
      enabled: true,
      model: config.openaiModel,
      timeoutMs: config.remoteEnrichmentTimeoutMs
    })
  : createDeterministicEnrichmentProvider();
```

Tests:

- [ ] `OPENAI_API_KEY` alone does not enable durable remote enrichment.
- [ ] `OPENAI_API_KEY` alone preserves the intended live copy behavior.
- [ ] `MASTHEAD_REMOTE_ENRICHMENT=1` enables durable remote enrichment when a key exists.
- [ ] `MASTHEAD_REMOTE_ENRICHMENT=0` disables durable remote enrichment even when `MASTHEAD_LLM_COPY=1`.
- [ ] `MASTHEAD_LIVE_COPY=0` disables live copy even when a key exists.
- [ ] `MASTHEAD_LLM_COPY=1` keeps backward compatibility when no specific flags are set.
- [ ] Settings or health DTOs report local deterministic enrichment separately from remote enrichment availability.

Verify:

```bash
npm test -- --run src/daemon/__tests__/config.test.ts src/ui/settings/__tests__/SettingsSurface.test.tsx
```

Expected result:

- Config tests document the new precedence.
- Settings copy does not imply remote enrichment is required for useful local enrichment.

---

## Phase 3: Configure Durable OpenAI Timeout And Failure Detail

The durable provider should have a durable timeout and enough failure detail to diagnose validation failures.

Files:

- `src/enrichment/openAIProvider.ts`
- `src/daemon/config.ts`
- `src/daemon/server.ts`
- `src/enrichment/enrichmentAudit.ts`
- `src/enrichment/types.ts`
- `src/enrichment/__tests__/openAIProvider.test.ts`
- `src/daemon/__tests__/config.test.ts`

Design:

- Keep a provider-level fallback constant, but daemon wiring must pass an explicit durable timeout.
- Add env:
  - `MASTHEAD_REMOTE_ENRICHMENT_TIMEOUT_MS`
- Suggested default:
  - `12_000` ms for durable enrichment.
- Keep live card copy timeout separate from durable timeout.
- Persist or expose validation failure detail in a bounded field:
  - `failure_code = "validation_failed"`
  - `failure_message` should include a short validator reason.
  - If richer detail is needed, put bounded structured detail in `source_refs_json` or a typed diagnostic field, not an unbounded raw model output.
- Do not store raw provider output when validation fails unless existing redaction and size bounds make that safe.

Tests:

- [ ] Config default durable timeout is 12 seconds.
- [ ] Env override is honored.
- [ ] Invalid timeout values follow existing config validation behavior.
- [ ] Provider uses passed timeout instead of the 2 second fallback.
- [ ] Validation failures return a bounded diagnostic reason.
- [ ] Timeout failures return `failure_code = "timeout"`.

Verify:

```bash
npm test -- --run src/daemon/__tests__/config.test.ts src/enrichment/__tests__/openAIProvider.test.ts
```

Expected result:

- Durable provider tests prove configured timeout and diagnostic detail.

---

## Phase 4: Add Failed Enrichment Dedupe And Backoff

The schema already supports dedupe if `content_fingerprint` is stable. Use that instead of adding a migration.

Files:

- `src/enrichment/enrichmentCoordinator.ts`
- `src/daemon/db/enrichmentRepository.ts`
- `src/enrichment/__tests__/enrichmentCoordinator.test.ts`
- `src/daemon/db/__tests__/enrichmentRepository.test.ts`

Existing schema fact:

```sql
UNIQUE (session_id, enrichment_kind, prompt_version, content_fingerprint)
```

Design:

- Failed fingerprint must be stable for the same facts and status:

```ts
const failedFingerprint = `${fingerprint}:failed:${result.status}`;
```

- Remove `generatedAt` from failed fingerprints.
- Add a failure backoff window.
- Suggested default:
  - 10 minutes.
- Inject a clock and optional backoff duration if existing tests already use that pattern.
- `ensureCurrent` should skip provider calls when the latest failed row has the same base fact fingerprint and is still inside backoff.
- Return the latest failed row during backoff so callers can surface status if needed.
- Retry immediately when facts change.

Pseudo-flow:

```ts
const current = repository.readCurrentSessionEnrichment(...);
if (current?.factFingerprint === fingerprint) {
  return current;
}

const latestFailed = repository.readLatestFailedSessionEnrichment(...);
if (isSameFailedFacts(latestFailed, fingerprint) && isWithinBackoff(latestFailed.generatedAt, now)) {
  return latestFailed;
}

return enrich(sessionId, facts);
```

Tests:

- [ ] `enrich` writes a stable failed fingerprint without `generatedAt`.
- [ ] A repeated provider failure for the same facts updates the existing failed row through the unique key.
- [ ] `ensureCurrent` does not call provider when latest failed row is within backoff and facts are unchanged.
- [ ] `ensureCurrent` calls provider again after backoff expires.
- [ ] `ensureCurrent` calls provider immediately when facts changed.
- [ ] Current successful enrichment still wins over older failed rows.
- [ ] Disabled provider status does not cause noisy retry loops.

Verify:

```bash
npm test -- --run src/enrichment/__tests__/enrichmentCoordinator.test.ts src/daemon/db/__tests__/enrichmentRepository.test.ts
```

Expected result:

- Backoff and dedupe behavior is covered without real time.

---

## Phase 5: Centralize Title And Copy Quality Predicates

Several surfaces need to agree on what counts as weak copy. A shared pure helper prevents drift between deterministic enrichment, Logbook, live projection, and UI badge behavior.

Files:

- Candidate new file: `src/shared/sessionTextQuality.ts`
- `src/enrichment/sessionCompiler.ts`
- `src/enrichment/sessionNarrativeDraft.ts`
- `src/core/replay.ts`
- `src/core/sessionCopy.ts`
- `src/daemon/db/sessionQueryRepository.ts`
- `src/ui/SessionCard.tsx`
- `src/enrichment/__tests__/titleQuality.test.ts`
- Candidate new test file: `src/shared/__tests__/sessionTextQuality.test.ts`

Design:

- Keep the helper dependency-free so core, daemon, enrichment, and UI can import it safely.
- Start with specific weak phrases observed in the DB and tests.
- Do not reject valid short titles just because they are short.
- Separate title usefulness from summary usefulness.
- Preserve existing validator strictness for AI-generated live copy.

Suggested API:

```ts
export function isWeakSessionTitle(value: string | null | undefined): boolean;
export function isUsefulSessionTitle(value: string | null | undefined): boolean;
export function isWeakLiveSummary(value: string | null | undefined): boolean;
export function firstUsefulSessionTitle(candidates: Array<string | null | undefined>): string | undefined;
export function hasAcceptableDisplayCopy(input: {
  title?: string | null;
  headline?: string | null;
  summary?: string | null;
}): boolean;
```

Weak phrases to include initially:

- `Codex hook event`
- `Codex session`
- `Masthead Codex session`
- `Session narrative`
- `Recent activity`
- `This project`
- `Current work`
- `Untitled session`
- `Masthead session`
- `Ready for review` when it appears as a review-template summary with no concrete noun.

Tests:

- [ ] Weak observed titles are rejected.
- [ ] Concrete titles like `Repair OAuth callback title quality` are accepted.
- [ ] Concrete file-area titles like `Session card headline refresh` are accepted.
- [ ] Review-template summaries with no object are rejected.
- [ ] Useful provider live summaries are accepted even when provider title is weak.

Verify:

```bash
npm test -- --run src/shared/__tests__/sessionTextQuality.test.ts src/enrichment/__tests__/titleQuality.test.ts
```

Expected result:

- All title and copy selection code can share one quality vocabulary.

---

## Phase 6: Derive Canonical Effects From Transcript Tool Calls

Transcript imports currently store messages and tool calls, but often do not produce durable file effects. Enrichment needs those concrete nouns.

Files:

- `src/daemon/db/sessionRepository.ts`
- Candidate new file: `src/daemon/db/transcriptEffects.ts`
- `src/daemon/db/__tests__/sessionRepository.test.ts`
- Candidate new test file: `src/daemon/db/__tests__/transcriptEffects.test.ts`

Design:

- Parse transcript tool call arguments as structured JSON whenever possible.
- Derive file effects from common keys:
  - `path`
  - `file`
  - `filePath`
  - `filename`
  - `files`
  - `paths`
  - `target`
  - `workdir` only as context, not an effect path by itself.
- Derive file effects from commands when safe:
  - `apply_patch` hunks.
  - `git diff -- path`.
  - `sed`, `rg`, `cat`, `nl`, `ls` path arguments when they point inside the project.
  - Tool arguments that contain patch text.
- Derive command summaries from:
  - `command`
  - `cmd`
  - `normalizedCommand`
  - known shell command arrays.
- Keep redaction strict:
  - Do not persist credentials or environment values.
  - Avoid storing full absolute home paths.
  - Prefer repo-relative paths when path is inside the workspace.
  - Reject private absolute paths that cannot be normalized safely.
- Effects should be bounded:
  - Limit per transcript import, for example 200 effects.
  - Deduplicate by session, path, operation, and observed time bucket if needed.

Suggested helper API:

```ts
export interface DerivedTranscriptEffect {
  filePath: string;
  effectKind: "added" | "modified" | "deleted" | "read" | "inspected" | "unknown";
  source: "tool_call" | "tool_result" | "patch" | "command";
  observedAt?: string;
  sourceRefJson: unknown;
}

export interface DerivedTranscriptCommand {
  command: string;
  summary: string;
  observedAt?: string;
}

export function deriveTranscriptEffects(input: TranscriptEffectInput): {
  fileEffects: DerivedTranscriptEffect[];
  commands: DerivedTranscriptCommand[];
};
```

Important:

- If `file_effects.effect_kind` already has looser values, map to existing values instead of changing the schema.
- Do not store read-only inspections as write effects.
- Do not parse shell commands with a brittle full shell parser. Use conservative extraction and prefer structured tool args.

Tests:

- [ ] Tool call arguments with `{"filePath":"src/ui/SessionCard.tsx"}` create a file effect.
- [ ] `apply_patch` text creates write effects for updated files.
- [ ] Shell command args create command summaries.
- [ ] Duplicate references dedupe.
- [ ] Absolute paths under the workspace are stored as repo-relative paths.
- [ ] Absolute paths outside the workspace are rejected or safely summarized.
- [ ] Secret-looking values in args are not persisted.
- [ ] `rg` or `sed` inspection creates a read/inspect effect, not a modification.

Verify:

```bash
npm test -- --run src/daemon/db/__tests__/transcriptEffects.test.ts src/daemon/db/__tests__/sessionRepository.test.ts
```

Expected result:

- Transcript import produces canonical facts that enrichment can use.

---

## Phase 7: Promote Git Snapshots Into Durable File Effects

The active DB had many `masthead-git-observer` raw records but zero durable `file_effects`. That is a direct data-enrichment gap.

Files:

- `src/daemon/server.ts`
- Candidate new file: `src/daemon/db/gitSnapshotEffectsRepository.ts`
- `src/daemon/__tests__/gitSnapshots.test.ts`
- Candidate new test file: `src/daemon/db/__tests__/gitSnapshotEffectsRepository.test.ts`
- `src/core/__tests__/ingestServer.test.ts`, only if an integration test is needed.

Design:

- Convert each `GitSnapshot.changedPaths[]` entry into a durable `file_effects` row.
- Store `changedPath.path` as the effect path.
- Do not store `repoRoot`, `worktreePath`, or `gitCommonDir` in public path fields.
- Preserve status, staged flag, additions, deletions, observed time, and snapshot id in bounded `source_ref_json`.
- Call the repository after a new git snapshot is appended.
- Make the conversion idempotent using existing `file_effects` unique key:
  - `(session_id, path, effect_kind, observed_at)`
- If multiple snapshots have the same path and observed time but different additions/deletions, prefer the latest raw snapshot in `source_ref_json` or use a stable observed timestamp per snapshot.

Suggested function:

```ts
export function upsertFileEffectsFromGitSnapshot(db: MastheadDatabase, snapshot: GitSnapshot): number;
```

Suggested call site:

```ts
async function appendGitSnapshotIfChanged(gitSnapshot: GitSnapshot): Promise<boolean> {
  const appended = await appendRawSnapshot(...);
  if (appended) {
    upsertFileEffectsFromGitSnapshot(database, gitSnapshot);
  }
  return appended;
}
```

Tests:

- [ ] A git snapshot with changed paths inserts matching `file_effects`.
- [ ] Re-appending the same snapshot does not duplicate file effects.
- [ ] Sensitive path-only snapshots do not leak private repo/worktree roots.
- [ ] Staged, additions, deletions, and status are preserved when available.
- [ ] Live projection still receives git snapshots after the repository write is added.

Verify:

```bash
npm test -- --run src/daemon/db/__tests__/gitSnapshotEffectsRepository.test.ts src/daemon/__tests__/gitSnapshots.test.ts
```

Expected result:

- Git observer data becomes durable enrichment input.

---

## Phase 8: Improve Narrative Fact Selection

Once transcript and git facts exist, narrative facts should prefer concrete project work over boilerplate imported context.

Files:

- `src/enrichment/sessionFacts.ts`
- `src/enrichment/sessionNarrativeFacts.ts`
- `src/enrichment/workSubject.ts`
- `src/enrichment/__tests__/sessionNarrativeFacts.test.ts`
- `src/enrichment/__tests__/titleQuality.test.ts`

Design:

- Include top file paths and changed areas from `file_effects`.
- Include meaningful command summaries from imported tool calls.
- Include git-derived file effects exactly like transcript-derived effects.
- Exclude boilerplate user-message content:
  - AGENTS.md instruction blocks.
  - environment context blocks.
  - long pasted project instructions.
  - generic hook events.
  - source setup boilerplate.
- Prefer user intent from:
  - first non-boilerplate user prompt,
  - latest explicit user request,
  - objective,
  - stored title only if useful.
- Use the shared quality helper from Phase 5.

Tests:

- [ ] Facts include file paths derived from `file_effects`.
- [ ] Facts include command summaries when present.
- [ ] Facts skip AGENTS.md and environment boilerplate as subject candidates.
- [ ] Facts choose the first real user request when a transcript begins with project instructions.
- [ ] Facts avoid weak titles as subject candidates.
- [ ] Facts include git-derived file effects from `masthead-git-observer` records.

Verify:

```bash
npm test -- --run src/enrichment/__tests__/sessionNarrativeFacts.test.ts src/enrichment/__tests__/titleQuality.test.ts
```

Expected result:

- Narrative facts expose concrete nouns needed for useful headlines.

---

## Phase 9: Harden Deterministic Narrative Drafts

The deterministic fallback should produce useful copy without AI. It should never settle for `Session narrative is active in this project` when user intent, file paths, commands, or git facts exist.

Files:

- `src/enrichment/sessionNarrativeDraft.ts`
- `src/enrichment/sessionCompiler.ts`
- `src/enrichment/__tests__/sessionNarrativeDraft.test.ts`
- `src/enrichment/__tests__/enrichmentQualityRegression.test.ts`
- `src/enrichment/__tests__/titleQuality.test.ts`

Design:

- Use shared title quality predicates before accepting any generated title.
- Prefer deterministic titles in this order:
  1. Real user request summarized into a concise title.
  2. File or area based title.
  3. Command or workflow based title.
  4. Existing objective/title if useful.
  5. Honest last-resort fallback.
- If using a last-resort fallback, use something honest and less product-facing, such as `Session details unavailable`.
- Record `titleSource` so debugging can tell whether the title came from message, files, objective, provider, or fallback.
- Add `validationWarnings` when a title had to fall back.

Regression cases:

- Input with file effects for `src/ui/SessionCard.tsx` should mention session cards or the file area.
- Input with request text `work on the headline refreshes and data enrichment` should produce a headline about headline refreshes and data enrichment.
- Input with git effects for `src/enrichment/enrichmentCoordinator.ts` should mention enrichment coordination or enrichment reliability.
- Input with only hook boilerplate should not claim meaningful progress.
- Provider title `Codex session` plus useful live summary should keep the useful summary and reject the weak title.

Verify:

```bash
npm test -- --run \
  src/enrichment/__tests__/sessionNarrativeDraft.test.ts \
  src/enrichment/__tests__/enrichmentQualityRegression.test.ts \
  src/enrichment/__tests__/titleQuality.test.ts
```

Expected result:

- Deterministic enrichment is concrete enough for Logbook even when remote AI is disabled.

---

## Phase 10: Make Live Headline Refresh Fail Softly

Now cards should not make remote AI failure the most visible state when acceptable deterministic or durable copy exists.

Files:

- `src/core/openaiSessionCopy.ts`
- `src/core/sessionCopy.ts`
- `src/core/replay.ts`
- `src/ui/SessionCard.tsx`
- `src/core/__tests__/openaiSessionCopy.test.ts`
- `src/core/__tests__/projection.test.ts`
- `src/ui/__tests__/observabilitySessionCard.test.tsx`

Design:

- Keep validation strict.
- Preserve previous good copy when refresh fails.
- Add or surface structured failure detail:

```ts
export interface SessionCopyRefreshState {
  status: "idle" | "refreshing" | "applied" | "failed";
  failureReason?: "timeout" | "validation_failed" | "api_error" | "disabled";
  validationReason?: string;
  attemptedAt?: string;
}
```

- UI behavior:
  - If copy quality is acceptable and refresh failed, do not render prominent `AI headline failed` text.
  - Keep diagnostics available in a tooltip, aria label, debug detail, or non-prominent status if the existing UI has an appropriate place.
  - If there is no acceptable fallback copy, show a clear but non-alarming failure state.
- Add a per-session and per-fingerprint live copy cooldown so unchanged validation failures do not churn every projection refresh.
- The card title should remain the best available title, not the failed model output.

Suggested UI rule:

```ts
const shouldShowCopyFailureBadge =
  copyRefresh.status === "failed" &&
  !hasAcceptableDisplayCopy(session.copy);
```

Tests:

- [ ] Validation failure preserves existing display copy.
- [ ] Validation reason is available for diagnostics.
- [ ] Session card does not show visible `AI headline failed` when fallback copy is acceptable.
- [ ] Session card shows a subdued failure state when no acceptable copy exists.
- [ ] Repeated projection calls within cooldown do not call the live OpenAI copy provider again for unchanged facts.
- [ ] Existing accessibility labels still expose enough state for diagnostics.

Verify:

```bash
npm test -- --run \
  src/core/__tests__/openaiSessionCopy.test.ts \
  src/core/__tests__/projection.test.ts \
  src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected result:

- Remote AI failure no longer dominates the Now card UX.

---

## Phase 11: Make Logbook Title Selection Quality-Aware

Logbook should not blindly prefer weak enrichment titles over better objectives, summaries, stored titles, or derived subjects.

Files:

- `src/daemon/db/sessionQueryRepository.ts`
- `src/enrichment/__tests__/titleQuality.test.ts`
- `src/daemon/db/__tests__/sessionQueryRepository.test.ts`
- `src/ui/logbook/__tests__/LogbookInspector.test.tsx`

Design:

- Use the shared quality helper from Phase 5.
- Filter weak candidates before selection.
- Candidate order:
  1. Non-weak enrichment title.
  2. Non-weak objective.
  3. Non-weak stored session title.
  4. Non-weak enrichment live summary.
  5. Non-weak enrichment subject or search summary if already available in the DTO.
  6. Conservative fallback.
- Do not expand Logbook queries to scan full messages unless tests prove the enrichment layer cannot supply enough candidates.

Suggested shape:

```ts
const title = firstUsefulSessionTitle([
  enrichment?.title,
  row.objective,
  row.title,
  enrichment?.liveSummary,
  enrichment?.subject,
  enrichment?.searchSummary
]) ?? "Untitled session";
```

Tests:

- [ ] Weak enrichment title is skipped in favor of objective.
- [ ] Weak objective is skipped in favor of stored title.
- [ ] Useful live summary beats weak stored title.
- [ ] Good enrichment title still wins.
- [ ] Empty and whitespace candidates fallback predictably.
- [ ] Logbook inspector uses the same selected title semantics as the row where applicable.

Verify:

```bash
npm test -- --run \
  src/enrichment/__tests__/titleQuality.test.ts \
  src/daemon/db/__tests__/sessionQueryRepository.test.ts \
  src/ui/logbook/__tests__/LogbookInspector.test.tsx
```

Expected result:

- Logbook stops surfacing generic enrichment titles when better local data exists.

---

## Phase 12: Add Enrichment Health Diagnostics

Add or extend a read-only diagnostic that reports the exact failure modes from the investigation.

Files:

- `src/daemon/settingsService.ts`
- Candidate new script: `scripts/masthead-enrichment-health.js`
- `src/daemon/__tests__/settingsService.test.ts`, if present.
- Candidate script test if the repo has script test conventions.
- `docs/acceptance/product-release-gate.md`, if this becomes a release gate.

Design:

- Prefer extending existing `settingsService.enrichmentHealth` before adding a separate script-only implementation.
- Script must be read-only.
- Inputs:
  - optional DB path,
  - optional recent session count,
  - optional JSON output.
- Metrics:
  - session count,
  - current enrichment count by source and kind,
  - failed enrichment count by source, kind, and status,
  - repeated failed fingerprints,
  - weak current titles,
  - sessions without file effects,
  - sessions with messages but no effects,
  - git snapshots without corresponding file effects,
  - remote enrichment enabled state,
  - durable remote timeout.
- Exit behavior:
  - exit `0` for report-only by default,
  - optional `--fail-on-regression` can exit non-zero for CI later.

Example output:

```text
Masthead enrichment health
Database: /home/tyler/.local/share/masthead-dev/masthead.sqlite
Sessions: 402
Current session capsules: 397
Weak current titles: 347
Failed OpenAI session capsules today: 2780
Timeout failures today: 2141
Validation failures today: 638
Sessions with messages but no file effects: 136
Git snapshots without durable file effects: 3041
Remote enrichment: disabled
Remote timeout: 12000ms
```

Tests:

- [ ] Health service counts weak current titles using shared quality helper.
- [ ] Health service counts failed enrichments by status.
- [ ] Health service counts sessions with messages but no file effects.
- [ ] Health service counts git snapshot coverage gap.
- [ ] Script or API report does not write to the DB.

Verify:

```bash
node scripts/masthead-enrichment-health.js --db /home/tyler/.local/share/masthead-dev/masthead.sqlite --json
```

Expected result:

- The command reports the current weak-title and failure counts without mutating the DB.

---

## Phase 13: Add A Controlled Re-Enrichment Path

After code fixes ship, existing weak sessions need an intentional repair path. Do not mutate user data automatically on startup.

Files:

- `scripts/masthead-reenrich.js`
- `src/daemon/server.ts`
- Existing tests around `/enrichment/rebuild`, if present.
- Optional docs under `docs/`.

Design:

- Reuse existing `/enrichment/rebuild` tooling if available.
- Add options if missing:
  - `--recent N`
  - `--session SESSION_ID`
  - `--dry-run`
  - `--deterministic-only`
  - `--remote`
  - `--ignore-backoff`, only for explicit operator repair.
- Default should be dry-run or require explicit confirmation when mutating many sessions.
- It should use the same coordinator and backoff rules as normal enrichment unless explicitly overridden.
- Deterministic repair should be possible without `OPENAI_API_KEY`.

Recommended post-deploy manual flow:

```bash
node scripts/masthead-enrichment-health.js --db /home/tyler/.local/share/masthead-dev/masthead.sqlite
node scripts/masthead-reenrich.js --recent 100 --deterministic-only --dry-run
node scripts/masthead-reenrich.js --recent 100 --deterministic-only
node scripts/masthead-enrichment-health.js --db /home/tyler/.local/share/masthead-dev/masthead.sqlite
```

If remote enrichment is explicitly enabled:

```bash
MASTHEAD_REMOTE_ENRICHMENT=1 MASTHEAD_REMOTE_ENRICHMENT_TIMEOUT_MS=12000 node scripts/masthead-reenrich.js --recent 50 --remote
```

Tests:

- [ ] Dry-run does not write enrichments.
- [ ] Deterministic-only path does not call remote provider.
- [ ] Remote path respects backoff.
- [ ] Session-specific re-enrichment only touches the requested session.
- [ ] `--ignore-backoff` is explicit and tested if added.

Verify:

```bash
npm test -- --run src/enrichment/__tests__/enrichmentCoordinator.test.ts
node scripts/masthead-reenrich.js --recent 5 --deterministic-only --dry-run
```

Expected result:

- Operators can repair weak historical sessions intentionally.

---

## Phase 14: Browser And Product Verification

Use the harness-neutral launcher from repo instructions.

Commands:

```bash
npm run dev
```

Then open the app with the Codex in-app Browser plugin and inspect:

- Now view at desktop width.
- Now view at tablet width.
- Now view at narrow mobile width.
- Logbook view at desktop width.
- Logbook view at tablet width.
- Logbook view at narrow mobile width.

Required visual checks:

- Now cards show useful deterministic or durable headlines.
- Now cards do not prominently show `AI headline failed` when useful fallback copy exists.
- Logbook rows show concrete session titles.
- Logbook inspector headline is concrete.
- No `No live connection` state appears when the connector is healthy.
- No UI text overlaps at narrow mobile width.
- The UI does not present Masthead as a live monitoring console.

Suggested seeded verification:

- Use or import a transcript that edits `src/ui/SessionCard.tsx`.
- Confirm the Now or Logbook headline references session cards, headline refresh, or data enrichment.
- Confirm the title is not `Codex hook event`, `Session narrative`, `Recent activity`, `Masthead session`, or `Untitled session`.

Verify commands:

```bash
npm run typecheck
npm run check:surface-contract
```

Expected result:

- Typecheck and surface contract pass.
- Browser verification confirms headline behavior across Now and Logbook.

---

## Full Verification Pass

Run targeted tests first while implementing each phase. Before considering the implementation complete, run:

```bash
npm test -- --run \
  src/daemon/__tests__/config.test.ts \
  src/enrichment/__tests__/openAIProvider.test.ts \
  src/enrichment/__tests__/enrichmentCoordinator.test.ts \
  src/daemon/db/__tests__/enrichmentRepository.test.ts \
  src/shared/__tests__/sessionTextQuality.test.ts \
  src/daemon/db/__tests__/transcriptEffects.test.ts \
  src/daemon/db/__tests__/sessionRepository.test.ts \
  src/daemon/db/__tests__/gitSnapshotEffectsRepository.test.ts \
  src/daemon/__tests__/gitSnapshots.test.ts \
  src/enrichment/__tests__/sessionNarrativeFacts.test.ts \
  src/enrichment/__tests__/sessionNarrativeDraft.test.ts \
  src/enrichment/__tests__/enrichmentQualityRegression.test.ts \
  src/enrichment/__tests__/titleQuality.test.ts \
  src/core/__tests__/openaiSessionCopy.test.ts \
  src/core/__tests__/projection.test.ts \
  src/ui/__tests__/observabilitySessionCard.test.tsx \
  src/daemon/db/__tests__/sessionQueryRepository.test.ts \
  src/ui/logbook/__tests__/LogbookInspector.test.tsx
npm run typecheck
npm run check:surface-contract
```

If a listed new test file is not needed because coverage was added to an existing file, remove it from the command and document where the coverage landed.

---

## Rollback And Safety Levers

- Set `MASTHEAD_REMOTE_ENRICHMENT=0` to disable durable remote enrichment.
- Set `MASTHEAD_LIVE_COPY=0` to disable live AI headline refresh.
- Keep deterministic enrichment available when remote flags are off.
- Do not run `scripts/masthead-reenrich.js` without `--dry-run` until health diagnostics and targeted tests pass.
- If transcript effect extraction over-collects paths, disable the new extraction path behind a narrow config or revert only that module while preserving timeout/backoff fixes.
- If git snapshot file effects over-collect, stop calling `upsertFileEffectsFromGitSnapshot` while keeping raw snapshots available for Now.

---

## Suggested Commit Sequence

1. `test: capture headline enrichment regressions`
2. `config: split live copy and remote enrichment flags`
3. `enrichment: configure durable timeout and failure diagnostics`
4. `enrichment: dedupe failed rows and add backoff`
5. `quality: centralize session title predicates`
6. `ingest: derive transcript file effects`
7. `ingest: persist git snapshot file effects`
8. `enrichment: improve narrative facts and deterministic drafts`
9. `ui: soften live copy refresh failures`
10. `logbook: filter weak session titles`
11. `diagnostics: add enrichment health report`
12. `scripts: control deterministic and remote re-enrichment`

Keep commits smaller if a phase touches too many files to review safely.

---

## Risks And Mitigations

- Risk: Disabling durable remote enrichment by default reduces AI-written copy.
  - Mitigation: deterministic enrichment must improve first, and remote can be explicitly re-enabled.
- Risk: Transcript command parsing leaks private paths or secrets.
  - Mitigation: prefer structured args, normalize workspace-relative paths, reject unsafe absolutes, and test secret-looking values.
- Risk: Git snapshot effects leak repo/worktree roots.
  - Mitigation: store only `changedPath.path` in `file_effects.path`, keep roots out of user-facing fields.
- Risk: Weak-title filtering hides a valid short title.
  - Mitigation: use specific observed bad patterns, not generic length-only rejection.
- Risk: Backoff delays recovery after a transient provider outage.
  - Mitigation: keep default at 10 minutes and retry immediately when facts change.
- Risk: Logbook query expansion becomes expensive.
  - Mitigation: improve enrichment facts first and avoid full message scans in Logbook queries unless tests prove they are necessary.
- Risk: Re-enrichment mutates too much data.
  - Mitigation: dry-run default or explicit confirmation, plus `--session` and `--recent` scopes.

---

## Closeout Checklist

- [ ] All targeted tests pass.
- [ ] `npm run typecheck` passes.
- [ ] `npm run check:surface-contract` passes.
- [ ] `npm run dev` renders healthy Now and Logbook surfaces.
- [ ] In-app Browser screenshots verify desktop, tablet, and narrow mobile behavior.
- [ ] Health diagnostic shows failure storms are contained.
- [ ] Health diagnostic shows file-effect coverage improved for sessions with messages/tool/git evidence.
- [ ] Manual deterministic re-enrichment dry-run reports expected changes.
- [ ] GBrain session closeout records the durable implementation decisions and any rollout caveats.
