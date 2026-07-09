# Workbench Raw Enrichment Sessions Implementation Plan

> Superseded by `docs/superpowers/plans/2026-07-08-workbench-pipeline-v1.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Workbench command-copy surface with a simple user-facing list of raw sessions that need enrichment, plus disposable handoff text the user can give to their coding agent.

**Architecture:** Add one read-only Workbench API endpoint backed by the existing Workbench missing-enrichment queue. Load that endpoint through a small app controller and render a dense selectable table in the Workbench surface. Keep CLI commands, schemas, validation, evidence packets, and apply behavior agent-facing only.

**Tech Stack:** TypeScript, React, Vitest, local HTTP daemon, SQLite-backed repositories, existing Masthead CSS/design system.

## Global Constraints

- Workbench V1 first screen answers: "Which raw sessions should I point my agent at next?"
- First screen shows sessions missing Workbench session enrichment. It does not rank, score, bucket, or predict artifact needs.
- User-facing Workbench must not show `mastheadctl`, shell commands, apply scripts, schema JSON, evidence packets, or artifact JSON.
- CLI remains agent-facing machinery. `session_enrichment`, `session_dossier`, and `bug_fix_trace` still need excellent agent guidance, but not as visible first-screen UI.
- Agent work requests are disposable handoffs generated from current selection. Do not create durable request tables, assignments, task status, owners, due dates, or scheduling.
- The first row payload is minimal: title/objective fallback, project, runtime, lifecycle, last activity, missing-enrichment status, and select/copy handoff action.
- New UI read APIs must be allowed through the read-only worktree bridge and included in the endpoint matrix.
- Before execution, account for the current dirty worktree. Some Workbench files were changed during an accidental implementation pass. Do not blindly delete untracked V1 files; compare each touched file to this plan and either keep matching work or rewrite it deliberately.

## Definition of Done

- Workbench first screen renders a real list of raw sessions missing current Workbench session enrichment.
- Selecting one or more rows generates plain-language handoff text for the user's coding agent.
- Workbench and Session Dossier UI source files contain no visible `mastheadctl`, `npm run`, `output.json`, `schema.json`, or `apply.sh` strings.
- New Workbench read endpoint works from the primary daemon and through the read-only bridge.
- Agent-facing CLI guidance remains available for `session_enrichment`, `session_dossier`, and `bug_fix_trace`, but is not shown as first-screen Workbench UI.
- Focused tests, typecheck, endpoint matrix, and in-app Browser visual checks pass or have documented unrelated failures.

## Do Not Build

- No ranked queue.
- No recommendation buckets.
- No artifact prediction on the first screen.
- No durable work-request table.
- No owner, due date, assignment, scheduling, or task-state workflow.
- No background agent launcher.
- No pre-apply proposal review flow.
- No evidence-packet or artifact JSON first-screen viewer.

---

## File Structure

- `src/shared/workbench.ts`: shared DTOs for Workbench UI read models.
- `src/workbench/queueRepository.ts`: existing source of missing-enrichment queue rows; keep it as the domain query.
- `src/daemon/server.ts`: expose read-only `GET /workbench/missing-sessions`.
- `src/daemon/__tests__/workbenchApi.test.ts`: daemon endpoint tests.
- `src/app/daemonClient.ts`: add `getWorkbenchMissingSessions`.
- `src/app/__tests__/daemonClient.test.ts`: client URL/response test.
- `src/core/worktreeConnector.ts`: allow the new read endpoint through bridge mode.
- `scripts/masthead-endpoint-matrix.js`: include the new endpoint in compatibility checks.
- `src/app/workbench/useWorkbenchController.ts`: load rows, manage selection, produce handoff text.
- `src/app/workbench/__tests__/useWorkbenchController.test.tsx`: controller tests.
- `src/ui/workbench/workbenchHandoff.ts`: pure disposable handoff builder.
- `src/ui/workbench/__tests__/workbenchHandoff.test.ts`: handoff text tests.
- `src/ui/workbench/WorkbenchPanel.tsx`: replace CLI command surface with raw session list and handoff panel.
- `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`: UI contract tests.
- `src/app/App.tsx`: wire the Workbench controller into the surface.
- `src/styles/masthead.css`: replace command-card Workbench CSS with table/list/handoff styles.
- `src/ui/session-dossier/SessionDossier.tsx`: remove the session-scoped CLI command leak.
- `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`: update dossier expectations.
- `src/workbench/instructions.ts`, `src/cli/workbench.ts`, `src/workbench/applySessionEnrichment.ts`: keep or implement the agent-facing guidance contract, but do not surface it in the Workbench UI.
- `docs/reference/daemon-api.md`, `docs/reference/enrichment.md`, `README.md`, `docs/acceptance/workbench-v1-evidence.md`: update docs/evidence after behavior is verified.

---

### Task 0: Worktree Recovery and Guardrails

**Files:**
- Inspect only at first: current dirty worktree files from `git status --short`
- Modify only if needed by later tasks

**Interfaces:**
- Consumes: current dirty worktree, including accidental Workbench implementation edits.
- Produces: a deliberate baseline for executing this plan without resurrecting the command-copy Workbench.

- [ ] **Step 1: Capture the current dirty Workbench scope**

Run:

```bash
git status --short
git diff -- src/ui/workbench src/app src/daemon src/workbench src/cli docs/reference/enrichment.md README.md CONTEXT.md
```

Expected: identify which files already contain accidental implementation work and which files contain earlier V1 work that should not be reverted blindly.

- [ ] **Step 2: Classify current changes before editing**

Create a short local checklist in the implementation notes, not committed product code:

```text
Keep if aligned with this plan:
- agent-facing CLI guidance for all three output kinds
- session_enrichment apply evidence-ref validation
- glossary/docs that say UI handoff, CLI agent-facing

