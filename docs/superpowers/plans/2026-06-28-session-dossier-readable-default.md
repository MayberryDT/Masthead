# Session Dossier Readable Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Session Dossier default to key stats, useful enrichment, and searchable transcript, with raw technical detail hidden behind an Advanced details action.

**Architecture:** Keep `SessionDossier` as the single dossier renderer, but split the default content stack from advanced evidence. Use existing `SessionDossierDto` data first. Remove file-oriented UI from normal Dossier and Logbook controls without deleting database tables or repository queries.

**Tech Stack:** React 19, TypeScript, Vitest, happy-dom, Masthead session dossier DTOs, existing CSS in `src/styles/session-dossier.css` and `src/styles/logbook.css`.

---

## Context

- Product decision source: GBrain slug `decisions/masthead-surface-redesign-direction`.
- Token usage should move into the top Dossier card.
- Overview should become enriched transcript/data summary instead of raw overview filler.
- Timeline, verification, needs attention, tools, raw records, and source metadata belong in Advanced details.
- File-related UI should leave normal Dossier and Logbook surfaces for now.
- Optimization pass: make "remove files" testable. The normal Dossier must not render file panels, file metrics, file transcript rows, or Logbook file controls; advanced details may retain raw tool/timeline/provenance evidence, but not a resurrected Files panel.

## File Structure

- Modify: `src/ui/session-dossier/SessionDossier.tsx`
  - Owns default Dossier order and Advanced details toggle.
- Modify: `src/ui/session-dossier/DossierTranscript.tsx`
  - Owns transcript search and filter controls.
- Modify: `src/styles/session-dossier.css`
  - Owns default stack, advanced details panel, and transcript readability.
- Modify: `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`
  - Covers default and advanced Dossier behavior.
- Modify: `src/ui/logbook/LogbookToolbar.tsx`
  - Removes file filter and file sort from the normal Logbook toolbar.
- Modify: `src/ui/logbook/__tests__/LogbookToolbar.test.tsx`
  - Covers the Logbook toolbar after file UI removal.
- Optional modify: `src/shared/sessionDossier.ts`
  - Only add optional narrative fields if existing `narrative` cannot express the enrichment summary.

### Task 1: Lock The Default Dossier Contract With Tests

**Files:**
- Modify: `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`

- [ ] **Step 1: Replace the broad evidence test with default-view assertions**

In `renders canonical session evidence and copy actions`, replace expectations for default technical panels with:

```tsx
expect(html).toContain("Session dossier");
expect(html).toContain("Repair OAuth callback");
expect(html).toContain("Tokens");
expect(html).toContain("Input");
expect(html).toContain("Output");
expect(html).toContain("Enrichment");
expect(html).toContain("Fix the OAuth return path.");
expect(html).toContain("Transcript");
expect(html).toContain("Please repair the OAuth callback.");
expect(html).toContain("Advanced details");
expect(html).toContain("Copy context");
expect(html).toContain("Canonical ID");
expect(html).not.toContain("<h4>Files</h4>");
expect(html).not.toContain("<h4>Tools</h4>");
expect(html).not.toContain("<h4>Timeline</h4>");
expect(html).not.toContain("<h4>Verification</h4>");
expect(html).not.toContain("<h4>Needs attention</h4>");
expect(html).not.toContain("src/app/App.tsx");
expect(html).not.toContain("File ");
```

- [ ] **Step 2: Add an advanced details interaction test**

Add this test:

```tsx
test("opens advanced evidence on demand", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);

  await act(async () => {
    root.render(<SessionDossier dossier={dossier()} />);
  });

  expect(host.textContent).not.toContain("Narrative evidence");
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
  expect(button).toBeTruthy();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(host.textContent).toContain("Verification");
  expect(host.textContent).toContain("Tools");
  expect(host.textContent).toContain("Timeline");
  expect(host.textContent).toContain("Narrative evidence");
  root.unmount();
});
```

- [ ] **Step 3: Run the focused Dossier test and verify failure**

Run:

```bash
npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx
```

Expected: FAIL because technical panels render by default and no advanced toggle exists.

- [ ] **Step 4: Commit the failing test**

```bash
git add src/ui/session-dossier/__tests__/SessionDossier.test.tsx
git commit -m "test: define readable dossier default"
```

### Task 2: Rebuild The Default Dossier Stack

**Files:**
- Modify: `src/ui/session-dossier/SessionDossier.tsx`
- Modify: `src/styles/session-dossier.css`

- [ ] **Step 1: Add advanced state and remove unused default state**

In `SessionDossier.tsx`, replace:

```tsx
const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
const [showAllTimeline, setShowAllTimeline] = useState(false);
const [showAllFiles, setShowAllFiles] = useState(false);
const [showAllTools, setShowAllTools] = useState(false);
```

with:

```tsx
const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
const [showAllTimeline, setShowAllTimeline] = useState(false);
const [showAllTools, setShowAllTools] = useState(false);
const [advancedOpen, setAdvancedOpen] = useState(false);
```

Remove `visibleFiles`.

- [ ] **Step 2: Remove Files from the top metric grid**

Replace the hero metrics with:

```tsx
<DossierMetric label="Lifecycle" value={identity?.lifecycle ?? live?.lifecycle ?? "Unknown"} />
<DossierMetric label="Duration" value={formatDuration(identity?.durationMs) ?? live?.durationLabel ?? "-"} />
<DossierMetric label="Tokens" value={formatNumber(dossier?.usage.totalTokens ?? live?.totalTokens)} />
<DossierMetric label="Input" value={formatNumber(dossier?.usage.inputTokens)} />
<DossierMetric label="Output" value={formatNumber(dossier?.usage.outputTokens)} />
<DossierMetric label="Messages" value={formatNumber(dossier?.coverage.transcript.messages)} />
```

- [ ] **Step 3: Rename Overview to Enrichment and keep it concise**

Replace the `DossierPanel title="Overview"` block with:

```tsx
<DossierPanel title="Enrichment" className="dossier-panel-span">
  <div className="dossier-copy-stack">
    <DossierCopyBlock label="Summary" value={dossier?.narrative.liveSummary ?? live?.currentActivity} />
    <DossierCopyBlock label="Objective" value={dossier?.narrative.objective ?? live?.copy.reason} />
    <DossierCopyBlock label="Outcome" value={dossier?.narrative.outcome ?? live?.copy.status} />
    <DossierCopyBlock label="First prompt" value={dossier?.narrative.firstUserPrompt} />
    <DossierCopyBlock label="Latest prompt" value={dossier?.narrative.latestUserPrompt} />
    <DossierTags label="Topics" values={dossier?.narrative.topics} />
    <DossierTags label="Technologies" values={dossier?.narrative.technologies} />
    <DossierTags label="Unresolved" values={dossier?.narrative.unresolved} />
  </div>
</DossierPanel>
```

- [ ] **Step 4: Move technical panels into an advanced block**

After the Transcript panel, add:

```tsx
<div className="dossier-advanced-actions">
  <button type="button" className="dossier-link-button" onClick={() => setAdvancedOpen((current) => !current)}>
    {advancedOpen ? "Hide advanced details" : "Advanced details"}
  </button>
</div>

{advancedOpen ? (
  <section className="dossier-advanced-details" aria-label="Advanced session details">
    {/* move Verification, Needs attention, Tools, Transcript excerpts, Timeline, Token usage, Context packet, Review actions, and Provenance panels here */}
  </section>
) : null}
```

Move the existing technical panels into this section. Do not move the old Files panel.

When moving panels, keep these panels in Advanced details:

```tsx
Verification
Needs attention
Tools
Transcript excerpts
Timeline
Token usage
Context packet
Review actions
Provenance
```

Leave the old `DossierPanel title="Files"` block deleted.

- [ ] **Step 5: Add CSS for the new stack**

Append:

```css
.dossier-advanced-actions {
  display: flex;
  justify-content: flex-end;
}

.dossier-advanced-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  grid-column: 1 / -1;
}

@media (max-width: 760px) {
  .dossier-advanced-details {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 6: Run the focused Dossier test**

Run:

```bash
npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/session-dossier/SessionDossier.tsx src/styles/session-dossier.css src/ui/session-dossier/__tests__/SessionDossier.test.tsx
git commit -m "feat: simplify session dossier default"
```

### Task 3: Remove File Filters From Dossier Transcript And Logbook Toolbar

**Files:**
- Modify: `src/ui/session-dossier/DossierTranscript.tsx`
- Modify: `src/ui/logbook/LogbookToolbar.tsx`
- Modify: `src/ui/logbook/__tests__/LogbookToolbar.test.tsx`

- [ ] **Step 1: Add Logbook toolbar assertions**

In `src/ui/logbook/__tests__/LogbookToolbar.test.tsx`, add or update a render test with:

```tsx
expect(html).toContain("Search sessions");
expect(html).toContain("Recent");
expect(html).not.toContain("Files changed");
expect(html).not.toContain("Changed file path");
expect(html).not.toContain("Open file filter");
```

- [ ] **Step 2: Run Logbook toolbar test and verify failure**

Run:

```bash
npm test -- --run src/ui/logbook/__tests__/LogbookToolbar.test.tsx
```

Expected: FAIL because the toolbar still renders file sort/filter UI.

- [ ] **Step 3: Remove Files from transcript filters and normal transcript rows**

In `src/ui/session-dossier/DossierTranscript.tsx`, change the `filters` array to:

```tsx
const filters: Array<{ label: string; value: SessionTranscriptKindFilter }> = [
  { label: "All", value: "all" },
  { label: "User", value: "user" },
  { label: "Assistant", value: "assistant" },
  { label: "Tools", value: "tools" },
  { label: "Checkpoints", value: "checkpoints" },
  { label: "Signals", value: "signals" }
];
```

Then change rendered items from:

```tsx
const renderedItems = compressLowValueRuns(transcript?.items ?? []);
```

to:

```tsx
const visibleTranscriptItems = (transcript?.items ?? []).filter((item) => item.kind !== "file_effect");
const renderedItems = compressLowValueRuns(visibleTranscriptItems);
```

This removes file-related rows from the normal transcript view without changing the underlying transcript API.

- [ ] **Step 4: Add a transcript file-row regression assertion**

In `SessionDossier.test.tsx`, extend `dossier()` transcript data in the transcript render test or add a small test fixture that includes:

```tsx
{
  itemId: "file-effect-1",
  kind: "file_effect" as const,
  label: "src/app/App.tsx",
  lowValue: false,
  observedAt: "2026-06-25T23:04:00.000Z",
  role: "tool" as const,
  sessionId: "canonical-session-1",
  sourceRef: {},
  text: "src/app/App.tsx"
}
```

Assert:

```tsx
expect(html).not.toContain("src/app/App.tsx");
expect(html).not.toContain("File ");
```

- [ ] **Step 5: Remove Logbook file sort and file popover**

In `src/ui/logbook/LogbookToolbar.tsx`, remove this sort option:

```tsx
{ value: "files_desc", label: "Files changed" },
```

Remove:

```tsx
const activeFileFilterCount = filters.file ? 1 : 0;
const [fileOpen, setFileOpen] = useState(false);
const filePopoverId = useId();
const updateFile = (value: string) => onFilterChange?.({ ...filters, file: value || undefined });
```

Remove the entire `<div className="logbook-file-popover-filter"...>` block.

- [ ] **Step 6: Run Dossier and Logbook tests**

Run:

```bash
npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/ui/logbook/__tests__/LogbookToolbar.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/session-dossier/DossierTranscript.tsx src/ui/logbook/LogbookToolbar.tsx src/ui/logbook/__tests__/LogbookToolbar.test.tsx
git commit -m "feat: remove file controls from normal history UI"
```

### Task 4: Verify Transcript Search Behavior

**Files:**
- Modify: `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`
- Modify if needed: `src/ui/session-dossier/DossierTranscript.tsx`

- [ ] **Step 1: Add a controlled transcript search test**

Add this test:

```tsx
test("wires transcript search input to the caller", async () => {
  const onQueryChange = vi.fn();
  const host = document.createElement("div");
  const root = createRoot(host);

  await act(async () => {
    root.render(
      <SessionDossier
        dossier={dossier()}
        onTranscriptQueryChange={onQueryChange}
        transcript={{
          coverage: dossier().coverage.transcript,
          items: [],
          total: 0
        }}
        transcriptQuery=""
      />
    );
  });

  const input = host.querySelector("input[type='search']");
  expect(input).toBeTruthy();
  await act(async () => {
    input?.dispatchEvent(new InputEvent("input", { bubbles: true, data: "OAuth" }));
  });

  expect(onQueryChange).toHaveBeenCalled();
  root.unmount();
});
```

- [ ] **Step 2: Run the Dossier tests**

Run:

```bash
npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx
```

Expected: PASS if the existing controlled input wiring is healthy. If it fails because happy-dom does not set the input value through `InputEvent`, update the test to set `(input as HTMLInputElement).value = "OAuth"` before dispatching the event.

- [ ] **Step 3: Commit**

```bash
git add src/ui/session-dossier/__tests__/SessionDossier.test.tsx
git commit -m "test: verify dossier transcript search wiring"
```

### Task 5: Final Dossier Verification

**Files:**
- Verify: `src/ui/session-dossier/*`
- Verify: `src/ui/logbook/LogbookToolbar.tsx`
- Verify: `src/styles/session-dossier.css`
- Verify: `src/styles/logbook.css`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/ui/logbook/__tests__/LogbookToolbar.test.tsx src/ui/__tests__/sessionLibraryDetail.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run contracts and build**

Run:

```bash
npm run check:surface-contract
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Browser verification**

Run:

```bash
npm run dev
```

Open the app with the Codex in-app Browser. Verify:

- Dossier headline and top stats are visible without scrolling inside the modal.
- Token usage appears in the top card.
- Enrichment appears above Transcript.
- Transcript search input is visible and usable.
- Files, Timeline, Verification, Needs attention, Tools, Provenance, and raw evidence appear only after `Advanced details`.
- Logbook toolbar has no file filter or `Files changed` sort.
- Narrow mobile width around 390px has no overlapping text or clipped buttons.

- [ ] **Step 4: Commit verification fixes**

```bash
git add src/ui/session-dossier src/ui/logbook src/styles/session-dossier.css src/styles/logbook.css
git commit -m "fix: verify readable dossier layout"
```
