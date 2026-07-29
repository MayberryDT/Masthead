# Authoring Campaign Status & Stall — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user runs Select all → Copy Agent Prompt, Workbench always shows durable campaign progress and marks the request stalled when the external agent stops writing to the daemon — without turning Activity into an active control plane, without batch caps, and with a stronger handoff prompt so agents ground verification and keep running until complete.

**Architecture:** Extend the existing incomplete V5 request read model (`GET /workbench/authoring/v5/requests`) with published/rejected counts and a pure stall signal derived from `updatedAt`. Poll that DTO from `useWorkbenchController` and render a compact **Campaign status** strip on Workbench (outside the Activity rail). Activity remains a passive event log. Strengthen `buildWorkbenchHandoff` so the pasted prompt encodes verification grounding and durable-milestone rules.

**Tech Stack:** TypeScript, Vitest, React (WorkbenchPanel), Masthead daemon HTTP, existing V5 authoring tables/DTOs.

**Date:** 2026-07-29  
**Status:** implemented on feat/authoring-campaign-status-stall (2026-07-29)  
**Incident source:** request `authoring-v5-request:acad2935-4223-43f4-9b84-5186b95d9e0b` on newuser-e2e (`d75fe426…`): 1/87 packs done, 0 published, 12 hard-reject, pack 2 active with no draft; daemon idle ~5.7h while Codex died mid local JSON edit.

---

## Frozen product decisions

| # | Decision | Default |
|---|---|---|
| D1 | Campaign status surface | **Yes** — compact strip on Workbench, **not** in Activity rail |
| D2 | Stall detection | **Yes** — derived from request `updatedAt` while status is `open`/`active` |
| D3 | Activity rail | **Unchanged** — passive read-only event log only; may *record* stall/progress events, never host campaign controls |
| D4 | Batch size caps / first-pack circuit breakers | **Out of scope** — Codex may own full select-all campaigns |
| D5 | Stall threshold | **30 minutes** idle (`STALL_MS = 30 * 60 * 1000`) with no request `updated_at` advance |
| D6 | Stall action | **Surface only** — do not auto-cancel request, do not auto-release pack claim in this plan (resume still works via existing bootstrap/status commands) |
| D7 | Handoff prompt | **Strengthen** verification + durable milestones + continue-until-complete (text only; no new CLI ops) |
| D8 | Multiple incomplete requests | Keep existing behavior: API returns **most recently updated** incomplete request only |

---

## Global constraints

- Logbook remains published-artifacts-only; this plan does not change publish gates.
- No Masthead-written enrichment prose.
- Do not invent a second authoring protocol; extend V5 incomplete summary + handoff builder.
- Do not put campaign controls or status chrome inside `.workbench-activity-rail`.
- Prefer pure functions for stall math (easy unit tests, no clock-in-DB).
- Worktree-safe: new read fields must stay behind existing read routes (`/workbench/authoring/v5/requests` is already bridged).
- Disk hygiene (AGENTS.md): no multi-GB DB archives during proof.

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/workbenchAuthoringV5.ts` | Extend incomplete summary DTO; export `STALL_MS` / stall helper types |
| `src/workbench/authoring/workbenchAuthoringV5Stall.ts` | Pure `evaluateAuthoringCampaignStall(updatedAt, now, thresholdMs)` |
| `src/workbench/authoring/workbenchAuthoringV5Service.ts` | Fill extended incomplete summary (published/rejected + stall fields) |
| `src/daemon/__tests__/workbenchAuthoringV5Api.test.ts` (or service unit tests) | API/summary contract for stall + counts |
| `src/app/daemonClient.ts` | Already has `getIncompleteWorkbenchAuthoringRequest` — type stays in shared |
| `src/app/workbench/useWorkbenchController.ts` | Poll incomplete request with queue; expose campaign view model |
| `src/ui/workbench/WorkbenchPanel.tsx` + `masthead.css` | Compact campaign status strip |
| `src/ui/workbench/workbenchHandoff.ts` | Stronger pasted prompt |
| `src/ui/workbench/__tests__/workbenchHandoff.test.ts` | Handoff content contract |
| `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx` | Campaign strip render / stall class |
| `src/app/workbench/__tests__/useWorkbenchController.test.tsx` | Poll + expose incomplete request |

---

## Out of scope (explicit)

- Auto-cancel stalled campaigns
- Auto-release active pack claims
- Turning Activity into a job console
- Batch size limits or first-pack pause policies
- Desktop OS notifications (optional later)
- Changing quality gate codes (verification gate stays)

---

## Task 1: Pure stall evaluation + DTO extension

**Files:**
- Create: `src/workbench/authoring/workbenchAuthoringV5Stall.ts`
- Create: `src/workbench/authoring/__tests__/workbenchAuthoringV5Stall.test.ts`
- Modify: `src/shared/workbenchAuthoringV5.ts` (`WorkbenchAuthoringV5IncompleteRequestSummaryDto`)

**Interfaces:**
- Produces:
  - `export const WORKBENCH_AUTHORING_V5_STALL_MS = 30 * 60 * 1000`
  - `export function evaluateAuthoringCampaignStall(input: { updatedAt: string; nowMs: number; stallMs?: number }): { stalled: boolean; idleMs: number }`
  - Extended summary fields (all optional-safe for older clients not needed — same process ships together):
    - `publishedSessionCount: number`
    - `rejectedSessionCount: number`
    - `softFlaggedSessionCount: number`
    - `stalled: boolean`
    - `idleMs: number`
    - `currentPackId?: string` (if already on full request DTO; add when cheap from same read)

- [ ] **Step 1: Write failing stall unit tests**

```ts
// src/workbench/authoring/__tests__/workbenchAuthoringV5Stall.test.ts
import { describe, expect, test } from "vitest";
import {
  WORKBENCH_AUTHORING_V5_STALL_MS,
  evaluateAuthoringCampaignStall
} from "../workbenchAuthoringV5Stall";