Rewrite if conflicting with this plan:
- Workbench UI command-copy cards
- Dossier visible Workbench command
- first-screen buckets/ranking/artifact prediction

Do not touch if unrelated:
- Electron dev icon/launcher changes
- schema drift repair
- unrelated V1 workbench persistence files unless a task names them
```

- [ ] **Step 3: Establish the no-visible-CLI guard command**

This command should fail before the UI cleanup and pass after Tasks 4 and 6:

```bash
rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" src/ui/workbench src/ui/session-dossier/SessionDossier.tsx
```

Expected before cleanup: matches in current Workbench/Dossier UI. Expected after cleanup: no matches.

---

### Task 1: Read-Only Missing Sessions API

**Files:**
- Create: `src/shared/workbench.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/core/worktreeConnector.ts`
- Modify: `scripts/masthead-endpoint-matrix.js`
- Test: `src/daemon/__tests__/workbenchApi.test.ts`

**Interfaces:**
- Consumes: `queueWorkbenchSessions(db, { kind: "session_enrichment", scope: "missing", limit })`
- Produces:

```ts
export type WorkbenchMissingSessionDto = {
  sessionId: string;
  title: string;
  project?: string;
  runtime: string;
  lifecycle: string;
  lastActivityAt: string;
  enrichmentStatus: "missing" | "stale" | "failed";
};

export type WorkbenchMissingSessionsResponse = {
  ok: true;
  generatedAt: string;
  limit: number;
  sessions: WorkbenchMissingSessionDto[];
};
```

- [ ] **Step 1: Write the failing API test**

Create `src/daemon/__tests__/workbenchApi.test.ts` using the same local harness shape as `src/daemon/__tests__/dataApi.test.ts`: `createMastheadDaemon`, local `listen(daemon)`, local `getJson`, `tempDirs`, and `daemons` cleanup. Add this server-backed test:

```ts
test("returns recent sessions missing Workbench enrichment", async () => {
  const daemon = await startTestDaemon();
  seedSession(daemon.database, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:missing",
    title: "Raw session needing memory"
  });
  seedSession(daemon.database, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:current",
    title: "Already enriched"
  });
  upsertSessionEnrichment(daemon.database, {
    content: { candidateDecisions: [], searchPhrases: [], technologies: [], title: "Already enriched", topics: [], unresolved: [] },
    contentFingerprint: "current",
    enrichmentKind: "session_capsule",
    generatedAt: "2026-07-08T00:00:00.000Z",
    model: "external_agent",
    promptVersion: "session-capsule-v4",
    provider: "workbench_cli",
    sessionId: "session:current",
    sourceRefs: [],
    status: "current"
  });

  const body = await getJson(daemon.baseUrl, "/workbench/missing-sessions?limit=10");

  expect(body).toMatchObject({
    ok: true,
    limit: 10,
    sessions: [expect.objectContaining({
      sessionId: "session:missing",
      title: "Raw session needing memory",
      project: "Masthead",
      runtime: "codex",
      enrichmentStatus: "missing"
    })]
  });
  expect(body.sessions).toHaveLength(1);
});
```

Copy the helper shape from `dataApi.test.ts` instead of inventing a shared test utility.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- --run src/daemon/__tests__/workbenchApi.test.ts
```

