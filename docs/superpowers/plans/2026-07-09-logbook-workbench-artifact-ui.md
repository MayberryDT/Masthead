# Logbook + Workbench Artifact-UI Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Logbook read as a published **artifact book** (capsule log + body inspector) and Workbench read as a **session pipeline that produces multi-kind artifacts**, matching the locked grilling decisions (2026-07-09).

**Architecture:** Backend artifact-first read path already exists (`/logbook/artifacts`, capsule mapping in `daemonClient`). This pass is **UI/controller/copy alignment only**: strip session-library chrome from Logbook, master–detail body+provenance inspector, remove bulk enrich/checkboxes/summary strip, kind/project/date filters, and Workbench package/resolution vocabulary + handoff framing. No new clustering UI, no dual Logbook mode, no Now changes.

**Tech Stack:** React + TypeScript, existing Vitest + happy-dom UI tests, `mastheadctl`/daemon already artifact-capable.

**Branch / worktree:** Prefer existing `feature/artifact-first-logbook` at `.worktrees/artifact-first-logbook` (already has artifact APIs). If starting fresh, create a worktree from that branch.

**Source of truth (locked decisions):**

| Area | Decision |
|------|----------|
| Logbook row | Published artifact only |
| Columns | Kind · Title/highlight · Project · Confidence · Provenance · Published |
| Layout | Left capsule log · Right body on select |
| Right pane | Body + always-visible provenance (join rationale when multi) |
| Filters | Kind + project + date + search (no runtime/model primary) |
| Summary strip | Remove |
| Bulk enrich | Remove from Logbook |
| Checkboxes | None; row click selects for inspector |
| Workbench finish | Package publish + automatic kinds resolved |
| Workbench columns | Package · Runbook · ADR · Timeline · Resolution |
| Handoff | Explicit artifacts + automatic set sentence |
| Scope | Logbook full surface + Workbench copy/columns only |

**Out of scope:** Now, dual session/artifact Logbook, human multi-select clustering, re-adding summary metrics, bulk enrich elsewhere, full visual redesign of primitives, supersede browser UI, markdown export polish.

---

## File map

| Responsibility | Files |
|----------------|--------|
| Capsule columns | `src/ui/logbook/logbookColumns.ts` |
| Capsule row (no checkbox) | `src/ui/logbook/LogbookRow.tsx` |
| Table shell | `src/ui/logbook/LogbookTable.tsx` |
| Toolbar filters/copy | `src/ui/logbook/LogbookToolbar.tsx` |
| Inspector body+provenance | `src/ui/logbook/LogbookInspector.tsx` (rewrite) |
| Surface composition | `src/ui/HistoryPanel.tsx` |
| Filter types | `src/ui/HistoryPanel.tsx` (`LogbookFilterState`) |
| Controller (drop bulk, kind filter, detail load) | `src/app/logbook/useLogbookController.ts` |
| Client artifact detail fields | `src/app/daemonClient.ts` (ensure body/provenance surface for inspector) |
| Workbench copy/columns | `src/ui/workbench/WorkbenchPanel.tsx` |
| Handoff text | `src/ui/workbench/workbenchHandoff.ts` |
| Empty states / search chrome | `src/ui/HistoryPanel.tsx` |
| Styles | `src/styles/logbook.css`, workbench CSS if needed |
| Tests | `src/ui/logbook/__tests__/*`, `src/ui/__tests__/historyPanel.test.tsx`, `src/app/logbook/__tests__/useLogbookController.test.tsx`, `src/ui/workbench/__tests__/*`, `src/app/workbench/__tests__/useWorkbenchController.test.tsx` |

**Artifact detail contract (already roughly present):**  
`getLogbookArtifact` / `getLogbookSession` maps to `LogbookSessionDetail` with `outcome` = body text, `files` = provenance session ids, `tools` = evidence refs. Inspector rewrite should prefer a dedicated shape if easy; otherwise consume mapped detail with clear field mapping documented in Task 4.

---

### Task 1: Logbook columns + row without checkbox

**Files:**
- Modify: `src/ui/logbook/logbookColumns.ts`
- Modify: `src/ui/logbook/LogbookRow.tsx`
- Modify: `src/ui/logbook/LogbookTable.tsx` (if it wires select column specially)
- Test: `src/ui/logbook/__tests__/LogbookTable.test.tsx`