describe("evaluateAuthoringCampaignStall", () => {
  const updatedAt = "2026-07-28T21:40:25.195Z";
  const base = Date.parse(updatedAt);

  test("not stalled inside threshold", () => {
    const result = evaluateAuthoringCampaignStall({
      updatedAt,
      nowMs: base + WORKBENCH_AUTHORING_V5_STALL_MS - 1
    });
    expect(result.stalled).toBe(false);
    expect(result.idleMs).toBe(WORKBENCH_AUTHORING_V5_STALL_MS - 1);
  });

  test("stalled at and beyond threshold", () => {
    expect(
      evaluateAuthoringCampaignStall({
        updatedAt,
        nowMs: base + WORKBENCH_AUTHORING_V5_STALL_MS
      }).stalled
    ).toBe(true);
    expect(
      evaluateAuthoringCampaignStall({
        updatedAt,
        nowMs: base + WORKBENCH_AUTHORING_V5_STALL_MS + 3_600_000
      }).idleMs
    ).toBe(WORKBENCH_AUTHORING_V5_STALL_MS + 3_600_000);
  });

  test("invalid updatedAt yields not stalled with idleMs 0", () => {
    expect(evaluateAuthoringCampaignStall({ updatedAt: "nope", nowMs: base })).toEqual({
      stalled: false,
      idleMs: 0
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
npx vitest run src/workbench/authoring/__tests__/workbenchAuthoringV5Stall.test.ts
```

- [ ] **Step 3: Implement pure stall helper**

```ts
// src/workbench/authoring/workbenchAuthoringV5Stall.ts
export const WORKBENCH_AUTHORING_V5_STALL_MS = 30 * 60 * 1000;

export function evaluateAuthoringCampaignStall(input: {
  updatedAt: string;
  nowMs: number;
  stallMs?: number;
}): { stalled: boolean; idleMs: number } {
  const updatedMs = Date.parse(input.updatedAt);
  if (!Number.isFinite(updatedMs)) return { stalled: false, idleMs: 0 };
  const idleMs = Math.max(0, input.nowMs - updatedMs);
  const stallMs = input.stallMs ?? WORKBENCH_AUTHORING_V5_STALL_MS;
  return { stalled: idleMs >= stallMs, idleMs };
}
```

- [ ] **Step 4: Extend shared DTO**

In `WorkbenchAuthoringV5IncompleteRequestSummaryDto` add:

```ts
publishedSessionCount: number;
rejectedSessionCount: number;
softFlaggedSessionCount: number;
stalled: boolean;
idleMs: number;
currentPackId?: string;
```

Keep existing fields. Document that `sessionsCompleted` remains **attempted** count (do not rename — UI label must say "attempted" or "sessions done" carefully; prefer labels "Attempted / Published / Rejected").

- [ ] **Step 5: Re-run stall tests — expect PASS**

```bash
npx vitest run src/workbench/authoring/__tests__/workbenchAuthoringV5Stall.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/workbench/authoring/workbenchAuthoringV5Stall.ts \
  src/workbench/authoring/__tests__/workbenchAuthoringV5Stall.test.ts \
  src/shared/workbenchAuthoringV5.ts
git commit -m "feat(authoring): pure campaign stall evaluation and summary DTO fields"
```

---

## Task 2: Fill incomplete summary with counts + stall

**Files:**
- Modify: `src/workbench/authoring/workbenchAuthoringV5Service.ts` (`getIncompleteWorkbenchAuthoringV5RequestSummary`)
- Test: extend `src/workbench/authoring/__tests__/workbenchAuthoringV5Service.test.ts` **or** `src/daemon/__tests__/workbenchAuthoringV5Api.test.ts` (prefer service-level if fixtures exist; otherwise API GET after create + freeze clock via inject)

**Interfaces:**
- Consumes: `evaluateAuthoringCampaignStall`, request row fields `publishedSessionCount`, `rejectedSessionCount`, `softFlaggedSessionCount`, `updatedAt`, `currentPackId`
- Produces: full `WorkbenchAuthoringV5IncompleteRequestsDto` with new fields

- [ ] **Step 1: Write failing test** that incomplete summary includes published/rejected and `stalled: true` when `updatedAt` is old

Sketch (adapt to nearest existing V5 service fixture pattern in repo):

```ts
test("incomplete summary marks stalled after idle threshold and exposes disposition counts", () => {
  // arrange: create active request with known published/rejected counters and updatedAt in the past
  // act: getIncompleteWorkbenchAuthoringV5RequestSummary(db, { command: "/bin/mastheadctl" }, { nowMs })
  // assert:
  //   request.publishedSessionCount === …
  //   request.rejectedSessionCount === …
  //   request.stalled === true
  //   request.idleMs >= WORKBENCH_AUTHORING_V5_STALL_MS
});
```

If `getIncompleteWorkbenchAuthoringV5RequestSummary` cannot accept `nowMs` without a signature change, add optional third arg:

```ts
export function getIncompleteWorkbenchAuthoringV5RequestSummary(
  db: MastheadDatabase,
  input: { command: string },
  options: { nowMs?: number } = {}
): WorkbenchAuthoringV5IncompleteRequestsDto
```

Default `nowMs` to `Date.now()` in production.

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement summary fill**

In `getIncompleteWorkbenchAuthoringV5RequestSummary`, after loading `request`:

```ts
const stall = evaluateAuthoringCampaignStall({
  updatedAt: request.updatedAt,
  nowMs: options.nowMs ?? Date.now()
});
return {
  request: {
    requestId: request.requestId,
    status: request.status,
    packsCompleted,
    packCount: request.packCount,
    sessionsCompleted: request.attemptedSessionCount,
    sessionCount: request.sessionCount,
    publishedSessionCount: request.publishedSessionCount,
    rejectedSessionCount: request.rejectedSessionCount,
    softFlaggedSessionCount: request.softFlaggedSessionCount,
    stalled: stall.stalled,
    idleMs: stall.idleMs,
    ...(request.currentPackId ? { currentPackId: request.currentPackId } : {}),
    handoff: { /* existing bootstrap startCommand */ },
    updatedAt: request.updatedAt
  }
};
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/workbench/authoring/__tests__/workbenchAuthoringV5Service.test.ts
# and/or
npx vitest run src/daemon/__tests__/workbenchAuthoringV5Api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(authoring): incomplete request summary includes stall and disposition counts"
```

---

## Task 3: Workbench controller polls campaign summary

**Files:**
- Modify: `src/app/workbench/useWorkbenchController.ts`
- Modify: `src/app/workbench/__tests__/useWorkbenchController.test.tsx`

**Interfaces:**
- Consumes: `getIncompleteWorkbenchAuthoringRequest(activeProjectionUrl)`
- Produces on controller result:
  - `campaignRequest: WorkbenchAuthoringV5IncompleteRequestSummaryDto | null`
  - `campaignLoading: boolean` (optional; can fold into main loading if simpler)
  - refresh campaign on same cadence as queue reload / after successful `copy_agent_prompt`

- [ ] **Step 1: Write failing controller test**

```ts
test("loads incomplete authoring campaign summary for Workbench status strip", async () => {
  // mock getIncompleteWorkbenchAuthoringRequest → { request: { requestId, stalled: true, packsCompleted: 1, packCount: 87, ... } }
  // mount controller / act until idle
  // expect(latest().campaignRequest?.requestId).toBe("authoring-v5-request:…")
  // expect(latest().campaignRequest?.stalled).toBe(true)
});
```

- [ ] **Step 2: Run — expect FAIL** (property missing)

- [ ] **Step 3: Implement poll**

- On initial load and whenever workbench queue reloads, also fetch incomplete request.
- After `copy_agent_prompt` succeeds, immediately re-fetch incomplete summary (new campaign must appear without waiting for next poll).
- On fetch error: leave previous campaignRequest or set null; do not block queue rendering.
- Do **not** invent a second websocket; HTTP poll is enough (queue already polls).

- [ ] **Step 4: Run controller tests — expect PASS**

```bash
npx vitest run src/app/workbench/__tests__/useWorkbenchController.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(workbench): poll incomplete authoring campaign for status strip"
```

---

## Task 4: Campaign status strip UI (not Activity)

**Files:**
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/styles/masthead.css`
- Modify: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`
- Modify: Workbench surface wiring if props must pass through `WorkbenchSurface.tsx`

**Placement (locked):**
- Render **below the ops toolbar**, **above** quality-review / not-added panels and the session table.
- Class: `workbench-campaign-status` (not under `.workbench-activity-rail`).
- When no incomplete request: render nothing (no empty chrome).

**Copy (locked):**

| State | Presentation |
|---|---|
| Active, not stalled | `Campaign · 1/87 packs · 0 published · 12 rejected · 12 attempted · updated <relative or ISO short>` |
| Active, stalled | Same + visible **Stalled** token + idle duration e.g. `idle 5h 42m` |
| Open (not yet active) | `Campaign · preparing/open · N sessions · M packs` |

No buttons required in this plan (status only). Optional single quiet control **out of scope**: “Copy status command” — skip unless trivial; handoff already has bootstrap.

- [ ] **Step 1: Failing panel tests**

```ts
test("renders campaign status strip when incomplete request present", () => {
  const html = renderToStaticMarkup(
    <WorkbenchPanel
      campaignRequest={{
        requestId: "authoring-v5-request:one",
        status: "active",
        packsCompleted: 1,
        packCount: 87,
        sessionsCompleted: 12,
        sessionCount: 1039,
        publishedSessionCount: 0,
        rejectedSessionCount: 12,
        softFlaggedSessionCount: 0,
        stalled: true,
        idleMs: 6 * 3600_000,
        handoff: { requestId: "authoring-v5-request:one", startCommand: "…" },
        updatedAt: "2026-07-28T21:40:25.195Z"
      }}
    />
  );
  expect(html).toContain("workbench-campaign-status");
  expect(html).toContain("Stalled");
  expect(html).toContain("1/87");
  expect(html).toContain("0 published");
  expect(html).toContain("12 rejected");
  expect(html).not.toMatch(/workbench-activity-rail[\s\S]*workbench-campaign-status/);
});

test("omits campaign status strip when no incomplete request", () => {
  const html = renderToStaticMarkup(<WorkbenchPanel campaignRequest={null} />);
  expect(html).not.toContain("workbench-campaign-status");
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement strip + CSS**

- Compact mono labels matching existing fact tokens (reuse visual language of `.workbench-queue-facts` without moving those facts).
- Stalled: stronger border/color token (warning, not error-destructive).
- `aria-label="Authoring campaign status"`; when stalled `aria-live="polite"` once is enough (avoid noisy live regions on every poll — set live only when stalled transitions true if easy; else static label is OK for v1).

- [ ] **Step 4: Wire props from controller through surface**

Ensure `WorkbenchSurface` / App path passes `campaignRequest` into `WorkbenchPanel`.

- [ ] **Step 5: Tests PASS**

```bash
npx vitest run src/ui/workbench/__tests__/WorkbenchPanel.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(workbench): show authoring campaign status strip with stall"
```

---

## Task 5: Strengthen Copy Agent Prompt handoff text

**Files:**
- Modify: `src/ui/workbench/workbenchHandoff.ts`
- Modify: `src/ui/workbench/__tests__/workbenchHandoff.test.ts`

**Product intent:** Reduce pack-0 total reject and mid-edit abandon by making the pasted contract explicit. Soft text only — still paired with Tasks 1–4 for human visibility.

**Required lines (order locked):**

1. `Masthead authoring request: <id>`
2. `Start: <bootstrap command>`
3. `Stop rule: Do not stop until nextAction.kind is "complete" and a request receipt exists.`
4. `Pack finish is not request completion. Always run the returned nextAction.command next.`
5. `Scope: N sessions in M fixed packs (daemon-owned).` when counts available
6. **New** durable milestone line:  
   `Progress only counts when mastheadctl save/finish succeeds. Local file edits are not progress.`
7. **New** verification line:  
   `Verification: never set status "passed" with empty evidenceRefs.verification; if no verification evidence, use an honest not-run/boundary claim with refs (empty verification refs hard-reject).`
8. **New** loop line:  
   `After every finish, immediately run nextAction (and followUp if present). On hard_reject, read findings before the next pack and fix the pattern.`

Keep handoff free of session ids, worker/sub-agent mandates, and forbidden tool recipe strings (existing sanitizer / tests).

- [ ] **Step 1: Update handoff tests** for new lines + still no sessionIds / no sub-agent wording

```ts
test("handoff encodes verification grounding and durable milestones", () => {
  const text = buildWorkbenchHandoff({ capabilities, request: withScope as never });
  expect(text).toContain("Progress only counts when mastheadctl save/finish succeeds");
  expect(text).toContain('never set status "passed" with empty evidenceRefs.verification');
  expect(text).toContain("After every finish, immediately run nextAction");
  expect(text).not.toContain("sessionIds");
  expect(text.toLowerCase()).not.toMatch(/worker|nested agent|sub-agent|multi-agent/);
});
```

Adjust exact line-count assertions in existing tests (they currently expect 4 or 5 lines).

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `buildWorkbenchHandoff` lines**

- [ ] **Step 4: Tests PASS**

```bash
npx vitest run src/ui/workbench/__tests__/workbenchHandoff.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(workbench): strengthen authoring handoff prompt for verification and loop"
```

---

## Task 6: Acceptance proof (automated + manual checklist)

**Files:**
- Optional: short note under `docs/acceptance/` only if Tyler wants a permanent gate; otherwise keep proof in PR description.
- Test: one integration-style test if cheap — otherwise manual on e2e.

### Automated acceptance

- [ ] **Step 1: Run focused suite**

```bash
npx vitest run \
  src/workbench/authoring/__tests__/workbenchAuthoringV5Stall.test.ts \
  src/ui/workbench/__tests__/workbenchHandoff.test.ts \
  src/ui/workbench/__tests__/WorkbenchPanel.test.tsx \
  src/app/workbench/__tests__/useWorkbenchController.test.tsx
```

Expected: all PASS.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

### Manual acceptance (newuser-e2e or fixture)

Using the still-open request `acad2935…` **or** a fresh small select-all:

| # | Check | Pass criteria |
|---|---|---|
| M1 | Open Workbench with active incomplete request | Campaign strip visible with packs done/total and disposition counts |
| M2 | No agent writing for ≥30m (or inject old `updatedAt` in test DB) | Strip shows **Stalled** + idle time |
| M3 | Activity rail | Still passive event list only; no campaign chrome inside it |
| M4 | Copy Agent Prompt on new selection | Clipboard includes verification + durable milestone lines |
| M5 | After agent finishes one pack (reject or publish) | Counts update on next poll without restarting app |
| M6 | When request completes | Campaign strip disappears |

- [ ] **Step 3: Commit any acceptance doc only if added**

---

## Dependency graph

```text
Task 1 (stall pure + DTO)
   └─► Task 2 (summary fill)
          └─► Task 3 (controller poll)
                 └─► Task 4 (UI strip)
Task 5 (handoff prompt)  ── parallel with Tasks 1–4
Task 6 (acceptance)      ── after 1–5
```

Max parallel after Task 1: **Task 5** can run in parallel with Tasks 2–4.

---

## Self-review (plan author)

| Spec intent | Task |
|---|---|
| Campaign status surface | Task 4 (+ 2–3 data) |
| Stall detection | Tasks 1–2, surfaced in 4 |
| Activity stays passive | Task 4 placement constraint + out of scope |
| No batch caps / no circuit breaker | Frozen D4 + out of scope |
| Handoff prompt strength | Task 5 |
| No placeholders / concrete files | Yes |
| Existing incomplete API reused | Tasks 2–3 |

**Residual risks (accepted):**
- Soft prompt still cannot revive a dead agent process — stall strip is the user-visible truth.
- 30m threshold may be tight for huge inspect pages; adjust only via `WORKBENCH_AUTHORING_V5_STALL_MS` constant if dogfood complains.
- Summary uses `attemptedSessionCount` as `sessionsCompleted` historically — UI labels must not say “published” for that field.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-29-authoring-campaign-status-and-stall.md`.

**Two execution options when you want implementation:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans checkpoints  

**Which approach?** (Only after you say to implement.)