Expected: FAIL with a 404 or missing route for `/workbench/missing-sessions`.

- [ ] **Step 3: Add the shared DTO**

Create `src/shared/workbench.ts` with the interfaces above. Keep it DTO-only.

- [ ] **Step 4: Implement the daemon route**

In `src/daemon/server.ts`, add a `GET /workbench/missing-sessions` branch near other read-only `GET` routes:

```ts
if (request.method === "GET" && url.pathname === "/workbench/missing-sessions") {
  const limit = readWorkbenchLimit(url.searchParams.get("limit"));
  const sessions = queueWorkbenchSessions(database, {
    kind: "session_enrichment",
    limit,
    scope: "missing"
  }).map((session) => ({
    enrichmentStatus: session.status === "current" ? "missing" : session.status,
    lastActivityAt: session.lastActivityAt,
    lifecycle: session.lifecycle,
    project: session.project,
    runtime: session.runtime,
    sessionId: session.sessionId,
    title: session.title
  }));
  sendJson(request, response, config.allowedOrigins, 200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    limit,
    sessions
  });
  return;
}
```

Add this local helper near other request parsing helpers:

```ts
function readWorkbenchLimit(raw: string | null): number {
  const parsed = raw ? Number(raw) : 50;
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}
```

- [ ] **Step 5: Allow the endpoint through read-only bridge**

Add `"/workbench/missing-sessions"` to `staticReadOnlyBridgePaths` in `src/core/worktreeConnector.ts`.

- [ ] **Step 6: Add endpoint matrix coverage**

Add this row to `READ_ONLY_ENDPOINTS` in `scripts/masthead-endpoint-matrix.js`:

```js
{ method: "GET", path: "/workbench/missing-sessions?limit=10", label: "workbench missing sessions" }
```

- [ ] **Step 7: Run the API and bridge checks**

Run:

```bash
npm test -- --run src/daemon/__tests__/workbenchApi.test.ts
npm run check:endpoint-matrix
```

Expected: both pass.

---

### Task 2: App Client and Handoff Builder

**Files:**
- Modify: `src/app/daemonClient.ts`
- Modify: `src/app/__tests__/daemonClient.test.ts`
- Create: `src/ui/workbench/workbenchHandoff.ts`
- Create: `src/ui/workbench/__tests__/workbenchHandoff.test.ts`

**Interfaces:**
- Produces:

```ts
export async function getWorkbenchMissingSessions(
  baseUrl?: string,
  options?: { limit?: number; signal?: AbortSignal }
): Promise<WorkbenchMissingSessionsResponse>;

export function buildWorkbenchHandoff(input: {
  sessions: WorkbenchMissingSessionDto[];
}): string;
```

- [ ] **Step 1: Write failing client test**

In `src/app/__tests__/daemonClient.test.ts`, add:

```ts
test("loads Workbench missing sessions from the daemon", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({
        ok: true,
        generatedAt: "2026-07-08T00:00:00.000Z",
        limit: 25,
        sessions: []
      })
    )
  );

  await getWorkbenchMissingSessions("http://127.0.0.1:17373/projection", { limit: 25 });

  expect(fetch).toHaveBeenCalledWith(
    "http://127.0.0.1:17373/workbench/missing-sessions?limit=25",
    expect.objectContaining({ headers: { accept: "application/json" } })
  );
});
```

