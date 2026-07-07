# Board Refresh Liveness And Blocked Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Board refresh interval enforce live freshness so stale sessions leave Active, and make `Blocked` mean only a current permission/approval stop.

**Architecture:** Centralize live permission semantics in core, then make every live-state source use that same policy: hook-derived `/live/state`, blocker derivation, projection overlay, and UI labels. `/projection` already polls on the selected Board refresh interval; this plan wires that interval into the projection state selector and adds TTLs for both event-derived activity and unresolved approval blockers.

**Tech Stack:** TypeScript, React, Vitest, Masthead daemon `/projection`, existing live-state reports, existing live connector templates.

## Global Constraints

- Do not add OS process scanning, Codex-specific thread probing, or access-mode tracking UI.
- `Blocked` means only: the agent is currently stopped on a permission/approval request.
- `user.question`, `waiting_for_user`, `needs_input`, `needs_user`, and `question_requested` are not live `Blocked`.
- `permissionMode: "bypassPermissions"` and equivalent full-access/bypass modes must never create a live blocker.
- `Active` requires fresh proof: a fresh `working` `/live/state` report or a recent event-derived working proof.
- A stored historical event may remain searchable in Logbook, but it must not assert current Board liveness after its freshness window expires.
- UI components must not independently infer blocked from waiting labels; core projection owns live state truth.
- Do not redesign Board layout, lanes, filters, or navigation.

---

## Optimizer Rubric And Result

Rubric:

- Root-cause coverage, 25 pts: covers all current false sources: stale event fallback, live-state report aliases, hook-implied state, unresolved blocker derivation, replay labels, UI waiting classes, and notification predicates.
- State-model correctness, 20 pts: separates historical session metadata, attention, live liveness, and permission blockers without introducing new visible states.
- Current-code fit, 15 pts: uses current files, types, functions, and test surfaces without broad rewrites or type-invalid shortcuts.
- Sequencing and testability, 15 pts: failing tests come before implementation; each task has a narrow verification command and an independently reviewable deliverable.
- Risk controls and rollback, 15 pts: includes freshness constants, bounded false-negative risk, generated connector fixes, manual acceptance, and production rollback notes.
- Scope control, 10 pts: avoids process scans, schema churn, product redesign, and speculative access tracking.

Score trajectory:

- Round 0: 60/100. The draft identified the stale-event bug, but missed hook-derived `/live/state` false blockers, generated connector state machines, unresolved blocker expiration, and UI predicates that could reintroduce stale waiting states.
- Round 1: 81/100. Added source-level blocker policy and refresh wiring, but still let raw `waiting_for_approval` leak through UI and did not expire unresolved approval blockers.
- Round 2: 92/100. Moved truth ownership into core projection, added blocker TTLs, and covered generated connector code; remaining weakness was a vague live-state TTL contract.
- Round 3: 96/100. Added explicit working TTL adjustment, deterministic acceptance tests, and rollback/manual verification. Plateau reached; further changes would mainly reformat.

Substantive improvements over the prior plan:

- Introduces one central permission policy (`src/core/livePermission.ts`) used by blockers, hook live-state reports, and projection event fallback.
- Expires both stale event-derived Active and unresolved approval blockers; the old plan only expired event-derived Active.
- Fixes the hidden false-blocked path where `liveStateReportFromHookPayload(...)` and generated connector state machines could still post `state: "blocked"` for user questions or `needs_input`.

---

## Current Code Diagnosis

The Board refresh exists, but today it reprojects stale evidence:

- `src/app/App.tsx` polls `loadLiveProjection()` every `refreshRateMs`.
- `src/app/liveProjectionClient.ts` sends `refreshIntervalMs` to `/projection`.
- `src/daemon/server.ts` parses `refreshIntervalMs`, but only uses it for headline enrichment.
- `src/core/liveProjectionState.ts` maps old `command.started`, `turn.started`, and `user.response` events to `working` without an age cap.

False `Blocked` can enter through several independent paths:

- `src/core/liveState.ts` maps `needsInput`, `waiting_for_user`, and question aliases to `blocked`.
- `src/core/liveHookAdapter.ts` maps `user.question` and all `approval.requested` events to blocked live-state reports.
- `src/core/liveBlockers.ts` opens blockers for both `approval.requested` and `user.question`, and currently leaves unresolved blockers live forever.
- `src/daemon/liveConnectorSettings.ts` generated connector code maps questions and `needs_input` statuses to blocked in at least the OpenCode template.
- `src/core/replay.ts` turns blocked display state back into `Needs approval` / `Needs input`.
- `src/ui/format.ts` and `src/ui/SessionCard.tsx` have waiting-specific `Needs approval`, `Needs input`, and `is-waiting` behavior.

The fix must close all of these paths. Fixing only the visible label or only `liveBlockers.ts` is insufficient.

---

## Target State Contract

Projection output is the source of truth for Board state:

| Evidence | Board `displayState` | `primaryStatus` after replay | Label/pill | Lane |
|---|---:|---:|---:|---:|
| Fresh `working` live-state report | `working` | existing running status | `Active` | `running` |
| Fresh `blocked` live-state report from pending permission | `blocked` | `blocked` | `Blocked` | `needs_action` |
| Fresh unresolved pending approval blocker | `blocked` | `blocked` | `Blocked` | `needs_action` |
| Recent `command.started`, `turn.started`, or `user.response` inside grace window | `working` | existing running status | `Active` | `running` |
| `user.question` | not blocked | historical metadata/attention only | no `Needs input` live state | not blocked |
| `approval.requested` with `permissionMode: "bypassPermissions"` | not blocked | nonblocked live activity or idle after TTL | no `Blocked` | not blocked |
| Expired working live-state report and no newer proof | `idle` | `stalled` | `Idle` | `idle` |
| Stale event-derived work and no newer proof | `idle` | `stalled` | `Idle` | `idle` |
| Unresolved approval blocker older than blocker TTL with no fresh blocked report | `idle` | `stalled` | `Idle` | `idle` |

Freshness constants:

```ts
const DEFAULT_WORKING_LIVE_STATE_TTL_MS = 30_000;
const DEFAULT_BLOCKED_LIVE_STATE_TTL_MS = 10 * 60_000;
const DEFAULT_IDLE_LIVE_STATE_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_UNKNOWN_LIVE_STATE_TTL_MS = 60_000;

export function eventWorkingGraceMsForRefresh(refreshIntervalMs: number | undefined): number {
  if (!Number.isFinite(refreshIntervalMs)) return 30_000;
  return Math.max(15_000, Math.min(60_000, Number(refreshIntervalMs) * 2));
}

export function approvalBlockerTtlMsForRefresh(refreshIntervalMs: number | undefined): number {
  if (!Number.isFinite(refreshIntervalMs)) return 10 * 60_000;
  return Math.max(60_000, Math.min(10 * 60_000, Number(refreshIntervalMs) * 12));
}
```

