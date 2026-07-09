# Workbench Ops Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Workbench into a complete human ops surface over the existing raw→publish pipeline: fix claim reads, wire every non-LLM operator action in the UI, restyle Activity as a high-contrast terminal-like rail within Masthead metal design, and dogfood the full loop until Logbook publication is proven.

**Architecture:** Keep the durable pipeline model (`workbench_session_state` / activity / claims) as the single source of truth. Extend daemon HTTP write routes for claim/release and quality review (transcript check/import and publish already exist). Expand the Workbench controller + panel into selection-driven ops (Check, Import, Accept/Fail quality, Publish, Claim/Release, Not Added review, Copy Agent Prompt for agent-only enrichment/dossier/bug-fix work). Restyle the Activity rail only—do not invent a second activity store.

**Tech Stack:** TypeScript daemon + SQLite repositories, React/Vitest renderer, existing `masthead.css` design tokens (`--space-*`, metal surfaces, mono fonts), `mastheadctl workbench` CLI, Electron Dev UI on `5173`.

**Contract sources:**
- `CONTEXT.md` (Workbench glossary)
- `docs/adr/0009-logbook-only-shows-published-sessions.md`
- `docs/acceptance/workbench-v1-evidence.md`
- Prior plans: `2026-07-08-workbench-pipeline-v1.md` (pipeline), `2026-07-08-workbench-ui-harness-neutrality.md` (chrome)

**Worktree (mandatory):**

```text
/home/tyler/.codex/worktrees/f503/Masthead
```

**Port rule:** Do not steal `5173` from Electron Dev. Prefer verifying in the running Electron Dev app / in-app Browser. For browser-only worktree UI use `MASTHEAD_UI_PORT=5180 npm run dev`.

---

## Product Decisions (locked for this plan)

### Human ops (in UI)

| Action | Who | Notes |
|---|---|---|
| Refresh queue / activity | Human | Already exists |
| Select / Select Visible / Clear | Human | Already exists |
| Check transcript | Human or agent | Daemon route exists; wire UI |
| Preview import | Human | Optional intermediate; show permission failures honestly |
| Import transcript | Human or agent | Source-scoped permission required |
| Accept quality | Human | New repository + API; deterministic precheck may auto-pass |
| Fail quality → Not Added path | Human | New API; sets `quality_status=failed` and moves off default queue |
| Publish | Human or agent | Daemon route exists; wire UI; gates enforced |
| Claim / Release | Human or agent | Repo+CLI exist; add HTTP; claim is a short-lived lease, not a task |
| Inspect Not Added | Human | Summary + expandable reason list + detail rows |
| Copy Agent Prompt | Human | Only path for enrichment / dossier / bug-fix authoring |

### Agent-only (no human authoring UI)

- Writing `session_enrichment` JSON
- Writing `session_dossier` / `bug_fix_trace` artifacts
- Applying validated enrichment/artifacts (CLI)

When `nextAction` is `enrich` or `create_dossier`, the UI primary action is **Copy Agent Prompt**, not an edit form.

### Visual

- Activity rail: darker inset “console” surface, event-type color tokens, mono metadata, higher contrast body text, terminal-like density — still Masthead metal (no pure black CRT theme, no neon rainbow).
- Ops toolbar: metal toolbar language already used by Sources/Logbook; enable/disable by selection + `nextAction`.

### Explicit non-goals

- No human LLM enrichment editor or dossier markdown editor
- No task manager (owners, due dates, Kanban)
- No visible CLI recipes in the Workbench panel DOM (handoff clipboard text may include agent CLI guidance)
- No historical dual-runtime ghost merge (separate issue)
- No full OpenWiki rewrite
- No purge/delete UI in this plan (Not Added review only)

---

## File Map

| Path | Responsibility |
|---|---|
| `src/daemon/db/workbenchPipelineRepository.ts` | Fix `readActiveClaim` if needed; add `markWorkbenchQuality`; ensure claim read returns active claims |
| `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts` | Fix claim test expiry; quality mark tests |
| `src/daemon/__tests__/workbenchApi.test.ts` | Claim/release/quality/publish/transcript HTTP coverage; claim DTO on queue |
| `src/daemon/server.ts` | Add POST claim/release/quality routes; use `actor: { kind: "user", id: "workbench_ui" }` for UI-originated defaults when body omits actor |
| `src/cli/workbench.ts` | Add `quality pass` / `quality fail` (and optional `quality precheck`) if missing |
| `src/cli/__tests__/mastheadctl.test.ts` | CLI quality + claim future-expiry |
| `src/shared/workbench.ts` | Action result DTOs; activity event tone helper types if shared |
| `src/app/daemonClient.ts` | Write clients: check/import/publish/claim/release/quality; not-added list already exists |
| `src/app/__tests__/daemonClient.test.ts` | Client path/body tests for new writes |
| `src/app/workbench/useWorkbenchController.ts` | Selection ops, action busy/error, reload after mutations, not-added detail toggle |
| `src/app/workbench/__tests__/useWorkbenchController.test.tsx` | Ops enablement + mutation reload |
| `src/ui/workbench/WorkbenchPanel.tsx` | Ops toolbar buttons, status strip, Not Added panel, richer Activity rows |
| `src/ui/workbench/workbenchActivity.ts` | Pure helpers: event tone class, relative time format, row model |
| `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx` | Ops buttons, activity tones, no CLI tokens in DOM |
| `src/ui/workbench/__tests__/workbenchActivity.test.ts` | Tone mapping unit tests |
| `src/styles/masthead.css` | Activity console rail + ops toolbar density |
| `design.md` | Workbench surface archetype |
| `docs/acceptance/workbench-ops-complete-evidence.md` | Create acceptance evidence after dogfood |
| `docs/reference/daemon-api.md` | Document new write routes |
| `scripts/dogfood-workbench-ops.js` | Optional: seed + walk check→import→quality→publish on temp DB |

