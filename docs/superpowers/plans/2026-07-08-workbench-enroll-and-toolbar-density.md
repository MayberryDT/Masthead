# Workbench Enroll + Toolbar Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enroll captured sessions into the Workbench publish-path queue automatically on live ingest and on demand via a Workbench toolbar button (HTTP + CLI sharing one helper), and shrink Workbench + Sources toolbars to match Now control height and spacing.

**Architecture:** One pure enrollment core (`enrollMissingWorkbenchSessions` / `enrollWorkbenchSession`) that only creates `workbench_session_state` for sessions with **no** pipeline row (`publish_path` / `check_transcript`). Wire it three ways: (1) after live/metadata session upsert, (2) CLI `mastheadctl workbench enroll --missing`, (3) `POST /workbench/enroll-missing` for the Workbench **Enroll missing** button. Do not re-touch published or not_added rows. Separately, align Workbench and Sources toolbar CSS with Now’s `.observability-toolbar` (56px bar, 40px controls, compact facts, single-row density).

**Tech Stack:** TypeScript daemon + SQLite, React/Vitest UI, existing `mastheadctl workbench` CLI, `AppButton` / metal toolbar tokens in `src/styles/masthead.css` and `src/styles/sources.css`.

**Worktree (mandatory):**

```text
/home/tyler/.codex/worktrees/f503/Masthead
```

**Port rule:** Do not steal `5173` from Electron Dev. Prefer verifying in Electron / primary daemon on `17373`. Writes require primary (not read-only bridge).

**Contract sources:**
- `CONTEXT.md` (Workbench glossary)
- `docs/adr/0009-logbook-only-shows-published-sessions.md`
- Prior plan: `docs/superpowers/plans/2026-07-08-workbench-ops-complete.md` (ops toolbar already exists)

---

## Product Decisions (locked)

### Enrollment semantics

| Rule | Behavior |
|---|---|
| Missing state only | Enroll iff no `workbench_session_state` row for `session_id` |
| Initial state | `publication_status = publish_path`, `next_action = check_transcript`, transcript/quality unchecked, enrichment/dossier missing |
| Skip always | Existing `publish_path`, `published`, `not_added_to_logbook` |
| Not transcript import | Enroll ≠ Import Transcript; no source permission required |
| Not auto-publish | Do not re-run legacy backfill publish/not_added logic |
| Activity | Optional compact receipts: per-session `enrolled` is noisy at bulk scale — prefer **one summary activity** for bulk (`enroll_missing_completed` with counts) and **silent or single** enroll on live (no flood). Live: no per-event activity unless session was newly created for pipeline (first enroll only, optional). Bulk: one activity row with `{ enrolled, skipped, limit }` |

### Surfaces

| Trigger | Surface |
|---|---|
| Live capture | Automatic in daemon after session materializes |
| Human catch-up | Workbench toolbar button **Enroll missing** |
| Agent / recovery | `mastheadctl workbench enroll --missing --json` |

### Button copy

- Label: **Enroll missing**
- Tooltip / status: `Enroll sessions that are not yet on the Workbench publish path`
- Do **not** label it “Import” (conflicts with Import Transcript)

### Toolbar density (Now is source of truth)

Reference (Now / shared):

```css
.observability-toolbar {
  min-height: 56px;
  gap: var(--space-xs);
  padding: var(--space-sm);
}
/* controls */
.app-button { min-height: 40px; }
.toolbar-select { height: 40px; min-height: 40px; }
```

Workbench + Sources must match that visual height. Prefer **single row**; if ops overflow, secondary actions collapse before growing bar height.

### Out of scope

- Auto quality fail / auto transcript import on enroll
- Historical dual-runtime merge
- Usage toolbar
- Full Sources visual redesign beyond toolbar height/spacing
- Enrolling deleted sessions (`deleted_at IS NOT NULL`)

---

## File Map