- [ ] **Step 2: Implement `getWorkbenchMissingSessions`**

In `src/app/daemonClient.ts`, import `WorkbenchMissingSessionsResponse` and add:

```ts
export async function getWorkbenchMissingSessions(
  baseUrl = defaultLiveProjectionUrl(),
  options: { limit?: number; signal?: AbortSignal } = {}
): Promise<WorkbenchMissingSessionsResponse> {
  return getJson<WorkbenchMissingSessionsResponse>(baseUrl, "/workbench/missing-sessions", {
    label: "workbench missing sessions",
    query: { limit: options.limit },
    signal: options.signal
  });
}
```

- [ ] **Step 3: Write failing handoff text tests**

Create `src/ui/workbench/__tests__/workbenchHandoff.test.ts`:

```ts
test("builds a plain-language handoff without CLI commands", () => {
  const text = buildWorkbenchHandoff({
    sessions: [{
      lifecycle: "ended",
      lastActivityAt: "2026-07-08T12:00:00.000Z",
      project: "Masthead",
      runtime: "codex",
      sessionId: "session:abc",
      enrichmentStatus: "missing",
      title: "Raw import session"
    }]
  });

  expect(text).toContain("Masthead is running locally");
  expect(text).toContain("session:abc");
  expect(text).toContain("Raw import session");
  expect(text).toContain("Start with session enrichment");
  expect(text).not.toContain("mastheadctl");
  expect(text).not.toContain("npm run");
  expect(text).not.toContain("output.json");
});
```

- [ ] **Step 4: Implement `buildWorkbenchHandoff`**

Create `src/ui/workbench/workbenchHandoff.ts`:

```ts
import type { WorkbenchMissingSessionDto } from "../../shared/workbench";

export function buildWorkbenchHandoff(input: { sessions: WorkbenchMissingSessionDto[] }): string {
  const rows = input.sessions.map((session) => {
    const project = session.project ? `, project: ${session.project}` : "";
    return `- ${session.title} (${session.sessionId}) — runtime: ${session.runtime}${project}, lifecycle: ${session.lifecycle}, last activity: ${session.lastActivityAt}`;
  });
  return [
    "Masthead is running locally. Please use its agent-facing Workbench tools to enrich the selected sessions.",
    "",
    "Start with session enrichment for each selected session. Use only Masthead evidence. If the evidence clearly supports a durable session dossier or bug-fix trace, create that artifact after the session enrichment.",
    "",
    "Selected sessions:",
    ...rows
  ].join("\n");
}
```

- [ ] **Step 5: Run client and handoff tests**

Run:

```bash
npm test -- --run src/app/__tests__/daemonClient.test.ts src/ui/workbench/__tests__/workbenchHandoff.test.ts
```

Expected: PASS.

---

### Task 3: Workbench Controller

**Files:**
- Create: `src/app/workbench/useWorkbenchController.ts`
- Create: `src/app/workbench/__tests__/useWorkbenchController.test.tsx`

**Interfaces:**
- Consumes: `getWorkbenchMissingSessions`, `buildWorkbenchHandoff`
- Produces:

```ts
export type UseWorkbenchControllerResult = {
  error?: string;
  handoffText: string;
  loading: boolean;
  retry: () => void;
  selectedSessionIds: Set<string>;
  sessions: WorkbenchMissingSessionDto[];
  toggleSession: (sessionId: string) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
};
```

- [ ] **Step 1: Write failing controller tests**

Create tests that mock `getWorkbenchMissingSessions` and assert:

```ts
test("loads missing sessions only when Workbench is active and live", async () => {
  const { result } = renderHook(() => useWorkbenchController({
    active: true,
    activeProjectionUrl: "http://127.0.0.1:17373",
    isLive: true,
    refreshKey: 1
  }));

  await waitFor(() => expect(result.current.sessions).toHaveLength(1));
  expect(getWorkbenchMissingSessions).toHaveBeenCalledWith("http://127.0.0.1:17373", expect.objectContaining({ limit: 50 }));
});

test("builds handoff text from selected rows", async () => {
  const { result } = renderHook(() => useWorkbenchController({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 }));
  await waitFor(() => expect(result.current.sessions).toHaveLength(1));

  act(() => result.current.toggleSession("session:abc"));

  expect(result.current.handoffText).toContain("session:abc");
  expect(result.current.handoffText).not.toContain("mastheadctl");
});
```