---

## Current Gaps (baseline facts)

1. **UI is read + handoff only.** Controller loads `/workbench/sessions`, activity, not-added summary. No mutation methods.
2. **Daemon client** has GETs only for pipeline; no POST wrappers for transcript/publish/claim/quality.
3. **HTTP missing:** claim, release, quality mark. Present: check-transcript, import-transcript-preview, import-transcript, publish, not-added reads.
4. **Claim bug:** tests use fixed `expiresAt: "2026-07-08T12:05:00.000Z"`. `readActiveClaim` filters `expires_at > now()`, so wall-clock now makes claims appear inactive. Fix tests to use relative future expiry; re-verify repository if still broken.
5. **Quality:** `next_action` can be `review_quality`, but there is no first-class `markWorkbenchQuality` — only direct SQL in tests.
6. **Activity rail CSS** is low-contrast muted mono on `#081d2b`; event types are not color-coded.
7. **Empty publish-path** is common after legacy backfill; dogfood must seed or capture new sessions deliberately.

---

### Task 0: Baseline And Guardrails

**Files:**
- Inspect only: `git status --short`, `CONTEXT.md`, this plan

- [ ] **Step 1: Confirm worktree and dirty scope**

```bash
cd /home/tyler/.codex/worktrees/f503/Masthead
git status --short
git rev-parse --short HEAD
```

Expected: worktree on Workbench/Sources lineage; do not revert unrelated Sources V2 polish.

- [ ] **Step 2: Capture failing claim tests as baseline**

```bash
npm test -- --run src/daemon/db/__tests__/workbenchPipelineRepository.test.ts src/daemon/__tests__/workbenchApi.test.ts 2>&1 | tail -80
```

Expected: at least the claim-related assertions fail (or note if already fixed).

- [ ] **Step 3: Record no-visible-CLI baseline**

```bash
rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" src/ui/workbench src/ui/session-dossier/SessionDossier.tsx || true
```

Expected: no matches in UI sources (handoff builder may mention CLI only in clipboard text built in `workbenchHandoff.ts` — that file is agent handoff text, not rendered UI chrome; do not display that string as a panel recipe).

- [ ] **Step 4: Commit nothing yet** — baseline only.

---

### Task 1: Fix Active Claim Read And Tests

**Files:**
- Modify: `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts`
- Modify: `src/daemon/__tests__/workbenchApi.test.ts`
- Modify only if needed: `src/daemon/db/workbenchPipelineRepository.ts` (`readActiveClaim`)

- [ ] **Step 1: Write/adjust failing test with future-relative expiry**

In `workbenchPipelineRepository.test.ts`, replace fixed past/near expiry with:

```ts
test("claims are short-lived and do not change publication state", async () => {
  const db = await testDb();
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:1",
    title: "Meaningful work"
  });
  const before = ensureWorkbenchSessionState(db, "session:1");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  const claim = claimWorkbenchSessions(db, {
    claimedBy: "codex",
    expiresAt,
    sessionIds: ["session:1"]
  });

  const after = ensureWorkbenchSessionState(db, "session:1");
  expect(claim.claims).toHaveLength(1);
  expect(after.publicationStatus).toBe(before.publicationStatus);
  expect(after.activeClaim?.claimedBy).toBe("codex");
  expect(after.activeClaim?.expiresAt).toBe(expiresAt);
  expect(after.activeClaim?.claimId).toBe(claim.claims[0].claimId);

  releaseWorkbenchClaim(db, {
    claimId: claim.claims[0].claimId,
    reason: "complete"
  });
  expect(ensureWorkbenchSessionState(db, "session:1").activeClaim).toBeUndefined();
});
```

Also add:

```ts
test("expired claims are not active", async () => {
  const db = await testDb();
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:expired",
    title: "Expired claim"
  });
  claimWorkbenchSessions(db, {
    claimedBy: "codex",
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
    sessionIds: ["session:expired"]
  });
  expect(ensureWorkbenchSessionState(db, "session:expired").activeClaim).toBeUndefined();
});
```

Apply the same future-relative `expiresAt` pattern in `workbenchApi.test.ts` where claims are asserted on queue DTOs.

- [ ] **Step 2: Run tests**

```bash
npm test -- --run src/daemon/db/__tests__/workbenchPipelineRepository.test.ts src/daemon/__tests__/workbenchApi.test.ts
```

Expected: claim tests pass if only expiry was wrong. If `activeClaim` still undefined with future expiry, proceed to Step 3.

- [ ] **Step 3: Fix `readActiveClaim` only if still broken**

Verify `readActiveClaim` still uses:

```ts
WHERE session_id = ? AND released_at IS NULL AND expires_at > ?
```

with `now = new Date().toISOString()`. SQLite string compare works for ISO-8601 Z timestamps. Do **not** change the filter semantics (expired must hide). If the queue DTO path drops `activeClaim`, fix `workbenchQueueSessionDtos` in `server.ts` to pass through `state.activeClaim` when present:

