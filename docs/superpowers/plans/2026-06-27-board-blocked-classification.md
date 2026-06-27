# Board Blocked Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Masthead Board use red/`Blocked` only for sessions that cannot proceed without intervention, while active work stays green, idle work stays blue, and conflicts remain attention metadata instead of becoming blockers.

**Architecture:** Separate three concepts that are currently conflated: lifecycle (`running`, `idle`, `ended`), intervention blockers (`blocked`, pending user input, pending approval), and attention signals (`conflict`, verification stale, high risk, failed command). The Board card rail/status token will be derived from lifecycle plus real blocker state only; conflict detection will be tightened so stale or same-worktree git snapshots do not create false attention.

**Tech Stack:** TypeScript, React, Vitest, Masthead live projection, Codex in-app Browser with `iab` backend for final visual verification.

---

## Optimizer Rubric And Result

Rubric:

- Status taxonomy correctness, 25 pts: red means blocked only; conflict/failure/verification cannot accidentally become red.
- Root-cause coverage, 20 pts: covers stale snapshots, same-worktree attribution, and UI blocked predicate.
- Test specificity, 20 pts: tests reproduce the favicon-style false positive and lock the intended card/filter/projection behavior.
- Sequencing and reversibility, 15 pts: failing tests come first, implementation steps are minimal and independently verifiable.
- Source fit and blast-radius control, 10 pts: follows current files/patterns and avoids redesigning Board.
- Verification completeness, 10 pts: includes typecheck, targeted tests, live Browser inspection, and diff hygiene.

Score trajectory:

- Round 1: 78/100. Good coverage, but allowed non-blocked failures to remain red and left one projection helper ambiguous.
- Round 2: 91/100. Red is now strictly blocker-only, tests are executable against existing helpers, and stale/same-worktree conflict fixes are separated.
- Round 3: 91/100. Plateau; no structural alternative beat the Round 2 plan without adding UI redesign scope.

Substantive improvements:

- Removed the `Needs review` red path. Failed or conflict-only sessions can be attention items, but they do not get the red card rail unless they are explicit blockers.
- Made same-worktree overlap suppression exact instead of “degraded but still conflict.”
- Replaced ambiguous projection-test guidance with complete object literals using the existing `projection.test.ts` helper shape.

---

## File Map

- Modify: `src/ui/format.ts`
  - Owns Board/UI card predicates and class mapping. `isBlockedSessionCard` must represent intervention blockers only.
- Modify: `src/ui/SessionCard.tsx`
  - Uses the shared predicate for visible status token derivation.
- Modify: `src/ui/filterBoard.ts`
  - Uses the same blocked predicate for lifecycle filter and main-scan counts.
- Modify: `src/core/conflicts.ts`
  - Uses latest snapshots only and suppresses same-worktree duplicate attribution.
- Modify: `src/core/replay.ts`
  - No expected direct change if `conflicts.ts` owns filtering; inspect after tests to confirm no duplicate filtering is needed.
- Modify: `src/core/attention.ts`
  - No expected direct change unless tests show conflict attention severity/copy still implies blocking.
- Test: `src/ui/__tests__/observabilitySessionCard.test.tsx`
  - Locks active/idle/blocked/conflict-only rendered labels and classes.
- Test: `src/ui/__tests__/filterBoard.test.ts`
  - Locks blocked filter and summary counts.
- Test: `src/core/__tests__/conflicts.test.ts`
  - Locks stale snapshot and same-worktree conflict behavior.
- Test: `src/core/__tests__/projection.test.ts`
  - Locks end-to-end projection behavior for conflict-only running cards.

---

## Definition Of Blocked

A Board card is blocked only when the session state says the agent cannot proceed without intervention:

- `primaryStatus === "blocked"`
- `outcomeLabel === "blocked"`
- `endReason === "blocked"`
- `primaryStatus === "waiting_for_user"`
- `primaryStatus === "waiting_for_approval"`

Not blocked:

- `indicators.includes("conflict")`
- `primaryStatus === "failed"`
- `primaryStatus === "possibly_looping"`
- `outcomeLabel === "failed"`
- `endReason === "failed"`
- stale verification
- high-risk path