- [ ] **Step 2: Implement controller**

Follow `useUsageStatsController` style:

```ts
export function useWorkbenchController({ activeProjectionUrl, active, refreshKey, isLive }: UseWorkbenchControllerOptions): UseWorkbenchControllerResult {
  const [sessions, setSessions] = useState<WorkbenchMissingSessionDto[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState(() => new Set<string>());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async (options: { signal?: AbortSignal } = {}) => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await getWorkbenchMissingSessions(activeProjectionUrl, { limit: 50, signal: options.signal });
      setSessions(response.sessions);
      setSelectedSessionIds((current) => new Set([...current].filter((sessionId) => response.sessions.some((session) => session.sessionId === sessionId))));
    } catch (loadError) {
      if (!options.signal?.aborted) setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!options.signal?.aborted) setLoading(false);
    }
  }, [activeProjectionUrl]);

  useEffect(() => {
    if (!active || !isLive) return;
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [active, isLive, load, refreshKey]);

  const selectedSessions = sessions.filter((session) => selectedSessionIds.has(session.sessionId));
  return {
    error,
    handoffText: buildWorkbenchHandoff({ sessions: selectedSessions }),
    loading,
    retry: () => void load(),
    selectedSessionIds,
    sessions,
    toggleSession: (sessionId) => setSelectedSessionIds((current) => toggleSet(current, sessionId)),
    selectAllVisible: () => setSelectedSessionIds(new Set(sessions.map((session) => session.sessionId))),
    clearSelection: () => setSelectedSessionIds(new Set())
  };
}
```

- [ ] **Step 3: Run controller tests**

Run:

```bash
npm test -- --run src/app/workbench/__tests__/useWorkbenchController.test.tsx
```

Expected: PASS.

---

### Task 4: User-Facing Workbench Panel

**Files:**
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`
- Modify: `src/styles/masthead.css`

**Interfaces:**
- Consumes: `UseWorkbenchControllerResult` props from `App.tsx`
- Produces: static/presentational Workbench surface with no data fetching.

- [ ] **Step 1: Replace old test with the corrected UI contract**

Update `WorkbenchPanel.test.tsx` so it renders:

```tsx
<WorkbenchPanel
  sessions={[{
    lifecycle: "ended",
    lastActivityAt: "2026-07-08T12:00:00.000Z",
    project: "Masthead",
    runtime: "codex",
    sessionId: "session:abc",
    enrichmentStatus: "missing",
    title: "Raw session needing enrichment"
  }]}
  selectedSessionIds={new Set(["session:abc"])}
  handoffText={"Masthead is running locally.\n- Raw session needing enrichment (session:abc)"}
  loading={false}
  onClearSelection={() => undefined}
  onRetry={() => undefined}
  onSelectAllVisible={() => undefined}
  onToggleSession={() => undefined}