```ts
activeClaim: state.activeClaim
  ? { claimedBy: state.activeClaim.claimedBy, expiresAt: state.activeClaim.expiresAt, claimId: state.activeClaim.claimId }
  : undefined
```

Extend shared DTO if `claimId` is missing from UI type (needed for Release):

```ts
// src/shared/workbench.ts
activeClaim?: { claimId: string; claimedBy: string; expiresAt: string };
```

- [ ] **Step 4: Re-run tests**

```bash
npm test -- --run src/daemon/db/__tests__/workbenchPipelineRepository.test.ts src/daemon/__tests__/workbenchApi.test.ts
```

Expected: PASS for claim cases.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/db/workbenchPipelineRepository.ts \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts \
  src/daemon/__tests__/workbenchApi.test.ts \
  src/shared/workbench.ts
git commit -m "$(cat <<'EOF'
fix(workbench): restore active claim reads with future-safe tests

Use relative claim expiry in tests and include claimId on queue DTOs so
UI and CLI can release the correct lease.
EOF
)"
```

---

### Task 2: Quality Review Repository + CLI

**Files:**
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts`
- Modify: `src/cli/workbench.ts`
- Modify: `src/cli/__tests__/mastheadctl.test.ts`

- [ ] **Step 1: Write failing quality mark tests**

```ts
test("quality pass advances next action toward enrichment", async () => {
  const db = await testDb();
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:q",
    title: "Quality pass"
  });
  db.prepare(
    `UPDATE workbench_session_state
     SET transcript_status = 'imported', quality_status = 'unchecked', next_action = 'review_quality'
     WHERE session_id = ?`
  ).run("session:q");

  const result = markWorkbenchQuality(db, {
    actor: { kind: "user", id: "tyler" },
    sessionId: "session:q",
    status: "passed"
  });

  expect(result.state.qualityStatus).toBe("passed");
  expect(result.state.nextAction).toBe("enrich");
  expect(result.activity.eventType).toBe("quality_passed");
});

test("quality fail moves session to not_added_to_logbook", async () => {
  const db = await testDb();
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:fail",
    title: "Quality fail"
  });
  ensureWorkbenchSessionState(db, "session:fail");

  const result = markWorkbenchQuality(db, {
    actor: { kind: "user", id: "tyler" },
    sessionId: "session:fail",
    status: "failed",
    reason: "hook_only_noise"
  });

  expect(result.state.qualityStatus).toBe("failed");
  expect(result.state.publicationStatus).toBe("not_added_to_logbook");
  expect(result.state.nonPublicationReason).toBe("hook_only_noise");
  expect(result.activity.eventType).toBe("quality_failed");
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- --run src/daemon/db/__tests__/workbenchPipelineRepository.test.ts -t "quality"
```

Expected: FAIL — `markWorkbenchQuality` not exported.

- [ ] **Step 3: Implement `markWorkbenchQuality`**

Add beside other state writers in `workbenchPipelineRepository.ts`:

```ts
export function markWorkbenchQuality(
  db: MastheadDatabase,
  input: {
    actor: WorkbenchActor;
    sessionId: string;
    status: "passed" | "failed";
    reason?: string;
  }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const now = new Date().toISOString();
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    if (input.status === "passed") {
      db.prepare(
        `UPDATE workbench_session_state
         SET quality_status = 'passed', non_publication_reason = NULL, updated_at = ?
         WHERE session_id = ?`
      ).run(now, input.sessionId);
      updateWorkbenchNextAction(db, input.sessionId, now);
      const activity = insertWorkbenchActivity(db, {
        activityId: stableRecordId("workbench_activity", [input.sessionId, "quality_passed", now]),
        actor: input.actor,
        details: {},
        eventAt: now,
        eventType: "quality_passed",
        sessionId: input.sessionId,
        summary: "Quality accepted"
      });
      db.prepare(
        `UPDATE workbench_session_state SET last_activity_at = ?, updated_at = ? WHERE session_id = ?`
      ).run(now, now, input.sessionId);
      return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
    }

    const reason = input.reason?.trim() || "quality_failed";
    db.prepare(
      `UPDATE workbench_session_state
       SET quality_status = 'failed',
           publication_status = 'not_added_to_logbook',
           next_action = 'none',
           non_publication_reason = ?,
           updated_at = ?
       WHERE session_id = ?`
    ).run(reason, now, input.sessionId);
    const activity = insertWorkbenchActivity(db, {
      activityId: stableRecordId("workbench_activity", [input.sessionId, "quality_failed", now]),
      actor: input.actor,
      details: { reason },
      eventAt: now,
      eventType: "quality_failed",
      sessionId: input.sessionId,
      summary: "Quality failed; not added to Logbook"
    });
    db.prepare(
      `UPDATE workbench_session_state SET last_activity_at = ?, updated_at = ? WHERE session_id = ?`
    ).run(now, now, input.sessionId);
    return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
  });
}
```

Optional helper used by CLI/API for one-shot deterministic screen:

```ts
// In quality path callers, not necessarily in repository:
// runCaptureQualityPrecheck(db, sessionId) → if ok mark passed, else mark failed with reason
```

- [ ] **Step 4: Wire CLI**

In `src/cli/workbench.ts`, add commands:

```text
mastheadctl workbench quality pass --session <id> --json
mastheadctl workbench quality fail --session <id> --reason <code> --json
mastheadctl workbench quality precheck --session <id> --json
```