With the default 10s Board refresh, event-derived Active expires after 20s and unresolved approval blockers expire after 2 minutes unless a fresh blocked live-state report keeps proving the stop.

---

## File Map

Create:

- `src/core/livePermission.ts`
  - Central permission/liveness policy helpers.
- `src/core/__tests__/livePermission.test.ts`
  - Unit tests for pending approval detection, bypass modes, user-question handling, and event-implied live state.

Modify:

- `src/core/liveState.ts`
  - Remove user-input aliases from blocked normalization.
  - Reduce default `working` TTL to 30s.
- `src/core/liveHookAdapter.ts`
  - Use central policy for hook-implied live-state reports.
  - Stop generating blocked reports for user questions and bypass approvals.
- `src/core/liveBlockers.ts`
  - Use central policy.
  - Track only pending approval blockers.
  - Expire unresolved blockers by age.
- `src/core/liveProjectionState.ts`
  - Require fresh proof for `working`.
  - Demote running-without-proof to stale idle.
  - Stop using raw waiting statuses as live blocked proof.
- `src/core/liveProjection.ts`
  - Accept `refreshIntervalMs`.
  - Compute event and blocker freshness windows.
- `src/core/replay.ts`
  - Pass `eventWorkingGraceMs` into state selection.
  - Use only fresh blockers.
  - Collapse blocked status/label to exactly `blocked` / `Blocked`.
  - Stop mapping `primaryStatus: "blocked"` to a command-failure headline signal.
- `src/daemon/server.ts`
  - Pass `refreshIntervalMs` into projection.
  - Pass `now` and blocker TTL into `deriveLiveBlockers(...)`.
- `src/daemon/liveConnectorSettings.ts`
  - Fix generated connector state machines so questions/user input do not post blocked live-state reports.
- `src/ui/format.ts`
  - Remove `waitingSessionLabel(...)`.
  - Make UI blocked checks trust projection state, not waiting labels.
- `src/ui/SessionCard.tsx`
  - Remove `is-waiting` state class and `Needs approval` / `Needs input` pill path.
- `src/app/liveSessionEndedNotifications.ts`
  - No expected implementation change if `isBlockedSessionCard(...)` is corrected; tests must lock the behavior.

Test:

- `src/core/__tests__/livePermission.test.ts`
- `src/core/__tests__/liveState.test.ts`
- `src/core/__tests__/liveHookAdapter.test.ts`
- `src/core/__tests__/liveBlockers.test.ts`
- `src/core/__tests__/liveProjectionState.test.ts`
- `src/core/__tests__/liveProjection.test.ts`
- `src/core/__tests__/projection.test.ts`
- `src/daemon/__tests__/liveConnectorSettings.test.ts`
- `src/ui/__tests__/observabilitySessionCard.test.tsx`
- `src/ui/__tests__/dovetailCardSystem.test.tsx`
- `src/app/__tests__/liveSessionEndedNotifications.test.ts`

---

### Task 1: Add Central Live Permission Policy

**Files:**
- Create: `src/core/livePermission.ts`
- Create: `src/core/__tests__/livePermission.test.ts`

**Interfaces:**
- Produces: `approvalEventRequiresPermission(event: NormalizedEvent): boolean`
- Produces: `liveStateImpliedByEvent(event: NormalizedEvent): LiveRuntimeSemanticState | undefined`
- Produces: `eventIsWorkingProof(event: NormalizedEvent): boolean`

- [ ] **Step 1: Write the failing policy tests**

Create `src/core/__tests__/livePermission.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { approvalEventRequiresPermission, eventIsWorkingProof, liveStateImpliedByEvent } from "../livePermission.ts";
import type { NormalizedEvent } from "../types.ts";

describe("live permission policy", () => {
  test("treats ordinary approval requests as pending permission blockers", () => {
    const approval = event("approval.requested", { commandId: "cmd-1", permissionMode: "on-request" });

    expect(approvalEventRequiresPermission(approval)).toBe(true);
    expect(liveStateImpliedByEvent(approval)).toBe("blocked");
  });

  test.each(["bypassPermissions", "bypass_permissions", "full_access", "danger-full-access", "none", "disabled"] as const)(
    "does not block bypass/full-access approval mode %s",
    (permissionMode) => {
      const approval = event("approval.requested", { commandId: "cmd-1", permissionMode });

      expect(approvalEventRequiresPermission(approval)).toBe(false);
      expect(liveStateImpliedByEvent(approval)).toBe("working");
    }
  );

  test("does not treat user questions as blocked or working proof", () => {
    const question = event("user.question", { status: "needs_input" });

    expect(liveStateImpliedByEvent(question)).toBeUndefined();
    expect(eventIsWorkingProof(question)).toBe(false);
  });

  test("maps only state-bearing work events to working proof", () => {
    expect(eventIsWorkingProof(event("command.started"))).toBe(true);
    expect(eventIsWorkingProof(event("turn.started"))).toBe(true);
    expect(eventIsWorkingProof(event("user.response"))).toBe(true);
    expect(eventIsWorkingProof(event("file.changed"))).toBe(false);
    expect(eventIsWorkingProof(event("session.started"))).toBe(false);
  });
});

function event(type: NormalizedEvent["type"], payload: Record<string, unknown> = {}): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${type}`,
    sessionId: "session-1",
    source: { adapter: "codex", surface: "hook", sourceEventId: `event-${type}` },
    occurredAt: "2026-07-07T12:00:00.000Z",
    receivedAt: "2026-07-07T12:00:00.000Z",
    type,
    summary: type,
    payload: { runtime: "codex", sourceSessionId: "source-1", ...payload },
    sensitivity: "metadata",
    payloadHash: `hash-${type}`,
    evidence: []
  };
}
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
npm test -- --run src/core/__tests__/livePermission.test.ts
```

Expected before implementation: FAIL because the module does not exist.

- [ ] **Step 3: Implement `src/core/livePermission.ts`**

Create:

```ts
import type { LiveRuntimeSemanticState } from "./liveState.ts";
import type { NormalizedEvent } from "./types.ts";

const BYPASS_PERMISSION_MODES = new Set([
  "bypasspermissions",
  "bypass_permissions",
  "full_access",
  "danger_full_access",
  "none",
  "disabled",
  "off"
]);