Those may still appear in attention queues, inspectors, badges, or needs-action lanes for ended sessions, but they must not render the Board card as red/`Blocked`.

---

### Task 1: Lock UI Blocked Semantics With Failing Tests

**Files:**
- Modify: `src/ui/__tests__/observabilitySessionCard.test.tsx`
- Modify: `src/ui/__tests__/filterBoard.test.ts`

- [ ] **Step 1: Add conflict-only rendered card regression**

Add this test near the existing status/class tests in `src/ui/__tests__/observabilitySessionCard.test.tsx`:

```tsx
test("does not render conflict-only running cards as blocked", () => {
  const html = renderToStaticMarkup(
    <SessionCard
      session={session({
        lifecycle: "running",
        primaryStatus: "editing",
        stateLabel: "Running",
        indicators: ["attention", "conflict"],
        attentionReason: "Same tracked path changed by 2 active sessions"
      })}
      onToggle={() => undefined}
    />
  );

  expect(html).toContain(">Active<");
  expect(html).not.toContain(">Blocked<");
  expect(html).not.toContain("needs-attention");
});
```

- [ ] **Step 2: Add class mapping assertions for active, idle, blocked, and conflict-only**

In `src/ui/__tests__/observabilitySessionCard.test.tsx`, add or replace the class mapping test with:

```tsx
test("maps only real blockers to the blocked color class", () => {
  expect(stateClassName(session({ lifecycle: "running", primaryStatus: "editing", indicators: [] }))).toBe("running");
  expect(stateClassName(session({ lifecycle: "idle", primaryStatus: "stalled", indicators: [] }))).toBe("stalled");
  expect(stateClassName(session({ lifecycle: "running", primaryStatus: "blocked", indicators: ["attention"] }))).toBe("needs-attention");
  expect(stateClassName(session({ lifecycle: "running", primaryStatus: "waiting_for_user", indicators: ["attention"] }))).toBe(
    "needs-attention"
  );
  expect(stateClassName(session({ lifecycle: "running", primaryStatus: "waiting_for_approval", indicators: ["attention"] }))).toBe(
    "needs-attention"
  );
  expect(stateClassName(session({ lifecycle: "running", primaryStatus: "editing", indicators: ["attention", "conflict"] }))).toBe(
    "running"
  );
  expect(stateClassName(session({ lifecycle: "running", primaryStatus: "failed", indicators: ["attention"] }))).toBe("running");
});
```

- [ ] **Step 3: Add filter/summary regression coverage**

Add this test to `src/ui/__tests__/filterBoard.test.ts`:

```ts
test("does not count conflict-only or failed cards as blocked", () => {
  const cards = [
    { ...baseCard, sessionId: "active", lifecycle: "running", primaryStatus: "editing", indicators: [] },
    {
      ...baseCard,
      sessionId: "conflict-only",
      lifecycle: "running",
      primaryStatus: "editing",
      indicators: ["attention", "conflict"],
      attentionReason: "Same tracked path changed by 2 active sessions"
    },
    { ...baseCard, sessionId: "failed", lifecycle: "running", primaryStatus: "failed", indicators: ["attention"] },
    { ...baseCard, sessionId: "blocked", lifecycle: "running", primaryStatus: "blocked", indicators: ["attention"] },
    { ...baseCard, sessionId: "approval", lifecycle: "running", primaryStatus: "waiting_for_approval", indicators: ["attention"] }
  ] satisfies SessionCardView[];

  expect(
    filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "blocked", sort: "recent_activity" }).map(
      (card) => card.sessionId
    )
  ).toEqual(["blocked", "approval"]);

  expect(summarizeMainScanCards(cards)).toMatchObject({
    running: 3,
    active: 3,
    needsAction: 2,
    needsAttention: 2
  });
});
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
npm test -- --run src/ui/__tests__/observabilitySessionCard.test.tsx src/ui/__tests__/filterBoard.test.ts
```

Expected before implementation: FAIL because conflict-only and failed cards currently map into blocked/red semantics.

---

### Task 2: Make Red And `Blocked` Intervention-Only

**Files:**
- Modify: `src/ui/format.ts`
- Modify: `src/ui/SessionCard.tsx`
- Modify: `src/ui/filterBoard.ts`