`precheck` runs `runCaptureQualityPrecheck` then `markWorkbenchQuality` with the result.

- [ ] **Step 5: Tests + commit**

```bash
npm test -- --run src/daemon/db/__tests__/workbenchPipelineRepository.test.ts src/cli/__tests__/mastheadctl.test.ts
```

```bash
git add src/daemon/db/workbenchPipelineRepository.ts \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts \
  src/cli/workbench.ts \
  src/cli/__tests__/mastheadctl.test.ts
git commit -m "$(cat <<'EOF'
feat(workbench): add quality pass/fail pipeline transitions

Give human and CLI operators a first-class quality review step that
either advances publish-path work or sends failures to Not Added.
EOF
)"
```

---

### Task 3: Daemon HTTP Write Routes For Ops

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/__tests__/workbenchApi.test.ts`
- Modify: `docs/reference/daemon-api.md` (after tests green)
- Modify: `scripts/masthead-endpoint-matrix.js` only if matrix tracks writes (reads already covered)

- [ ] **Step 1: Write failing API tests**

```ts
test("POST claim and release round-trip on queue DTO", async () => {
  // seed publish-path session
  const claimRes = await fetch(`${base}/workbench/sessions/${encodeURIComponent(sessionId)}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimedBy: "ui-user", ttlSeconds: 300 })
  });
  expect(claimRes.status).toBe(200);
  const claimBody = await claimRes.json();
  expect(claimBody.ok).toBe(true);
  expect(claimBody.claims[0].claimedBy).toBe("ui-user");

  const queue = await (await fetch(`${base}/workbench/sessions?limit=20`)).json();
  const row = queue.sessions.find((s: { sessionId: string }) => s.sessionId === sessionId);
  expect(row.activeClaim?.claimedBy).toBe("ui-user");
  expect(row.activeClaim?.claimId).toBe(claimBody.claims[0].claimId);

  const releaseRes = await fetch(`${base}/workbench/claims/${claimBody.claims[0].claimId}/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "done" })
  });
  expect(releaseRes.status).toBe(200);
});

test("POST quality pass/fail", async () => {
  // after transcript imported fixture
  const pass = await fetch(`${base}/workbench/sessions/${id}/quality`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "passed" })
  });
  expect(pass.status).toBe(200);
  expect((await pass.json()).state.qualityStatus).toBe("passed");
});
```

Also assert existing transcript + publish routes still work with `actor` recorded as system/user when body omits id.

- [ ] **Step 2: Implement routes in `server.ts` near other Workbench handlers**

```ts
// POST /workbench/sessions/:sessionId/claim
// body: { claimedBy?: string; ttlSeconds?: number }
// default claimedBy: "workbench_ui", ttlSeconds: 900

// POST /workbench/claims/:claimId/release
// body: { reason?: string }

// POST /workbench/sessions/:sessionId/quality
// body: { status: "passed" | "failed"; reason?: string }
// or { mode: "precheck" } to run capture precheck then mark
```

Actor for UI routes:

```ts
const actor = { kind: "user" as const, id: typeof body.actorId === "string" ? body.actorId : "workbench_ui" };
```

Write endpoints must **not** be added to the read-only worktree bridge matcher.

- [ ] **Step 3: Run API tests**

```bash
npm test -- --run src/daemon/__tests__/workbenchApi.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update `docs/reference/daemon-api.md` with the three routes + existing transcript/publish matrix.**

- [ ] **Step 5: Commit**

```bash
git add src/daemon/server.ts src/daemon/__tests__/workbenchApi.test.ts docs/reference/daemon-api.md
git commit -m "$(cat <<'EOF'
feat(workbench): expose claim, release, and quality HTTP ops

Complete the operator write surface so the Workbench UI can drive the
same pipeline state as the CLI without agent-only detours.
EOF
)"
```

---

### Task 4: Daemon Client Write Methods

**Files:**
- Modify: `src/app/daemonClient.ts`
- Modify: `src/app/__tests__/daemonClient.test.ts`
- Modify: `src/shared/workbench.ts` (result types if not already shared)

- [ ] **Step 1: Add types + failing client tests**

```ts
// Expected client surface
export async function postWorkbenchCheckTranscript(baseUrl: string, sessionId: string, options?: { signal?: AbortSignal })
export async function postWorkbenchImportTranscriptPreview(baseUrl: string, sessionId: string, options?: { sourceId?: string; signal?: AbortSignal })
export async function postWorkbenchImportTranscript(baseUrl: string, sessionId: string, options?: { sourceId?: string; signal?: AbortSignal })
export async function postWorkbenchPublish(baseUrl: string, sessionId: string, options?: { signal?: AbortSignal })
export async function postWorkbenchClaim(baseUrl: string, sessionId: string, options?: { claimedBy?: string; ttlSeconds?: number; signal?: AbortSignal })
export async function postWorkbenchReleaseClaim(baseUrl: string, claimId: string, options?: { reason?: string; signal?: AbortSignal })
export async function postWorkbenchQuality(baseUrl: string, sessionId: string, options: { status?: "passed" | "failed"; mode?: "precheck"; reason?: string; signal?: AbortSignal })
```

Paths must match Task 3 exactly.

- [ ] **Step 2: Implement with existing `postJson`/`getJson` helpers** (same error labeling style as other client methods).

- [ ] **Step 3: Run client tests + commit**