| Path | Responsibility |
|---|---|
| `src/daemon/db/workbenchPipelineRepository.ts` | `enrollWorkbenchSession`, `enrollMissingWorkbenchSessions` |
| `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts` | Enroll unit tests |
| `src/daemon/db/sessionRepository.ts` | Call enroll after live/metadata session upsert returns `sessionId` |
| `src/daemon/db/__tests__/sessionRepository.test.ts` | Live upsert creates workbench publish_path state |
| `src/cli/workbench.ts` | `enroll --missing` command |
| `src/cli/__tests__/mastheadctl.test.ts` | CLI enroll tests |
| `src/daemon/server.ts` | `POST /workbench/enroll-missing` |
| `src/daemon/__tests__/workbenchApi.test.ts` | HTTP enroll tests |
| `src/shared/workbench.ts` | `WorkbenchEnrollMissingResponse` DTO |
| `src/app/daemonClient.ts` | `postWorkbenchEnrollMissing` |
| `src/app/__tests__/daemonClient.test.ts` | Client path test |
| `src/app/workbench/useWorkbenchController.ts` | `enrollMissing` action + `canRun` / busy |
| `src/app/workbench/__tests__/useWorkbenchController.test.tsx` | Controller enroll |
| `src/ui/workbench/WorkbenchPanel.tsx` | **Enroll missing** button placement |
| `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx` | Button present, density classes |
| `src/styles/masthead.css` | Workbench toolbar density → Now tokens |
| `src/styles/sources.css` | Sources toolbar density → Now tokens |
| `docs/reference/daemon-api.md` | Document enroll-missing |
| `docs/acceptance/workbench-enroll-evidence.md` | Create after verification |

---

## Baseline facts (dev DB at plan time)

- `publish_path`: 0  
- `published`: ~182  
- `not_added_to_logbook`: ~357  
- Sessions with **no** workbench row: ~68 (mostly `running` live captures)

After enroll missing, publish path should rise by that missing count (modulo deletes).

---

### Task 0: Baseline

**Files:** inspect only

- [ ] **Step 1: Confirm worktree and HEAD**

```bash
cd /home/tyler/.codex/worktrees/f503/Masthead
git status --short | head -40
git rev-parse --short HEAD
```

- [ ] **Step 2: Confirm empty publish path vs missing state**

```bash
node -e "
const path = require('path');
(async () => {
  const { openMastheadDatabase } = await import('./dist/daemon/src/daemon/db/sqlite.js');
  const db = await openMastheadDatabase(path.join(process.env.HOME, '.local/share/masthead-dev/masthead.sqlite'));
  const rows = db.prepare('SELECT publication_status, COUNT(*) c FROM workbench_session_state GROUP BY 1').all();
  const missing = db.prepare(\`SELECT COUNT(*) c FROM sessions s LEFT JOIN workbench_session_state w ON w.session_id = s.session_id WHERE w.session_id IS NULL AND s.deleted_at IS NULL\`).get();
  console.log(JSON.stringify({ rows, missing }, null, 2));
  db.close();
})();
"
```

Expected: `publish_path` absent or 0; `missing.c` > 0.

- [ ] **Step 3: No commit**

---

### Task 1: Enrollment Repository Core