- [ ] **Step 1: Confirm columns match locked set**

`logbookColumns.ts` should be exactly:

```ts
export const logbookColumns = [
  { key: "kind", label: "KIND", className: "logbook-col-kind" },
  { key: "title", label: "TITLE / HIGHLIGHT", className: "logbook-col-session" },
  { key: "project", label: "PROJECT", className: "logbook-col-project" },
  { key: "confidence", label: "CONF", className: "logbook-col-confidence" },
  { key: "provenance", label: "PROVENANCE", className: "logbook-col-provenance" },
  { key: "published", label: "PUBLISHED", className: "logbook-col-date" }
] as const;
```

Remove any `select` column.

- [ ] **Step 2: Update failing table test for no checkbox**

In `LogbookTable.test.tsx`, assert:

```ts
expect(html).not.toContain('type="checkbox"');
expect(html).toContain("KIND");
expect(html).toContain("TITLE / HIGHLIGHT");
expect(html).toContain("PROVENANCE");
expect(html).toContain("PUBLISHED");
```

Remove tests that click bulk checkboxes; keep row click / keyboard open tests.

- [ ] **Step 3: Implement LogbookRow without select cell**

- Drop `bulkSelected`, `onToggleBulkSelect`, checkbox `<td>`.
- Keep: kind token, title + highlight (`HighlightedSnippet`), project, confidence (`models[0]` mapping until native field), provenance (`hostId` or `${toolCount} sessions` mapping), published date.
- `aria-label`: `Open artifact: ${title}` (already).
- Field mapping (until richer DTO on row):

| Column | Source on `LogbookSession` mapping today |
|--------|------------------------------------------|
| kind | `runtime` or `lifecycle` (artifact kind) |
| title | `title` |
| highlight | `snippet` / `objective` |
| project | `project` |
| confidence | `models[0]` |
| provenance | `hostId` (provenance label) |
| published | `lastActivityAt` (publishedAt mapped) |

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/ui/logbook/__tests__/LogbookTable.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/logbook/logbookColumns.ts src/ui/logbook/LogbookRow.tsx src/ui/logbook/LogbookTable.tsx src/ui/logbook/__tests__/LogbookTable.test.tsx
git commit -m "feat(logbook): capsule columns without selection checkboxes"
```

---

### Task 2: Remove Logbook summary strip

**Files:**
- Modify: `src/ui/HistoryPanel.tsx`
- Test: `src/ui/__tests__/historyPanel.test.tsx`

- [ ] **Step 1: Write failing expectations**

Update history panel tests that expect summary strip:

```ts
expect(html).not.toContain("logbook-summary-strip");
expect(html).not.toContain(">Sessions</dt>");
expect(html).not.toContain(">Messages</dt>");
expect(html).not.toContain(">Tool calls</dt>");
```

- [ ] **Step 2: Remove strip from HistoryPanel render**

- Delete or stop rendering `<LogbookSummaryStrip … />`.
- Remove `summaryItemsFor` usage from the main Logbook ready path (can leave dead helpers only if still used by skeleton; prefer delete unused).
- Stop requiring `summary` for the happy path UI (controller may still fetch later—remove fetch in Task 5).

- [ ] **Step 3: Fix skeleton loading chrome**

First-run skeleton must not depend on Sessions/Messages strip. Skeleton table uses `logbookColumns` only.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/ui/__tests__/historyPanel.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(logbook): remove session-era summary strip"
```

---

### Task 3: Toolbar — kind + project + date + search; drop bulk + runtime/model

**Files:**
- Modify: `src/ui/logbook/LogbookToolbar.tsx`
- Modify: `src/ui/HistoryPanel.tsx` (`LogbookFilterState`, facets)
- Test: toolbar tests if any; `historyPanel.test.tsx`; `LogbookToolbar` via history panel

- [ ] **Step 1: Extend filter state with kind**

In `HistoryPanel.tsx` types:

```ts
export type LogbookFilterState = {
  kind?: string | string[]; // session_dossier | runbook | adr | incident_timeline
  project?: string | string[];
  dateFrom?: string;
  dateTo?: string;
  // remove from primary UI: runtime?, model? — may leave in type briefly if facets still reference; prefer delete
};
```

