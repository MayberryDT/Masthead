# Settings Intent Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize Settings by user intent so everyday setup, data policy, storage, advanced runtime details, and dangerous actions no longer compete as equal technical cards.

**Architecture:** Keep existing settings data and action handlers in `OperationsPanel`. Recompose existing settings components into a calmer vertical hierarchy, splitting advanced runtime details away from common storage/export tasks and keeping destructive actions isolated.

**Tech Stack:** React 19, TypeScript, Vitest, happy-dom, existing settings DTOs and CSS in `src/styles/settings.css`.

---

## Context

- Product decision source: GBrain slug `decisions/masthead-surface-redesign-direction`.
- Settings grouping can be proposed by the implementation plan.
- Working hierarchy: everyday, advanced, and dangerous, grouped by user intent.
- Avoid a toolbar/header area that exists for one action.
- Optimization pass: remove or wire inert controls. Settings should not contain decorative buttons; if `Copy` remains for the hook endpoint, it must copy and report state.

## File Structure

- Modify: `src/ui/OperationsPanel.tsx`
  - Owns high-level settings order.
- Modify: `src/ui/settings/HookSettings.tsx`
  - Everyday capture setup and hook endpoint copy behavior.
- Modify: `src/ui/settings/EnrichmentSettings.tsx`
  - Everyday generated-summary state.
- Modify: `src/ui/settings/PrivacySettings.tsx`
  - Data boundary and privacy state.
- Modify: `src/ui/settings/StorageSettings.tsx`
  - Storage summary, open folder, export, and raw-copy deletion.
- Create: `src/ui/settings/AdvancedRuntimeSettings.tsx`
  - Database path, database ID, API/schema, and retention class details.
- Modify: `src/ui/settings/DangerZone.tsx`
  - Destructive actions remain last and visually isolated.
- Modify: `src/styles/settings.css`
  - Vertical layout, section sizing, details styling.
- Modify: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
  - Static settings surface contract.
- Modify: `src/ui/settings/__tests__/SettingsOperationalStates.test.tsx`
  - Read-only and failure states.
- Modify: `src/ui/__tests__/operationsPanel.test.tsx`
  - Existing OperationsPanel behavior.

### Task 1: Define The Intent-Based Settings Contract

**Files:**
- Modify: `src/ui/settings/__tests__/SettingsSurface.test.tsx`

- [ ] **Step 1: Update the surface test expectations**

In `renders real settings rows and shared controls instead of the old card grid`, replace section expectations with:

```tsx
expect(html).toContain("Everyday setup");
expect(html).toContain("Data boundaries");
expect(html).toContain("Storage and export");
expect(html).toContain("Advanced runtime");
expect(html).toContain("Danger zone");
expect(html.indexOf("Everyday setup")).toBeLessThan(html.indexOf("Data boundaries"));
expect(html.indexOf("Data boundaries")).toBeLessThan(html.indexOf("Storage and export"));
expect(html.indexOf("Storage and export")).toBeLessThan(html.indexOf("Advanced runtime"));
expect(html.indexOf("Advanced runtime")).toBeLessThan(html.indexOf("Danger zone"));
expect(html).not.toContain("settings-section-wide");
expect(html).not.toContain("ops-card");
expect(html).not.toContain("ghost-pill");
```

- [ ] **Step 2: Run settings surface test and verify failure**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx
```

Expected: FAIL because current section titles and grid sizing do not match the new hierarchy.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/ui/settings/__tests__/SettingsSurface.test.tsx
git commit -m "test: define settings intent hierarchy"
```

### Task 2: Split Advanced Runtime Details Out Of Storage

**Files:**
- Create: `src/ui/settings/AdvancedRuntimeSettings.tsx`
- Modify: `src/ui/settings/StorageSettings.tsx`
- Modify: `src/ui/settings/__tests__/SettingsSurface.test.tsx`

- [ ] **Step 1: Create the advanced runtime component**

Create `src/ui/settings/AdvancedRuntimeSettings.tsx`:

```tsx
import type { DataSummary, SettingsStateDto } from "../../app/daemonClient";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type AdvancedRuntimeSettingsProps = {
  dataSummary?: DataSummary;
  settings?: SettingsStateDto;
};

export function AdvancedRuntimeSettings({ dataSummary, settings }: AdvancedRuntimeSettingsProps) {
  const summary = dataSummary ?? settings?.storage.dataSummary;
  const storageClasses = summary ? Object.entries(summary.storageClasses) : [];
  return (
    <SettingsSection eyebrow="Advanced" title="Advanced runtime">
      <SettingsRow label="Database ID" value={settings?.data.databaseId ?? "Loading"} />
      <SettingsRow
        label="Runtime"
        value={
          settings
            ? `${settings.runtime.mode} / ${settings.runtime.writable ? "writable" : "read only"} / API ${settings.apiVersion} / schema ${settings.schemaVersion}`
            : "Loading"
        }
      />
      <SettingsRow
        description={storageClasses.length > 0 ? storageClasses.map(([name, item]) => `${name}: ${item.retention}`).join(", ") : undefined}
        label="Retention classes"
        value={storageClasses.length > 0 ? `${storageClasses.length} classes` : "Loading"}
      />
      <SettingsRow label="Raw event rows" value={summary ? formatCount(summary.rawEvents) : "Loading"} />
      <SettingsRow label="MCP audit rows" value={summary ? formatCount(summary.auditRows) : "Loading"} />
    </SettingsSection>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
```

- [ ] **Step 2: Simplify StorageSettings**

In `StorageSettings.tsx`, remove rows for Database ID, Runtime, and Retention classes. Change section title:

```tsx
<SettingsSection eyebrow="Storage" title="Storage and export">
```

Keep rows for Database, Data directory, Sessions, Raw source copies, and Export.

- [ ] **Step 3: Run surface test and verify it still fails because OperationsPanel is not wired**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx
```

Expected: FAIL because `AdvancedRuntimeSettings` is not rendered yet.

- [ ] **Step 4: Commit component split**

```bash
git add src/ui/settings/AdvancedRuntimeSettings.tsx src/ui/settings/StorageSettings.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx
git commit -m "feat: split settings runtime details"
```

### Task 3: Reorder OperationsPanel Around User Intent

**Files:**
- Modify: `src/ui/OperationsPanel.tsx`
- Modify: `src/ui/settings/HookSettings.tsx`
- Modify: `src/ui/settings/PrivacySettings.tsx`
- Modify: `src/ui/settings/EnrichmentSettings.tsx`

- [ ] **Step 1: Import advanced runtime settings**

In `OperationsPanel.tsx`, add:

```tsx
import { AdvancedRuntimeSettings } from "./settings/AdvancedRuntimeSettings";
```

- [ ] **Step 2: Reorder the settings sections**

Replace the section order inside `.settings-layout` with:

```tsx
<HookSettings
  busy={writesDisabled}
  hooks={effectiveSettings?.hooks}
  onInstall={() => void runHookAction("install")}
  onTest={() => void runHookAction("test")}
  onUninstall={() => void runHookAction("uninstall")}
/>
<EnrichmentSettings enrichment={effectiveSettings?.enrichment} />
<PrivacySettings privacy={effectiveSettings?.privacy} />
<StorageSettings
  busy={busy}
  dataSummary={effectiveSummary}
  onOpenDataDirectory={openDataDirectory}
  onExport={onExportLocalData}
  onRequestPrune={onRequestPruneLocalData}
  settings={effectiveSettings}
  writeDisabled={writesDisabled}