- [ ] **Step 1: Narrow `isBlockedSessionCard`**

In `src/ui/format.ts`, replace the existing predicate with:

```ts
export function isBlockedSessionCard(session: SessionCardView): boolean {
  return (
    session.primaryStatus === "blocked" ||
    session.outcomeLabel === "blocked" ||
    session.endReason === "blocked" ||
    session.primaryStatus === "waiting_for_user" ||
    session.primaryStatus === "waiting_for_approval"
  );
}
```

- [ ] **Step 2: Keep class mapping lifecycle-first**

In `src/ui/format.ts`, use:

```ts
export function stateClassName(session: SessionCardView): string {
  if (isBlockedSessionCard(session)) return "needs-attention";
  if (session.lifecycle === "ended" && session.outcomeLabel === "completed") return "complete";
  if (session.lifecycle === "idle" || session.primaryStatus === "stalled") return "stalled";
  if (session.lifecycle === "ended") return "ended";
  return "running";
}
```

- [ ] **Step 3: Keep status token labels intervention-only**

In `src/ui/format.ts`, use:

```ts
export function statusTokenLabel(session: SessionCardView): string {
  if (isBlockedSessionCard(session)) return "Blocked";
  if (session.indicators.includes("risk")) return "High risk";
  if (session.lifecycle === "running") return "Active";
  if (session.lifecycle === "idle") return "Idle";
  if (session.lifecycle === "ended" && session.outcomeLabel) return outcomeLabel(session.outcomeLabel);
  return session.stateLabel;
}
```

In `src/ui/SessionCard.tsx`, use the same blocker rule:

```ts
function observabilityStateLabel(session: SessionCardView): string {
  if (isBlockedSessionCard(session)) return "Blocked";
  if (session.lifecycle === "idle") return "Idle";
  if (session.lifecycle === "ended" && session.outcomeLabel === "completed") return "Turn complete";
  if (session.lifecycle === "ended") return "Response ready";
  return "Active";
}
```

- [ ] **Step 4: Update `filterBoard.ts` blocked scan predicate**

Use only the shared blocker predicate:

```ts
function isBlockedScanCard(card: SessionCardView): boolean {
  return isBlockedSessionCard(card);
}
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
npm test -- --run src/ui/__tests__/observabilitySessionCard.test.tsx src/ui/__tests__/filterBoard.test.ts
```

Expected: PASS.

---

### Task 3: Prevent Stale Git Snapshots From Creating Current Conflicts

**Files:**
- Modify: `src/core/conflicts.ts`
- Modify: `src/core/__tests__/conflicts.test.ts`

- [ ] **Step 1: Add stale snapshot regression**

Add to `src/core/__tests__/conflicts.test.ts`:

```ts
test("uses only the latest snapshot per session when detecting exact file overlap", () => {
  const conflicts = detectConflicts([
    snapshot("auth", "/repo/.git", "/repo-auth", "src/shared.ts", {
      snapshotId: "auth-old",
      observedAt: "2026-06-23T02:00:00.000Z"
    }),
    snapshot("auth", "/repo/.git", "/repo-auth", "src/other.ts", {
      snapshotId: "auth-latest",
      observedAt: "2026-06-23T02:05:00.000Z"
    }),
    snapshot("middleware", "/repo/.git", "/repo-middleware", "src/shared.ts", {
      snapshotId: "middleware-latest",
      observedAt: "2026-06-23T02:06:00.000Z"
    })
  ]);

  expect(conflicts).toEqual([]);
});
```

- [ ] **Step 2: Add latest-overlap positive coverage**

Add:

```ts
test("detects exact file overlap from latest snapshots", () => {
  const conflicts = detectConflicts([
    snapshot("auth", "/repo/.git", "/repo-auth", "src/old.ts", {
      snapshotId: "auth-old",
      observedAt: "2026-06-23T02:00:00.000Z"
    }),
    snapshot("auth", "/repo/.git", "/repo-auth", "src/shared.ts", {
      snapshotId: "auth-latest",
      observedAt: "2026-06-23T02:05:00.000Z"
    }),
    snapshot("middleware", "/repo/.git", "/repo-middleware", "src/shared.ts", {
      snapshotId: "middleware-latest",
      observedAt: "2026-06-23T02:06:00.000Z"
    })
  ]);

  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]?.sharedPaths).toEqual(["src/shared.ts"]);
});
```