**Files:**
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Modify: `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("enrollWorkbenchSession creates publish_path only when missing", async () => {
  const db = await testDb();
  seedSession(db, {
    lifecycle: "running",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:enroll-1",
    title: "Live capture"
  });

  const first = enrollWorkbenchSession(db, {
    actor: { kind: "system", id: "live_ingest" },
    sessionId: "session:enroll-1"
  });
  expect(first.enrolled).toBe(true);
  expect(first.state?.publicationStatus).toBe("publish_path");
  expect(first.state?.nextAction).toBe("check_transcript");

  const second = enrollWorkbenchSession(db, {
    actor: { kind: "system", id: "live_ingest" },
    sessionId: "session:enroll-1"
  });
  expect(second.enrolled).toBe(false);
  expect(second.state?.publicationStatus).toBe("publish_path");
});

test("enrollWorkbenchSession does not demote published or not_added", async () => {
  const db = await testDb();
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:pub",
    title: "Published"
  });
  markWorkbenchPublished(db, {
    actor: { kind: "system", id: "test" },
    publishedVia: "test",
    sessionId: "session:pub"
  });
  expect(
    enrollWorkbenchSession(db, { actor: { kind: "user", id: "workbench_ui" }, sessionId: "session:pub" }).enrolled
  ).toBe(false);
  expect(readWorkbenchSessionState(db, "session:pub")?.publicationStatus).toBe("published");
});

test("enrollMissingWorkbenchSessions only touches sessions without state", async () => {
  const db = await testDb();
  seedSession(db, { lifecycle: "running", model: "gpt-5", project: "Masthead", sessionId: "session:a", title: "A" });
  seedSession(db, { lifecycle: "running", model: "gpt-5", project: "Masthead", sessionId: "session:b", title: "B" });
  seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:c", title: "C" });
  ensureWorkbenchSessionState(db, "session:b"); // already on path
  markWorkbenchNotAdded(db, {
    actor: { kind: "system", id: "test" },
    reason: "metadata_only",
    sessionId: "session:c"
  });

  const result = enrollMissingWorkbenchSessions(db, {
    actor: { kind: "user", id: "workbench_ui" },
    limit: 100
  });

  expect(result.enrolled).toBe(1);
  expect(result.enrolledSessionIds).toEqual(["session:a"]);
  expect(result.skippedExisting).toBeGreaterThanOrEqual(2);
  expect(readWorkbenchSessionState(db, "session:a")?.publicationStatus).toBe("publish_path");
  expect(readWorkbenchSessionState(db, "session:c")?.publicationStatus).toBe("not_added_to_logbook");
});
```

- [ ] **Step 2: Run tests — expect FAIL (functions missing)**

```bash
npm test -- --run src/daemon/db/__tests__/workbenchPipelineRepository.test.ts -t "enroll"
```

- [ ] **Step 3: Implement**

In `workbenchPipelineRepository.ts`:

```ts
export type WorkbenchEnrollResult = {
  enrolled: boolean;
  sessionId: string;
  state?: WorkbenchSessionStateRecord;
};

export type WorkbenchEnrollMissingResult = {
  enrolled: number;
  skippedExisting: number;
  enrolledSessionIds: string[];
  limit: number;
};

export function enrollWorkbenchSession(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; sessionId: string }
): WorkbenchEnrollResult {
  const existing = readWorkbenchSessionState(db, input.sessionId);
  if (existing) {
    return { enrolled: false, sessionId: input.sessionId, state: existing };
  }
  // ensure creates publish_path / check_transcript defaults
  const state = ensureWorkbenchSessionState(db, input.sessionId);
  return { enrolled: true, sessionId: input.sessionId, state };
}

export function enrollMissingWorkbenchSessions(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; limit?: number }
): WorkbenchEnrollMissingResult {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 500), 2000));
  const missing = db
    .prepare(
      `SELECT s.session_id AS sessionId
       FROM sessions s
       LEFT JOIN workbench_session_state w ON w.session_id = s.session_id
       WHERE w.session_id IS NULL
         AND s.deleted_at IS NULL
       ORDER BY COALESCE(s.last_activity_at, s.updated_at, s.created_at) DESC, s.session_id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ sessionId: string }>;

  const enrolledSessionIds: string[] = [];
  for (const row of missing) {
    const result = enrollWorkbenchSession(db, { actor: input.actor, sessionId: row.sessionId });
    if (result.enrolled) enrolledSessionIds.push(row.sessionId);
  }

  const existingCountRow = db
    .prepare(`SELECT COUNT(*) AS c FROM workbench_session_state`)
    .get() as { c: number };

  // skippedExisting = total with state not just processed; for API honesty use:
  // candidates scanned that already had state is 0 in this query. Report:
  // enrolled + note that only missing were candidates.
  const result: WorkbenchEnrollMissingResult = {
    enrolled: enrolledSessionIds.length,
    skippedExisting: 0, // this query only selects missing; keep field for API stability
    enrolledSessionIds,
    limit
  };

  // One summary activity (not per session)
  if (enrolledSessionIds.length > 0) {
    const now = new Date().toISOString();
    // Use a stable-or-unique activity on a system sentinel: prefer first enrolled session
    // OR insert via recordWorkbenchActivity on the first enrolled id with eventType enroll_missing_completed
    recordWorkbenchActivity(db, {
      actor: input.actor,
      details: {
        enrolled: result.enrolled,
        enrolledSessionIds: enrolledSessionIds.slice(0, 20),
        limit
      },
      eventType: "enroll_missing_completed",
      sessionId: enrolledSessionIds[0],
      summary: `Enrolled ${result.enrolled} missing session${result.enrolled === 1 ? "" : "s"} into Workbench`
    });
  }

  // silence unused if needed
  void existingCountRow;

  return result;
}
```

Notes for implementer:

- Prefer **not** inventing a fake session for summary activity; attaching summary to first enrolled session is fine for V1 Activity rail.
- `enrollWorkbenchSession` must remain safe under concurrent live ingest (unique PK on `session_id` — if insert races, catch and re-read).
- Do **not** call quality precheck here.

If `ensureWorkbenchSessionState` already inserts the right defaults, reuse it. If a race `INSERT` fails, re-read and return `enrolled: false`.

- [ ] **Step 4: Pass tests**

```bash
npm test -- --run src/daemon/db/__tests__/workbenchPipelineRepository.test.ts -t "enroll"
```

- [ ] **Step 5: Commit**

```bash
git add src/daemon/db/workbenchPipelineRepository.ts \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts
git commit -m "$(cat <<'EOF'
feat(workbench): add enroll helper for missing pipeline sessions

