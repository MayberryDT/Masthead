# Sources Setup Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Sources around the developer action `Set up sources`, with live capture, optional historical import, transcript approval, enrichment choice, and visible per-harness proof.

**Architecture:** Keep the existing Sources surface and daemon endpoints. Reframe the empty state, connected dashboard, and onboarding modal around source setup instead of adapter diagnostics. Use existing `SourcesSetupDto`, source status counts, import job status, and policy flags before adding new data fields.

**Tech Stack:** React 19, TypeScript, Vitest, happy-dom, Masthead daemon DTOs, existing CSS in `src/styles/sources.css`.

---

## Context

- Product decision source: GBrain slug `decisions/masthead-surface-redesign-direction`.
- Visual artifact: `mockups/masthead-surface-problem-map.html`.
- Sources should say `Set up sources`, not `Import session history`, because historical import is optional.
- Onboarding stays a modal, but it should be minimal and direct for developers.
- Advanced diagnostics remains available, but not as a peer action in the empty first-run state.
- Optimization pass: keep every setup path explicit. Live capture can be enabled without historical import, historical import can be enabled without hiding transcript approval, and diagnostics must be tested from a connected state because the empty state intentionally has one primary action.

## File Structure

- Modify: `src/ui/sources/SourcesEmptyState.tsx`
  - Owns no-data copy and the first-run CTA.
- Modify: `src/ui/sources/SourcesConnectedDashboard.tsx`
  - Owns visible source proof, connected source rows, and top actions.
- Modify: `src/ui/sources/SourcesOnboardingModal.tsx`
  - Owns modal steps for scan, source choice, live/history/transcript/enrichment choices, and review.
- Modify: `src/ui/SourcesPanel.tsx`
  - Owns wiring between empty, connected, onboarding, and diagnostics states.
- Modify: `src/styles/sources.css`
  - Owns visual hierarchy, action grouping, connected proof rows, and modal step layout.
- Modify: `src/ui/__tests__/sourcesPanel.test.tsx`
  - Covers static Sources rendering.
- Modify: `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`
  - Covers interactive onboarding and diagnostics behavior.
- Modify if existing counts are insufficient: `src/daemon/sources/sourceSetupService.ts`
  - Only derive visible proof fields from current status data; avoid schema changes in this pass.
- Modify if DTO additions are needed: `src/shared/sourcesSetup.ts`
  - Add optional fields only when backed by data from `sourceSetupService.ts`.

### Task 1: Rename The First-Run Job To Source Setup

**Files:**
- Modify: `src/ui/sources/SourcesEmptyState.tsx`
- Modify: `src/ui/__tests__/sourcesPanel.test.tsx`

- [ ] **Step 1: Update the empty-state test first**

In `src/ui/__tests__/sourcesPanel.test.tsx`, change the empty setup assertion to make the new CTA and hidden diagnostics explicit:

```tsx
expect(html).toContain("No sources set up");
expect(html).toContain("Set up sources");
expect(html).toContain("Capture new sessions now, or optionally import past sessions from local harness history.");
expect(html).not.toContain("Advanced diagnostics");
expect(html).not.toContain("Connect sources");
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- --run src/ui/__tests__/sourcesPanel.test.tsx
```

Expected: FAIL because the current empty state still renders `No sources connected`, `Connect sources`, and an `Advanced diagnostics` button.

- [ ] **Step 3: Replace the empty-state component with source setup copy**

In `src/ui/sources/SourcesEmptyState.tsx`, replace the component with:

```tsx
import { AppButton } from "../primitives/AppButton";

type Props = {
  busy?: boolean;
  status?: string;
  onConnectSources: () => void;
};

export function SourcesEmptyState({ busy = false, onConnectSources, status }: Props) {
  return (
    <section className="empty-session-state sources-empty-state" aria-label="No sources set up">
      <p className="mono-label">Sources</p>
      <h2>No sources set up</h2>
      <p>
        Capture new sessions now, or optionally import past sessions from local harness history.
      </p>
      <div className="surface-actions">
        <AppButton type="button" variant="primary" onClick={onConnectSources} disabled={busy}>
          Set up sources
        </AppButton>
      </div>
      <p className="surface-status">Local only / Live capture can start without historical import / Transcript import requires approval</p>
      {status ? <p className="sources-status surface-status">{status}</p> : null}
    </section>
  );
}
```

- [ ] **Step 4: Update `SourcesPanel` to stop passing `onShowAdvanced` into the empty state**

In `src/ui/SourcesPanel.tsx`, change:

```tsx
<SourcesEmptyState busy={busy} onConnectSources={() => setOnboardingOpen(true)} onShowAdvanced={() => setAdvancedOpen(true)} status={status} />
```

to:

```tsx
<SourcesEmptyState busy={busy} onConnectSources={() => setOnboardingOpen(true)} status={status} />
```

- [ ] **Step 5: Run the focused test again**

Run:

```bash
npm test -- --run src/ui/__tests__/sourcesPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/sources/SourcesEmptyState.tsx src/ui/SourcesPanel.tsx src/ui/__tests__/sourcesPanel.test.tsx
git commit -m "feat: reframe sources empty state"
```

### Task 2: Make Connected Sources Show Proof Instead Of Adapter Cards

**Files:**
- Modify: `src/ui/sources/SourcesConnectedDashboard.tsx`
- Modify: `src/ui/__tests__/sourcesPanel.test.tsx`
- Modify: `src/styles/sources.css`

- [ ] **Step 1: Add connected-proof assertions**

In `src/ui/__tests__/sourcesPanel.test.tsx`, update the connected setup test to assert proof labels:

```tsx
expect(html).toContain("Source health");
expect(html).toContain("Set up more sources");
expect(html).toContain("Live capture");
expect(html).toContain("History");
expect(html).toContain("Transcripts");
expect(html).toContain("Enrichment");
expect(html).toContain("Last activity");
expect(html).toContain("Needs transcript import");
expect(html).toContain("Needs enrichment");
```

In the `connectedSetup()` fixture in the same test file, set:

```tsx
transcriptImportEnabled: false,
enrichmentEnabled: false,
needsAttention: ["transcript_import", "enrichment"],
```

on the `connectedSources[0]` row so the proof labels are deterministic.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- --run src/ui/__tests__/sourcesPanel.test.tsx
```

Expected: FAIL because the current dashboard says `Connected sources`, `Add source`, and does not render proof labels.

- [ ] **Step 3: Add proof helpers in `SourcesConnectedDashboard.tsx`**

Add these helpers below `sourceRowFromSetup`:

```tsx
type ProofRow = {
  label: string;
  value: string;
  tone: "good" | "warn" | "neutral";
};

function proofRows(source: SourceRow): ProofRow[] {
  return [
    { label: "Live capture", value: source.lastSyncAt ? "Observed" : "No recent activity", tone: source.lastSyncAt ? "good" : "warn" },
    { label: "History", value: `${source.sessions} sessions`, tone: source.sessions > 0 ? "good" : "neutral" },
    { label: "Transcripts", value: source.transcriptImportEnabled ? "Enabled" : "Needs transcript import", tone: source.transcriptImportEnabled ? "good" : "warn" },
    { label: "Enrichment", value: source.enrichmentEnabled ? "Enabled" : "Needs enrichment", tone: source.enrichmentEnabled ? "good" : "warn" },
    { label: "Last activity", value: source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString() : "Not observed", tone: source.lastSyncAt ? "good" : "neutral" }
  ];
}
```

Update `SourceRow` to include:

```tsx
enrichmentEnabled: boolean;
transcriptImportEnabled: boolean;
```

Set those fields in both `sourceRowFromAdapter` and `sourceRowFromSetup`:

```tsx
enrichmentEnabled: adapter.policies.enrichment,
transcriptImportEnabled: adapter.policies.transcriptImport,
```

and:

```tsx
enrichmentEnabled: Boolean(source.enrichmentEnabled),
transcriptImportEnabled: Boolean(source.transcriptImportEnabled),
```

- [ ] **Step 4: Replace row rendering with proof cells**

In the card body, replace the existing `adapter-stat-grid` block and last-sync paragraph with:

```tsx
<dl className="source-proof-list" aria-label={`${source.label} source proof`}>
  {proofRows(source).map((row) => (
    <div className={`source-proof source-proof-${row.tone}`} key={row.label}>
      <dt>{row.label}</dt>
      <dd>{row.value}</dd>
    </div>
  ))}
</dl>
```

Change the dashboard heading and buttons:

```tsx
<h2>Source health</h2>
```

```tsx
Set up more sources
```

Keep `Advanced diagnostics` as a quiet button in the connected state.

- [ ] **Step 5: Add CSS for proof rows**

Append to `src/styles/sources.css`:

```css
.source-proof-list {
  display: grid;
  gap: 7px;
  margin: 0;
}

.source-proof {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  border-top: 1px solid rgba(194, 221, 241, 0.1);
  padding-top: 7px;
}