```bash
npm test -- --run src/app/__tests__/daemonClient.test.ts
git add src/app/daemonClient.ts src/app/__tests__/daemonClient.test.ts src/shared/workbench.ts
git commit -m "$(cat <<'EOF'
feat(workbench): add daemon client write helpers for ops actions
EOF
)"
```

---

### Task 5: Controller — Complete Ops State Machine

**Files:**
- Modify: `src/app/workbench/useWorkbenchController.ts`
- Modify: `src/app/workbench/__tests__/useWorkbenchController.test.tsx`

- [ ] **Step 1: Expand controller result type**

```ts
export type WorkbenchActionKind =
  | "check_transcript"
  | "import_transcript"
  | "quality_pass"
  | "quality_fail"
  | "quality_precheck"
  | "publish"
  | "claim"
  | "release"
  | "copy_agent_prompt";

export type UseWorkbenchControllerResult = {
  // existing fields...
  actionError?: string;
  actionBusy: boolean;
  lastActionSummary?: string;
  notAddedSessions: WorkbenchNotAddedSessionDto[];
  notAddedOpen: boolean;
  setNotAddedOpen: (open: boolean) => void;
  loadNotAdded: () => void;
  runAction: (kind: WorkbenchActionKind) => Promise<void>;
  canRun: (kind: WorkbenchActionKind) => boolean;
};
```

- [ ] **Step 2: Enablement rules (pure, unit-testable)**

Implement `canRun` against selection:

| Action | Enabled when |
|---|---|
| `check_transcript` | ≥1 selected; any selected has `transcriptStatus` in `unchecked`/`missing`/`available` OR next is `check_transcript` |
| `import_transcript` | ≥1 selected; any selected needs import (`nextAction === "import_transcript"` or transcript `missing`/`permission_needed`/`available` without imported) |
| `quality_pass` / `quality_precheck` / `quality_fail` | ≥1 selected with `qualityStatus === "unchecked"` or `nextAction === "review_quality"` |
| `publish` | ≥1 selected with `nextAction === "publish"` |
| `claim` | ≥1 selected without active claim |
| `release` | ≥1 selected with `activeClaim` |
| `copy_agent_prompt` | ≥1 selected and handoff non-empty (especially when next is `enrich` / `create_dossier`) |

Always disable all mutations when `!isLive` or `actionBusy`.

- [ ] **Step 3: `runAction` implementation sketch**

```ts
const runAction = useCallback(async (kind: WorkbenchActionKind) => {
  if (!canRun(kind) || actionBusy) return;
  setActionBusy(true);
  setActionError(undefined);
  try {
    const ids = Array.from(selectedSessionIds);
    if (kind === "check_transcript") {
      for (const sessionId of ids) {
        await postWorkbenchCheckTranscript(activeProjectionUrl, sessionId);
      }
    } else if (kind === "import_transcript") {
      for (const sessionId of ids) {
        await postWorkbenchImportTranscript(activeProjectionUrl, sessionId);
      }
    } else if (kind === "quality_pass") {
      for (const sessionId of ids) {
        await postWorkbenchQuality(activeProjectionUrl, sessionId, { status: "passed" });
      }
    } else if (kind === "quality_fail") {
      for (const sessionId of ids) {
        await postWorkbenchQuality(activeProjectionUrl, sessionId, {
          status: "failed",
          reason: "operator_rejected"
        });
      }
    } else if (kind === "quality_precheck") {
      for (const sessionId of ids) {
        await postWorkbenchQuality(activeProjectionUrl, sessionId, { mode: "precheck" });
      }
    } else if (kind === "publish") {
      for (const sessionId of ids) {
        await postWorkbenchPublish(activeProjectionUrl, sessionId);
      }
    } else if (kind === "claim") {
      for (const sessionId of ids) {
        await postWorkbenchClaim(activeProjectionUrl, sessionId, { claimedBy: "workbench_ui", ttlSeconds: 900 });
      }
    } else if (kind === "release") {
      const claimIds = sessions
        .filter((s) => selectedSessionIds.has(s.sessionId) && s.activeClaim?.claimId)
        .map((s) => s.activeClaim!.claimId);
      for (const claimId of claimIds) {
        await postWorkbenchReleaseClaim(activeProjectionUrl, claimId, { reason: "operator_release" });
      }
    }
    // copy_agent_prompt handled in UI via existing handoffText + clipboard
    await load();
  } catch (error) {
    setActionError(error instanceof Error ? error.message : String(error));
  } finally {
    setActionBusy(false);
  }
}, [/* deps */]);
```

On `transcript_permission_required`, set `actionError` to a plain-language message:  
`Transcript import needs source permission for this session's source. Grant it under Sources, then retry Import.`  
Do not dump stack traces.

- [ ] **Step 4: Not Added detail load**

When `notAddedOpen` becomes true, call `getWorkbenchNotAddedSessions` (limit 50) and store rows. Toolbar fact "Not Added to Logbook" is clickable / button toggles the panel.

- [ ] **Step 5: Controller tests**

Cover: enablement matrix, sequential check then reload, permission error string, not-added open load, busy disables double-submit.

```bash
npm test -- --run src/app/workbench/__tests__/useWorkbenchController.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/app/workbench/useWorkbenchController.ts src/app/workbench/__tests__/useWorkbenchController.test.tsx
git commit -m "$(cat <<'EOF'
feat(workbench): drive pipeline ops from the Workbench controller

Selection-scoped check, import, quality, publish, claim/release, and
Not Added inspection against the same daemon pipeline state.
EOF
)"
```

