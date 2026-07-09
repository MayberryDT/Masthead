# Interface Cleanup and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete Usage experience, install the approved Stamped Steel Spine Knowledge flow card, and replace the current Settings Priority Bay with a concise category-based settings surface that keeps Agent access inside Settings.

**Architecture:** Add one read-only Knowledge flow summary boundary from SQLite to a sidebar controller and component, then delete only the renderer-side Usage surface. Recompose Settings around a local category selector and focused category components while preserving existing daemon APIs, stored preferences, MCP behavior, data lifecycle semantics, and Masthead controls.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Node HTTP daemon, SQLite, CSS, Electron desktop bridge.

## Global Constraints

- Logbook remains published artifacts only; sessions remain capture, Workbench, and provenance units.
- Do not add Agent Access to primary navigation. Agent access is a compact Settings category.
- Do not change Sources behavior; Sources continues to own discovery, enablement, activation, testing, repair, refresh, and onboarding.
- Keep daemon-side Usage collection and `GET /usage/summary`; remove only the renderer navigation, surface, controller, and orphaned presentation code.
- Preserve the selected sidebar prototype at `mockups/sidebar-knowledge-flow-ten-iterations.html#v1` as the visual source of truth.
- Preserve existing button, toggle, input, filterable-select, status-badge, and confirmation-dialog behavior.
- Category selection is local UI state only: no new route, URL hash, persistence, global store, or daemon endpoint.
- Do not change MCP launch semantics, data deletion semantics, retention semantics, or stored preference formats.
- Use `DevCite` only during live visual inspection and remove every wrapper before commit.
- Follow the read-only worktree bridge contract for new GET endpoints.

---

## File Map

### New files

- `src/shared/knowledgeFlow.ts` — shared four-count DTO.
- `src/daemon/db/knowledgeFlowRepository.ts` — one database read for the sidebar inventory.
- `src/daemon/db/__tests__/knowledgeFlowRepository.test.ts` — count and filtering semantics.
- `src/app/sidebar/useKnowledgeFlowSummary.ts` — sidebar loading, polling, abort, and error state.
- `src/app/sidebar/__tests__/useKnowledgeFlowSummary.test.tsx` — controller behavior.
- `src/ui/SidebarKnowledgeFlow.tsx` — selected Stamped Steel Spine markup.
- `src/ui/__tests__/sidebarKnowledgeFlow.test.tsx` — rendering states.
- `src/ui/settings/SettingsCategoryNav.tsx` — Settings category rail.
- `src/ui/settings/AdvancedSettings.tsx` — compact runtime/database identity.
- `src/ui/settings/__tests__/SettingsCategoryNav.test.tsx` — category semantics and switching.

### Modified files

- `src/daemon/server.ts`, `src/app/daemonClient.ts` — Knowledge flow HTTP boundary.
- `src/core/worktreeConnector.ts`, `scripts/masthead-endpoint-matrix.js` — bridge coverage.
- `src/app/App.tsx`, `src/ui/ObservabilitySidebar.tsx` — remove Usage and wire Knowledge flow.
- `src/ui/OperationsPanel.tsx` — category state and focused pane composition.
- `src/ui/settings/PreferencesSettings.tsx`, `StorageSettings.tsx`, `McpSettings.tsx`, `DangerZone.tsx`, `SettingsSection.tsx`, `SettingsRow.tsx` — concise category content.
- `src/styles/settings.css`, `src/styles/masthead.css`, `src/styles/sources.css` — new Settings layout, sidebar card, and removal of Usage-named presentation residue.
- `src/ui/sources/SourcesConnectedDashboard.tsx` — neutral summary class names with unchanged visuals.
- Existing focused tests under `src/app/__tests__/`, `src/core/__tests__/`, `src/ui/__tests__/`, and `src/ui/settings/__tests__/`.
- `design.md` — approved Settings archetype and no standalone Agent Access surface.

### Deleted files

- `src/app/usage/useUsageStatsController.ts`
- `src/app/surfaces/UsageSurface.tsx`
- `src/ui/SidebarUsageStats.tsx`
- `src/ui/usage/UsagePanel.tsx`
- `src/ui/usage/UsageSummaryStrip.tsx`
- `src/ui/usage/__tests__/UsagePanel.test.tsx`
- `src/ui/__tests__/sidebarUsageStats.test.tsx`
- `src/ui/settings/OnboardingSettings.tsx`

---

### Task 1: Restore the green TypeScript baseline

**Files:**
- Modify: `src/app/__tests__/sessionIdlePresentation.test.ts`
- Modify: `src/app/sources/__tests__/setupPlanRunner.test.ts`
- Modify: `src/ui/logbook/LogbookInspector.tsx`
- Modify: `src/ui/logbook/LogbookRow.tsx`
- Modify: `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`

