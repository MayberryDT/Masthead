# Lifecycle-First Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Track progress with the checkbox items below. Do not implement remote LLM invocation, extra coding-agent adapters, or source-control mutations unless a later plan explicitly adds them.

**Optimized with:** `plan-optimizer`

**Score trajectory:** `78 -> 88 -> 92 -> 93 -> 93`

**Final score:** `93 / 100`

## Goal

Redesign Masthead around session lifecycle truth:

- What is running right now?
- What needs action right now?
- What ended?
- Why did it end?
- What should the user do next?

The board should keep all useful information available, but the first screen should stay quiet. Cards show current lifecycle facts. Details, evidence, review history, and inferred context move into a modal.

## Non-Goals

- Do not add support for Claude Code, Hermes, OpenClaw, Pi, Kilo Code, OpenCode, or other adapters in this pass. Keep core nouns adapter-neutral, but prove the Codex vertical first.
- Do not let an LLM decide whether a session is running.
- Do not enable remote LLM calls by default.
- Do not scrape raw transcripts, full command output, screenshots, browser state, shell history, or full diffs.
- Do not approve Codex actions, stop sessions, launch agents, mutate Git, run shell commands from the app, or change Codex config outside explicit hook-admin flows.
- Do not ship another expanded-card board. The inspection surface is a modal.

## Definition of Done

- A real Codex session appears as `Running` within one UI poll interval after the first hook event.
- A session with newer activity after `dismiss`, `reviewed`, or `expected` never shows that disposition as the primary card state.
- A session is not treated as `ended` because of silence alone. Silence produces `Idle` or `Stale`, unless a terminal event or explicit user disposition ends it.
- Ended sessions are grouped by outcome: `completed`, `needs_attention`, `blocked`, `failed`, `abandoned`, or `unknown`.
- Card fronts show only lifecycle-critical facts: state, recency, project/workspace, changed-file count, and one next action when needed.
- Modal details expose evidence, timeline, worktree state, attention items, conflicts, review history, and safe actions.
- Historical note: the visual redesign originally referenced the now-deleted `DESIGN-MastHead.md`. Current UI work must follow `design.md`.
- `npm test -- --run`, `npm run typecheck`, `npm run build`, and `npm run dogfood:live` pass.
- In-app Browser verification passes at `390`, `768`, `1280`, and the current desktop viewport with no horizontal overflow.

## Optimizer Rubric

| Criterion | Weight | Final | Notes |
| --- | ---: | ---: | --- |
| Lifecycle source of truth | 20 | 19 | Runtime state is deterministic and separated from outcome/review overlays. |
| Evidence and outcome contract | 15 | 14 | Outcomes require inspectable evidence; LLM output is optional and bounded. |
| UI hierarchy and visual restraint | 15 | 14 | Cards are lifecycle-first; modal carries detail; design doc gives concrete tokens. |
| Sequencing and migration safety | 15 | 14 | Adds a compatibility phase before deleting expanded-card contracts. |
| Verification and live dogfood | 20 | 18 | Includes unit, build, browser, and real-live-session gates. |
| Scope control and adapter-neutrality | 15 | 14 | Codex-first implementation with neutral core vocabulary and no speculative adapters. |

## Core Architecture

Masthead must project three independent state layers. Keeping them separate is the main fix for the stale-session problem.

### 1. Runtime Lifecycle

Runtime lifecycle answers whether the session appears active now.

```ts
export type SessionLifecycle = "running" | "idle" | "ended";
```

Rules:

- `running`: the latest non-terminal event is recent, the session is waiting for approval/user input, or the latest event indicates active work.
- `idle`: the session has no terminal event and no recent activity past the configured idle threshold.
- `ended`: a terminal session event exists, or the user explicitly records an abandoned/superseded terminal outcome.
- Never infer `ended` from silence alone.
- Never derive lifecycle from review dispositions or LLM output.

### 2. Ended-Session Outcome

Outcome answers why an ended session ended.

```ts
export type SessionOutcomeLabel =
  | "completed"
  | "needs_attention"
  | "blocked"
  | "failed"
  | "abandoned"
  | "unknown";
```

Rules:

- Outcome is evaluated only when lifecycle is `ended`, or when a future long-idle policy explicitly asks for a review suggestion.
- Deterministic evidence wins over LLM interpretation.
- Missing shell exit status must not be treated as failure.
- Missing verification after source changes should produce `needs_attention`, not `failed`.
- Outcome records should include evidence refs, policy version, and confidence.