Idempotently create publish_path state for sessions that have never
entered Workbench, without touching published or not-added rows.
EOF
)"
```

---

### Task 2: Live Ingest Auto-Enroll

**Files:**
- Modify: `src/daemon/db/sessionRepository.ts`
- Modify: `src/daemon/db/__tests__/sessionRepository.test.ts` (or add focused enroll assertion)

- [ ] **Step 1: Failing test**

After a live event upsert, assert workbench state exists:

```ts
test("live upsert enrolls session onto workbench publish_path", async () => {
  // use existing liveEvent helper + createSessionRepository
  const sessionId = repository.upsertLiveEvent(liveEvent("enroll-live", { project: "Masthead", title: "Enroll live" }));
  expect(sessionId).toBeTruthy();
  const state = readWorkbenchSessionState(db, sessionId!);
  expect(state?.publicationStatus).toBe("publish_path");
  expect(state?.nextAction).toBe("check_transcript");
});
```

Also assert second event does not error and does not change publication if later published (second event alone stays publish_path).

- [ ] **Step 2: Implement hook**

In `createSessionRepository` → `upsertLiveEvent`, after successful `upsertSession` (when `sessionId` is known):

```ts
import { enrollWorkbenchSession } from "./workbenchPipelineRepository.ts";

// at end of upsertLiveEvent, before return:
enrollWorkbenchSession(db, {
  actor: { kind: "system", id: "live_ingest" },
  sessionId
});
return sessionId;
```

Also call from `ingestAdapterRecord` when it returns a new/updated `sessionId` for metadata or transcript adapter paths that create sessions — at minimum any path that inserts into `sessions`. Prefer a single internal helper:

```ts
function afterSessionMaterialized(sessionId: string): void {
  enrollWorkbenchSession(db, { actor: { kind: "system", id: "session_materialize" }, sessionId });
}
```

called from live upsert and adapter ingest success.

Avoid circular imports: `workbenchPipelineRepository` must not import `sessionRepository`.

- [ ] **Step 3: Run tests**

```bash
npm test -- --run src/daemon/db/__tests__/sessionRepository.test.ts src/daemon/db/__tests__/workbenchPipelineRepository.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/daemon/db/sessionRepository.ts src/daemon/db/__tests__/sessionRepository.test.ts
git commit -m "$(cat <<'EOF'
feat(workbench): auto-enroll sessions on live and adapter materialize