export function approvalEventRequiresPermission(event: NormalizedEvent): boolean {
  if (event.type !== "approval.requested") return false;
  const mode =
    normalizedPayloadToken(event, "permissionMode") ??
    normalizedPayloadToken(event, "permission_mode") ??
    normalizedPayloadToken(event, "approvalMode") ??
    normalizedPayloadToken(event, "approval_mode") ??
    normalizedPayloadToken(event, "sandbox_permissions");
  if (mode && BYPASS_PERMISSION_MODES.has(mode)) return false;
  if (event.payload.requiresApproval === false) return false;
  if (event.payload.requiresPermission === false) return false;
  if (event.payload.pending === false) return false;
  if (event.payload.autoApproved === true) return false;
  return true;
}

export function liveStateImpliedByEvent(event: NormalizedEvent): LiveRuntimeSemanticState | undefined {
  switch (event.type) {
    case "approval.requested":
      return approvalEventRequiresPermission(event) ? "blocked" : "working";
    case "approval.resolved":
    case "user.response":
    case "turn.started":
    case "command.started":
      return "working";
    case "turn.completed":
    case "session.closed":
    case "session.completed":
      return "idle";
    default:
      return undefined;
  }
}

export function eventIsWorkingProof(event: NormalizedEvent): boolean {
  return liveStateImpliedByEvent(event) === "working";
}