- [ ] **Step 2: Rewrite toolbar filters**

Keep:
- Search (`CollapsibleSearch`) — placeholder e.g. `Search published artifacts…`
- Date filter
- Project filter
- **New** Kind filter (single or multi): options:

```ts
const kindOptions = [
  { value: "session_dossier", label: "Session dossier" },
  { value: "runbook", label: "Runbook" },
  { value: "adr", label: "ADR" },
  { value: "incident_timeline", label: "Incident timeline" }
];
```

Remove from toolbar:
- Runtime filter
- Model filter
- All bulk enrich UI (`Enrich summaries`, `Enrich full`, select page/filtered, bulk status)

Sort options: keep `recent`, `oldest`, `project`; remove `duration_desc`, `tools_desc`, `errors_desc` (session-era).

- [ ] **Step 3: Facet strip**

`activeFilterFacets` must surface Kind / Project / Date / Query only.

- [ ] **Step 4: Wire filters into search**

`useLogbookController` / `logbookPageSearchFilters` must pass `kind` into `searchLogbook` (maps to `state` or better: extend `LogbookSearchFilters` with `kind` and `fetchArtifactLogbookPage` already uses `filters.state` for kind — **prefer explicit `kind` field** on `LogbookSearchFilters` and map it in `fetchArtifactLogbookPage`).

In `daemonClient.ts`:

```ts
export type LogbookSearchFilters = {
  q?: string;
  kind?: string; // artifact kind
  project?: string | string[];
  // ...
};

// fetchArtifactLogbookPage:
kind: typeof filters.kind === "string" && isArtifactKindFilter(filters.kind) ? filters.kind : undefined,
```

Do not use `filters.state` as kind once `kind` exists.

- [ ] **Step 5: Tests**

```bash
npx vitest run src/ui/__tests__/historyPanel.test.tsx src/app/__tests__/daemonClient.test.ts
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(logbook): kind/project/date filters; drop bulk and runtime/model"
```

---

### Task 4: Inspector = artifact body + provenance

**Files:**
- Modify: `src/ui/logbook/LogbookInspector.tsx` (primary rewrite)
- Modify: `src/app/daemonClient.ts` if needed for structured body
- Modify: `src/app/logbook/useLogbookController.ts` detail load (drop transcript-first, use artifact detail)
- Test: `src/ui/logbook/__tests__/LogbookInspector.test.tsx`

- [ ] **Step 1: Define inspector props**

Prefer:

```ts
type Props = {
  loading?: boolean;
  artifact?: {
    kind: string;
    title: string;
    confidence?: string;
    project?: string;
    publishedAt?: string;
    provenanceSessionIds: string[];
    provenanceLabel?: string;
    joinRationale?: string;
    body: unknown; // parsed JSON object preferred
    evidenceRefs?: string[];
  };
  onClose: () => void;
};
```

If keeping `LogbookSessionDetail` temporarily, document mapping:

| Inspector | Detail field |
|-----------|--------------|
| kind | `runtime` / lifecycle |
| title | `title` |
| body | parse `outcome` if JSON string else show text |
| provenance ids | `files` (currently mapped) or fetch `getLogbookArtifact` |
| join rationale | need real field: **extend getLogbookSession artifact path to pass joinRationale** |

- [ ] **Step 2: Ensure client returns structured artifact for open**

In `getLogbookSession` artifact branch (or replace call sites with `getLogbookArtifact`):

Return/join:
- `joinRationale`
- `body` as object (not only stringified outcome)
- `provenanceSessionIds`
- `kind`, `confidence`, `publishedAt`

Simplest path: controller calls `getLogbookArtifact(id)` and passes result into inspector; stop using session dossier + transcript as primary Logbook detail.

- [ ] **Step 3: Render body by kind**

Structure:

```
<header> KIND · title · close
<body>
  kind-specific sections from body JSON
  (fallback: pretty-printed JSON if unknown shape)
</body>
<section provenance always visible>
  N sessions · list session ids
  join rationale if multi
</section>
```

Kind renderers (minimal V1):