Keep Now captures on the Workbench publish path without a manual step
for new events.
EOF
)"
```

---

### Task 3: CLI Enroll Missing

**Files:**
- Modify: `src/cli/workbench.ts`
- Modify: `src/cli/__tests__/mastheadctl.test.ts`

- [ ] **Step 1: Failing CLI test**

```ts
test("workbench enroll --missing enrolls sessions without pipeline state", async () => {
  // seed two sessions, one already ensureWorkbenchSessionState
  const result = await runMastheadCli(["workbench", "enroll", "--missing", "--db", dbPath, "--json"]);
  expect(result.exitCode).toBe(0);
  const body = JSON.parse(result.stdout);
  expect(body.enrolled).toBe(1);
  expect(body.enrolledSessionIds).toContain("session:missing");
});
```

- [ ] **Step 2: Implement**

```text
mastheadctl workbench enroll --missing [--limit N] --json
```

```ts
if (command === "enroll") {
  const mode = args[1]; // expect "--missing" as first flag or subcommand
  // Prefer: workbench enroll --missing
  // Parse --limit
  const actor = { kind: "agent" as const, id: optionValue(args, "--by") ?? "mastheadctl" };
  const limit = Number(optionValue(args, "--limit") ?? 500);
  // open db, migrate if needed (match other commands)
  return jsonResult(enrollMissingWorkbenchSessions(db, { actor, limit }));
}
```

Add help lines next to other workbench commands.

- [ ] **Step 3: Tests + commit**

```bash
npm test -- --run src/cli/__tests__/mastheadctl.test.ts
git add src/cli/workbench.ts src/cli/__tests__/mastheadctl.test.ts
git commit -m "$(cat <<'EOF'
feat(workbench): add CLI enroll --missing for pipeline catch-up

Agent and operator recovery path sharing the same enroll helper as live
ingest and the Workbench UI button.
EOF
)"
```

---

### Task 4: HTTP Enroll-Missing Route

**Files:**
- Modify: `src/shared/workbench.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/__tests__/workbenchApi.test.ts`
- Modify: `docs/reference/daemon-api.md`

- [ ] **Step 1: DTO**

```ts
// src/shared/workbench.ts
export type WorkbenchEnrollMissingResponse = {
  ok: true;
  enrolled: number;
  skippedExisting: number;
  enrolledSessionIds: string[];
  limit: number;
  generatedAt: string;
};
```

- [ ] **Step 2: API test**

```ts
test("POST /workbench/enroll-missing enrolls only sessions without state", async () => {
  // seed session without state + one published
  const res = await fetch(`${base}/workbench/enroll-missing`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limit: 100 })
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.enrolled).toBeGreaterThanOrEqual(1);

  const queue = await (await fetch(`${base}/workbench/sessions?limit=50`)).json();
  expect(queue.sessions.some((s: { sessionId: string }) => s.sessionId === "session:missing")).toBe(true);
});
```

- [ ] **Step 3: Route** (near other workbench handlers; **not** on worktree bridge)

```ts
// POST /workbench/enroll-missing
// body: { limit?: number; actorId?: string }
// actor: { kind: "user", id: body.actorId ?? "workbench_ui" }
const result = enrollMissingWorkbenchSessions(database, { actor, limit });
sendJson(..., 200, {
  ok: true,
  ...result,
  generatedAt: new Date().toISOString()
});
```

- [ ] **Step 4: Docs + tests + commit**

```bash
npm test -- --run src/daemon/__tests__/workbenchApi.test.ts
git add src/shared/workbench.ts src/daemon/server.ts \
  src/daemon/__tests__/workbenchApi.test.ts docs/reference/daemon-api.md
git commit -m "$(cat <<'EOF'
feat(workbench): expose enroll-missing HTTP op for Workbench UI