### 3. Review Disposition

Review disposition records what the user did locally.

Examples: `dismissed`, `reviewed`, `expected`, `snoozed`, `false_positive`, `abandoned`, `superseded`.

Rules:

- Disposition is a secondary annotation.
- It may suppress a specific attention item only when the underlying evidence has not changed.
- It may mark an ended completed session as reviewed.
- It must not overwrite the runtime lifecycle label on an active card.
- A disposition is stale when newer session evidence exists:

```ts
const dispositionIsStale =
  Date.parse(session.lastMeaningfulActivityAt) > Date.parse(disposition.recordedAt);
```

If stale, show it only in the modal as review history, for example: `Previously dismissed; new activity detected.`

## Files and Responsibilities

- `src/core/types.ts`: Add lifecycle, outcome, review annotation, lane, and modal view-model types. Keep temporary compatibility with existing `primaryStatus`, `SessionCardView`, and `ExpandedSessionView` until UI migration is complete.
- `src/core/sessionReducer.ts`: Derive deterministic lifecycle and expose `lastMeaningfulActivityAt`, `lastEventType`, terminal metadata, and flags.
- `src/core/outcomes.ts`: Expand outcome policy around ended sessions and preserve immutable evidence.
- `src/core/outcomeClassifier.ts`: Add optional schema validation for LLM outcome candidates without invoking a model by default.
- `src/core/llmAttention.ts`: Reuse evidence-ref validation patterns; keep LLM-generated items inferred and evidence-backed.
- `src/core/reviewDispositions.ts`: Stop rewriting active card state from dispositions; add stale-disposition and evidence-hash checks.
- `src/core/replay.ts`: Project lifecycle lanes and modal detail view models.
- `src/core/liveProjection.ts`: Preserve the live envelope while returning lifecycle-first projection data.
- `src/app/liveProjectionClient.ts`: Keep client parsing compatible with the updated projection shape.
- `src/ui/SessionBoard.tsx`: Replace expanded-card layout with lifecycle lanes and selected-session modal state.
- `src/ui/SessionCard.tsx`: Convert card front copy to lifecycle-first facts.
- `src/ui/SessionDetailModal.tsx`: New modal for current activity, outcome, evidence, timeline, review history, and safe actions.
- `src/ui/ExpandedSessionCard.tsx`: Retire after `SessionDetailModal` covers all detail content.
- `src/ui/BoardSummary.tsx`: Rework counts around `Running`, `Needs action`, `Ended to review`, and `Completed`.
- `src/ui/AttentionQueue.tsx`: Keep as secondary context, not the primary organizing surface.
- `src/ui/Toolbar.tsx` and `src/ui/ConnectionStatus.tsx`: Simplify chrome and make live/demo/collector state clear without visual noise.
- `src/ui/format.ts`: Add lifecycle labels, recency labels, outcome labels, and review annotation labels.
- `src/styles/masthead.css`: Rebuild around the design source of truth. Current UI work must follow `design.md`.
- `docs/release-gates.md`: Update after implementation with the new lifecycle gates and actual verification results.
- `docs/superpowers/plans/2026-06-23-lifecycle-first-redesign.html`: Visual target for the redesigned board.

## Task 0: Freeze the Current Failure as Tests

**Files:**

- Modify: `src/core/__tests__/reviewDispositions.test.ts`
- Modify: `src/core/__tests__/projection.test.ts`
- Modify: `src/ui/__tests__/liveBoard.test.tsx`

- [ ] Add a regression fixture where a session has an older `dismissed` session disposition and then receives a newer hook event.
- [ ] Assert the card primary state is `Running`, not `Dismissed`.
- [ ] Assert the stale dismissal remains visible only as modal/review context.
- [ ] Add a fixture where a session has no terminal event and old activity.
- [ ] Assert it becomes `Idle`, not `Ended`.
- [ ] Add a fixture with a terminal event and no verification after changes.
- [ ] Assert it becomes `Ended` plus `needs_attention`.

Verify:

```bash
npm test -- --run src/core/__tests__/reviewDispositions.test.ts src/core/__tests__/projection.test.ts src/ui/__tests__/liveBoard.test.tsx
```

Expected before implementation: at least one new regression test fails for the stale-disposition behavior.

## Task 1: Add Lifecycle and Modal Contracts with Compatibility

**Files:**

- Modify: `src/core/types.ts`
- Modify tests as needed: `src/core/__tests__/projection.test.ts`