/>
```

Assert:

```ts
expect(html).toContain("Sessions needing enrichment");
expect(html).toContain("Raw session needing enrichment");
expect(html).toContain("Masthead");
expect(html).toContain("codex");
expect(html).toContain("ended");
expect(html).toContain("Copy handoff");
expect(html).not.toContain("mastheadctl");
expect(html).not.toContain("npm run");
expect(html).not.toContain("output.json");
expect(html).not.toContain("Bug-fix candidates");
expect(html).not.toContain("Missing dossiers");
```

- [ ] **Step 2: Implement props and markup**

Replace command cards with:

- Header: `Workbench`
- Supporting text: `Choose raw sessions that need memory, then hand them to your coding agent.`
- Toolbar: `Select all visible`, `Clear selection`, `Refresh`
- Table/list columns: session, project, runtime, lifecycle, last activity, enrichment
- Handoff panel visible when one or more rows are selected
- Empty state: `No sessions need Workbench enrichment.`
- Error state with retry button

Do not use `<code>` or `<pre>` for handoff text on the first screen; use a readonly `<textarea>` or selectable text block so it reads like user-to-agent language, not a terminal recipe.
Do not include "dossier", "bug-fix", or artifact language in row labels or first-screen grouping. Artifact creation may appear only inside the disposable handoff as optional follow-up for the agent after session enrichment.

- [ ] **Step 3: Update CSS**

Replace `.workbench-command*` styles with classes such as:

```css
.workbench-session-list {}
.workbench-session-row {}
.workbench-session-meta {}
.workbench-handoff {}
.workbench-handoff textarea {}
```

Use `design.md` constraints: dense developer console, no nested cards, restrained status tokens, 8px radius or less, stable row dimensions, no hero/marketing layout.

- [ ] **Step 4: Run panel tests**

Run:

```bash
npm test -- --run src/ui/workbench/__tests__/WorkbenchPanel.test.tsx
```

Expected: PASS and no CLI strings in rendered HTML.

- [ ] **Step 5: Run the no-visible-CLI guard**

Run:

```bash
rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" src/ui/workbench
```

Expected: no matches.

---

### Task 5: App Wiring

**Files:**
- Modify: `src/app/App.tsx`
- Modify: any existing app/surface tests that render Workbench

**Interfaces:**
- Consumes: `useWorkbenchController`
- Produces: WorkbenchPanel receives controller props.

- [ ] **Step 1: Instantiate the controller**

Near existing surface controllers in `App.tsx`:

```ts
const workbench = useWorkbenchController({
  active: activeSurface === "workbench",
  activeProjectionUrl,
  isLive,
  refreshKey
});
```

Use the actual refresh state names present in `App.tsx`; do not create a separate polling system.

- [ ] **Step 2: Pass props into WorkbenchPanel**

Replace:

```tsx
<WorkbenchPanel />
```

with:

```tsx
<WorkbenchPanel
  error={workbench.error}
  handoffText={workbench.handoffText}
  loading={workbench.loading}
  onClearSelection={workbench.clearSelection}
  onRetry={workbench.retry}
  onSelectAllVisible={workbench.selectAllVisible}
  onToggleSession={workbench.toggleSession}
  selectedSessionIds={workbench.selectedSessionIds}
  sessions={workbench.sessions}
/>
```

- [ ] **Step 3: Run app/UI tests**

Run:

```bash
npm test -- --run src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/app/workbench/__tests__/useWorkbenchController.test.tsx src/app/__tests__/daemonClient.test.ts
```

Expected: PASS.

---

### Task 6: Remove User-Facing CLI Leaks Outside Workbench

**Files:**
- Modify: `src/ui/session-dossier/SessionDossier.tsx`
- Modify: `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`
- Consider: `src/ui/icons/icon-registry.ts`

**Interfaces:**
- Consumes: existing `SessionDossierDto`
- Produces: no visible `mastheadctl` command in Dossier.

- [ ] **Step 1: Write/update failing Dossier test**

Update the test currently named around "Workbench command" so it asserts:

```ts
expect(html).toContain("Workbench");
expect(html).toContain("Use Workbench to prepare an agent handoff for this session.");
expect(html).not.toContain("mastheadctl workbench");
expect(html).not.toContain("--kind");
```

- [ ] **Step 2: Replace command summary**

In `SessionDossier.tsx`, replace the `SummarySection label="Workbench command"` value with plain language:

```tsx
<SummarySection
  label="Workbench"
  section="workbench-handoff"
  value={dossier ? "Use Workbench to prepare an agent handoff for this session." : undefined}