Thin write route over the shared enroll helper so the toolbar button can
catch up sessions that never entered the pipeline.
EOF
)"
```

---

### Task 5: Client + Controller Enroll Action

**Files:**
- Modify: `src/app/daemonClient.ts`
- Modify: `src/app/__tests__/daemonClient.test.ts`
- Modify: `src/app/workbench/useWorkbenchController.ts`
- Modify: `src/app/workbench/__tests__/useWorkbenchController.test.tsx`

- [ ] **Step 1: Client**

```ts
export async function postWorkbenchEnrollMissing(
  baseUrl: string,
  options: { limit?: number; signal?: AbortSignal } = {}
): Promise<WorkbenchEnrollMissingResponse> {
  const body = options.limit === undefined ? undefined : { limit: options.limit };
  return postJson(baseUrl, "/workbench/enroll-missing", {
    body,
    label: "workbench enroll missing",
    signal: options.signal
  });
}
```

- [ ] **Step 2: Controller**

Extend `WorkbenchActionKind`:

```ts
| "enroll_missing"
```

`canRun("enroll_missing")`: `isLive && !actionBusy` (always available when live; button may show enrolled count after). Optional later: disable when a prior response said enrolled=0 and queue still empty — not required V1.

`runAction("enroll_missing")`:

```ts
const result = await postWorkbenchEnrollMissing(activeProjectionUrl, { limit: 500 });
setLastActionSummary(
  result.enrolled === 0
    ? "No missing sessions to enroll"
    : `Enrolled ${result.enrolled} session${result.enrolled === 1 ? "" : "s"}`
);
await load();
```

- [ ] **Step 3: Tests**

- Client posts correct path  
- Controller enroll reloads sessions  
- Busy disables double enroll  

```bash
npm test -- --run src/app/__tests__/daemonClient.test.ts src/app/workbench/__tests__/useWorkbenchController.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/app/daemonClient.ts src/app/__tests__/daemonClient.test.ts \
  src/app/workbench/useWorkbenchController.ts \
  src/app/workbench/__tests__/useWorkbenchController.test.tsx \
  src/shared/workbench.ts
git commit -m "$(cat <<'EOF'
feat(workbench): wire enroll-missing through client and controller
EOF
)"
```

---

### Task 6: Workbench UI — Enroll Missing Button

**Files:**
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/app/App.tsx` (if new props needed — prefer using existing `runAction` / `canRun`)
- Modify: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`

- [ ] **Step 1: UI tests**

```tsx
test("toolbar exposes Enroll missing without CLI recipes", () => {
  render(<WorkbenchPanel canRun={() => true} runAction={vi.fn()} /* ... */ />);
  expect(screen.getByRole("button", { name: /enroll missing/i })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/mastheadctl|npm run/i);
});
```

- [ ] **Step 2: Place button**

Put **Enroll missing** at the **start** of the ops cluster (queue intake), before selection ops:

```text
[Enroll missing] | [Copy Agent Prompt] [Check] [Import Transcript] ... | facts
```

```tsx
<AppButton
  variant="default"
  onClick={() => run("enroll_missing")}
  disabled={!canRun("enroll_missing")}
>
  Enroll missing
</AppButton>
```

Empty state when publish path is 0: keep existing empty copy; optionally add secondary line:

```text
No publish-path sessions
If Now has captures, use Enroll missing
```

Do not auto-run enroll on panel mount.

- [ ] **Step 3: Tests + commit**

```bash
npm test -- --run src/ui/workbench/__tests__/WorkbenchPanel.test.tsx
git add src/ui/workbench/WorkbenchPanel.tsx src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/app/App.tsx
git commit -m "$(cat <<'EOF'
feat(workbench): add Enroll missing toolbar control