**Interfaces:**
- Consumes: current `SessionCardView`, `SourcesSetupPlan`, `LogbookSession`, and artifact-kind unions.
- Produces: a clean `npm run typecheck` baseline before interface edits.

- [ ] **Step 1: Correct stale test fixtures**

In `sessionIdlePresentation.test.ts`, remove the duplicate `sessionId` default and use current enum values:

```ts
function card(overrides: Partial<SessionCardView> & { sessionId: string }): SessionCardView {
  return {
    project: "Masthead",
    title: "Session",
    headline: { headline: "Session", source: "offline", confidence: "low" },
    stateLabel: "Active",
    primaryStatus: "reading",
    lifecycle: "running",
    priorityRank: 1,
    durationLabel: "1m",
    lastActivity: "2026-07-09T00:00:00.000Z",
    lastActivityLabel: "now",
    changedFileCount: 0,
    indicators: [],
    identityConfidence: "direct",
    safeActions: [],
    isExpanded: false,
    ...overrides
  };
}
```

Delete every `importTranscripts: false` property from `setupPlanRunner.test.ts`; the current `SourcesSetupPlan` no longer declares it. Change the forbidden artifact fixture from `artifactKind: "bug_fix_trace"` to `artifactKind: "runbook"`.

- [ ] **Step 2: Narrow optional Logbook values correctly**

In `LogbookInspector.tsx`, use a non-null filter that preserves the actual returned object shape:

```ts
const entries = value
  .map((entry) => {
    const record = asRecord(entry);
    if (!record) return undefined;
    const at = stringField(record, "at");
    const summary = stringField(record, "summary");
    if (!at && !summary) return undefined;
    return { at, summary };
  })
  .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
```

In `LogbookRow.tsx`, normalize optional display inputs before rendering:

```ts
const kind = session.runtime ?? session.lifecycle ?? "artifact";
const publishedAt = session.lastActivityAt;
```

Use `kindLabel(kind)`, and render the date cell as:

```tsx
<td className="logbook-date logbook-col-date">
  {publishedAt ? (
    <>
      <time dateTime={publishedAt}>{formatDate(publishedAt)}</time>
      <span>{formatTime(publishedAt)}</span>
    </>
  ) : (
    <span>—</span>
  )}
</td>
```

- [ ] **Step 3: Verify the baseline**

Run:

```bash
npm run typecheck
npx vitest run src/app/__tests__/sessionIdlePresentation.test.ts src/app/sources/__tests__/setupPlanRunner.test.ts src/ui/logbook src/ui/session-dossier/__tests__/SessionDossier.test.tsx
```

Expected: TypeScript exits 0 and the focused tests pass.

- [ ] **Step 4: Commit the baseline cleanup**

```bash
git add src/app/__tests__/sessionIdlePresentation.test.ts src/app/sources/__tests__/setupPlanRunner.test.ts src/ui/logbook/LogbookInspector.tsx src/ui/logbook/LogbookRow.tsx src/ui/session-dossier/__tests__/SessionDossier.test.tsx
git commit -m "fix: restore artifact-first typecheck baseline"
```

---

### Task 2: Add the Knowledge flow summary read boundary

**Files:**
- Create: `src/shared/knowledgeFlow.ts`
- Create: `src/daemon/db/knowledgeFlowRepository.ts`
- Create: `src/daemon/db/__tests__/knowledgeFlowRepository.test.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/app/__tests__/daemonClient.test.ts`
- Modify: `src/core/worktreeConnector.ts`
- Modify: `src/core/__tests__/worktreeConnector.test.ts`
- Modify: `scripts/masthead-endpoint-matrix.js`

**Interfaces:**
- Produces: `KnowledgeFlowSummaryDto` and `getKnowledgeFlowSummary(baseUrl, options)`.
- Consumed by: Task 3 sidebar controller.

- [ ] **Step 1: Write the failing repository test**

Create `knowledgeFlowRepository.test.ts` with a migrated temporary database. Use this test body after importing `seedSession`, `ensureWorkbenchSessionState`, `applySessionArtifact`, `publishSessionArtifact`, `openMastheadDatabase`, and `migrateDatabase`:

```ts
test("summarizes current pipeline inventory without deleted or superseded rows", async () => {
  const db = await testDb();
  for (const sessionId of ["session:one", "session:two", "session:resolved", "session:deleted"]) {
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: sessionId
    });
    ensureWorkbenchSessionState(db, sessionId);
  }
  db.prepare("UPDATE sessions SET deleted_at = ? WHERE session_id = ?")
    .run("2026-07-09T12:00:00.000Z", "session:deleted");
  db.prepare("UPDATE workbench_session_state SET publication_status = 'published', resolution_status = 'automatic_resolved' WHERE session_id = ?")
    .run("session:resolved");

  const publishArtifact = (sessionId: string, fingerprint: string) => {
    const artifact = applySessionArtifact(db, {
      artifactKind: "session_dossier",
      content: { summary: fingerprint },
      contentFingerprint: fingerprint,
      createdBy: "test",
      evidenceRefs: [],
      schemaVersion: "session-dossier-v1",
      sessionId,
      title: fingerprint,
      validation: { ok: true }
    });
    publishSessionArtifact(db, artifact.artifactId);
    return artifact;
  };

  publishArtifact("session:one", "artifact-old");
  publishArtifact("session:one", "artifact-one");
  publishArtifact("session:two", "artifact-two");

expect(getKnowledgeFlowSummary(db)).toEqual({
  capturedSessions: 3,
  workbenchSessions: 2,
  publishedArtifacts: 2,
  automaticallyResolvedSessions: 1
});
});
```

- [ ] **Step 2: Run the repository test and confirm the missing module failure**

```bash
npx vitest run src/daemon/db/__tests__/knowledgeFlowRepository.test.ts
```

Expected: FAIL because `knowledgeFlowRepository.ts` does not exist.

- [ ] **Step 3: Implement the shared DTO and one-query repository**

Create `src/shared/knowledgeFlow.ts`:

```ts
export type KnowledgeFlowSummaryDto = {
  capturedSessions: number;
  workbenchSessions: number;
  publishedArtifacts: number;
  automaticallyResolvedSessions: number;
};
```

Create `src/daemon/db/knowledgeFlowRepository.ts`:

```ts
import type { KnowledgeFlowSummaryDto } from "../../shared/knowledgeFlow.ts";
import type { MastheadDatabase } from "./sqlite.ts";

type KnowledgeFlowSummaryRow = {
  capturedSessions: number;
  workbenchSessions: number;
  publishedArtifacts: number;
  automaticallyResolvedSessions: number;
};

export function getKnowledgeFlowSummary(db: MastheadDatabase): KnowledgeFlowSummaryDto {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sessions WHERE deleted_at IS NULL) AS capturedSessions,
      (SELECT COUNT(*)
       FROM workbench_session_state
       JOIN sessions ON sessions.session_id = workbench_session_state.session_id
       WHERE workbench_session_state.publication_status = 'publish_path'
         AND sessions.deleted_at IS NULL) AS workbenchSessions,
      (SELECT COUNT(*)
       FROM session_artifacts
       WHERE publication_status = 'published' AND status = 'current') AS publishedArtifacts,
      (SELECT COUNT(*)
       FROM workbench_session_state
       JOIN sessions ON sessions.session_id = workbench_session_state.session_id
       WHERE workbench_session_state.resolution_status = 'automatic_resolved'
         AND sessions.deleted_at IS NULL) AS automaticallyResolvedSessions
  `).get() as KnowledgeFlowSummaryRow;

  return {
    capturedSessions: Number(row.capturedSessions),
    workbenchSessions: Number(row.workbenchSessions),
    publishedArtifacts: Number(row.publishedArtifacts),
    automaticallyResolvedSessions: Number(row.automaticallyResolvedSessions)
  };
}
```

- [ ] **Step 4: Expose and test the HTTP/client boundary**

Import the repository in `server.ts` and add the GET branch before the Workbench routes:

```ts
if (request.method === "GET" && url.pathname === "/knowledge-flow/summary") {
  sendJson(request, response, config.allowedOrigins, 200, {
    ok: true,
    summary: getKnowledgeFlowSummary(database)
  });
  return;
}
```

Add to `daemonClient.ts`:

```ts
import type { KnowledgeFlowSummaryDto } from "../shared/knowledgeFlow";