- [ ] Add `SessionLifecycle`, `SessionOutcomeLabel`, `SessionEndReason`, `ReviewAnnotation`, `LifecycleLaneId`, `LifecycleLaneView`, and `SessionDetailView`.
- [ ] Extend `DerivedSession` without removing existing fields yet.
- [ ] Keep `primaryStatus` during migration so attention, conflict, history, and existing tests can keep working.
- [ ] Mark `isExpanded` and `ExpandedSessionView` as transitional contracts in code comments only if needed.
- [ ] Add `selectedSession?: SessionDetailView` to the board projection while keeping `expandedSession` until the UI migration is complete.

Suggested type shape:

```ts
export type SessionLifecycle = "running" | "idle" | "ended";

export type SessionOutcomeLabel =
  | "completed"
  | "needs_attention"
  | "blocked"
  | "failed"
  | "abandoned"
  | "unknown";

export type LifecycleLaneId = "needs_action" | "running" | "idle" | "ended_review" | "history";

export type ReviewAnnotation = {
  status: "dismissed" | "reviewed" | "expected" | "snoozed" | "false_positive";
  recordedAt: string;
  stale: boolean;
  reason?: string;
};
```

Verify:

```bash
npm test -- --run src/core/__tests__/projection.test.ts
npm run typecheck
```

Expected: types compile and existing projection behavior is not broken before the reducer changes.

## Task 2: Implement Deterministic Runtime Lifecycle

**Files:**

- Modify: `src/core/sessionReducer.ts`
- Modify: `src/core/__tests__/sessionReducer.test.ts`

- [ ] Add reducer options for injected `now` and `idleAfterMs` so lifecycle tests are deterministic.
- [ ] Derive `lifecycle`, `endedAt`, `endReason`, and `lastEventType`.
- [ ] Treat `session.completed` as terminal.
- [ ] Treat latest `approval.requested` or `user.question` as `running` plus the existing pending flags.
- [ ] Treat recent command/file/session events as `running`.
- [ ] Treat old non-terminal sessions as `idle`.
- [ ] Do not use review dispositions or LLM output in this reducer.
- [ ] Preserve existing `primaryStatus` enough for attention/history compatibility.

Verify:

```bash
npm test -- --run src/core/__tests__/sessionReducer.test.ts
```

Expected: lifecycle tests pass, and `idle` is clearly distinct from `ended`.

## Task 3: Expand Ended-Session Outcome Policy

**Files:**

- Modify: `src/core/outcomes.ts`
- Modify: `src/core/__tests__/outcomes.test.ts`
- Modify if needed: `src/core/attention.ts`

- [ ] Expand labels to `completed`, `needs_attention`, `blocked`, `failed`, `abandoned`, and `unknown`.
- [ ] Classify failed verification or known nonzero exit status as `failed`.
- [ ] Classify completed-with-changes but no fresh verification as `needs_attention`.
- [ ] Classify waiting-for-user or waiting-for-approval at terminal time as `blocked`.
- [ ] Classify user-marked terminal abandonment as `abandoned`.
- [ ] Classify clean terminal sessions with fresh passing verification as `completed`.
- [ ] Preserve immutable evidence; policy changes should not mutate evidence refs.
- [ ] Keep `completed_without_verification` attention compatible, but make the card outcome label clearer.

Verify:

```bash
npm test -- --run src/core/__tests__/outcomes.test.ts src/core/__tests__/attention.test.ts
```

Expected: ended sessions have flexible outcome labels, and missing exit status does not create false failure.

## Task 4: Add Optional LLM Outcome Candidate Validation

**Files:**

- Create: `src/core/outcomeClassifier.ts`
- Create: `src/core/__tests__/outcomeClassifier.test.ts`
- Modify as needed: `src/core/llmAttention.ts`

- [ ] Add a schema-shaped candidate type.

```ts
export type LlmOutcomeCandidate = {
  outcome: SessionOutcomeLabel;
  confidence: "high" | "medium" | "low";
  reason: string;
  evidence_refs: string[];
  missing_evidence: string[];
  recommended_next_action: string;
};
```

- [ ] Validate every candidate against available evidence refs.
- [ ] Reject zero-evidence candidates.
- [ ] Reject claims that contradict deterministic lifecycle.
- [ ] Cache future classifier results by session id plus evidence hash, but do not wire remote calls in this pass unless explicitly approved later.
- [ ] Make the UI label these results as inferred context, not hard facts.