Operator catch-up for sessions that never entered the publish-path queue.
EOF
)"
```

---

### Task 7: Toolbar Density — Workbench Matches Now

**Files:**
- Modify: `src/styles/masthead.css` (workbench toolbar + facts)

- [ ] **Step 1: Align Workbench toolbar shell to Now tokens**

Targets:

| Token | Value |
|---|---|
| Bar min-height | `56px` (inherit `.observability-toolbar`) |
| Bar padding | `var(--space-sm)` |
| Bar gap | `var(--space-xs)` |
| Buttons | `min-height: 40px` (remove 36px override or set 40px) |
| Fact chips | `min-height: 40px` (not 56px), keep label top / number centered |
| Prefer nowrap | `flex-wrap: nowrap` on desktop; allow wrap only below existing mobile breakpoints |

Concrete CSS changes:

```css
.workbench-toolbar.observability-toolbar {
  /* keep metal styles but match Now density */
  flex-wrap: nowrap;
  min-height: 56px;
  gap: var(--space-xs);
  padding: var(--space-sm);
  margin: 0 0 14px; /* same bottom rhythm as shared toolbar if not already */
  overflow-x: auto; /* if actions overflow, scroll rather than double height */
  overflow-y: hidden;
}

.workbench-toolbar-actions {
  flex-wrap: nowrap;
  gap: var(--space-xs);
}

.workbench-toolbar-actions .app-button {
  min-height: 40px;
  padding-inline: 12px;
  font-size: 12px;
  flex: 0 0 auto;
}

.workbench-toolbar-facts div {
  min-height: 40px;
  min-width: 88px;
  padding: 4px 8px;
}

.workbench-toolbar-facts dd {
  font-size: 16px; /* still readable; slightly under 18px if height tight */
}
```

If overflow is ugly with all ops, keep all buttons but horizontal scroll inside the actions row rather than wrapping to a second full-height row. Do **not** remove ops in this task unless scroll is insufficient — then collapse Claim/Release into a compact pattern only if necessary (prefer scroll first).

- [ ] **Step 2: Visual check**

In Electron: Now toolbar height vs Workbench toolbar height should be ~equal. Fact chips should not force a taller bar.

- [ ] **Step 3: Commit**

```bash
git add src/styles/masthead.css
git commit -m "$(cat <<'EOF'
style(workbench): match Now toolbar density for ops bar

Use 40px controls, compact fact chips, and single-row layout so Workbench
chrome no longer doubles Now toolbar height.
EOF
)"
```

---

### Task 8: Toolbar Density — Sources Matches Now

**Files:**
- Modify: `src/styles/sources.css`

- [ ] **Step 1: Align Sources action bar**

Current problem: `.sources-action-bar.sources-toolbar .app-button { min-height: 40px; }` is correct for buttons, but bar padding/facts/wrap still inflate height.

```css
.sources-action-bar.sources-toolbar {
  min-height: 56px;
  gap: var(--space-xs);
  padding: var(--space-sm); /* if not already via observability-toolbar */
  flex-wrap: nowrap;
  align-items: center;
  overflow-x: auto;
}

.sources-action-bar.sources-toolbar .sources-action-group {
  flex-wrap: nowrap;
  gap: var(--space-xs);
}

.sources-action-bar.sources-toolbar .app-button {
  min-height: 40px;
}

.sources-toolbar-facts div {
  min-height: 40px;
  padding: 4px 8px;
}

.sources-toolbar-facts dd {
  /* optional: slightly larger numbers for parity with workbench facts */
  font-size: 16px;
  text-align: center; /* if structure allows */
}
```

Do not redesign connector cards. Toolbar only.

- [ ] **Step 2: Commit**

```bash
git add src/styles/sources.css
git commit -m "$(cat <<'EOF'
style(sources): match Now toolbar density

Tighten Sources metal bar and fact chips to the same 40px control
height and single-row spacing as Now and Workbench.
EOF
)"
```

---

### Task 9: Dogfood + Evidence

**Files:**
- Create: `docs/acceptance/workbench-enroll-evidence.md`
- Optional: extend `scripts/dogfood-workbench-ops.js` with an enroll step

- [ ] **Step 1: Automated**

```bash
# rebuild daemon if needed
npm run build:daemon

# unit/API
npm test -- --run \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts \
  src/daemon/db/__tests__/sessionRepository.test.ts \
  src/daemon/__tests__/workbenchApi.test.ts \
  src/cli/__tests__/mastheadctl.test.ts \
  src/app/workbench \
  src/ui/workbench