/>
<AdvancedRuntimeSettings dataSummary={effectiveSummary} settings={effectiveSettings} />
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
```

- [ ] **Step 3: Rename section headings**

In `HookSettings.tsx`, change:

```tsx
<SettingsSection eyebrow="Everyday" title="Everyday setup">
```

Add the React state import:

```tsx
import { useState } from "react";
```

Also wire the endpoint copy button so it is not decorative. Add state:

```tsx
const [copyState, setCopyState] = useState<"idle" | "copied" | "failed" | "unavailable">("idle");
```

Add a copy handler:

```tsx
async function copyEndpoint(): Promise<void> {
  if (!hooks?.endpoint || !navigator.clipboard?.writeText) {
    setCopyState("unavailable");
    return;
  }
  try {
    await navigator.clipboard.writeText(hooks.endpoint);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1400);
  } catch {
    setCopyState("failed");
  }
}
```

Change the hook endpoint row control:

```tsx
control={
  <AppButton disabled={!hooks?.endpoint} onClick={() => void copyEndpoint()} variant="quiet">
    Copy endpoint
  </AppButton>
}
```

Change the description:

```tsx
description={copyState === "copied" ? "Endpoint copied." : copyState === "failed" ? "Endpoint copy failed." : "Codex hooks post sanitized lifecycle events to this local endpoint."}
```

In `PrivacySettings.tsx`, change the title to:

```tsx
Data boundaries
```

In `EnrichmentSettings.tsx`, keep the title short:

```tsx
Enrichment
```

- [ ] **Step 4: Add endpoint-copy behavior test**

In `src/ui/settings/__tests__/SettingsOperationalStates.test.tsx`, add:

```tsx
test("copies the hook endpoint from everyday setup", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<OperationsPanel settingsState={settings} />);
  });

  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Copy endpoint");
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(writeText).toHaveBeenCalledWith(settings.hooks.endpoint);
  expect(container.textContent).toContain("Endpoint copied.");
});
```

- [ ] **Step 5: Run settings tests**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx
```

Expected: PASS or a narrow failure in old section title assertions.

- [ ] **Step 6: Update old title assertions if needed**

If a test still expects `Codex integration`, replace it with:

```tsx
expect(html).toContain("Everyday setup");
expect(html).toContain("Lifecycle hooks");
```

- [ ] **Step 7: Run settings tests again**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/OperationsPanel.tsx src/ui/settings/HookSettings.tsx src/ui/settings/PrivacySettings.tsx src/ui/settings/EnrichmentSettings.tsx src/ui/settings/__tests__
git commit -m "feat: reorder settings by intent"
```

### Task 4: Make Settings Vertical And Less Card-Heavy

**Files:**
- Modify: `src/styles/settings.css`
- Modify: `src/ui/settings/SettingsSection.tsx`

- [ ] **Step 1: Remove the 12-column card grid feel**

In `src/styles/settings.css`, replace `.settings-layout` with:

```css
.settings-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  min-width: 0;
}
```

Replace `.settings-section` grid-column rules with:

```css
.settings-section {
  position: relative;
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
  border-radius: 5px;
  background: #081d2b;
  box-shadow:
    0 0 0 1px rgba(92, 153, 187, 0.14),
    inset 0 1px 0 rgba(190, 225, 245, 0.035);
  padding: 14px;
}

.settings-section-wide,
.settings-section-danger {
  grid-column: auto;
}
```

- [ ] **Step 2: Keep danger visually isolated**

Ensure danger styling remains:

```css
.settings-section-danger {
  box-shadow:
    0 0 0 1px rgba(255, 97, 97, 0.22),
    inset 0 1px 0 rgba(255, 210, 210, 0.04);
}

.settings-section-danger::before {
  background: var(--red, #ff483e);
}
```

- [ ] **Step 3: Run settings tests**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx src/ui/__tests__/operationsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/styles/settings.css src/ui/settings/SettingsSection.tsx src/ui/settings/__tests__ src/ui/__tests__/operationsPanel.test.tsx
git commit -m "feat: simplify settings layout"
```

### Task 5: Final Settings Verification

**Files:**
- Verify: `src/ui/OperationsPanel.tsx`
- Verify: `src/ui/settings/*`
- Verify: `src/styles/settings.css`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx src/ui/__tests__/operationsPanel.test.tsx src/daemon/__tests__/settingsApi.test.ts
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

Open Settings with the Codex in-app Browser. Verify:

- Settings reads vertically in this order: Everyday setup, Enrichment, Data boundaries, Storage and export, Advanced runtime, Danger zone.
- No toolbar exists just for a single refresh or action.
- Hook endpoint `Copy endpoint` works or is disabled when no endpoint is available.
- Read-only state disables writes but leaves export visible.
- Destructive actions are last and clearly separated.
- At 390px width, rows wrap without clipping values or buttons.

- [ ] **Step 4: Commit verification fixes**

```bash
git add src/ui/OperationsPanel.tsx src/ui/settings src/styles/settings.css
git commit -m "fix: verify settings intent layout"
```