| Kind | Sections |
|------|----------|
| `session_dossier` | problem, context, approach, outcome, verification, risks |
| `runbook` | problemSignature, reproSteps, fixSteps, deadEnds, validationChecks |
| `adr` | status, context, decision, alternatives, consequences |
| `incident_timeline` | symptom, impact, timeline[], remediation |

Missing fields: omit section (don’t invent).

- [ ] **Step 4: Aria labels**

- `aria-label="Artifact detail"` (not Session detail)
- Close: `Close artifact detail`

- [ ] **Step 5: Tests**

```tsx
test("renders runbook body and provenance", () => {
  const html = renderToStaticMarkup(
    <LogbookInspector
      onClose={() => {}}
      artifact={{
        kind: "runbook",
        title: "Fix cache lock",
        body: {
          problemSignature: { symptoms: ["EBUSY"], errorStrings: [], affectedScope: "cache" },
          reproSteps: ["run tests twice"],
          fixSteps: ["serialize lock"],
          deadEnds: [],
          validationChecks: ["npm test"]
        },
        provenanceSessionIds: ["session:a", "session:b"],
        joinRationale: "shared EBUSY signature"
      }}
    />
  );
  expect(html).toContain("Fix cache lock");
  expect(html).toContain("serialize lock");
  expect(html).toContain("session:a");
  expect(html).toContain("shared EBUSY signature");
  expect(html).toContain("Artifact detail");
});
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(logbook): artifact body inspector with always-visible provenance"
```

---

### Task 5: Controller cleanup — no bulk, artifact detail, empty copy

**Files:**
- Modify: `src/app/logbook/useLogbookController.ts`
- Modify: `src/ui/HistoryPanel.tsx` (props surface)
- Modify: App wiring that passes bulk props into HistoryPanel
- Test: `src/app/logbook/__tests__/useLogbookController.test.tsx`

- [ ] **Step 1: Delete bulk enrichment state/API from controller**

Remove:
- `selectedSessionIds`, bulk target/confirm/status/busy
- `rebuildEnrichments` bulk flows
- `onBulkEnrich*` return values

Keep:
- `selectedSessionId` / open artifact for inspector
- search, filters (incl. kind), sort, page

- [ ] **Step 2: Detail load**

```ts
void getLogbookArtifact(selectedId, url, { signal })
  .then(setSelectedArtifact)
```

Do not load dossier/transcript as primary Logbook inspector content (dossier UI elsewhere if needed).

- [ ] **Step 3: Stop summary fetch if unused**

Remove `getLogbookSummary` from Logbook metadata effect if strip is gone (keep `listProjects` for project filter).

- [ ] **Step 4: Empty / error copy**

In `HistoryPanel` empty states:

- "No published artifacts yet." / "Compile and publish from Workbench."
- "No artifacts match these filters."
- Search label: artifacts, not "session history" where user-visible

- [ ] **Step 5: Delete or rewrite bulk controller tests**

Replace with:

```ts
test("selecting a row id loads artifact detail via getLogbookArtifact", async () => {
  // mock search + getLogbookArtifact
});
```

- [ ] **Step 6: Run**

```bash
npx vitest run src/app/logbook/__tests__/useLogbookController.test.tsx src/ui/__tests__/historyPanel.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor(logbook): drop bulk enrich; open artifact detail only"
```

---

### Task 6: Workbench columns + tooltips (package / kinds / resolution)

**Files:**
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/shared/workbench.ts` if DTO fields missing (runbook/adr/timeline/resolution already partially present)
- Test: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx` if present; else controller tests

- [ ] **Step 1: Table headers**

Replace session-publish-era columns with:

| Header | Field |
|--------|--------|
| enrichment | `sessionEnrichmentStatus` |
| dossier | `sessionDossierStatus` |
| package | `sessionPackageStatus` (or derive: enrichment+dossier+published) |
| runbook | `runbookStatus` |
| adr | `adrStatus` |
| timeline | `incidentTimelineStatus` |
| resolution | `resolutionStatus` |

Remove leftover "bug fix" labeling.

- [ ] **Step 2: Tooltips**

```ts
copyAgentPrompt:
  "Copy a plain-language prompt for your coding agent to compile and publish artifacts from the selected sessions (session package always; runbook, ADR, and incident timeline when evidence supports them).",
publish:
  "Publish the session package (dossier capsule) for selected sessions when package gates are satisfied. Automatic kinds still need apply/publish or N/A for full resolution.",
failQuality:
  "Fail quality and remove sessions from the publish path (Not Added).",
// update notAdded similarly: excluded from package path, not "from Logbook sessions"
```