# dogfood enroll on temp DB or CLI against dev only if safe:
# Prefer temp DB in script. Against live dev:
# node dist/daemon/src/cli/mastheadctl.js workbench enroll --missing --json
```

- [ ] **Step 2: Live UI checklist (primary daemon)**

1. Note Now card count and Workbench publish path (likely 0).  
2. Click **Enroll missing** → publish path rises; table fills.  
3. Generate a new live event (or Settings connector test) → new session appears on Workbench without button.  
4. Click Enroll missing again → “No missing sessions” / enrolled 0.  
5. Compare Now / Workbench / Sources toolbar heights visually.  
6. Confirm bridge still cannot POST enroll-missing.

- [ ] **Step 3: Write evidence doc + commit**

```bash
git add docs/acceptance/workbench-enroll-evidence.md scripts/dogfood-workbench-ops.js
git commit -m "$(cat <<'EOF'
test(workbench): record enroll-missing and toolbar density evidence
EOF
)"
```

---

### Task 10: Verification Gate

- [ ] **Step 1: Focused suites**

```bash
npm test -- --run \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts \
  src/daemon/db/__tests__/sessionRepository.test.ts \
  src/daemon/__tests__/workbenchApi.test.ts \
  src/cli/__tests__/mastheadctl.test.ts \
  src/app/__tests__/daemonClient.test.ts \
  src/app/workbench \
  src/ui/workbench
```

Expected: PASS.

- [ ] **Step 2: Contracts**

```bash
npm run check:product-contract
npm run check:surface-contract
npm run verify:no-citations
npm run check:endpoint-matrix
```

Note: full typecheck may still fail on pre-existing Sources fixtures — document if unrelated.

- [ ] **Step 3: CLI token guard**

```bash
rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" \
  src/ui/workbench/WorkbenchPanel.tsx || true
```

Expected: no matches.

- [ ] **Step 4: Final docs commit if needed**

```bash
git add docs/acceptance/ docs/reference/daemon-api.md
git commit -m "$(cat <<'EOF'
docs(workbench): close enroll-missing acceptance gate
EOF
)"
```

---

## Execution Order Rationale

1. Repository core first — single source of truth for enroll semantics.  
2. Live path — stops the hole from growing.  
3. CLI — agent parity before UI.  
4. HTTP + client + controller + button — human ops in Workbench.  
5. Density CSS — independent visual fix after button exists so layout includes Enroll.  
6. Sources density — same visual language.  
7. Dogfood + gate.

---

## Risk Controls

- **Idempotent enroll only** — never overwrite published/not_added.  
- **Bulk activity** — one summary event, not N spam rows.  
- **Write primary-only** — enroll-missing not on bridge.  
- **No auto transcript import** on enroll.  
- **Toolbar overflow** — horizontal scroll before multi-row height growth.  
- **Performance** — default limit 500; UI uses 500; CLI allows override.

---

## Definition Of Done

- New live sessions appear on Workbench publish path without a button press.  
- **Enroll missing** button enrolls only sessions without pipeline state and reloads the queue.  
- CLI `workbench enroll --missing` shares the same helper.  
- Published and not_added counts unchanged by enroll.  
- Workbench and Sources toolbars approximate Now height (40px controls, ~56px bar).  
- Focused tests + contracts pass (or documented unrelated failures).  
- Evidence doc records live UI enroll + density check.

---

## Self-Review (plan author)

| Requirement | Task |
|---|---|
| Shared enroll helper | Task 1 |
| Live auto-enroll | Task 2 |
| CLI catch-up | Task 3 |
| HTTP for button | Task 4 |
| Client + controller | Task 5 |
| Workbench button | Task 6 |
| Workbench toolbar density | Task 7 |
| Sources toolbar density | Task 8 |
| Dogfood / evidence | Task 9–10 |

No TBD placeholders. Types: `WorkbenchEnrollMissingResponse`, `enroll_missing` action kind, route `POST /workbench/enroll-missing` consistent across tasks.