---

### Task 6: Workbench Panel Ops UI

**Files:**
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/app/App.tsx` (pass new controller props)
- Modify: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`
- Modify: `src/styles/masthead.css` (toolbar only; activity rail is Task 7)

- [ ] **Step 1: Write UI contract tests first**

```tsx
test("ops toolbar exposes human actions without CLI recipes", () => {
  render(
    <WorkbenchPanel
      sessions={[publishReadySession]}
      selectedSessionIds={new Set([publishReadySession.sessionId])}
      handoffText="Process these sessions"
      canRun={(kind) => kind === "publish" || kind === "copy_agent_prompt"}
      onRunAction={vi.fn()}
      // ...
    />
  );
  expect(screen.getByRole("button", { name: /check transcript/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /import transcript/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /accept quality/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /fail quality/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^publish$/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^claim$/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /release/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /copy agent prompt/i })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/mastheadctl|npm run|output\.json|schema\.json|apply\.sh/i);
});

test("enrich next-action emphasizes agent prompt not edit form", () => {
  // session nextAction enrich → Accept Quality/Publish disabled; Copy Agent Prompt enabled
});
```

- [ ] **Step 2: Toolbar layout**

Left cluster (primary ops), right cluster (facts):

```text
[Copy Agent Prompt] [Check] [Import] [Precheck] [Accept Quality] [Fail Quality] [Publish] [Claim] [Release] | Select Visible | Clear | Refresh
facts: Publish path N · Selected K · Not Added M (button)
```

Use existing `AppButton` variants:
- `primary` for the single most relevant next action of the selection when homogeneous
- default for secondary ops
- `quiet` for Clear / Fail Quality (destructive-ish)

Disable via `canRun` + `actionBusy`. Show `actionError` in `workbench-error` strip; show `lastActionSummary` as quiet mono status if useful.

- [ ] **Step 3: Empty state honesty**

When `sessions.length === 0` and not loading:

```text
No publish-path sessions
N not added to Logbook · open review
```

Do not show onboarding hero. Link/button opens Not Added panel.

- [ ] **Step 4: Not Added panel**

When open, render below toolbar or as left-column secondary table:

| session | reason | runtime | last activity |

Read-only. No agent handoff of these IDs by default (do not auto-include in handoff text).

- [ ] **Step 5: Wire App.tsx**

Pass new props from `useWorkbenchController` into `WorkbenchPanel`.

- [ ] **Step 6: Tests + commit**

```bash
npm test -- --run src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx
git add src/ui/workbench/WorkbenchPanel.tsx src/app/App.tsx src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/styles/masthead.css
git commit -m "$(cat <<'EOF'
feat(workbench): complete human ops toolbar on the Workbench surface

Expose check, import, quality, publish, claim/release, and Not Added
review while keeping enrichment authoring agent-only via handoff.
EOF
)"
```

---

### Task 7: Activity Rail — Terminal Contrast Within Masthead

**Files:**
- Create: `src/ui/workbench/workbenchActivity.ts`
- Create: `src/ui/workbench/__tests__/workbenchActivity.test.ts`
- Modify: `src/ui/workbench/WorkbenchPanel.tsx` (activity list markup)
- Modify: `src/styles/masthead.css`

- [ ] **Step 1: Pure tone mapping tests**

```ts
import { describe, expect, test } from "vitest";
import { workbenchActivityTone } from "../workbenchActivity";

describe("workbenchActivityTone", () => {
  test("maps lifecycle events to tones", () => {
    expect(workbenchActivityTone("transcript_checked")).toBe("info");
    expect(workbenchActivityTone("transcript_import_queued")).toBe("info");
    expect(workbenchActivityTone("transcript_permission_required")).toBe("warn");
    expect(workbenchActivityTone("quality_passed")).toBe("ok");
    expect(workbenchActivityTone("quality_failed")).toBe("bad");
    expect(workbenchActivityTone("claimed")).toBe("claim");
    expect(workbenchActivityTone("claim_released")).toBe("mute");
    expect(workbenchActivityTone("published")).toBe("ok");
    expect(workbenchActivityTone("publication_gate_failed")).toBe("bad");
    expect(workbenchActivityTone("unknown_event")).toBe("mute");
  });
});
```

- [ ] **Step 2: Implement helper**

```ts
export type WorkbenchActivityTone = "ok" | "info" | "warn" | "bad" | "claim" | "mute";

export function workbenchActivityTone(eventType: string): WorkbenchActivityTone {
  const t = eventType.toLowerCase();
  if (/(fail|error|denied|blocked|not_added|gate_failed|quality_failed)/.test(t)) return "bad";
  if (/(permission|warn|missing|required)/.test(t)) return "warn";
  if (/(published|quality_passed|satisfied|imported|enrichment_applied)/.test(t)) return "ok";
  if (/^claimed$|claim_heartbeat/.test(t)) return "claim";
  if (/(claim_released|legacy_backfill)/.test(t)) return "mute";
  if (/(transcript|import|check|preview|queued)/.test(t)) return "info";
  return "mute";
}

export function formatWorkbenchActivityTime(iso: string): string {
  // Prefer short local time HH:MM:SS for terminal density; fallback to raw iso slice
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour12: false });
}
```

- [ ] **Step 3: Markup change for each activity row**