Verify:

```bash
npm test -- --run src/core/__tests__/outcomeClassifier.test.ts src/core/__tests__/llmAttention.test.ts
```

Expected: unsupported model claims are rejected, and deterministic lifecycle remains unaffected.

## Task 5: Fix Review Disposition Freshness

**Files:**

- Modify: `src/core/reviewDispositions.ts`
- Modify: `src/core/__tests__/reviewDispositions.test.ts`

- [ ] Change dispositions from primary card state to secondary annotations.
- [ ] Add freshness checks for session dispositions using `lastMeaningfulActivityAt`.
- [ ] Add evidence-hash or evidence-ref checks for attention-item suppression so new evidence creates a new visible item.
- [ ] Allow `reviewed` to convert ended `completed_unreviewed` to reviewed/completed history, but not active running sessions.
- [ ] Preserve snooze expiry behavior.
- [ ] Return review annotations for modal/detail display.

Verify:

```bash
npm test -- --run src/core/__tests__/reviewDispositions.test.ts
```

Expected: stale dismissals no longer overwrite active runtime state.

## Task 6: Project Lifecycle Lanes and Modal Details

**Files:**

- Modify: `src/core/replay.ts`
- Modify: `src/core/liveProjection.ts`
- Modify: `src/app/liveProjectionClient.ts`
- Modify: `src/core/__tests__/projection.test.ts`
- Modify: `src/core/__tests__/liveProjection.test.ts`
- Modify: `src/app/__tests__/liveProjectionClient.test.ts`

- [ ] Add lanes in this priority order: `needs_action`, `running`, `idle`, `ended_review`, `history`.
- [ ] Populate `needs_action` with approvals, user questions, failed/blocked sessions, conflicts, repeated failures, and high-risk unresolved attention.
- [ ] Populate `running` with current active work.
- [ ] Populate `idle` with quiet non-terminal sessions.
- [ ] Populate `ended_review` with ended sessions whose outcome is `needs_attention`, `blocked`, `failed`, or `unknown`.
- [ ] Populate `history` with completed/reviewed/expected/older terminal sessions.
- [ ] Add `selectedSession?: SessionDetailView` for modal content.
- [ ] Keep `expandedSession` only as a temporary adapter until the React UI no longer reads it.
- [ ] Update summary counts to `running`, `needsAction`, `idle`, `endedToReview`, and `completed`.

Verify:

```bash
npm test -- --run src/core/__tests__/projection.test.ts src/core/__tests__/liveProjection.test.ts src/app/__tests__/liveProjectionClient.test.ts
```

Expected: live board data puts fresh running sessions first and stale review labels only in detail annotations.

## Task 7: Replace Expanded Cards with a Modal UI

**Files:**

- Modify: `src/ui/SessionBoard.tsx`
- Modify: `src/ui/SessionCard.tsx`
- Create: `src/ui/SessionDetailModal.tsx`
- Modify or remove after migration: `src/ui/ExpandedSessionCard.tsx`
- Modify: `src/ui/BoardSummary.tsx`
- Modify: `src/ui/AttentionQueue.tsx`
- Modify: `src/ui/__tests__/liveBoard.test.tsx`
- Modify: `src/ui/__tests__/filterBoard.test.ts`

- [ ] Render lifecycle lanes instead of an expanded card grid.
- [ ] Make cards open `SessionDetailModal`.
- [ ] Remove inline detail panels from card layout.
- [ ] Card front content must be limited to:
  - lifecycle label
  - last activity age
  - project/workspace
  - changed-file count
  - one next action when needed
- [ ] Modal sections:
  - current activity
  - lifecycle and outcome
  - worktree state
  - attention/conflicts
  - review history
  - evidence/timeline
  - safe actions
- [ ] Add keyboard and focus behavior: open by Enter/Space, close with Esc, return focus to the card.
- [ ] Keep `AttentionQueue` secondary and scoped to unresolved items.