.source-proof dt {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.source-proof dd {
  margin: 0;
  color: var(--body);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.source-proof-good dd {
  color: var(--green);
}

.source-proof-warn dd {
  color: var(--yellow);
}
```

- [ ] **Step 6: Run the focused test**

Run:

```bash
npm test -- --run src/ui/__tests__/sourcesPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/sources/SourcesConnectedDashboard.tsx src/styles/sources.css src/ui/__tests__/sourcesPanel.test.tsx
git commit -m "feat: show source health proof"
```

### Task 3: Make The Modal A Minimal Source Setup Flow

**Files:**
- Modify: `src/ui/sources/SourcesOnboardingModal.tsx`
- Modify: `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`
- Modify: `src/styles/sources.css`

- [ ] **Step 1: Update modal interaction tests**

In `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`, update button and heading expectations:

```tsx
buttonByText(container, "Set up sources").click();
expect(container.textContent).toContain("Set up sources");
expect(container.textContent).toContain("Check local sources");
expect(container.textContent).toContain("Live capture can start without importing old sessions.");
```

Update the connected dashboard opener:

```tsx
buttonByText(container, "Set up more sources").click();
buttonByText(container, "Check local sources").click();
```

Update the final action assertion:

```tsx
buttonByText(container, "Start source setup").click();
```

- [ ] **Step 2: Run the modal tests and verify failure**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: FAIL because the modal still uses `Connect local sources`, `Scan this computer`, and `Build session library`.

- [ ] **Step 3: Rename modal copy and final action**

In `SourcesOnboardingModal.tsx`, make these direct text replacements:

```tsx
aria-label="Set up sources"
```

```tsx
<h2>Set up sources</h2>
```

```tsx
Live capture can start without importing old sessions. Masthead checks known local history locations only when you ask it to.
```

```tsx
<AppButton type="button" variant="primary" onClick={handleScan} disabled={busy}>Check local sources</AppButton>
```

```tsx
<h3>Start source setup</h3>
<p>Masthead will connect selected sources for live capture, import approved history, and queue approved enrichment work.</p>
```

```tsx
<AppButton type="button" variant="primary" onClick={handleBuild} disabled={busy || running || selectedIds.length === 0}>Start source setup</AppButton>
```

- [ ] **Step 4: Add a concise history-choice step before transcript approval**

Change the step union:

```tsx
type Step = "intro" | "found" | "history" | "transcripts" | "enrichment" | "build" | "success";
```

Add local state:

```tsx
const [importHistory, setImportHistory] = useState(true);
```

Change the found-step Continue button:

```tsx
<AppButton type="button" variant="primary" onClick={() => setStep("history")} disabled={selectedIds.length === 0}>Continue</AppButton>
```

Add this block before the transcript step:

```tsx
{step === "history" ? (
  <div className="session-detail-body">
    <h3>History import</h3>
    <div className="source-choice-list">
      <label className="source-choice">
        <input type="radio" name="source-history-mode" checked={importHistory} onChange={() => setImportHistory(true)} />
        <span>
          <strong>Connect live capture and import past sessions</strong>
          <small>Recommended when local history is available and you want Logbook to be useful immediately.</small>
        </span>
      </label>
      <label className="source-choice">
        <input type="radio" name="source-history-mode" checked={!importHistory} onChange={() => setImportHistory(false)} />
        <span>
          <strong>Connect live capture only</strong>
          <small>Masthead starts saving new sessions from this point forward.</small>
        </span>
      </label>
    </div>
    <div className="surface-actions">
      <AppButton type="button" onClick={() => setStep("found")}>Back</AppButton>
      <AppButton type="button" variant="primary" onClick={() => setStep("transcripts")}>Continue</AppButton>
    </div>
  </div>
) : null}
```

Include `importMetadata: importHistory` in the `onRunSetup` payload:

```tsx
importMetadata: importHistory,
importTranscripts: importHistory,
queueEnrichment: enrichmentMode !== "skip",
```

Change `transcriptApprovals` so live-only setup does not accidentally approve historical transcript import:

```tsx
transcriptApprovals: selectedSources.map((source) => ({
  approved: importHistory && (source.transcriptApproval?.required ? true : Boolean(source.transcriptApproval?.approved)),
  runtime: source.runtime,
  sourceId: source.sourceId
}))
```

- [ ] **Step 5: Add CSS for the modal choices**

Append:

```css
.source-choice-list {
  display: grid;
  gap: 8px;
}

.source-choice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  border: 1px solid rgba(92, 153, 187, 0.16);
  border-radius: 5px;
  background: rgba(6, 25, 37, 0.58);
  padding: 11px;
}

.source-choice strong,
.source-choice small {
  display: block;
}

.source-choice small {
  margin-top: 3px;
  color: var(--mute);
  font-size: 12px;
  line-height: 1.35;
}
```

- [ ] **Step 6: Update setup-run assertion**

In the `build invokes setup run callback` test, expect:

```tsx
expect(onRunSetup).toHaveBeenCalledWith({
  enrichmentMode: "local",
  importMetadata: true,
  importTranscripts: true,
  queueEnrichment: true,
  sourceIds: ["codex-sessions"],
  transcriptApprovals: [{ approved: true, runtime: "codex", sourceId: "codex-sessions" }]
});
```

- [ ] **Step 7: Add the live-capture-only regression test**

Add this test to `SourcesPanelImports.test.tsx`:

```tsx
test("live-only setup does not approve historical transcript import", async () => {
  const onRunSetup = vi.fn(async () => ({ jobs: [], queued: 0, skipped: [] }));
  const container = document.createElement("div");
  const root = createRoot(container);

  await renderOpenScannedOnboarding(root, container, { onRunSetup });

  await act(async () => {
    buttonByText(container, "Continue").click();
  });
  await act(async () => {
    const liveOnly = [...container.querySelectorAll("input[name='source-history-mode']")][1] as HTMLInputElement;
    liveOnly.click();
  });
  await act(async () => {
    buttonByText(container, "Continue").click();
  });
  await act(async () => {
    buttonByText(container, "Continue").click();
  });
  await act(async () => {
    buttonByText(container, "Continue").click();
  });
  await act(async () => {
    buttonByText(container, "Start source setup").click();
  });

  expect(onRunSetup).toHaveBeenCalledWith({
    enrichmentMode: "local",
    importMetadata: false,
    importTranscripts: false,
    queueEnrichment: true,
    sourceIds: ["codex-sessions"],
    transcriptApprovals: [{ approved: false, runtime: "codex", sourceId: "codex-sessions" }]
  });
  await act(async () => root.unmount());
});
```

- [ ] **Step 8: Run the modal tests**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/sources/SourcesOnboardingModal.tsx src/styles/sources.css src/ui/sources/__tests__/SourcesPanelImports.test.tsx
git commit -m "feat: simplify sources setup modal"
```

### Task 4: Keep Advanced Diagnostics Available But Deliberate

**Files:**
- Modify: `src/ui/sources/SourcesAdvancedDiagnostics.tsx`
- Modify: `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`
- Modify: `src/styles/sources.css`

- [ ] **Step 1: Strengthen the diagnostics test**

In `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`, change the diagnostics test to render a connected setup state instead of an empty setup state, because the empty state intentionally has no Advanced diagnostics button:

```tsx
root.render(
  <SourcesPanel adapters={[]} busy={false} imports={[]} onExcludePath={noop} onRefresh={noop} setup={connectedSetup()} sources={[]} />
);
```

Then add assertions:

```tsx
expect(container.textContent).toContain("Advanced diagnostics");
expect(container.textContent).toContain("Adapter inventory");
expect(container.textContent).toContain("Import jobs");
expect(container.textContent).toContain("Close diagnostics");
```

- [ ] **Step 2: Run the diagnostics test and verify failure if copy differs**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: FAIL if the close button or labels do not match the deliberate advanced wording.

- [ ] **Step 3: Update advanced diagnostics copy**

In `src/ui/sources/SourcesAdvancedDiagnostics.tsx`, use a heading that clearly marks this as advanced:

```tsx
<p className="mono-label">Advanced diagnostics</p>
<h2>Adapter inventory and import jobs</h2>
```

Set the close button text to:

```tsx
Close diagnostics
```

- [ ] **Step 4: Run the diagnostics test**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/sources/SourcesAdvancedDiagnostics.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx
git commit -m "feat: demote sources diagnostics"
```

### Task 5: Final Sources Verification

**Files:**
- Verify: `src/ui/SourcesPanel.tsx`
- Verify: `src/ui/sources/*.tsx`
- Verify: `src/styles/sources.css`

- [ ] **Step 1: Run all Sources tests**

Run:

```bash
npm test -- --run src/ui/__tests__/sourcesPanel.test.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx src/daemon/sources/__tests__/sourceSetupService.test.ts
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

Run the app with:

```bash
npm run dev
```

Open the rendered app with the Codex in-app Browser. Verify Sources at desktop, tablet, and narrow mobile widths:

- Empty state shows only `Set up sources` as the primary action.
- Modal opens, scans, selects Codex, chooses history mode, reviews transcript approval, chooses enrichment, and starts setup.
- Live-capture-only mode sends `importMetadata: false`, `importTranscripts: false`, and does not approve transcript import.
- Connected Codex source shows source proof, counts, missing transcript/enrichment labels, and advanced diagnostics as a quiet action.
- Advanced diagnostics is reachable from connected Sources and not reachable from the empty first-run state.
- No text overlaps at 390px width.

- [ ] **Step 4: Commit verification fixes**

If verification requires CSS or copy fixes, commit them:

```bash
git add src/ui/SourcesPanel.tsx src/ui/sources src/styles/sources.css src/ui/__tests__/sourcesPanel.test.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx
git commit -m "fix: verify sources setup flow"
```