```tsx
<li className={`workbench-activity-item is-${workbenchActivityTone(item.eventType)}`}>
  <span className="workbench-activity-gutter" aria-hidden="true" />
  <div className="workbench-activity-body">
    <div className="workbench-activity-meta">
      <time dateTime={item.eventAt}>{formatWorkbenchActivityTime(item.eventAt)}</time>
      <span className="workbench-activity-type">{sanitizeWorkbenchVisibleText(item.eventType)}</span>
      <span className="workbench-activity-actor">{sanitizeWorkbenchVisibleText(item.actorId ?? item.actorKind)}</span>
    </div>
    <p className="workbench-activity-summary">{sanitizeWorkbenchVisibleText(item.summary)}</p>
  </div>
</li>
```

Allow summary to wrap (2 lines max with clamp) — currently single-line ellipsis kills readability.

- [ ] **Step 4: CSS — console rail**

Replace/extend `.workbench-activity-*` in `masthead.css` using design tokens:

```css
.workbench-activity-block {
  /* darker inset console inside metal rail */
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.22), rgba(0, 0, 0, 0.08)),
    #041018;
  border-color: rgba(92, 153, 187, 0.22);
  box-shadow:
    inset 0 1px 0 rgba(194, 221, 241, 0.06),
    inset 0 0 0 1px rgba(0, 0, 0, 0.35);
}

.workbench-activity-list {
  gap: 0;
  font-family: var(--font-mono);
}

.workbench-activity-item {
  display: grid;
  grid-template-columns: 3px minmax(0, 1fr);
  gap: var(--space-sm);
  padding: 8px 0;
  border-top: 1px solid rgba(194, 221, 241, 0.06);
}

.workbench-activity-gutter {
  background: rgba(148, 163, 184, 0.45); /* mute default */
  border-radius: 1px;
}

.workbench-activity-item.is-ok .workbench-activity-gutter { background: #3ecf8e; }
.workbench-activity-item.is-info .workbench-activity-gutter { background: #4aa8d8; }
.workbench-activity-item.is-warn .workbench-activity-gutter { background: #d6a243; }
.workbench-activity-item.is-bad .workbench-activity-gutter { background: #e06c75; }
.workbench-activity-item.is-claim .workbench-activity-gutter { background: #8b7cf6; }

.workbench-activity-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  color: rgba(194, 221, 241, 0.62);
  font-size: 10.5px;
  letter-spacing: 0.02em;
}

.workbench-activity-type {
  color: rgba(154, 214, 255, 0.92);
}

.workbench-activity-summary {
  margin: 2px 0 0;
  color: rgba(232, 244, 252, 0.96); /* higher contrast than --body on dark console */
  font-size: 12px;
  line-height: 1.35;
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

Rules:
- Keep radii at 5px panel / 3px controls (design.md).
- No pure `#000` full panel; keep blue-black masthead family (`#041018`).
- Use existing success/warn/danger hues already present in status tokens where possible.
- `scrollbar-gutter: stable` on the activity list if scrollbar pop reappears.

- [ ] **Step 5: Visual check**

In Electron Dev → Workbench: confirm activity rows are scannable at a glance (time + type + colored gutter + bright summary).

- [ ] **Step 6: Commit**

```bash
git add src/ui/workbench/workbenchActivity.ts \
  src/ui/workbench/__tests__/workbenchActivity.test.ts \
  src/ui/workbench/WorkbenchPanel.tsx \
  src/ui/workbench/__tests__/WorkbenchPanel.test.tsx \
  src/styles/masthead.css
git commit -m "$(cat <<'EOF'
style(workbench): restyle Activity rail as high-contrast console

Darker inset surface, event-type color gutters, mono metadata, and
readable multi-line summaries without leaving Masthead metal language.
EOF
)"
```

---

### Task 8: Design Contract — Workbench Archetype

**Files:**
- Modify: `design.md`
- Modify: `AGENTS.md` only if surface archetype list still omits Workbench ops completeness

- [ ] **Step 1: Add Workbench to surface lists**

In `design.md` center-workspace bullets and Surface Archetypes:

```markdown
- Workbench: dense ops table plus terminal-like Activity rail and selection-driven pipeline actions.
```

Archetype entry:

```markdown
- Workbench: dense publish-path table + Activity console rail + metal ops toolbar.
  Human ops cover transcript check/import, quality review, claim/release, publish,
  and Not Added inspection. Agent-authored enrichment/dossier/bug-fix work is
  requested via Copy Agent Prompt, never via an in-app enrichment editor.
```

- [ ] **Step 2: Commit**

```bash
git add design.md AGENTS.md
git commit -m "$(cat <<'EOF'
docs(design): define Workbench ops surface archetype
EOF
)"
```

---

### Task 9: Dogfood Script And Live Loop Proof

**Files:**
- Create: `scripts/dogfood-workbench-ops.js` (or extend `scripts/dogfood-workbench-v1.js`)
- Create: `docs/acceptance/workbench-ops-complete-evidence.md`

- [ ] **Step 1: Temp-DB dogfood path**

Script should:

1. Open temp SQLite, migrate to schema 17+
2. Seed one meaningful session with linked source + shallow messages (transcript-importable or pre-imported)
3. Run: check → (optional import) → quality pass → mark enrichment+dossier satisfied via existing apply helpers OR minimal repository marks for gate → publish
4. Assert session appears as published and is Logbook-visible via published-only query
5. Print JSON receipt `{ ok, sessionId, steps[] }`