- [ ] **Step 3: Run conflict tests and verify failure**

Run:

```bash
npm test -- --run src/core/__tests__/conflicts.test.ts
```

Expected before implementation: the stale snapshot test fails.

- [ ] **Step 4: Filter to latest snapshot per session**

In `src/core/conflicts.ts`, add:

```ts
function latestSnapshotsBySession(snapshots: GitSnapshot[]): GitSnapshot[] {
  const latest = new Map<string, GitSnapshot>();
  for (const snapshot of snapshots) {
    const previous = latest.get(snapshot.sessionId);
    if (!previous || snapshot.observedAt > previous.observedAt) {
      latest.set(snapshot.sessionId, snapshot);
    }
  }
  return [...latest.values()];
}
```

Then change the loop in `detectConflicts` to:

```ts
for (const snapshot of latestSnapshotsBySession(snapshots)) {
```

- [ ] **Step 5: Run conflict tests**

Run:

```bash
npm test -- --run src/core/__tests__/conflicts.test.ts
```

Expected: PASS.

---

### Task 4: Suppress Same-Worktree Duplicate Hard Conflicts

**Files:**
- Modify: `src/core/conflicts.ts`
- Modify: `src/core/__tests__/conflicts.test.ts`
- Modify: `src/core/__tests__/projection.test.ts`

- [ ] **Step 1: Replace degraded same-worktree conflict expectation**

Change the existing same-working-directory test in `src/core/__tests__/conflicts.test.ts` to:

```ts
test("does not hard-conflict same working-directory attribution", () => {
  const conflicts = detectConflicts([
    snapshot("auth", "/repo/.git", "/repo", "src/lib/auth/session.ts"),
    snapshot("middleware", "/repo/.git", "/repo", "src/lib/auth/session.ts")
  ]);

  expect(conflicts).toEqual([]);
});
```

- [ ] **Step 2: Implement same-worktree suppression**

In `src/core/conflicts.ts`, before creating a conflict:

```ts
const worktreePaths = [...new Set(matches.map((snapshot) => snapshot.worktreePath))];
if (worktreePaths.length < 2) continue;
```

Then set:

```ts
attribution: "direct",
```

- [ ] **Step 3: Run conflict tests**

Run:

```bash
npm test -- --run src/core/__tests__/conflicts.test.ts
```

Expected: PASS.

- [ ] **Step 4: Add projection coverage for duplicate same-worktree snapshots**

In `src/core/__tests__/projection.test.ts`, add:

```ts
test("does not mark same-worktree duplicate snapshots as conflict attention", () => {
  const board = projectFixture({
    events: [
      event("a-start", "session-a", "session.started", "2026-06-23T02:00:00.000Z"),
      event("b-start", "session-b", "session.started", "2026-06-23T02:00:01.000Z")
    ],
    gitSnapshots: [
      {
        snapshotId: "snapshot-a",
        sessionId: "session-a",
        repoRoot: "/workspace/app",
        worktreePath: "/workspace/app",
        gitCommonDir: "/workspace/app/.git",
        branch: "agent/session-a",
        headSha: "abc123",
        changedPaths: [
          {
            path: "src/shared.ts",
            status: "modified",
            staged: false,
            additions: 1,
            deletions: 0,
            sensitivity: "metadata"
          }
        ],
        observedAt: "2026-06-23T02:04:00.000Z"
      },
      {
        snapshotId: "snapshot-b",
        sessionId: "session-b",
        repoRoot: "/workspace/app",
        worktreePath: "/workspace/app",
        gitCommonDir: "/workspace/app/.git",
        branch: "agent/session-b",
        headSha: "abc123",
        changedPaths: [
          {
            path: "src/shared.ts",
            status: "modified",
            staged: false,
            additions: 1,
            deletions: 0,
            sensitivity: "metadata"
          }
        ],
        observedAt: "2026-06-23T02:04:01.000Z"
      }
    ]
  });

  expect(board.conflicts).toEqual([]);
  expect(board.attentionQueue.some((item) => item.type === "conflict")).toBe(false);
  expect(board.cards).toHaveLength(2);
  expect(board.cards.every((card) => card.lifecycle === "running")).toBe(true);
  expect(board.cards.every((card) => !card.indicators.includes("conflict"))).toBe(true);
});
```