/>
```

Do not add navigation or preselection in this task unless it is already trivial and covered by tests.

- [ ] **Step 3: Replace Workbench icon only if it still reads as terminal-first**

If the sidebar still uses `TerminalWindow`, change `workbench` in `src/ui/icons/icon-registry.ts` to a less terminal-coded lucide icon such as `ClipboardList` or `BookOpenCheck`. Update icon tests if needed.

- [ ] **Step 4: Run Dossier tests**

Run:

```bash
npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/ui/__tests__/observabilitySidebar.test.tsx
```

Expected: PASS, with no user-facing Workbench CLI command.

- [ ] **Step 5: Run the no-visible-CLI guard for Dossier**

Run:

```bash
rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" src/ui/session-dossier/SessionDossier.tsx
```

Expected: no matches.

---

### Task 7: Agent-Facing Guidance Contract

**Files:**
- Modify: `src/workbench/instructions.ts`
- Modify: `src/workbench/applySessionEnrichment.ts`
- Modify: `src/cli/workbench.ts`
- Modify: `src/workbench/__tests__/instructions.test.ts`
- Modify: `src/workbench/__tests__/applySessionEnrichment.test.ts`
- Modify: `src/cli/__tests__/mastheadctl.test.ts`

**Interfaces:**
- Consumes: existing `WorkbenchOutputKind`, schemas, evidence packets, validation.
- Produces: all three output kinds have first-class agent-facing guidance, not visible UI command copy.

- [ ] **Step 1: Keep this task strictly agent-facing**

No JSX from this task should be imported into `src/ui/workbench/WorkbenchPanel.tsx`. This task improves the agent path behind the disposable handoff.

- [ ] **Step 2: Add/keep instruction tests for all three kinds**

Tests should assert that `workbenchInstructions` contains:

```ts
"Agent guidance contract"
"Evidence rules"
"Confidence rubric"
"Field rules for session_enrichment"
"Field rules for session_dossier"
"Field rules for bug_fix_trace"
```

- [ ] **Step 3: Ensure session enrichment apply validates refs against the session packet**

Add or keep a test that:

```ts
expect(() => applySessionEnrichment(db, {
  sessionId: "session:abc",
  output: { ...validOutput(), evidenceRefs: ["missing:ref"] }
})).toThrow("Evidence ref is not present in the packet: missing:ref");
```

- [ ] **Step 4: Ensure CLI help is agent-complete**

`workbench --help` should include `queue`, `next`, `instructions`, `schema`, `evidence`, `validate`, `apply`, `artifacts`, and `batch`.

- [ ] **Step 5: Run Workbench/CLI tests**

Run:

```bash
npm test -- --run src/workbench src/cli
```

Expected: PASS.

---

### Task 8: Documentation and Acceptance Evidence

**Files:**
- Modify: `docs/reference/daemon-api.md`
- Modify: `docs/reference/enrichment.md`
- Modify: `README.md`
- Modify: `docs/acceptance/workbench-v1-evidence.md`

**Interfaces:**
- Consumes: verified behavior from Tasks 1-7.
- Produces: docs that match the corrected product framing.

- [ ] **Step 1: Document the read endpoint**

Add to `docs/reference/daemon-api.md`:

```md
- `GET /workbench/missing-sessions` returns raw sessions missing Workbench session enrichment for the Workbench UI. It is read-only and allowed through the worktree bridge.
```

- [ ] **Step 2: Keep enrichment docs agent-facing**

In `docs/reference/enrichment.md`, explicitly say:

```md
Workbench UI produces disposable user-to-agent handoffs. It does not show CLI commands. The CLI runbook below is agent-facing machinery for the coding agent that receives the handoff.
```

- [ ] **Step 3: Update acceptance evidence**

In `docs/acceptance/workbench-v1-evidence.md`, add a dated row for:

- Missing sessions API
- Workbench UI shows raw missing sessions
- Workbench UI contains no `mastheadctl`, `npm run`, schema JSON, or artifact JSON
- Disposable handoff text exists only for selected sessions
- CLI guidance remains agent-facing for all three output kinds

- [ ] **Step 4: Run doc-adjacent checks**

Run:

```bash
npm run check:product-contract
npm run check:surface-contract
npm run verify:no-citations
```

Expected: PASS.

---

### Task 9: Visual and End-to-End Verification

**Files:**
- No planned source edits unless verification exposes a defect.

**Interfaces:**
- Consumes: implemented UI and daemon API.
- Produces: verified Workbench in local dev app.

- [ ] **Step 1: Run focused automated verification**

Run:

```bash
npm test -- --run src/daemon/__tests__/workbenchApi.test.ts src/app/__tests__/daemonClient.test.ts src/app/workbench/__tests__/useWorkbenchController.test.tsx src/ui/workbench src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/workbench src/cli
npm run typecheck
npm run check:endpoint-matrix
rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" src/ui/workbench src/ui/session-dossier/SessionDossier.tsx
```

Expected: tests/typecheck/endpoint matrix pass, and `rg` returns no matches.

- [ ] **Step 2: Run full verification and record known unrelated failures**

Run:

```bash
npm test -- --run
```

Expected: PASS. If live-state/fixture date-sensitive tests still fail because July 7 live reports are expired under the July 8 clock, record them separately and do not claim full suite green.

- [ ] **Step 3: Start local dev app**

Run:

```bash
npm run dev
```

Expected: daemon/UI start through the harness-neutral launcher. Do not manually steal port `5173`.

- [ ] **Step 4: Browser inspect Workbench**

Using the in-app Browser, inspect Workbench at:

- desktop width
- tablet width
- narrow mobile width

Verify:

- Workbench shows sessions needing enrichment when present.
- Empty state appears when no missing sessions are returned.
- Selecting rows updates disposable handoff text.
- Copy handoff action is visible.
- No user-facing text contains `mastheadctl`, `npm run`, `output.json`, `schema`, raw evidence packet JSON, or artifact JSON.
- Text does not overflow controls at narrow width.

- [ ] **Step 5: Local dev app menu/tray sanity**

If the Electron dev app is expected to run during verification, use the existing installed Masthead Dev entry. Confirm this work does not regress the already-fixed dev launcher/tray icon behavior.

---

## Self-Review

**Spec coverage:** The plan covers raw missing sessions, minimal row information, disposable handoffs, no visible CLI, read-only bridge support, and agent-facing all-kind guidance.

**Scope intentionally excluded:** ranking, recommendation buckets, artifact prediction, durable work requests, assignments, scheduling, background agent launching, and pre-apply proposal review.

**Risk:** The current worktree contains accidental implementation edits. Execution must consciously reconcile them with this plan instead of assuming they are correct.

## Plan Optimizer Notes

Final optimization target: keep the implementation simple enough to match the corrected product decision while making the execution guardrails hard to miss.

Final score: `92/100`.

Score trajectory: `78 -> 88 -> 92 -> 92`.

Score breakdown:

- Product alignment and scope control: `19/20` - keeps Workbench focused on raw sessions needing enrichment and blocks ranking, buckets, task workflow, and visible CLI drift.
- Repo grounding: `18/20` - names the existing queue repository, daemon route style, read-only bridge matcher, endpoint matrix, app client, UI surface, and current dirty-worktree risk.
- Sequencing and dependencies: `14/15` - orders API, client, controller, UI, wiring, CLI-leak cleanup, agent guidance, docs, and verification so each task has a clear prerequisite.
- Verification quality: `14/15` - includes focused failing tests, endpoint matrix checks, typecheck, no-visible-CLI guards, full test attempt, and in-app Browser visual checks.
- Executor clarity: `13/15` - gives concrete files, interfaces, snippets, and expected outcomes without expanding into a full PRD.
- Risk management: `10/10` - adds an explicit recovery step for accidental implementation edits and prevents unrelated launcher/schema work from being overwritten.
- UI/design fit: `4/5` - references the design constraints and keeps the surface dense, but leaves exact visual polish to implementation screenshots.

- Improved recovery: added Task 0 so implementers handle the dirty worktree and accidental implementation pass deliberately.
- Improved scope control: added explicit Definition of Done and Do Not Build sections to prevent buckets, ranking, task workflow, artifact prediction, and visible CLI from creeping back in.
- Improved testability: added no-visible-CLI guard commands and made the Workbench DTO use `enrichmentStatus` instead of overloaded task-like `status`.
- Improved repo fit: corrected the daemon client test snippet to use this repo's existing `vi.stubGlobal(fetch...)` / `response(...)` pattern and fixed the handoff text expectation.