Reuse patterns from `scripts/dogfood-workbench-v1.js` and repository tests' `seedSession`.

- [ ] **Step 2: Run dogfood**

```bash
node scripts/dogfood-workbench-ops.js
```

Expected: `ok: true`.

- [ ] **Step 3: Live UI dogfood (manual checklist in evidence file)**

Against Electron Dev + primary daemon:

1. Ensure at least one publish-path session (new live capture after Sources ready, or temporary seed against dev DB **only if Tyler approves** — prefer real capture).
2. Workbench: select session → Check Transcript → confirm Activity row + status token update.
3. Import when needed; if permission blocked, confirm plain error (no crash).
4. Accept Quality or Precheck.
5. When next is enrich/create_dossier: Copy Agent Prompt → run agent apply in a separate shell (or use CLI apply fixtures).
6. Publish → session leaves publish-path table and appears in Logbook search.
7. Confirm Activity rail contrast is readable throughout.
8. Open Not Added review; confirm reason rows render.

Record outcomes in `docs/acceptance/workbench-ops-complete-evidence.md`.

- [ ] **Step 4: Commit dogfood + evidence**

```bash
git add scripts/dogfood-workbench-ops.js docs/acceptance/workbench-ops-complete-evidence.md
git commit -m "$(cat <<'EOF'
test(workbench): dogfood complete ops loop and record evidence
EOF
)"
```

---

### Task 10: Final Verification Gate

**Files:** none required beyond fixes for regressions found

- [ ] **Step 1: Focused suites**

```bash
npm test -- --run \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts \
  src/daemon/__tests__/workbenchApi.test.ts \
  src/app/__tests__/daemonClient.test.ts \
  src/app/workbench \
  src/ui/workbench \
  src/cli/__tests__/mastheadctl.test.ts \
  src/workbench
```

Expected: PASS.

- [ ] **Step 2: Product contracts**

```bash
npm run typecheck
npm run check:product-contract
npm run check:surface-contract
npm run verify:no-citations
npm run check:endpoint-matrix
```

Expected: PASS (document any pre-existing unrelated failures; do not expand scope).

- [ ] **Step 3: No CLI tokens in Workbench DOM sources**

```bash
rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" src/ui/workbench/WorkbenchPanel.tsx src/ui/session-dossier/SessionDossier.tsx || true
```

Expected: no matches.

- [ ] **Step 4: Update product release gate bullets if needed**

In `docs/acceptance/product-release-gate.md`, mark Workbench human ops + Activity contrast as proven with link to the new evidence file.

- [ ] **Step 5: Final commit if docs-only leftovers**

```bash
git add docs/acceptance/product-release-gate.md docs/acceptance/workbench-ops-complete-evidence.md
git commit -m "$(cat <<'EOF'
docs(workbench): close ops-complete acceptance gate
EOF
)"
```

---

## Execution Order Rationale

1. **Claim fix** unblocks truthful queue/claim UI and green tests.
2. **Quality repository** fills the missing human gate between transcript and agent enrichment.
3. **HTTP + client** make mutations available to the renderer without inventing a second pipeline.
4. **Controller + panel** deliver complete ops UX Tyler asked for (minus LLM authoring).
5. **Activity restyle** is independent of ops correctness but highly visible — after structure so event types actually fire during dogfood.
6. **Design.md** locks the archetype so future polish does not regress to handoff-only or instructional pages.
7. **Dogfood + gate** prove the loop end-to-end.

---

## Risk Controls

- **Publication is irreversible for Logbook visibility in V1** — publish only when gates pass; tests must assert 409 on incomplete sessions.
- **Transcript import is privacy-sensitive** — never auto-import on selection; require explicit Import click; respect source-scoped permission.
- **Quality fail → Not Added** removes from default agent queues; show reason; no silent drop.
- **Claims expire** — UI must re-read after load; do not trust stale selection claim state after long idle.
- **Bridge mode** — write routes stay primary-only; secondary worktrees cannot mutate pipeline.
- **Empty publish-path** — do not fake rows; empty state + Not Added count is correct ops state after backfill.

---

## Definition Of Done

- Claim tests pass with future-relative expiry; queue DTOs expose `activeClaim.claimId`.
- Human can Check, Import, Accept/Fail Quality, Publish, Claim/Release from Workbench UI without CLI.
- Enrichment/dossier/bug-fix remain agent-driven via Copy Agent Prompt only.
- Activity rail is high-contrast, event-colored, mono-metadata, still Masthead metal.
- Not Added is reviewable as list by reason, not only a toolbar number.
- Dogfood script + live evidence show check → … → publish → Logbook.
- Focused tests, typecheck, surface/product contracts, endpoint matrix pass or have documented unrelated failures.
- `design.md` documents the Workbench ops archetype.

---

## Self-Review (plan author)

| Requirement | Task |
|---|---|
| Fix claim / activeClaim | Task 1 |
| Quality human gate | Task 2–3 |
| Complete ops UI (no LLM authoring) | Tasks 3–6 |
| Activity terminal contrast | Task 7 |
| Design archetype | Task 8 |
| Dogfood priority next step | Task 9 |
| Permission/empty honesty | Tasks 5–6 |
| Verification | Task 10 |

No TBD placeholders remain. Types (`WorkbenchActionKind`, quality routes, claim DTO `claimId`) are consistent across tasks.