Button label may stay `Publish` or become `Publish package` — prefer **`Publish package`**.

- [ ] **Step 3: Stats / microcopy**

Any "Publish path" / "sessions in Logbook" user strings → package path / automatic resolution language.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(workbench): package and multi-kind resolution vocabulary"
```

---

### Task 7: Handoff outcome sentence

**Files:**
- Modify: `src/ui/workbench/workbenchHandoff.ts`
- Test: `src/ui/workbench/__tests__/workbenchHandoff.test.ts`
- Test: `src/app/workbench/__tests__/useWorkbenchController.test.tsx`

- [ ] **Step 1: Opening sentence (locked Q10-A)**

Ensure handoff starts with explicit automatic set framing (already largely present from artifact-first backend work). Align tooltip + first paragraph:

```ts
"Compile and publish artifacts from these sessions into Logbook: session package always; runbook, ADR, and incident timeline when evidence supports them (else N/A). Sessions stay the capture and pipeline unit; Logbook stores published artifacts only.",
```

Keep plain language; no CLI recipes in handoff body (existing rule).

- [ ] **Step 2: Tests**

```ts
expect(text).toContain("session package");
expect(text).toContain("runbook");
expect(text).toContain("incident timeline");
expect(text).not.toMatch(/mastheadctl/i);
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(workbench): handoff frames multi-kind artifact publish"
```

---

### Task 8: Integration polish + full verification

**Files:** CSS, empty states, any App.tsx prop cleanup

- [ ] **Step 1: CSS**

Ensure `.logbook-col-kind`, confidence, provenance widths; inspector body typography; no layout break without summary strip or checkbox column.

- [ ] **Step 2: Grep for stale user-facing strings**

```bash
rg -n "SESSION / MATCH|bulk enrich|Search all session history|Publish selected sessions to Logbook|bug fix" src/ui src/app --glob '!**/__tests__/**'
```

Fix remaining hits in product UI (tests may still mention history intentionally).

- [ ] **Step 3: Focused test run**

```bash
npx vitest run \
  src/ui/logbook \
  src/ui/__tests__/historyPanel.test.tsx \
  src/app/logbook \
  src/ui/workbench \
  src/app/workbench \
  src/app/__tests__/daemonClient.test.ts
```

- [ ] **Step 4: Full suite**

```bash
npm test
```

Note: main currently has ~7 pre-existing failures (collectorAutostart, sessionTransitionNotifications, dovetail). Do not "fix" those in this pass unless they block merge policy; report them separately.

- [ ] **Step 5: Manual smoke (Electron Dev or `npm run dev`)**

1. Logbook: no summary strip, no checkboxes, kind filter works, row open shows body + provenance.  
2. Workbench: columns show package/kinds/resolution; Copy Agent Prompt has artifact framing; Publish package tooltip correct.  
3. Narrow width: table + inspector still usable.

- [ ] **Step 6: Final commit if needed**

```bash
git commit -m "chore: logbook/workbench artifact-ui polish and verification"
```

---

## Self-review (plan vs locked grill)

| Locked decision | Task |
|-----------------|------|
| Artifact rows | 1, 5 |
| Columns A | 1 |
| Master–detail body | 4 |
| Provenance always on | 4 |
| Filters kind/project/date/search | 3 |
| No summary strip | 2 |
| No bulk enrich | 3, 5 |
| No checkboxes | 1, 5 |
| Workbench package/resolution | 6 |
| Handoff A | 7 |
| Scope Logbook+Workbench copy | all; out of scope listed |

**Gaps intentionally deferred:** rich per-kind body layout polish, superseded lineage UI, MCP copy, OpenWiki screenshots.

---

## Execution handoff

Plan complete and saved to:

`docs/superpowers/plans/2026-07-09-logbook-workbench-artifact-ui.md`

(in worktree `.worktrees/artifact-first-logbook`; copy to main checkout if needed)

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task + review  
2. **Inline Execution** — this session, task-by-task with checkpoints  

Which approach?