- [ ] **Step 5: Add projection coverage for real different-worktree conflicts**

Add:

```ts
test("keeps different-worktree exact file overlap as conflict attention", () => {
  const board = projectFixture({
    events: [
      event("a-start", "session-a", "session.started", "2026-06-23T02:00:00.000Z"),
      event("b-start", "session-b", "session.started", "2026-06-23T02:00:01.000Z")
    ],
    gitSnapshots: [snapshot("snapshot-a", "session-a", "src/shared.ts"), snapshot("snapshot-b", "session-b", "src/shared.ts")]
  });

  expect(board.conflicts).toHaveLength(1);
  expect(board.attentionQueue.filter((item) => item.type === "conflict")).toHaveLength(2);
  expect(board.cards.every((card) => card.lifecycle === "running")).toBe(true);
  expect(board.cards.every((card) => card.indicators.includes("conflict"))).toBe(true);
});
```

- [ ] **Step 6: Run projection and conflict tests**

Run:

```bash
npm test -- --run src/core/__tests__/projection.test.ts src/core/__tests__/conflicts.test.ts
```

Expected: PASS.

---

### Task 5: Verify Live Board Behavior

**Files:**
- No source changes.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
npm test -- --run src/ui/__tests__/observabilitySessionCard.test.tsx src/ui/__tests__/filterBoard.test.ts src/core/__tests__/conflicts.test.ts src/core/__tests__/projection.test.ts
```

Expected: PASS.

- [ ] **Step 3: Start live app**

Run:

```bash
npm run dev
```

Expected output includes:

```text
Masthead is ready.
Open http://127.0.0.1:<port>
```

- [ ] **Step 4: Inspect Board with the in-app Browser**

Use the Browser plugin with `iab` backend. Navigate to the printed app URL.

Evaluate:

```js
Array.from(document.querySelectorAll(".session-card")).map((card) => ({
  className: card.className,
  token: card.querySelector(".state-token")?.textContent?.trim(),
  headline: card.querySelector(".card-headline")?.textContent?.trim(),
  borderLeftColor: getComputedStyle(card).borderLeftColor,
  attention: card.textContent?.includes("Same tracked path changed by")
}));
```

Expected:
- Active/running cards show `token: "Active"` and green/running class.
- Idle cards show `token: "Idle"` and blue/stalled class.
- Blocked cards show `token: "Blocked"` and red/needs-attention class.
- Conflict-only favicon/logo cards do not show `token: "Blocked"` and do not have `needs-attention`.
- Same-worktree duplicate dirty files do not create conflict cards.

- [ ] **Step 5: Confirm source state stayed scoped**

Run:

```bash
git diff --check
git status --short
```

Expected:
- `git diff --check` has no output.
- Only the planned source/test files are modified.

---

## Execution Notes

- Do not redesign Board. This plan changes classification and evidence quality only.
- Do not remove attention queues or conflict records for real different-worktree overlaps.
- Do not treat generic failed commands as blocked. A failed command can be attention or needs review, but red/`Blocked` requires intervention state.
- If product wants a separate amber/warning visual for conflict or failed states later, that should be a separate UI design task.

## Final Self-Review

Spec coverage:
- User definition of blocked maps directly to `Definition Of Blocked` and Task 2.
- Favicon false-blocked cause maps to stale snapshot and same-worktree fixes in Tasks 3 and 4.
- Existing green/blue/red invariant remains protected by Tasks 1, 2, and 5.

Placeholder scan:
- No `TBD`, `TODO`, “adapt helper,” or open-ended implementation step remains.

Type consistency:
- Uses existing `SessionCardView`, `GitSnapshot`, `detectConflicts`, `stateClassName`, `filterCards`, `summarizeMainScanCards`, `projectFixture`, `event`, and `snapshot` patterns.