function normalizedPayloadToken(event: NormalizedEvent, key: string): string | undefined {
  const value = event.payload[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
```

- [ ] **Step 4: Run the policy tests**

Run:

```bash
npm test -- --run src/core/__tests__/livePermission.test.ts
```

Expected after implementation: PASS.

---

### Task 2: Stop Generating False Blocked Live-State Reports

**Files:**
- Modify: `src/core/liveState.ts`
- Modify: `src/core/liveHookAdapter.ts`
- Modify: `src/daemon/liveConnectorSettings.ts`
- Modify: `src/core/__tests__/liveState.test.ts`
- Modify: `src/core/__tests__/liveHookAdapter.test.ts`
- Modify: `src/daemon/__tests__/liveConnectorSettings.test.ts`

**Interfaces:**
- Consumes: `liveStateImpliedByEvent(...)`.
- Produces: `/live/state` reports that reserve `blocked` for pending permission.

- [ ] **Step 1: Update live-state normalization tests**

In `src/core/__tests__/liveState.test.ts`, replace the alias test with:

```ts
test("normalizes runtime aliases without treating user input as blocked", () => {
  expect(normalizeLiveState("running")).toBe("working");
  expect(normalizeLiveState("thinking")).toBe("working");
  expect(normalizeLiveState("waiting_for_approval")).toBe("blocked");
  expect(normalizeLiveState("approval_requested")).toBe("blocked");
  expect(normalizeLiveState("permission_requested")).toBe("blocked");
  expect(normalizeLiveState("needsInput")).toBeUndefined();
  expect(normalizeLiveState("waiting_for_user")).toBeUndefined();
  expect(normalizeLiveState("needs_user")).toBeUndefined();
  expect(normalizeLiveState("question_requested")).toBeUndefined();
  expect(normalizeLiveState("completed")).toBe("idle");
  expect(normalizeLiveState("stopped")).toBe("idle");
  expect(normalizeLiveState("ended")).toBe("idle");
  expect(normalizeLiveState("garbage")).toBeUndefined();
});
```

In the same file, update the default working TTL expectation from `12:01:30` to `12:00:30`:

```ts
expiresAt: "2026-07-07T12:00:30.000Z"
```

- [ ] **Step 2: Add hook live-state regression tests**

In `src/core/__tests__/liveHookAdapter.test.ts`, split the existing live-state report test and add:

```ts
test("does not derive blocked live state from user questions", () => {
  expect(
    liveStateReportFromHookPayload(
      {
        type: "user_question",
        sessionId: "question-session",
        timestamp: "2026-07-07T12:00:00.000Z",
        status: "needs_input"
      },
      { runtime: "omp", receivedAt: "2026-07-07T12:00:00.100Z" }
    )
  ).toBeUndefined();
});

test("does not derive blocked live state from bypass approval events", () => {
  expect(
    liveStateReportFromHookPayload(
      {
        hookEventName: "PermissionRequest",
        session_id: "codex-bypass-session",
        timestamp: "2026-07-07T12:00:00.000Z",
        permissionMode: "bypassPermissions"
      },
      { runtime: "codex", receivedAt: "2026-07-07T12:00:00.100Z" }
    )
  ).toMatchObject({
    sourceSessionId: "codex-bypass-session",
    state: "working"
  });
});
```

- [ ] **Step 3: Add generated connector regression tests**

In `src/daemon/__tests__/liveConnectorSettings.test.ts`, add a test that executes the generated OpenCode plugin through its public install output, matching the dynamic-import style of the existing generated OMP test:

```ts
test("generated OpenCode plugin does not post blocked state for questions or needs_input", async () => {
  const tempDir = await makeTempDir();
  const pluginPath = join(tempDir, "masthead-opencode-live.js");
  const originalPluginPath = process.env.MASTHEAD_OPENCODE_PLUGIN;
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: Record<string, unknown>; url: string }> = [];

  process.env.MASTHEAD_OPENCODE_PLUGIN = pluginPath;
  globalThis.fetch = (async (input, init) => {
    requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown>, url: String(input) });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    await installLiveConnector(configFor(tempDir), "opencode");
    const connectorModule = (await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`)) as {
      default: () => Promise<{ event: (input: { event: Record<string, unknown> }) => Promise<void> }>;
    };
    const connector = await connectorModule.default();
    await connector.event({
      event: {
        type: "question",
        properties: {
          session: { id: "opencode-question-session" },
          status: "needs_input",
          cwd: "/workspace/masthead"
        }
      }
    });
  } finally {
    if (originalPluginPath === undefined) delete process.env.MASTHEAD_OPENCODE_PLUGIN;
    else process.env.MASTHEAD_OPENCODE_PLUGIN = originalPluginPath;
    globalThis.fetch = originalFetch;
  }

  expect(requests.some((request) => request.url.includes("/ingest?runtime=opencode"))).toBe(true);
  expect(requests.filter((request) => request.url.includes("/live/state")).map((request) => request.body.state)).not.toContain("blocked");
});
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
npm test -- --run \
  src/core/__tests__/liveState.test.ts \
  src/core/__tests__/liveHookAdapter.test.ts \
  src/daemon/__tests__/liveConnectorSettings.test.ts
```

Expected before implementation: FAIL because user-input aliases and hook-derived question states still become blocked.

- [ ] **Step 5: Implement normalization changes**

In `src/core/liveState.ts`:

```ts
const DEFAULT_TTL_BY_STATE: Record<LiveRuntimeSemanticState, number> = {
  working: 30_000,
  blocked: 10 * 60_000,
  idle: 24 * 60 * 60_000,
  unknown: 60_000
};

const BLOCKED_ALIASES = new Set([
  "blocked",
  "waiting_for_approval",
  "approval_requested",
  "approval_required",
  "requires_approval",
  "permission_requested"
]);
```

- [ ] **Step 6: Implement hook live-state policy**

In `src/core/liveHookAdapter.ts`:

- Import `liveStateImpliedByEvent` from `./livePermission.ts`.
- Replace `stateImpliedByEventType(type)` with `liveStateImpliedByEvent(event)`.
- Guard user questions so explicit `needs_input`/`waiting_for_user` cannot become blocked:

```ts
const explicitState =
  event.type === "user.question"
    ? undefined
    : normalizeLiveState(event.payload.runtimeLifecycleState) ??
      normalizeLiveState(firstPayloadString(event, ["state", "status", "runtimeState", "lifecycleState"]));
const impliedState = liveStateImpliedByEvent(event);
const state = explicitState ?? impliedState;
```

Delete the old `stateImpliedByEventType(...)` function.

- [ ] **Step 7: Fix generated connector state machines**

In `src/daemon/liveConnectorSettings.ts`:

- Remove `question` and `needs_input|waiting_for_user` from any generated state classifier that returns `"blocked"`.
- Keep approval/permission requested/resolved state machines.
- Ensure OpenCode-style generated code behaves like:

```js
if (/permission|approval/.test(type) || /blocked|approval/.test(status)) return "blocked";
if (/stop|complete|completed|idle|session\\.end|sessionend/.test(type) || /idle|complete|completed|stopped|done/.test(status)) return "idle";
if (/session|tool|message|input|run|start|created/.test(type) || /running|working|active|busy/.test(status)) return "working";
```

Do not add access-mode tracking to connector output.

- [ ] **Step 8: Run tests**

Run:

```bash
npm test -- --run \
  src/core/__tests__/liveState.test.ts \
  src/core/__tests__/liveHookAdapter.test.ts \
  src/daemon/__tests__/liveConnectorSettings.test.ts
```

Expected after implementation: PASS.

---

### Task 3: Make Live Blockers Permission-Only And Freshness-Bounded

**Files:**
- Modify: `src/core/liveBlockers.ts`
- Modify: `src/core/__tests__/liveBlockers.test.ts`

**Interfaces:**
- Consumes: `approvalEventRequiresPermission(...)`.
- Produces: `deriveLiveBlockers(events, options?)`.

- [ ] **Step 1: Replace blocker tests**

In `src/core/__tests__/liveBlockers.test.ts`, keep the approval open/resolve test and replace the question tests with:

```ts
test("does not open blockers for user questions", () => {
  const blockers = deriveLiveBlockers([
    event("question-1", "user.question", "2026-07-07T12:00:00.000Z"),
    event("response-1", "user.response", "2026-07-07T12:01:00.000Z")
  ]);

  expect(blockers.get("session-1")).toEqual([]);
});

test("ignores bypass approval events", () => {
  const blockers = deriveLiveBlockers([
    event("approval-1", "approval.requested", "2026-07-07T12:00:00.000Z", {
      permissionMode: "bypassPermissions",
      toolName: "mcp__gbrain__search"
    })
  ]);

  expect(blockers.get("session-1")).toEqual([]);
});

test("keeps fresh unresolved permission approvals grouped by session", () => {
  const blockers = deriveLiveBlockers(
    [
      event("approval-1", "approval.requested", "2026-07-07T12:00:00.000Z", {
        permissionMode: "on-request",
        commandId: "cmd-1"
      })
    ],
    { now: new Date("2026-07-07T12:01:59.000Z"), maxAgeMs: 120_000 }
  );

  expect(blockers.get("session-1")?.map((blocker) => blocker.kind)).toEqual(["approval"]);
});

test("expires stale unresolved approval blockers", () => {
  const blockers = deriveLiveBlockers(
    [
      event("approval-1", "approval.requested", "2026-07-07T12:00:00.000Z", {
        permissionMode: "on-request",
        commandId: "cmd-1"
      })
    ],
    { now: new Date("2026-07-07T12:02:01.000Z"), maxAgeMs: 120_000 }
  );

  expect(blockers.get("session-1")).toEqual([]);
});

test("resolves approval blockers when the approved command starts", () => {
  const blockers = deriveLiveBlockers([
    event("approval-1", "approval.requested", "2026-07-07T12:00:00.000Z", {
      permissionMode: "on-request",
      commandId: "cmd-1"
    }),
    event("command-1", "command.started", "2026-07-07T12:00:10.000Z", {
      commandId: "cmd-1"
    })
  ]);

  expect(blockers.get("session-1")).toEqual([]);
});
```

- [ ] **Step 2: Run blocker tests and verify failure**

Run:

```bash
npm test -- --run src/core/__tests__/liveBlockers.test.ts
```

Expected before implementation: FAIL because question blockers and stale unresolved blockers are still returned.

- [ ] **Step 3: Implement blocker options and policy**

In `src/core/liveBlockers.ts`:

- Change `LiveBlockerKind` to:

```ts
export type LiveBlockerKind = "approval";
```

- Change the function signature:

```ts
export function deriveLiveBlockers(
  events: NormalizedEvent[],
  options: { now?: Date; maxAgeMs?: number } = {}
): Map<string, LiveBlocker[]> {
```

- Use `approvalEventRequiresPermission(event)` before opening a blocker.
- Remove all `user.question` blocker creation and resolution logic.
- Treat `approval.resolved`, matching `command.started`, `turn.completed` without waiting, and `session.closed` as resolvers.
- After resolving, filter unresolved blockers by `maxAgeMs` when `options.now` is provided:

```ts
const nowMs = options.now?.getTime();
const maxAgeMs = options.maxAgeMs;
for (const [sessionId, blockers] of grouped) {
  grouped.set(
    sessionId,
    blockers.filter((blocker) => {
      if (blocker.resolvedAt) return false;
      if (nowMs === undefined || maxAgeMs === undefined) return true;
      const openedAtMs = Date.parse(blocker.openedAt);
      return Number.isFinite(openedAtMs) && nowMs - openedAtMs <= maxAgeMs;
    })
  );
}
```

- [ ] **Step 4: Run blocker tests**

Run:

```bash
npm test -- --run src/core/__tests__/liveBlockers.test.ts
```

Expected after implementation: PASS.

---

### Task 4: Expire Event-Derived Active In The Projection Selector

**Files:**
- Modify: `src/core/liveProjectionState.ts`
- Modify: `src/core/__tests__/liveProjectionState.test.ts`

**Interfaces:**
- Consumes: `liveStateImpliedByEvent(...)`.
- Produces: `selectEffectiveLiveState({ latestStateEvent, eventWorkingGraceMs })`.

- [ ] **Step 1: Add selector tests**

Append these tests to `src/core/__tests__/liveProjectionState.test.ts`:

```ts
test("fresh command event can imply working inside the refresh grace window", () => {
  const effective = selectEffectiveLiveState({
    session: session({ primaryStatus: "reading", lifecycle: "running" }),
    latestEvent: event("command.started", "2026-07-07T12:00:00.000Z"),
    latestStateEvent: event("command.started", "2026-07-07T12:00:00.000Z"),
    unresolvedBlockers: [],
    now: new Date("2026-07-07T12:00:19.000Z"),
    eventWorkingGraceMs: 20_000
  });

  expect(effective).toMatchObject({
    semanticState: "working",
    displayState: "working",
    authority: "event",
    stateObservedAt: "2026-07-07T12:00:00.000Z"
  });
});

test("stale command event demotes to idle on projection refresh", () => {
  const effective = selectEffectiveLiveState({
    session: session({ primaryStatus: "reading", lifecycle: "running" }),
    latestEvent: event("file.changed", "2026-07-07T12:00:05.000Z"),
    latestStateEvent: event("command.started", "2026-07-07T12:00:00.000Z"),
    unresolvedBlockers: [],
    now: new Date("2026-07-07T12:00:21.000Z"),
    eventWorkingGraceMs: 20_000
  });

  expect(effective).toMatchObject({
    semanticState: "idle",
    displayState: "idle",
    authority: "timeout",
    stale: true
  });
});

test("user questions are not live blockers", () => {
  const question = event("user.question", "2026-07-07T12:00:00.000Z");
  const effective = selectEffectiveLiveState({
    session: session({ primaryStatus: "waiting_for_user", lifecycle: "running" }),
    latestEvent: question,
    latestStateEvent: undefined,
    unresolvedBlockers: [],
    now: new Date("2026-07-07T12:00:05.000Z"),
    eventWorkingGraceMs: 20_000
  });

  expect(effective).toMatchObject({
    semanticState: "idle",
    displayState: "idle",
    authority: "timeout",
    stale: true
  });
});

test("running sessions without fresh proof are demoted to idle", () => {
  const effective = selectEffectiveLiveState({
    session: session({ primaryStatus: "reading", lifecycle: "running" }),
    latestEvent: event("session.started", "2026-07-07T12:00:00.000Z"),
    latestStateEvent: undefined,
    unresolvedBlockers: [],
    now: new Date("2026-07-07T12:00:21.000Z"),
    eventWorkingGraceMs: 20_000
  });

  expect(effective).toMatchObject({
    semanticState: "idle",
    displayState: "idle",
    authority: "timeout",
    stale: true
  });
});
```

Update the local helper signature:

```ts
function event(type: NormalizedEvent["type"], occurredAt = "2026-07-07T12:00:00.000Z"): NormalizedEvent {
```

- [ ] **Step 2: Run selector tests and verify failure**

Run:

```bash
npm test -- --run src/core/__tests__/liveProjectionState.test.ts
```

Expected before implementation: FAIL because stale event-derived working and user questions still leak into live state.

- [ ] **Step 3: Implement selector inputs and ordering**

In `src/core/liveProjectionState.ts`:

- Import `liveStateImpliedByEvent`.
- Add input fields:

```ts
latestStateEvent?: NormalizedEvent;
eventWorkingGraceMs?: number;
```

- Keep the authority order:

1. fresh `latestLiveState.state === "blocked"`
2. unresolved blockers
3. fresh nonblocked live-state report
4. latest state-bearing event inside freshness rules
5. idle lifecycle
6. stale idle fallback

- Replace raw `session.primaryStatus === "waiting_for_approval" | "waiting_for_user"` blocker fallback with no fallback.

- [ ] **Step 4: Implement stale idle helper**

Use:

```ts
function staleIdle(event: NormalizedEvent | undefined, reason: string): EffectiveLiveState {
  return {
    semanticState: "idle",
    displayState: displayStateForLiveState("idle", { unseenCompletedTurn: false }),
    authority: "timeout",
    reason,
    stateObservedAt: event?.occurredAt,
    stale: true
  };
}
```

For event-derived state:

```ts
const eventWorkingGraceMs = input.eventWorkingGraceMs ?? 30_000;
const eventState = input.latestStateEvent ? liveStateImpliedByEvent(input.latestStateEvent) : undefined;
if (eventState === "working" && input.latestStateEvent) {
  if (eventIsFresh(input.latestStateEvent, input.now, eventWorkingGraceMs)) {
    return {
      semanticState: "working",
      displayState: displayStateForLiveState("working", { unseenCompletedTurn }),
      authority: "event",
      reason: `Latest state-bearing event ${input.latestStateEvent.type} is within the live activity grace window.`,
      stateObservedAt: input.latestStateEvent.occurredAt
    };
  }
  return staleIdle(input.latestStateEvent, `Latest working event ${input.latestStateEvent.type} is older than the live activity grace window.`);
}
if (eventState === "idle" && input.latestStateEvent) {
  return {
    semanticState: "idle",
    displayState: displayStateForLiveState("idle", { unseenCompletedTurn }),
    authority: "event",
    reason: `Latest state-bearing event ${input.latestStateEvent.type} implies idle.`,
    stateObservedAt: input.latestStateEvent.occurredAt
  };
}
if (input.session.lifecycle === "idle") {
  return {
    semanticState: "idle",
    displayState: displayStateForLiveState("idle", { unseenCompletedTurn }),
    authority: "timeout",
    reason: "Session is idle by timeout or closed lifecycle.",
    stale: Boolean(input.latestLiveState && !freshLiveState)
  };
}
if (input.session.lifecycle === "running") {
  return staleIdle(input.latestStateEvent ?? input.latestEvent, "Session has no fresh live-state report, unresolved approval blocker, or recent working event.");
}
```

- [ ] **Step 5: Run selector tests**

Run:

```bash
npm test -- --run src/core/__tests__/liveProjectionState.test.ts
```

Expected after implementation: PASS.

---

### Task 5: Wire Refresh Freshness Through Projection And Daemon

**Files:**
- Modify: `src/core/liveProjection.ts`
- Modify: `src/core/replay.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/core/__tests__/liveProjection.test.ts`
- Modify: `src/core/__tests__/projection.test.ts`

**Interfaces:**
- Produces: `projectLiveEvents(..., { refreshIntervalMs })`.
- Produces: `projectFixture(..., { eventWorkingGraceMs })`.
- Produces: `/projection?refreshIntervalMs=10000` demotes stale Active on subsequent polls.

- [ ] **Step 1: Add projection regression tests**

In `src/core/__tests__/liveProjection.test.ts`, add:

```ts
test("refresh interval expires stale event-derived active sessions", () => {
  const started = normalizeSupportedHookPayload(
    {
      provider_event_id: "stale-start",
      event: "session_started",
      session_id: "stale-live-session",
      timestamp: "2026-07-07T12:00:00.000Z",
      cwd: "/workspace/masthead",
      project: "Masthead",
      title: "Stale live session"
    },
    { receivedAt: "2026-07-07T12:00:00.010Z" }
  );
  const command = normalizeSupportedHookPayload(
    {
      provider_event_id: "stale-command",
      event: "command_started",
      session_id: "stale-live-session",
      timestamp: "2026-07-07T12:00:01.000Z",
      cwd: "/workspace/masthead",
      project: "Masthead",
      command_id: "cmd-1",
      command: "npm test"
    },
    { receivedAt: "2026-07-07T12:00:01.010Z" }
  );

  const envelope = projectLiveEvents([started, command], [], {
    generatedAt: "2026-07-07T12:00:25.000Z",
    refreshIntervalMs: 10_000,
    headlineMode: "offline"
  });

  expect(envelope.projection.cards[0]).toMatchObject({
    sessionId: "stale-live-session",
    lifecycle: "idle",
    primaryStatus: "stalled",
    displayState: "idle",
    stateAuthority: "timeout",
    stateStale: true
  });
  expect(envelope.projection.summary.active).toBe(0);
});
```

Add:

```ts
test("bypass approval does not create a blocked board card", () => {
  const approval = normalizeSupportedHookPayload(
    {
      provider_event_id: "bypass-approval",
      event: "approval_requested",
      session_id: "bypass-session",
      timestamp: "2026-07-07T12:00:00.000Z",
      cwd: "/workspace/masthead",
      project: "Masthead",
      permissionMode: "bypassPermissions"
    },
    { receivedAt: "2026-07-07T12:00:00.010Z" }
  );

  const envelope = projectLiveEvents([approval], [], {
    generatedAt: "2026-07-07T12:00:05.000Z",
    refreshIntervalMs: 10_000,
    headlineMode: "offline"
  });

  expect(envelope.projection.cards[0]).toMatchObject({
    sessionId: "bypass-session",
    displayState: "working"
  });
  expect(envelope.projection.cards[0]?.stateLabel).not.toBe("Blocked");
  expect(envelope.projection.summary.needsAction).toBe(0);
});
```

- [ ] **Step 2: Run projection tests and verify failure**

Run:

```bash
npm test -- --run src/core/__tests__/liveProjection.test.ts src/core/__tests__/projection.test.ts
```

Expected before implementation: FAIL because refresh interval is not connected to state selection and bypass approval still blocks.

- [ ] **Step 3: Add freshness options**

In `src/core/liveProjection.ts`, add:

```ts
refreshIntervalMs?: number;
eventWorkingGraceMs?: number;
```

Export:

```ts
export function eventWorkingGraceMsForRefresh(refreshIntervalMs: number | undefined): number {
  if (!Number.isFinite(refreshIntervalMs)) return 30_000;
  return Math.max(15_000, Math.min(60_000, Number(refreshIntervalMs) * 2));
}

export function approvalBlockerTtlMsForRefresh(refreshIntervalMs: number | undefined): number {
  if (!Number.isFinite(refreshIntervalMs)) return 10 * 60_000;
  return Math.max(60_000, Math.min(10 * 60_000, Number(refreshIntervalMs) * 12));
}
```

Pass to `projectFixture(...)`:

```ts
eventWorkingGraceMs: options.eventWorkingGraceMs ?? eventWorkingGraceMsForRefresh(options.refreshIntervalMs),
```

- [ ] **Step 4: Use latest state-bearing event in replay**

In `src/core/replay.ts`:

- Add `eventWorkingGraceMs?: number` to `ProjectFixtureOptions`.
- Pass it into `toCard(...)`.
- Import `liveStateImpliedByEvent`.
- Add:

```ts
function latestStateEvent(events: NormalizedEvent[]): NormalizedEvent | undefined {
  return events
    .filter((event) => liveStateImpliedByEvent(event) !== undefined)
    .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .at(-1);
}
```

- Pass both `latestEvent` and `latestStateEvent(sessionEvents)` into `selectEffectiveLiveState(...)`.

- [ ] **Step 5: Pass refresh and blocker TTL from daemon**

In `src/daemon/server.ts`, update `/projection`:

```ts
const projectionNow = new Date();
const blockerTtlMs = approvalBlockerTtlMsForRefresh(refreshIntervalMs);
const blockers = deriveLiveBlockers(projectionEvents, { now: projectionNow, maxAgeMs: blockerTtlMs });
const liveEnvelope = projectLiveEvents(projectionEvents, projectionGitSnapshots, {
  selectedSessionId,
  sessionEnrichments: liveProjectionEnrichments(database, projectionSessionIds),
  sessionHeadlineViews,
  sessionTranscriptFacts: liveProjectionTranscriptFacts(database, projectionSessionIds),
  liveStateReports,
  blockers,
  headlineMode,
  diagnostics: state.diagnostics.length,
  refreshIntervalMs,
  generatedAt: projectionNow.toISOString()
});
```

Import `approvalBlockerTtlMsForRefresh` beside `projectLiveEvents`.

- [ ] **Step 6: Update old projection fixtures deliberately**

Run:

```bash
rg -n "Needs approval|Needs input|Generating headline|lifecycle: \"running\"|primaryStatus: \"waiting_for_approval\"" \
  src/core/__tests__/liveProjection.test.ts \
  src/core/__tests__/projection.test.ts
```

For tests intended to assert active behavior, add a fresh `liveStateReports` entry. For tests intended to assert historical metadata, keep the metadata but assert the Board display state separately.

Example fresh active report:

```ts
liveStateReports: new Map([
  [
    "running-session",
    normalizeLiveStateReport({
      runtime: "codex",
      source: "test",
      sourceSessionId: "running-session",
      state: "working",
      observedAt: "2026-06-23T02:09:45.000Z"
    })
  ]
])
```

- [ ] **Step 7: Run projection tests**

Run:

```bash
npm test -- --run src/core/__tests__/liveProjection.test.ts src/core/__tests__/projection.test.ts
```

Expected after implementation: PASS.

---

### Task 6: Collapse Core Replay And UI To A Single `Blocked` Label

**Files:**
- Modify: `src/core/replay.ts`
- Modify: `src/ui/format.ts`
- Modify: `src/ui/SessionCard.tsx`
- Modify: `src/ui/__tests__/observabilitySessionCard.test.tsx`
- Modify: `src/ui/__tests__/dovetailCardSystem.test.tsx`
- Modify: `src/ui/__tests__/filterBoard.test.ts`

**Interfaces:**
- Produces: Board cards never render `Needs approval`, `Needs input`, or `is-waiting`.
- Produces: UI blocked checks trust projected state, not raw waiting metadata.

- [ ] **Step 1: Update UI tests**

In `src/ui/__tests__/observabilitySessionCard.test.tsx`, replace waiting-copy tests with:

```tsx
test("renders projected permission blockers as blocked and user waits as nonblocked idle", () => {
  const approval = renderToStaticMarkup(
    <SessionCard
      session={session({
        lifecycle: "running",
        primaryStatus: "blocked",
        displayState: "blocked",
        runtimeState: "blocked",
        stateLabel: "Blocked",
        indicators: ["attention"]
      })}
      onToggle={() => undefined}
    />
  );
  const input = renderToStaticMarkup(
    <SessionCard
      session={{
        ...session({
          lifecycle: "idle",
          primaryStatus: "stalled",
          displayState: "idle",
          runtimeState: "idle",
          stateLabel: "Idle",
          indicators: ["attention"]
        }),
        attentionReason: "User input requested"
      }}
      onToggle={() => undefined}
    />
  );

  expect(approval).toContain(">Blocked<");
  expect(approval).toContain("is-blocked");
  expect(approval).not.toContain("Needs approval");
  expect(approval).not.toContain("is-waiting");

  expect(input).toContain(">Idle<");
  expect(input).not.toContain("Needs input");
  expect(input).not.toContain("is-blocked");
  expect(input).not.toContain("is-waiting");
});
```

Update `stateClassName(...)` assertions:

```ts
expect(stateClassName(session({ lifecycle: "running", primaryStatus: "blocked", displayState: "blocked", indicators: ["attention"] }))).toBe("needs-attention");
expect(stateClassName(session({ lifecycle: "running", primaryStatus: "waiting_for_approval", displayState: "working", indicators: ["attention"] }))).toBe("running");
expect(stateClassName(session({ lifecycle: "idle", primaryStatus: "waiting_for_user", displayState: "idle", indicators: ["attention"] }))).toBe("stalled");
```

In `src/ui/__tests__/dovetailCardSystem.test.tsx`, replace `is-waiting` expectations with `is-blocked` only for projected blocked cards and `is-idle` for user-wait examples.

In `src/ui/__tests__/filterBoard.test.ts`, assert the blocked lifecycle filter returns cards with `displayState: "blocked"` or `primaryStatus: "blocked"`, not raw `waiting_for_approval`.

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
npm test -- --run \
  src/ui/__tests__/observabilitySessionCard.test.tsx \
  src/ui/__tests__/dovetailCardSystem.test.tsx \
  src/ui/__tests__/filterBoard.test.ts
```

Expected before implementation: FAIL because waiting labels/classes still exist.

- [ ] **Step 3: Collapse replay status and labels**

In `src/core/replay.ts`:

- Replace blocked status mapping with:

```ts
if (displayState === "blocked") return "blocked";
```

- Replace blocked label mapping with:

```ts
if (displayState === "blocked") return "Blocked";
```

- In `signalsFromCard(...)`, remove:

```ts
if (card.primaryStatus === "blocked") signals.add("command_failed");
```

Approval attention remains represented by `attentionItems`; blocked is not command failure.

- [ ] **Step 4: Simplify UI state helpers**

In `src/ui/format.ts`, remove `waitingSessionLabel(...)`.

Use:

```ts
export function isBlockedSessionCard(session: SessionCardView): boolean {
  return (
    session.displayState === "blocked" ||
    session.runtimeState === "blocked" ||
    session.primaryStatus === "blocked" ||
    session.outcomeLabel === "blocked" ||
    session.endReason === "blocked"
  );
}
```

Do not include `primaryStatus === "waiting_for_approval"` or `primaryStatus === "waiting_for_user"` in this predicate.

Use:

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

- [ ] **Step 5: Remove waiting rendering from `SessionCard.tsx`**

Change import:

```ts
import { isBlockedSessionCard } from "./format";
```

Replace the state functions:

```ts
function sessionStatePillLabel(session: SessionCardView): string {
  if (isBlockedSessionCard(session)) return "Blocked";
  if (session.lifecycle === "idle" || session.lifecycle === "ended" || session.primaryStatus === "stalled") return "Idle";
  return "Active";
}

function sessionStateClassName(session: SessionCardView): "is-active" | "is-idle" | "is-blocked" {
  if (isBlockedSessionCard(session)) return "is-blocked";
  if (session.lifecycle === "idle" || session.lifecycle === "ended" || session.primaryStatus === "stalled") return "is-idle";
  return "is-active";
}

function sessionVisualTier(session: SessionCardView): SessionVisualTier {
  if (isBlockedSessionCard(session)) return "action";
  if (session.lifecycle === "idle" || session.lifecycle === "ended" || session.primaryStatus === "stalled") {
    return session.primaryStatus === "failed" || session.outcomeLabel === "failed" ? "action" : "quiet";
  }
  return "live";
}
```

Search for remaining waiting UI:

```bash
rg -n "waitingSessionLabel|is-waiting|Needs approval|Needs input" src/ui src/app
```

Expected after implementation: no production-code matches.

- [ ] **Step 6: Run UI tests**

Run:

```bash
npm test -- --run \
  src/ui/__tests__/observabilitySessionCard.test.tsx \
  src/ui/__tests__/dovetailCardSystem.test.tsx \
  src/ui/__tests__/filterBoard.test.ts
```

Expected after implementation: PASS.

---

### Task 7: Update Notifications And Broader Fixture Expectations

**Files:**
- Modify: `src/app/__tests__/liveSessionEndedNotifications.test.ts`
- Modify only failing fixture tests in `src/core/__tests__` and `src/app/__tests__`.

**Interfaces:**
- Produces: notification transitions use projected blocked state only.
- Produces: old `Needs approval` / `Needs input` expectations are removed from Board/UI tests.

- [ ] **Step 1: Replace notification transition test**

In `src/app/__tests__/liveSessionEndedNotifications.test.ts`, replace the approval-waiting test with:

```ts
it("detects running sessions becoming idle, permission-blocked, or ended without treating user input as blocked", () => {
  const previous = projection([
    card({ sessionId: "idle", headline: cardHeadline("Idle candidate") }),
    card({ sessionId: "approval", headline: cardHeadline("Approval candidate") }),
    card({ sessionId: "input", headline: cardHeadline("Input candidate") }),
    card({ sessionId: "ended", headline: cardHeadline("Ended candidate") })
  ]);
  const next = projection([
    card({ sessionId: "idle", lifecycle: "idle", stateLabel: "Idle", headline: cardHeadline("Idle candidate") }),
    card({
      sessionId: "approval",
      primaryStatus: "blocked",
      displayState: "blocked",
      runtimeState: "blocked",
      stateLabel: "Blocked",
      attentionReason: "Approval requested",
      headline: cardHeadline("Approval candidate")
    }),
    card({
      sessionId: "input",
      primaryStatus: "stalled",
      lifecycle: "idle",
      displayState: "idle",
      runtimeState: "idle",
      stateLabel: "Idle",
      attentionReason: "User input requested",
      headline: cardHeadline("Input candidate")
    }),
    card({
      sessionId: "ended",
      lifecycle: "ended",
      outcomeLabel: "completed",
      stateLabel: "Completed",
      headline: cardHeadline("Ended candidate")
    })
  ]);

  expect(detectSessionNotificationTransitions(previous, next)).toEqual([
    { sessionId: "idle", transition: "idle", title: "Idle candidate", body: "Idle" },
    { sessionId: "approval", transition: "blocked", title: "Approval candidate", body: "Blocked: Approval requested" },
    { sessionId: "input", transition: "idle", title: "Input candidate", body: "Idle: User input requested" },
    { sessionId: "ended", transition: "ended", title: "Ended candidate", body: "Ended: Completed" }
  ]);
});
```

- [ ] **Step 2: Sweep obsolete test expectations**

Run:

```bash
rg -n "Needs approval|Needs input|is-waiting|without treating approval waiting as blocked" src -g '*.test.ts' -g '*.test.tsx'
```

Apply these replacements:

- Permission blocker tests: `stateLabel: "Blocked"`, `primaryStatus: "blocked"`, `displayState: "blocked"`.
- User-question tests: `stateLabel: "Idle"` or existing nonblocked lifecycle label; keep attention reason if the test needs it.
- Board headline tests: do not use `waiting_for_user` as a blocked/headline state. Keep it only as raw fixture metadata when the test explicitly covers metadata preservation.
- Session reducer tests may continue to assert raw historical `waiting_for_user` metadata if they are not Board/UI tests.

- [ ] **Step 3: Run affected tests**

Run:

```bash
npm test -- --run \
  src/app/__tests__/liveSessionEndedNotifications.test.ts \
  src/core/__tests__/boardHeadlineEnricher.test.ts \
  src/core/__tests__/dogfood.test.ts \
  src/core/__tests__/ingestServer.test.ts \
  src/app/__tests__/liveProjectionClient.test.ts
```

Expected: PASS after fixture updates.

---

### Task 8: End-To-End Verification And Rollback Notes

**Files:**
- No planned code changes.

**Interfaces:**
- Produces: verified implementation ready for a production build/install task.

- [ ] **Step 1: Run focused regression suite**

Run:

```bash
npm test -- --run \
  src/core/__tests__/livePermission.test.ts \
  src/core/__tests__/liveState.test.ts \
  src/core/__tests__/liveHookAdapter.test.ts \
  src/core/__tests__/liveBlockers.test.ts \
  src/core/__tests__/liveProjectionState.test.ts \
  src/core/__tests__/liveProjection.test.ts \
  src/core/__tests__/projection.test.ts \
  src/daemon/__tests__/liveConnectorSettings.test.ts \
  src/ui/__tests__/observabilitySessionCard.test.tsx \
  src/ui/__tests__/dovetailCardSystem.test.tsx \
  src/ui/__tests__/filterBoard.test.ts \
  src/app/__tests__/liveSessionEndedNotifications.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run build and full tests**

Run:

```bash
npm run build
npm test -- --run
```

Expected: both commands exit 0.

- [ ] **Step 3: Run live smoke**

Run:

```bash
npm run smoke:live
```

Expected: exits 0 and still proves fresh live evidence can create active cards.

- [ ] **Step 4: Manual Board acceptance**

Start the dev app:

```bash
npm run dev
```

Manual acceptance:

- Set Board refresh to `10s`.
- Start from a database containing old `command.started` or `turn.started` events with no fresh live-state report.
- Confirm those cards leave Active within two refreshes.
- Confirm a fresh `working` live-state report shows Active and then leaves Active after its 30s TTL if no new proof arrives.
- Confirm a real pending approval request shows exactly `Blocked`.
- Confirm an approval request with `permissionMode: "bypassPermissions"` never shows `Blocked`.
- Confirm `user.question` / `needs_input` never renders `Needs input` or `Blocked`.
- Confirm Board active count equals the number of cards in the running lane.

- [ ] **Step 5: Rollback notes for production install**

If this ships to the production app menu build and the Board becomes too conservative:

- Restore only the prior production bundle symlink under `~/.local/share/masthead-production/current` if an older bundle still exists during the install window.
- Prefer reverting the implementation commit over loosening UI predicates.
- Do not re-add process scanning or access-mode UI.
- If connectors are too quiet, add explicit heartbeat/live-state emissions in connector code with `ttlMs`; do not make projection infer long-running liveness from old events.

- [ ] **Step 6: Full product gate before app-menu replacement**

Run:

```bash
npm run verify
```

Expected: exits 0. If replacing the app-menu Masthead build, follow `docs/acceptance/product-release-gate.md` and the local disk hygiene rules in `AGENTS.md`.

---

## Non-Goals

- Do not add `Needs approval`, `Needs input`, or `Waiting` as live Board labels.
- Do not remove raw historical session statuses from Logbook/source evidence.
- Do not change the SQLite schema.
- Do not redesign Board cards, filters, or lanes.
- Do not add OS process liveness as an authority.
- Do not track sandbox/full-access mode in Masthead UI.

## Residual Risks

- A real permission prompt that remains unresolved after the blocker TTL will leave `Blocked` unless the connector continues posting fresh blocked live-state reports. This is intentional: without fresh proof, the Board should stop asserting current liveness.
- Long commands can leave Active after 30s if the harness emits no heartbeat or state update. The correct fix is connector heartbeat/TTL reporting, not historical inference.
- Some tests outside the listed files may still contain old waiting-label fixtures. Treat those as fixture alignment unless they reveal a production code path still rendering `Needs approval` or `Needs input`.