Verify:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx src/ui/__tests__/filterBoard.test.ts
```

Expected: cards stay compact, modal exposes the full detail surface, and stale dispositions are not card-front state.

## Task 8: Apply the Raycast-Inspired Masthead Visual System

**Files:**

- Modify: `src/styles/masthead.css`
- Modify: `src/app/App.tsx`
- Modify: `src/ui/Toolbar.tsx`
- Modify: `src/ui/ConnectionStatus.tsx`
- Modify tests as needed: `src/ui/__tests__/liveBoard.test.tsx`, `src/ui/__tests__/operationsPanel.test.tsx`

- [ ] Remove the current grid background and heavy visual chrome.
- [ ] Use `#07080a` for canvas.
- [ ] Use `#0d0d0d`, `#101111`, and `#121212` for the surface ladder.
- [ ] Use `#242728` hairline borders.
- [ ] Use no drop shadows.
- [ ] Use 6-10px radii for cards and controls; reserve 16px for modal/shell containers.
- [ ] Use Inter with `font-feature-settings: "calt", "kern", "liga", "ss03"`.
- [ ] Use one white primary pill for the dominant action only.
- [ ] Make semantic color sparse:
  - green: live/running only
  - yellow: idle/uncertain only
  - red: failed/blocked/needs action only
  - blue: inferred/model context only
- [ ] Keep the app surface, not a landing page. No large marketing headline or repeated explanation in the product UI.

Verify:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx src/ui/__tests__/operationsPanel.test.tsx
```

Expected: the UI reads as a quiet premium developer console, not a busy dashboard or landing page.

## Task 9: Update Dogfood and Release Gates

**Files:**

- Modify: `src/core/dogfood.ts`
- Modify: `src/core/__tests__/dogfood.test.ts`
- Modify: `docs/release-gates.md`

- [ ] Add dogfood gate: new live session appears in `running` within one poll interval after ingestion.
- [ ] Add dogfood gate: stale session-level dismissal does not affect a card with newer activity.
- [ ] Add dogfood gate: old non-terminal sessions are `idle`, not `ended`.
- [ ] Add dogfood gate: terminal sessions include an outcome or `unknown`.
- [ ] Add dogfood gate: LLM outcome candidates require valid evidence refs.
- [ ] Add dogfood gate: modal detail exposes raw evidence refs while card fronts stay compact.
- [ ] Update `docs/release-gates.md` with actual pass/fail evidence after verification.

Verify:

```bash
npm test -- --run src/core/__tests__/dogfood.test.ts
npm run dogfood
npm run dogfood:live
```

Expected: dogfood proves lifecycle-first behavior with fixture and live collector data.

## Task 10: Full Verification and Browser QA

**Files:**

- No product files unless verification reveals defects.

- [ ] Run the full local checks.

```bash
npm test -- --run
npm run typecheck
npm run build
npm run dogfood:live
```

- [ ] Start or reuse `npm run dev`.
- [ ] Use the Codex in-app Browser with the `iab` backend.
- [ ] Verify the live board at:

```text
http://127.0.0.1:5173/
```

- [ ] Check widths: `390`, `768`, `1280`, and the current desktop viewport.
- [ ] Confirm:
  - no horizontal overflow
  - no large top headline
  - cards are compact and lifecycle-first
  - modal opens and closes correctly
  - stale dispositions appear only as detail/review history
  - current live Codex sessions are not confused with dismissed/completed history
  - demo data is explicitly opt-in and never mixed with live data

Expected: the redesign is verified with tests, build checks, live dogfood, and rendered browser evidence.

## Acceptance Gates

- [ ] New Codex session appears as `Running` within one poll interval after ingestion.
- [ ] Active cards never show `Dismissed`, `Reviewed`, or `Expected` as their primary runtime state.
- [ ] Review dispositions are visible only as secondary context unless they apply to ended/history state.
- [ ] Silence creates `Idle`, not `Ended`.
- [ ] Ended sessions show an outcome or `unknown`.
- [ ] Card fronts stay quiet and scannable.
- [ ] Modal details contain the full evidence and timeline.
- [ ] LLM outcome candidates are optional, schema-validated, evidence-backed, and never lifecycle source of truth.
- [ ] Visual system matches `design.md`.
- [ ] Full test, typecheck, build, dogfood, and browser QA gates pass.

## Implementation Order

1. Freeze regression tests.
2. Add compatible contracts.
3. Implement deterministic lifecycle.
4. Implement outcome policy.
5. Validate optional LLM outcome candidates without model invocation.
6. Fix review-disposition freshness.
7. Project lifecycle lanes and modal detail data.
8. Replace expanded-card UI with modal UI.
9. Apply visual redesign.
10. Update dogfood/release gates.
11. Run full verification and browser QA.

This order is intentional: data truth first, review overlay second, UI third, visual polish fourth. Do not start with CSS; it would make misleading state look better without fixing the product problem.