export async function getKnowledgeFlowSummary(
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<KnowledgeFlowSummaryDto> {
  const body = await getJson<{ ok: true; summary: KnowledgeFlowSummaryDto }>(baseUrl, "/knowledge-flow/summary", {
    label: "knowledge flow summary",
    signal: options.signal
  });
  return body.summary;
}
```

Add a daemon-client test that expects `http://127.0.0.1:17373/knowledge-flow/summary` with the standard accept header.

- [ ] **Step 5: Admit the GET through the bridge and endpoint matrix**

Add `"/knowledge-flow/summary"` to `staticReadOnlyBridgePaths`, add a positive matcher assertion, and add:

```js
{ method: "GET", path: "/knowledge-flow/summary", label: "sidebar knowledge flow summary" }
```

to `READ_ONLY_ENDPOINTS`. Do not add a POST route.

- [ ] **Step 6: Verify and commit the read boundary**

```bash
npx vitest run src/daemon/db/__tests__/knowledgeFlowRepository.test.ts src/app/__tests__/daemonClient.test.ts src/core/__tests__/worktreeConnector.test.ts
npm run build:daemon
npm run check:endpoint-matrix
git add src/shared/knowledgeFlow.ts src/daemon/db/knowledgeFlowRepository.ts src/daemon/db/__tests__/knowledgeFlowRepository.test.ts src/daemon/server.ts src/app/daemonClient.ts src/app/__tests__/daemonClient.test.ts src/core/worktreeConnector.ts src/core/__tests__/worktreeConnector.test.ts scripts/masthead-endpoint-matrix.js
git commit -m "feat: expose knowledge flow summary"
```

Expected: all commands pass and the matrix recognizes the new GET route.

---

### Task 3: Install the Stamped Steel Spine sidebar card

**Files:**
- Create: `src/app/sidebar/useKnowledgeFlowSummary.ts`
- Create: `src/app/sidebar/__tests__/useKnowledgeFlowSummary.test.tsx`
- Create: `src/ui/SidebarKnowledgeFlow.tsx`
- Create: `src/ui/__tests__/sidebarKnowledgeFlow.test.tsx`
- Modify: `src/ui/ObservabilitySidebar.tsx`
- Modify: `src/ui/__tests__/observabilitySidebar.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/masthead.css`

**Interfaces:**
- Consumes: `getKnowledgeFlowSummary` and `KnowledgeFlowSummaryDto` from Task 2.
- Produces: `useKnowledgeFlowSummary` state and the `SidebarKnowledgeFlow` visual.

- [ ] **Step 1: Write failing component and controller tests**

The component test must assert loaded values, zero values, em-dash loading values, and `Summary unavailable`. The controller test must mock `getKnowledgeFlowSummary`, render a hook harness with `isLive: true`, and assert:

```ts
expect(current()).toMatchObject({
  loading: false,
  error: undefined,
  summary: {
    capturedSessions: 17,
    workbenchSessions: 6,
    publishedArtifacts: 11,
    automaticallyResolvedSessions: 4
  }
});
```

Add a second test that unmounts before resolution and asserts the aborted request does not write error state.

- [ ] **Step 2: Run the tests and confirm missing-module failures**

```bash
npx vitest run src/app/sidebar/__tests__/useKnowledgeFlowSummary.test.tsx src/ui/__tests__/sidebarKnowledgeFlow.test.tsx
```

- [ ] **Step 3: Implement the controller**

Create `useKnowledgeFlowSummary.ts` with this public result:

```ts
export type UseKnowledgeFlowSummaryResult = {
  summary?: KnowledgeFlowSummaryDto;
  loading: boolean;
  error?: string;
};
```

Load immediately when `isLive` is true, reload on `activeProjectionUrl` or `refreshKey`, poll every 60 seconds, abort the initial request on cleanup, and never write loading/error state after an abort. Do not cache a stale summary after the connection becomes unavailable.

- [ ] **Step 4: Implement the selected component markup**

Create `SidebarKnowledgeFlow.tsx`:

```tsx
export function SidebarKnowledgeFlow({ summary, loading = false, error }: Props) {
  const unavailable = Boolean(error);
  const value = (count: number | undefined) => loading || unavailable || count === undefined ? "—" : formatCount(count);

  return (
    <section className={`sidebar-knowledge-flow ${unavailable ? "unavailable" : ""}`} aria-label="Knowledge flow">
      <p className="sidebar-knowledge-flow-title">Knowledge flow</p>
      <div className="sidebar-knowledge-spine">
        <FlowRow index="01" label="Captured sessions" value={value(summary?.capturedSessions)} />
        <FlowRow index="02" label="In Workbench" value={value(summary?.workbenchSessions)} />
        <FlowRow index="03" label="Published artifacts" value={value(summary?.publishedArtifacts)} />
      </div>
      <p className="sidebar-knowledge-resolved">
        {unavailable ? "Summary unavailable" : `${value(summary?.automaticallyResolvedSessions)} automatically resolved`}
      </p>
    </section>
  );
}
```

Port the `.v1 .spine`, `.spine-row`, `.node`, and `.resolved` geometry from the approved prototype into scoped `.sidebar-knowledge-*` rules. Reuse the exact shared secondary-card border, background, stamped-band pseudo-element, and 2px blue bottom edge.

- [ ] **Step 5: Wire the component into the app shell**

Change `ObservabilitySidebar` props from Usage values to:

```ts
knowledgeFlowSummary?: KnowledgeFlowSummaryDto;
knowledgeFlowLoading?: boolean;
knowledgeFlowError?: string;
```

Render `SidebarKnowledgeFlow` at the bottom. In `App.tsx`, call `useKnowledgeFlowSummary` beside the other controllers and pass its state to the sidebar.

- [ ] **Step 6: Verify the source-of-truth match and commit**

```bash
npx vitest run src/app/sidebar/__tests__/useKnowledgeFlowSummary.test.tsx src/ui/__tests__/sidebarKnowledgeFlow.test.tsx src/ui/__tests__/observabilitySidebar.test.tsx
npm run verify:no-citations
git add src/app/sidebar src/ui/SidebarKnowledgeFlow.tsx src/ui/ObservabilitySidebar.tsx src/ui/__tests__/sidebarKnowledgeFlow.test.tsx src/ui/__tests__/observabilitySidebar.test.tsx src/app/App.tsx src/styles/masthead.css
git commit -m "feat: add sidebar knowledge flow"
```

Expected: the card matches option 1 and renders all four states without action controls.

---

### Task 4: Retire the renderer Usage surface and presentation residue

**Files:**
- Delete: renderer Usage files listed in the File Map.
- Modify: `src/app/App.tsx`
- Modify: `src/ui/ObservabilitySidebar.tsx`
- Modify: `src/ui/sources/SourcesConnectedDashboard.tsx`
- Modify: `src/styles/masthead.css`
- Modify: `src/styles/sources.css`
- Modify: `src/ui/__tests__/dovetailCardSystem.test.tsx`
- Modify: `src/ui/__tests__/sourcesPanel.test.tsx`
- Modify: `src/app/__tests__/collectorAutostart.test.tsx`
- Modify: `src/app/__tests__/sessionTransitionNotificationsApp.test.tsx`

**Interfaces:**
- Preserves: `getUsageStats`, Usage DTOs, daemon Usage repository/API, and capability reporting.
- Removes: `"usage"` from `AppSurface` and every renderer caller of `useUsageStatsController`.

- [ ] **Step 1: Update navigation tests to require Usage absence**

Change the sidebar expectation to:

```ts
expect(html).not.toContain("Usage");
expect(html).not.toContain("Agent Access");
expect(html).toContain("Knowledge flow");
```

Add an App architecture assertion that `App.tsx` contains none of `UsageSurface`, `UsagePanel`, or `useUsageStatsController`.

- [ ] **Step 2: Remove the Usage branch and controller**

Delete the Usage imports, controller call, and `activeSurface === "usage"` branch from `App.tsx`. Change the union to:

```ts
export type AppSurface = "now" | "logbook" | "sources" | "workbench" | "settings";
```

Delete the orphaned renderer files and their focused tests. Remove Usage fetch fixtures only where no remaining test calls `GET /usage/summary`.

- [ ] **Step 3: Neutralize shared Sources summary names without changing Sources visually**

Change Sources markup from `usage-summary-strip`, `usage-metric`, and `usage-metric-accent` to `summary-strip`, `summary-metric`, and `summary-metric-accent`. Rename matching shared CSS selectors and the `usage-card-enter` keyframe to `surface-card-enter`.

Do not change source labels, values, ordering, dimensions, or interactions.

- [ ] **Step 4: Delete renderer-only Usage CSS**

Remove `.usage-panel`, Usage toolbar, Usage chart/table, `.sidebar-usage`, and Usage-only responsive rules. Keep the newly neutral `.summary-*` rules needed by Sources and the `.sidebar-knowledge-*` rules from Task 3.

- [ ] **Step 5: Verify and commit Usage retirement**

```bash
rg -n "UsageSurface|UsagePanel|SidebarUsageStats|useUsageStatsController|sidebar-usage|usage-summary-strip|usage-metric" src/app src/ui src/styles
npx vitest run src/ui/__tests__/observabilitySidebar.test.tsx src/ui/__tests__/dovetailCardSystem.test.tsx src/ui/__tests__/sourcesPanel.test.tsx src/app/__tests__/collectorAutostart.test.tsx src/app/__tests__/sessionTransitionNotificationsApp.test.tsx
git add -A src/app src/ui src/styles
git commit -m "refactor: retire usage interface"
```

Expected: `rg` returns no renderer presentation matches; daemon Usage symbols may still exist outside these paths.

---

### Task 5: Build the focused Settings shell and category navigation

**Files:**
- Create: `src/ui/settings/SettingsCategoryNav.tsx`
- Create: `src/ui/settings/__tests__/SettingsCategoryNav.test.tsx`
- Modify: `src/ui/OperationsPanel.tsx`
- Modify: `src/ui/settings/SettingsSection.tsx`
- Modify: `src/ui/settings/SettingsRow.tsx`
- Modify: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Modify: `src/styles/settings.css`

**Interfaces:**
- Produces: `SettingsCategory` and category selection callback.
- Consumed by: Tasks 6–8 category components.

- [ ] **Step 1: Write the failing navigation test**

Assert the five category buttons, General's selected state, and selection callback:

```tsx
<SettingsCategoryNav active="general" onChange={onChange} />
```

Expected labels: `General`, `Data`, `Agent access`, `Advanced`, `Danger zone`. Clicking Data calls `onChange("data")`.

- [ ] **Step 2: Implement the category rail**

```tsx
export type SettingsCategory = "general" | "data" | "agent-access" | "advanced" | "danger";

const categories: Array<{ id: SettingsCategory; label: string }> = [
  { id: "general", label: "General" },
  { id: "data", label: "Data" },
  { id: "agent-access", label: "Agent access" },
  { id: "advanced", label: "Advanced" },
  { id: "danger", label: "Danger zone" }
];

export function SettingsCategoryNav({ active, onChange }: Props) {
  return (
    <nav className="settings-category-nav" aria-label="Settings categories">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          className={category.id === active ? "active" : ""}
          aria-current={category.id === active ? "page" : undefined}
          onClick={() => onChange(category.id)}
        >
          {category.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Replace Priority Bay composition with one focused pane**

Add `const [activeCategory, setActiveCategory] = useState<SettingsCategory>("general");` to `OperationsPanel`. Replace `.settings-layout-priority-bay` and priority columns with:

```tsx
<div className="settings-workspace">
  <SettingsCategoryNav active={activeCategory} onChange={setActiveCategory} />
  <div className="settings-pane" data-settings-category={activeCategory}>
    {activeCategory === "general" ? (
      <PreferencesSettings
        motionDisabled={motionDisabled}
        onMotionDisabledChange={onMotionDisabledChange}
        sessionEndedNotificationsEnabled={sessionEndedNotificationsEnabled}
        onSessionEndedNotificationsEnabledChange={onSessionEndedNotificationsEnabledChange}
      />
    ) : null}
    {activeCategory === "data" ? (
      <StorageSettings
        busy={busy}
        dataSummary={effectiveSummary}
        onOpenDataDirectory={openDataDirectory}
        onExport={onExportLocalData}
        onRequestPrune={onRequestPruneLocalData}
        settings={effectiveSettings}
        writeDisabled={writesDisabled}
      />
    ) : null}
    {activeCategory === "agent-access" ? <McpSettings baseUrl={baseUrl} privacy={effectiveSettings?.privacy} /> : null}
    {activeCategory === "advanced" ? <AdvancedSettings settings={effectiveSettings} /> : null}
    {activeCategory === "danger" ? (
      <DangerZone
        busy={writesDisabled}
        databaseId={effectiveSettings?.data.databaseId}
        databasePath={effectiveSettings?.data.databasePath}
        deletionScopeKind={deletionScopeKind}
        deletionScopeTarget={deletionScopeTarget}
        onDeletionScopeKindChange={onDeletionScopeKindChange}
        onDeletionScopeTargetChange={onDeletionScopeTargetChange}
        onRequestDeleteAll={onRequestDeleteLocalData}
        onRequestScopedDelete={onRequestScopedDelete}
        targets={effectiveSettings?.deletionTargets}
      />
    ) : null}
  </div>
</div>
```

Keep confirmation dialogs outside the pane so an open confirmation survives category layout changes.

- [ ] **Step 4: Simplify shared Settings primitives**

Make `SettingsSection` render one compact heading and optional one-sentence description. Keep `SettingsRow`'s label/value/control API, but align direct controls in the second column by default instead of forcing every control onto a new row.

- [ ] **Step 5: Add shell CSS and verify**

Implement desktop `grid-template-columns: 184px minmax(0, 760px)`, 18px gap, a flat category rail, and divided ledger rows. At `max-width: 760px`, use one column and a horizontally scrollable category strip. At 390px, stack row controls without horizontal overflow.

```bash
npx vitest run src/ui/settings/__tests__/SettingsCategoryNav.test.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx
git add src/ui/OperationsPanel.tsx src/ui/settings/SettingsCategoryNav.tsx src/ui/settings/SettingsSection.tsx src/ui/settings/SettingsRow.tsx src/ui/settings/__tests__/SettingsCategoryNav.test.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx src/styles/settings.css
git commit -m "feat: add focused settings navigation"
```

---

### Task 6: Simplify General and Data and move onboarding fully to Sources

**Files:**
- Modify: `src/ui/settings/PreferencesSettings.tsx`
- Modify: `src/ui/settings/StorageSettings.tsx`
- Delete: `src/ui/settings/OnboardingSettings.tsx`
- Create: `src/ui/settings/AdvancedSettings.tsx`
- Modify: `src/ui/OperationsPanel.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Modify: `src/ui/__tests__/operationsPanel.test.tsx`

**Interfaces:**
- Preserves: existing preference callbacks, desktop open-folder command, export callback, and retention confirmation.
- Removes: `onOpenOnboarding` from `OperationsPanel` and Settings call sites.

- [ ] **Step 1: Write the category content assertions**

Add tests that switch categories and assert:

```ts
expect(general.textContent).toContain("Motion");
expect(general.textContent).toContain("Session notifications");
expect(general.textContent).not.toContain("Turns off app animations");

expect(data.textContent).toContain("Database");
expect(data.textContent).toContain("Open folder");
expect(data.textContent).toContain("Export data");
expect(data.textContent).toContain("Raw source copies");

expect(container.textContent).not.toContain("Run onboarding again");
```

- [ ] **Step 2: Reduce General to two direct rows**

Change labels to `Motion` and `Session notifications`, remove both descriptions, and keep existing toggle aria labels and storage behavior.

- [ ] **Step 3: Reduce Data to three action rows**

Render only Database/Open folder, Export/Export data, and Raw source copies/count/Delete raw copies. Use a compact path presentation with the full path in `title`.

- [ ] **Step 4: Add Advanced identity**

Create `AdvancedSettings.tsx` with a compact definition list:

```tsx
<SettingsSection eyebrow="System" title="Advanced">
  <SettingsRow label="Database ID" value={settings?.data.databaseId ?? "Loading"} />
  <SettingsRow label="Database path" value={settings?.data.databasePath ?? "Loading"} />
  <SettingsRow label="Data directory" value={settings?.data.dataDirectory ?? "Loading"} />
  <SettingsRow label="Runtime" value={settings ? `${settings.runtime.host}:${settings.runtime.port}` : "Loading"} />
  <SettingsRow label="Mode" value={settings?.runtime.mode ?? "Loading"} />
  <SettingsRow label="Protocol" value={settings ? `API ${settings.apiVersion} / schema ${settings.schemaVersion}` : "Loading"} />
</SettingsSection>
```

- [ ] **Step 5: Remove Settings onboarding wiring**

Delete `OnboardingSettings`, the `onOpenOnboarding` prop, and `reopenOnboarding` in `App.tsx`. Keep Sources' own onboarding controller and modal behavior unchanged.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/__tests__/operationsPanel.test.tsx src/app/sources
git add -A src/ui/settings src/ui/OperationsPanel.tsx src/ui/__tests__/operationsPanel.test.tsx src/app/App.tsx
git commit -m "refactor: simplify general and data settings"
```

---

### Task 7: Compress MCP into the Agent access Settings category

**Files:**
- Modify: `src/ui/settings/McpSettings.tsx`
- Modify: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Modify: `src/ui/settings/__tests__/SettingsOperationalStates.test.tsx`
- Modify: `src/styles/settings.css`

**Interfaces:**
- Preserves: `getMcpStatus`, `getMcpLaunchConfig`, `validateMcpLaunchConfig`, `testMcpConnection`, clipboard copy, and three config formats.
- Removes: always-visible `CodeBlock`, refresh button, long status prose, and format descriptions.

- [ ] **Step 1: Write the concise-agent-access test**

Select Agent access and assert:

```ts
expect(panel.textContent).toContain("MCP server");
expect(panel.textContent).toContain("Test connection");
expect(panel.textContent).toContain("Access");
expect(panel.textContent).toContain("Client setup");
expect(panel.textContent).toContain("Copy configuration");
expect(panel.textContent).not.toContain("Checking the local MCP launch configuration");
expect(panel.querySelector("pre")).toBeNull();
```

- [ ] **Step 2: Replace the MCP card body with three Settings rows**

Use:

```tsx
<SettingsSection eyebrow="Local MCP" title="Agent access">
  <SettingsRow
    label="MCP server"
    value={<StatusBadge tone={statusTone(status, loadState)}>{statusLabel(status, loadState)}</StatusBadge>}
    control={<AppButton onClick={() => void runLaunchTest()} variant="quiet">{testState === "testing" ? "Testing…" : "Test connection"}</AppButton>}
  />
  <SettingsRow
    label="Access"
    value={<StatusBadge tone={accessEnabled ? "active" : "neutral"}>{accessEnabled ? "Enabled" : "Disabled"}</StatusBadge>}
  />
  <SettingsRow
    label="Client setup"
    control={
      <div className="settings-mcp-setup">
        <div className="settings-mcp-tabs" role="tablist" aria-label="MCP config format">
          {configTabs.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              className={tab.kind === activeConfig ? "active" : ""}
              role="tab"
              aria-selected={tab.kind === activeConfig}
              onClick={() => setActiveConfig(tab.kind)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <AppButton disabled={!canCopy} onClick={() => void copyConfig()} variant="quiet">
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy configuration"}
        </AppButton>
      </div>
    }
  />
</SettingsSection>
```

Keep one short inline result below the relevant row for load/test/copy failures. Do not render the config text.

- [ ] **Step 3: Verify loading, test, copy, and read-only behavior**

```bash
npx vitest run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx src/app/__tests__/daemonClient.test.ts
git add src/ui/settings/McpSettings.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx src/styles/settings.css
git commit -m "refactor: compact agent access settings"
```

---

### Task 8: Simplify Danger zone and finish responsive Settings styling

**Files:**
- Modify: `src/ui/settings/DangerZone.tsx`
- Modify: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Modify: `src/ui/settings/__tests__/SettingsOperationalStates.test.tsx`
- Modify: `src/ui/__tests__/operationsPanel.test.tsx`
- Modify: `src/styles/settings.css`

**Interfaces:**
- Preserves: deletion scope selection, target selection, request callbacks, database-ID confirmation, and read-only disabling.
- Produces: final responsive Settings visual contract.

- [ ] **Step 1: Lock destructive behavior with interaction tests**

Assert category selection exposes Danger zone, scoped deletion remains disabled without a target, delete-all still opens the typed database-ID confirmation, and read-only mode disables both mutation buttons.

- [ ] **Step 2: Remove duplicate Danger prose**

Keep this single section description:

```tsx
description="Deletes only Masthead's local canonical data. Original harness files are never changed."
```

Render Database as the compact ID value, then the scoped deletion controls and delete-all button. Remove duplicate path and retention explanations.

- [ ] **Step 3: Finish Settings CSS**

Delete `.settings-layout-priority-bay` and `.settings-priority-column*`. Ensure:

```css
.settings-workspace {
  display: grid;
  grid-template-columns: 184px minmax(0, 760px);
  align-items: start;
  gap: 18px;
  min-width: 0;
}

@media (max-width: 760px) {
  .settings-workspace { grid-template-columns: minmax(0, 1fr); }
  .settings-category-nav { display: flex; overflow-x: auto; }
  .settings-row { grid-template-columns: minmax(0, 1fr); }
}
```

Use 40px minimum controls, visible focus rings, no rounded pills, no nested cards, and no horizontal scrolling.

- [ ] **Step 4: Verify and commit the completed Settings surface**

```bash
npx vitest run src/ui/settings src/ui/__tests__/operationsPanel.test.tsx
npm run check:surface-contract
npm run verify:no-citations
git add src/ui/settings src/ui/OperationsPanel.tsx src/ui/__tests__/operationsPanel.test.tsx src/styles/settings.css
git commit -m "feat: finish focused settings surface"
```

---

### Task 9: Align the master design contract and complete verification

**Files:**
- Modify: `design.md`
- Modify: `scripts/masthead-surface-contract.js` only if the new Settings shell needs a durable structural assertion.
- Verify: all files changed in Tasks 1–8.

**Interfaces:**
- Documents: the final surface ownership and visual archetypes.
- Produces: a verified implementation ready for Tyler's hands-on QA.

- [ ] **Step 1: Update `design.md`**

Replace the obsolete standalone Agent Access references with the approved ownership:

```md
- Settings: category rail plus a focused settings ledger for General, Data, Agent access, Advanced, and Danger zone.
- Agent access is a compact MCP information/setup category inside Settings, not a primary surface.
```

State that Sources owns onboarding and that Settings rows prefer direct controls with no explanatory paragraph unless safety or ambiguity requires one.

- [ ] **Step 2: Run the full automated gate**

```bash
npm run verify:no-citations
npm run check:product-contract
npm run check:surface-contract
npm run typecheck
npm test -- --run
npm run build
npm run check:endpoint-matrix
```

Expected: every command exits 0.

- [ ] **Step 3: Inspect the live app with the required browser**

Run Masthead through the repository launcher on an available worktree-safe port. With the in-app Browser, inspect:

- Sidebar at desktop, tablet, and 390px: Usage absent; Knowledge flow stable; no overflow.
- Settings General: two direct toggles and no explanatory wall of text.
- Data: open folder, export, and raw-copy action.
- Agent access: status, test, format selection, and copy without a code wall.
- Advanced: compact identity values.
- Danger zone: scoped and delete-all confirmations.
- Sources: visually unchanged after neutral summary-class renaming.

Use temporary `DevCite` wrappers around `SidebarKnowledgeFlow`, `SettingsCategoryNav`, and `.settings-pane`; remove them and rerun `npm run verify:no-citations`.

- [ ] **Step 4: Commit documentation and final verification adjustments**

```bash
git add design.md scripts/masthead-surface-contract.js
git commit -m "docs: align settings and sidebar contracts"
```

- [ ] **Step 5: Hand the build to Tyler for experiential QA**

Provide the active app URL or Electron launch path and a short manual route: Sidebar → General → Data → Agent access → Advanced → Danger zone → Sources. Do not call the interface finished until Tyler has exercised it and approved the experience.
