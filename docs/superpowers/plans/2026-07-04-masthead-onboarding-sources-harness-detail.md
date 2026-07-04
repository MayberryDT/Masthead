# Masthead Onboarding And Sources Harness Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-run onboarding wizard and Sources-owned harness detail workflow where onboarding and each harness detail modal expose the same setup controls for live capture, metadata import, lazy transcript policy, and Dossier enrichment configuration, while making the dev app visually distinct from production.

**Architecture:** Sources becomes the product home for harness setup. The app keeps one shared state path for hooks, source setup, and LLM provider settings, then renders those controls in two contexts: full-window onboarding for first run and a single-harness detail modal for later repair or changes. The implementation preserves metadata-first import defaults, lazy transcript hydration on Dossier open, and Dossier-only enrichment instead of bulk enrichment.

**Tech Stack:** React 19, TypeScript, Vite, Electron, local daemon HTTP APIs, SQLite-backed source setup state, Vitest with happy-dom for UI tests.

---

## Scope

In scope:

- Add a dev-badged app/menu/tray identity for the Electron dev launcher.
- Move visible Codex hook setup out of Settings and into Sources harness detail.
- Make each Sources harness card open a richer harness detail modal.
- Add full-window first-run onboarding with subtle skip, persistent dismissal, and manual rerun from Settings.
- Reuse the same setup controls in onboarding and harness detail.
- Hoist shared settings state so Sources, Settings, and onboarding read and write the same provider/key/model state.
- Default setup to detected importable harnesses.
- Default history import to metadata only.
- Keep transcript hydration lazy, automatic when a Dossier/transcript view opens.
- Let users configure enrichment provider/key/model during onboarding and harness detail, using the same provider settings component as Settings.
- Do not queue enrichment for all imported sessions during onboarding. Dossier enrichment stays manual/on-open.
- Continue setup steps that can still succeed, then show a needs-attention report.

Out of scope:

- Adding new harness adapters.
- Changing the source import schema.
- Replacing the lazy transcript recovery already covered by progressive import tests.
- Building a marketing onboarding page.
- Renaming daemon routes solely because the UI ownership moved to Sources.

## File Structure

Create:

- `src/app/onboardingPreference.ts` - browser local preference for first-run onboarding dismissal.
- `src/app/__tests__/onboardingPreference.test.ts` - storage tests for onboarding dismissal.
- `src/app/sources/setupPlanRunner.ts` - UI orchestration for multi-step source setup with logs and partial success.
- `src/app/sources/__tests__/setupPlanRunner.test.ts` - verifies setup continues after failures and produces a report.
- `src/ui/sources/HarnessLiveCaptureSection.tsx` - Sources-owned live capture status and hook actions.
- `src/ui/sources/HarnessSetupControls.tsx` - shared setup choices used by onboarding and harness detail.
- `src/ui/sources/SetupRunProgress.tsx` - setup progress, logs, and final needs-attention report.
- `src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx` - hook action rendering and callbacks.
- `src/ui/settings/LlmProviderControls.tsx` - extracted shared provider/key/model editor.
- `public/assets/masthead-logo-sail-dev.svg` - dev-badged app/menu/tray icon source.

Modify:

- `src/app/App.tsx` - first-run onboarding gate, manual rerun wiring, Sources hook/settings props.
- `src/app/settings/useSettingsDataController.ts` - shared settings state and LLM provider save path used by Settings, Sources, and onboarding.
- `src/app/sources/useSourcesController.ts` - load hook state and expose hook actions.
- `src/ui/SourcesPanel.tsx` - controlled onboarding open state, hook and provider props, pass detail props.
- `src/ui/sources/AdapterList.tsx` - pass hook/provider/action props to detail modal.
- `src/ui/sources/AdapterRow.tsx` - keep card compact and add live capture summary.
- `src/ui/sources/SourceAdapterDetailModal.tsx` - richer harness detail surface.
- `src/ui/sources/SourcesOnboardingModal.tsx` - full-window first-run wizard, shared controls, plan runner.
- `src/ui/settings/EnrichmentSettings.tsx` - wrap extracted provider controls.
- `src/ui/OperationsPanel.tsx` - remove hook card, add rerun onboarding entry.
- `src/ui/settings/SettingsSurface.test.tsx` and `src/ui/__tests__/operationsPanel.test.tsx` - Settings no longer owns hook controls.
- `src/ui/sources/__tests__/AdapterRow.test.tsx` and `src/ui/sources/__tests__/SourcesPanelImports.test.tsx` - Sources owns hook/detail/onboarding assertions.
- `src/styles/sources.css`, `src/styles/settings.css`, `src/styles/masthead.css` - full-window onboarding, harness detail sections, dev identity if needed in-app.
- `src/electron/main.ts` and `src/electron/tray.ts` - dev tray icon and tooltip.
- `src/electron/__tests__/tray.test.ts` - tray tooltip label.
- `scripts/install-electron-dev-launcher.js` - use dev-badged icon in the desktop entry.
- `scripts/prepare-electron-resources.js` - copy dev-badged asset for packaged/dev resource fallback.

## Shared Behavior Rules

- Onboarding and harness detail use the same setup control components.
- Settings remains the global app settings surface. It does not own hook lifecycle controls.
- Sources owns all harness-specific setup and repair controls.
- Hook actions are still backed by the existing typed hook API functions in `src/app/daemonClient.ts`.
- Provider/key/model settings are backed by `updateLlmProviderSettings` and the existing `SettingsStateDto["llm"]`.
- `App` owns the loaded settings DTO in normal runtime. `OperationsPanel` may keep its fallback self-loading behavior for isolated tests and direct rendering, but production should pass the same `settingsState` and provider-save callback to Settings, Sources, and onboarding.
- Transcript import is never bulk-enabled by onboarding defaults.
- Setup plan execution logs every step, marks failed steps, and keeps running independent remaining steps.
- Tasks 3 and 4 are one commit boundary: Task 3 adds the controller state, Task 4 adds the receiving UI. Do not stop between them with a broken typecheck.

## Subagent Dispatch Matrix

- Subagent A: Task 1. Dev identity is isolated from onboarding and Sources state.
- Subagent B: Task 2. Onboarding dismissal preference is isolated and can run in parallel with Task 1.
- Subagent C: Tasks 3 and 4 together. Hook state and hook UI props are coupled and should land as one reviewable diff.
- Subagent D: Task 5 after Subagent C. Shared settings state and provider controls touch `App`, `OperationsPanel`, Sources, and Settings, so it should not run in parallel with Task 8.
- Subagent E: Task 6. Setup runner is isolated after shared setup types are settled.
- Subagent F: Tasks 7 and 8 together after Tasks 5 and 6. Onboarding UI depends on the setup runner and shared provider controls.
- Subagent G: Task 9 after Tasks 4 and 5. Harness detail polish depends on live capture and provider sections existing.
- Subagent H: Task 10 after Task 4. Settings hook removal should wait until Sources hook controls exist.
- Main agent: Tasks 11 and 12. Browser QA, final verification, and closeout should run after all implementation diffs are integrated.

Parallel-safe first wave: Tasks 1, 2, and 6. Everything else has UI prop or shared state dependencies.

## Risk Register

- Wrong hook target: The production app must not silently attach to the dev hook target. Mitigation: Sources live capture section always shows endpoint and config path, hook actions use the existing typed hook API, and browser QA verifies the displayed target before final closeout.
- Provider state drift: Settings, onboarding, and harness detail could save different LLM provider values. Mitigation: Task 5 hoists settings state through `App` and passes the same DTO and save callback everywhere.
- Bulk transcript import regression: Onboarding could accidentally import all transcripts. Mitigation: Task 7 tests `importTranscripts: false`, Dossier lazy hydration remains covered by existing progressive import tests, and final verification runs the full suite.
- Bulk enrichment regression: Onboarding could enqueue enrichment for all imported sessions. Mitigation: Task 7 tests `queueEnrichment: false`, and Dossier enrichment remains opened-session scoped.
- First-run onboarding loop: Dismissed onboarding could reopen on every app start. Mitigation: Task 2 stores a durable local dismissal preference, Task 8 only reopens when manually requested or not dismissed.
- Settings dead-end: Moving hooks out of Settings could hide repair actions. Mitigation: Task 4 adds hook actions to Codex harness detail before Task 10 removes the Settings card.
- Visual overload: Harness cards could become mini-settings panels. Mitigation: Task 9 keeps cards compact and puts detailed controls only in the modal.
- Dev/prod icon ambiguity: Dev badge may not render in desktop menu or tray. Mitigation: Task 1 uses a self-contained icon asset, updates desktop and tray paths, changes tooltip to `Masthead Dev`, and Task 11 includes visual QA.

## Acceptance Criteria

- Opening Sources shows interactive harness cards, not static diagnostics-only inventory.
- Clicking Codex opens a detail modal with overview, live capture, history import, transcript policy, Dossier enrichment, diagnostics, and source locations.
- Codex hook install/repair/test/uninstall controls are available in Sources harness detail and absent from Settings.
- Onboarding and harness detail render the same setup controls and provider configuration component.
- First-run onboarding blocks the full app, has a subtle skip button, and stays dismissed after skip until Settings reopens it.
- Onboarding defaults to detected importable harnesses selected.
- Onboarding submits metadata-only setup by default: `importMetadata: true`, `importTranscripts: false`, `queueEnrichment: false`.
- Setup execution logs progress, continues independent steps after failure, and ends with a needs-attention report when any step fails.
- Opening a session Dossier still triggers lazy transcript hydration for that session only.
- Dev app menu/tray identity is visibly different from production and tray tooltip reads `Masthead Dev`.

---

### Task 1: Dev-Badged Electron Dev Identity

**Files:**

- Create: `public/assets/masthead-logo-sail-dev.svg`
- Modify: `scripts/install-electron-dev-launcher.js`
- Modify: `scripts/prepare-electron-resources.js`
- Modify: `src/electron/main.ts`
- Modify: `src/electron/tray.ts`
- Test: `src/electron/__tests__/tray.test.ts`

- [ ] **Step 1: Write the failing tray tooltip test**

Add this test to `src/electron/__tests__/tray.test.ts`:

```ts
import { buildTrayMenuTemplate, trayTooltipLabel } from "../tray";

describe("Electron tray menu", () => {
  test("uses a dev tooltip when the dev channel is active", () => {
    expect(trayTooltipLabel(true)).toBe("Masthead Dev");
    expect(trayTooltipLabel(false)).toBe("Masthead");
  });
});
```

If the file already imports `buildTrayMenuTemplate`, extend the existing import instead of duplicating it.

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm run test:electron -- --run src/electron/__tests__/tray.test.ts
```

Expected: FAIL because `trayTooltipLabel` is not exported.

- [ ] **Step 3: Add the dev-badged SVG asset**

Create `public/assets/masthead-logo-sail-dev.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="Masthead Dev">
  <rect width="256" height="256" rx="48" fill="#031019"/>
  <path d="M52 189c34 8 69 4 104-13 7-3 13 7 6 12-34 25-75 34-124 24 8-6 12-13 14-23Z" fill="#f6fbff"/>
  <path d="M87 39c18 34 30 70 35 108-18 10-39 16-64 18 20-35 30-77 29-126Z" fill="#f6fbff"/>
  <path d="M123 73c28 27 46 57 55 91-15-8-31-13-49-16-2-25-4-50-6-75Z" fill="#d6e4ef"/>
  <path d="M80 170c31-4 60-12 87-26 4 9 7 18 9 27-31 18-68 25-111 20 6-5 11-12 15-21Z" fill="#91a8ba"/>
  <rect x="80" y="164" width="144" height="54" rx="12" fill="#ffcf36"/>
  <text x="152" y="199" text-anchor="middle" font-family="IBM Plex Sans, Arial, sans-serif" font-size="32" font-weight="700" fill="#031019">DEV</text>
</svg>
```

- [ ] **Step 4: Update the dev launcher icon path**

In `scripts/install-electron-dev-launcher.js`, change the icon path from the production sail to the dev badge:

```js
const iconPath = join(repo, "public", "assets", "masthead-logo-sail-dev.svg");
```

The generated desktop entry should keep `Name=Masthead Dev`.

- [ ] **Step 5: Copy the dev asset into Electron resources**

In `scripts/prepare-electron-resources.js`, extend the asset copy list so both icon files are available:

```js
const assetFiles = [
  "masthead-logo-sail.png",
  "masthead-logo-sail-dev.svg"
];
```

Preserve the script's existing copy function and add the new filename to the current loop.

- [ ] **Step 6: Make Electron pick dev icon and dev tooltip**

In `src/electron/tray.ts`, add a tooltip helper and update `createMastheadTray`:

```ts
export function trayTooltipLabel(isDev: boolean): string {
  return isDev ? "Masthead Dev" : "Masthead";
}

export async function createMastheadTray(
  iconPath: string,
  handlers: TrayMenuActionHandlers,
  options: { isDev?: boolean } = {}
): Promise<unknown> {
  const { Menu, Tray } = await import("electron");
  const tray = new Tray(iconPath);
  tray.setToolTip(trayTooltipLabel(Boolean(options.isDev)));
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(handlers)));
  tray.on("click", handlers.onShow);
  return tray;
}
```

In `src/electron/main.ts`, add a dev-channel helper:

```ts
function isElectronDevMode(): boolean {
  return process.env.MASTHEAD_ELECTRON_DEV === "1";
}
```

If `isElectronDevMode` already exists later in the file, reuse it and do not create a duplicate.

Update `trayIconPath`:

```ts
function trayIconPath(): string {
  const iconName = isElectronDevMode() ? "masthead-logo-sail-dev.svg" : "masthead-logo-sail.png";
  const sourceIcon = join(app.getAppPath(), "public", "assets", iconName);
  if (existsSync(sourceIcon)) return sourceIcon;
  return join(process.resourcesPath, iconName);
}
```

Update tray creation:

```ts
tray = await createMastheadTray(trayIconPath(), {
  onOpenDataDirectory: () => {
    void openDataDirectory(electronDataDirectory());
  },
  onQuit: () => app.quit(),
  onShow: showMainWindow
}, { isDev: isElectronDevMode() });
```

- [ ] **Step 7: Run focused verification**

Run:

```bash
npm run test:electron -- --run src/electron/__tests__/tray.test.ts src/electron/__tests__/devLauncher.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/assets/masthead-logo-sail-dev.svg scripts/install-electron-dev-launcher.js scripts/prepare-electron-resources.js src/electron/main.ts src/electron/tray.ts src/electron/__tests__/tray.test.ts
git commit -m "feat: distinguish masthead dev identity"
```

---

### Task 2: First-Run Onboarding Dismissal Preference

**Files:**

- Create: `src/app/onboardingPreference.ts`
- Create: `src/app/__tests__/onboardingPreference.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/__tests__/onboardingPreference.test.ts`:

```ts
// @vitest-environment happy-dom

import { beforeEach, describe, expect, test } from "vitest";
import {
  mastheadOnboardingDismissedStorageKey,
  readOnboardingDismissed,
  writeOnboardingDismissed
} from "../onboardingPreference";

describe("onboarding preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("defaults to not dismissed", () => {
    expect(readOnboardingDismissed()).toBe(false);
  });

  test("persists dismissal", () => {
    writeOnboardingDismissed(true);
    expect(window.localStorage.getItem(mastheadOnboardingDismissedStorageKey)).toBe("1");
    expect(readOnboardingDismissed()).toBe(true);
  });

  test("clears dismissal when onboarding is manually reopened", () => {
    writeOnboardingDismissed(true);
    writeOnboardingDismissed(false);
    expect(window.localStorage.getItem(mastheadOnboardingDismissedStorageKey)).toBeNull();
    expect(readOnboardingDismissed()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm test -- --run src/app/__tests__/onboardingPreference.test.ts
```

Expected: FAIL because `src/app/onboardingPreference.ts` does not exist.

- [ ] **Step 3: Implement the preference helper**

Create `src/app/onboardingPreference.ts`:

```ts
export const mastheadOnboardingDismissedStorageKey = "masthead:onboarding:dismissed:v1";

export function readOnboardingDismissed(): boolean {
  try {
    return window.localStorage.getItem(mastheadOnboardingDismissedStorageKey) === "1";
  } catch {
    return false;
  }
}

export function writeOnboardingDismissed(dismissed: boolean): void {
  try {
    if (dismissed) {
      window.localStorage.setItem(mastheadOnboardingDismissedStorageKey, "1");
    } else {
      window.localStorage.removeItem(mastheadOnboardingDismissedStorageKey);
    }
  } catch {
    // Local preference storage should not block app startup.
  }
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm test -- --run src/app/__tests__/onboardingPreference.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/onboardingPreference.ts src/app/__tests__/onboardingPreference.test.ts
git commit -m "feat: persist onboarding dismissal"
```

---

### Task 3: Sources Controller Owns Hook State And Hook Actions

**Files:**

- Modify: `src/app/sources/useSourcesController.ts`
- Test: `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`

- [ ] **Step 1: Write the failing UI integration assertion**

In `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`, add a test near the other connected dashboard tests:

```tsx
test("passes Codex hook state into harness detail from Sources", async () => {
  const onHookAction = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <SourcesPanel
        adapters={[codexAdapter()]}
        busy={false}
        hooks={installedHooks()}
        imports={[]}
        onCodexHookAction={onHookAction}
        onExcludePath={noop}
        onRefresh={noop}
        sources={[]}
      />
    );
  });

  await act(async () => {
    buttonByText(container, "Details").click();
  });

  expect(container.textContent).toContain("Live capture");
  expect(container.textContent).toContain("Installed");
  expect(container.textContent).toContain("/home/tyler/.codex/hooks.json");

  await act(async () => {
    buttonByText(container, "Test hooks").click();
  });

  expect(onHookAction).toHaveBeenCalledWith("test");
  await act(async () => root.unmount());
});
```

Add this helper in the same test file:

```ts
function installedHooks() {
  return {
    command: "MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest node /app/scripts/masthead-hook.js",
    configExists: true,
    configPath: "/home/tyler/.codex/hooks.json",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: true,
    integrations: [
      {
        actionSurface: "sources" as const,
        captureMode: "live_hook" as const,
        description: "Live local hook events are managed from Sources.",
        label: "Codex",
        runtime: "codex",
        status: "installed" as const,
        supportsActions: true
      }
    ],
    lastEventAt: "2026-07-04T12:00:00.000Z",
    lastTest: {
      message: "Test event accepted.",
      status: "passed" as const,
      testedAt: "2026-07-04T12:01:00.000Z"
    },
    missingEvents: [],
    mismatchedEvents: []
  };
}
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: FAIL because `SourcesPanel` has no `hooks` or `onCodexHookAction` props.

- [ ] **Step 3: Extend the Sources controller**

In `src/app/sources/useSourcesController.ts`, import hook APIs:

```ts
import {
  getCodexHookSettings,
  installCodexHooks,
  testCodexHooks,
  uninstallCodexHooks,
  type CodexHookSettingsDto
} from "../daemonClient";
```

Add state:

```ts
const [hooks, setHooks] = useState<CodexHookSettingsDto>();
const [hookActionBusy, setHookActionBusy] = useState(false);
```

Extend `loadInventory` by adding `getCodexHookSettings(activeProjectionUrl)` to the `Promise.allSettled` call and assigning the result:

```ts
if (hookResult.status === "fulfilled") setHooks(hookResult.value);
```

Add an action callback:

```ts
const runCodexHookAction = useCallback(async (action: "install" | "test" | "uninstall") => {
  setHookActionBusy(true);
  setStatus(
    action === "install"
      ? "Installing Codex hooks..."
      : action === "test"
        ? "Testing Codex hooks..."
        : "Uninstalling Codex hooks..."
  );
  try {
    const nextHooks =
      action === "install"
        ? await installCodexHooks(activeProjectionUrl)
        : action === "test"
          ? await testCodexHooks(activeProjectionUrl)
          : await uninstallCodexHooks(activeProjectionUrl);
    setHooks(nextHooks);
    setStatus(
      action === "install"
        ? "Codex hooks installed."
        : action === "test"
          ? "Codex hook test complete."
          : "Codex hooks uninstalled."
    );
    await loadInventory();
  } catch (error) {
    setStatus(`Codex hook ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    setHookActionBusy(false);
  }
}, [activeProjectionUrl, loadInventory]);
```

Return the new values:

```ts
hooks,
hookActionBusy,
runCodexHookAction,
```

- [ ] **Step 4: Pass hook props through App and SourcesPanel**

In `src/app/App.tsx`, destructure:

```ts
hooks: sourceHooks,
hookActionBusy,
runCodexHookAction: handleCodexHookAction,
```

Pass to `SourcesPanel`:

```tsx
hooks={sourceHooks}
hookActionBusy={hookActionBusy}
onCodexHookAction={handleCodexHookAction}
```

In `src/ui/SourcesPanel.tsx`, add props:

```ts
hooks?: CodexHookSettingsDto;
hookActionBusy?: boolean;
onCodexHookAction?: (action: "install" | "test" | "uninstall") => Promise<void> | void;
```

Pass them through to the adapter list/detail path added in Task 4.

- [ ] **Step 5: Run typecheck to catch prop gaps**

Run:

```bash
npm run typecheck
```

Expected: FAIL until Task 4 adds the receiving props. Continue to Task 4 before committing Task 3 if the prop chain is incomplete.

---

### Task 4: Shared Sources Live Capture Section

**Files:**

- Create: `src/ui/sources/HarnessLiveCaptureSection.tsx`
- Create: `src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx`
- Modify: `src/ui/sources/SourceAdapterDetailModal.tsx`
- Modify: `src/ui/sources/AdapterList.tsx`
- Modify: `src/ui/SourcesPanel.tsx`

- [ ] **Step 1: Write the focused component tests**

Create `src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { CodexHookSettingsDto } from "../../../app/daemonClient";
import { HarnessLiveCaptureSection } from "../HarnessLiveCaptureSection";

describe("HarnessLiveCaptureSection", () => {
  test("shows installed Codex hook proof and actions", () => {
    const html = renderToStaticMarkup(
      <HarnessLiveCaptureSection
        hooks={hooks({ installed: true })}
        runtime="codex"
        onAction={() => undefined}
      />
    );

    expect(html).toContain("Live capture");
    expect(html).toContain("Installed");
    expect(html).toContain("Test hooks");
    expect(html).toContain("Uninstall hooks");
    expect(html).toContain("/home/tyler/.codex/hooks.json");
    expect(html).toContain("http://127.0.0.1:17373/ingest");
  });

  test("invokes hook actions", async () => {
    const onAction = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<HarnessLiveCaptureSection hooks={hooks({ installed: false })} runtime="codex" onAction={onAction} />);
    });

    await act(async () => {
      buttonByText(container, "Install/repair hooks").click();
    });

    expect(onAction).toHaveBeenCalledWith("install");
    await act(async () => root.unmount());
  });

  test("renders non-actionable harness state without Codex hook buttons", () => {
    const html = renderToStaticMarkup(
      <HarnessLiveCaptureSection
        hooks={hooks({ installed: true })}
        runtime="claude_code"
      />
    );

    expect(html).toContain("Managed through source import");
    expect(html).not.toContain("Install/repair hooks");
  });
});

function hooks(input: { installed: boolean }): CodexHookSettingsDto {
  return {
    command: "MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest node /app/scripts/masthead-hook.js",
    configExists: input.installed,
    configPath: "/home/tyler/.codex/hooks.json",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: input.installed,
    integrations: [
      {
        actionSurface: "sources",
        captureMode: "live_hook",
        description: "Live local hook events are managed from Sources.",
        label: "Codex",
        runtime: "codex",
        status: input.installed ? "installed" : "not_installed",
        supportsActions: true
      },
      {
        actionSurface: "sources",
        captureMode: "transcript_import",
        description: "Imported from local Claude Code transcript history through Sources.",
        label: "Claude Code",
        runtime: "claude_code",
        status: "managed_in_sources",
        supportsActions: false
      }
    ],
    missingEvents: input.installed ? [] : ["SessionStart"],
    mismatchedEvents: []
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component**

Create `src/ui/sources/HarnessLiveCaptureSection.tsx`:

```tsx
import type { CodexHookSettingsDto, HarnessCaptureIntegrationDto } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";

type HookAction = "install" | "test" | "uninstall";

type Props = {
  busy?: boolean;
  hooks?: CodexHookSettingsDto;
  runtime: string;
  onAction?: (action: HookAction) => Promise<void> | void;
};

export function HarnessLiveCaptureSection({ busy = false, hooks, onAction, runtime }: Props) {
  const integration = hooks?.integrations.find((item) => item.runtime === runtime);
  const isCodex = runtime === "codex";
  const actionable = isCodex && Boolean(integration?.supportsActions);
  const status = liveCaptureStatus(hooks, integration, runtime);

  return (
    <section className="detail-section source-detail-section harness-live-capture" aria-label="Live capture">
      <div className="source-detail-section-head">
        <div>
          <p className="mono-label">Live capture</p>
          <h3>{integration?.label ?? runtime}</h3>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      <dl className="harness-live-capture-proof">
        <div>
          <dt>Mode</dt>
          <dd>{integration?.captureMode === "live_hook" ? "Live hook" : "Managed through source import"}</dd>
        </div>
        <div>
          <dt>Config</dt>
          <dd>{hooks?.configPath ?? integration?.configPath ?? "No writable hook config"}</dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd>{hooks?.endpoint ?? "No live endpoint"}</dd>
        </div>
        <div>
          <dt>Last test</dt>
          <dd>{hooks?.lastTest ? `${hooks.lastTest.status} at ${hooks.lastTest.testedAt}` : "Not run"}</dd>
        </div>
        <div>
          <dt>Last event</dt>
          <dd>{hooks?.lastEventAt ?? "Not observed"}</dd>
        </div>
        <div>
          <dt>Backup</dt>
          <dd>{hooks?.latestBackupPath ?? "No Masthead backup recorded"}</dd>
        </div>
      </dl>
      {status.message ? <p className="surface-status">{status.message}</p> : null}
      {actionable ? (
        <div className="source-detail-action-buttons">
          <AppButton disabled={busy} onClick={() => void onAction?.("install")}>
            Install/repair hooks
          </AppButton>
          <AppButton variant="quiet" disabled={busy || !hooks?.installed} onClick={() => void onAction?.("test")}>
            Test hooks
          </AppButton>
          <AppButton variant="quiet" disabled={busy || !hooks?.configExists} onClick={() => void onAction?.("uninstall")}>
            Uninstall hooks
          </AppButton>
        </div>
      ) : null}
    </section>
  );
}

function liveCaptureStatus(
  hooks: CodexHookSettingsDto | undefined,
  integration: HarnessCaptureIntegrationDto | undefined,
  runtime: string
): { label: string; message?: string; tone: StatusBadgeTone } {
  if (runtime !== "codex") {
    return { label: integration?.status === "managed_in_sources" ? "Managed in Sources" : "Source import", tone: "info" };
  }
  if (!hooks) return { label: "Loading", tone: "neutral" };
  if (hooks.error) return { label: "Needs repair", message: hooks.error, tone: "danger" };
  if (hooks.installed && hooks.missingEvents.length === 0 && hooks.mismatchedEvents.length === 0) {
    return { label: "Installed", tone: "active" };
  }
  if (hooks.configExists) {
    return { label: "Needs repair", message: "Hook configuration is present but does not match Masthead's expected capture events.", tone: "warning" };
  }
  return { label: "Not installed", message: "Codex hook configuration is not installed yet.", tone: "warning" };
}
```

- [ ] **Step 4: Add props to modal and pass them through**

In `src/ui/sources/SourceAdapterDetailModal.tsx`, import the component and add props:

```ts
import type { CodexHookSettingsDto } from "../../app/daemonClient";
import { HarnessLiveCaptureSection } from "./HarnessLiveCaptureSection";

type Props = {
  hooks?: CodexHookSettingsDto;
  hookActionBusy?: boolean;
  onCodexHookAction?: (action: "install" | "test" | "uninstall") => Promise<void> | void;
};
```

Render the live capture section after the action summary:

```tsx
<HarnessLiveCaptureSection
  busy={busy || hookActionBusy}
  hooks={hooks}
  runtime={view.runtime}
  onAction={onCodexHookAction}
/>
```

In `src/ui/sources/AdapterList.tsx` and `src/ui/SourcesPanel.tsx`, pass `hooks`, `hookActionBusy`, and `onCodexHookAction` down to `SourceAdapterDetailModal`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx src/ui/sources/__tests__/AdapterRow.test.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: PASS after prop chain and modal rendering are wired.

- [ ] **Step 6: Commit**

```bash
git add src/app/sources/useSourcesController.ts src/ui/SourcesPanel.tsx src/ui/sources/AdapterList.tsx src/ui/sources/SourceAdapterDetailModal.tsx src/ui/sources/HarnessLiveCaptureSection.tsx src/ui/sources/__tests__/HarnessLiveCaptureSection.test.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx
git commit -m "feat: move live capture controls into sources"
```

---

### Task 5: Extract Shared LLM Provider Controls

**Files:**

- Create: `src/ui/settings/LlmProviderControls.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/settings/useSettingsDataController.ts`
- Modify: `src/ui/OperationsPanel.tsx`
- Modify: `src/ui/settings/EnrichmentSettings.tsx`
- Modify: `src/ui/sources/SourceAdapterDetailModal.tsx`
- Test: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Test: `src/ui/sources/__tests__/AdapterRow.test.tsx`

- [ ] **Step 1: Add a failing harness detail assertion**

In `src/ui/sources/__tests__/AdapterRow.test.tsx`, add this to the `SourceAdapterDetailModal` describe block:

```tsx
test("renders shared enrichment provider controls in harness detail", () => {
  const html = renderToStaticMarkup(
    <SourceAdapterDetailModal
      adapter={codexAdapter({ transcriptImport: false })}
      busy={false}
      enrichment={{
        currentEnrichments: 0,
        health: { complete: 0, disabled: 0, failed: 0, queued: 0, status: "disabled" },
        model: "deterministic",
        provider: "Deterministic fallback",
        remoteModelEnabled: false,
        sessionCount: 120
      }}
      llm={llmSettings()}
      onClose={noop}
      onExcludePath={noop}
      onSaveLlmProvider={() => undefined}
    />
  );

  expect(html).toContain("Dossier enrichment");
  expect(html).toContain("Use remote LLM enrichment");
  expect(html).toContain("OpenAI");
  expect(html).toContain("Save provider");
});
```

Add helper:

```ts
function llmSettings() {
  return {
    activeProvider: "openai" as const,
    providers: [
      {
        apiKeyRequired: true,
        apiStyle: "responses" as const,
        baseUrl: "https://api.openai.com/v1",
        configured: false,
        customBaseUrl: false,
        id: "openai" as const,
        label: "OpenAI",
        local: false,
        model: "gpt-5-nano-2025-08-07"
      }
    ],
    remoteEnrichmentEnabled: false,
    secretStorage: {
      description: "API keys are stored locally.",
      kind: "local_database" as const
    }
  };
}
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/AdapterRow.test.tsx
```

Expected: FAIL because the modal does not accept or render LLM settings.

- [ ] **Step 3: Hoist settings state and provider save into the app controller**

In `src/app/settings/useSettingsDataController.ts`, extend the daemon client import:

```ts
import {
  getSettingsState,
  updateLlmProviderSettings,
  type SettingsStateDto,
  type UpdateLlmProviderSettingsInput
} from "../daemonClient";
```

Add state inside `useSettingsDataController`:

```ts
const [settingsState, setSettingsState] = useState<SettingsStateDto>();
const [settingsError, setSettingsError] = useState<string>();
const [settingsLoadState, setSettingsLoadState] = useState<"loading" | "ready" | "error">("loading");
```

Add a shared loader:

```ts
const loadSettingsState = useCallback(async (signal?: AbortSignal) => {
  setSettingsLoadState("loading");
  try {
    const settings = await getSettingsState(activeProjectionUrl, { signal });
    if (signal?.aborted) return;
    setSettingsState(settings);
    setSettingsError(undefined);
    setSettingsLoadState("ready");
  } catch (error) {
    if (signal?.aborted) return;
    setSettingsError(error instanceof Error ? error.message : String(error));
    setSettingsLoadState("error");
  }
}, [activeProjectionUrl]);
```

Load settings when the live projection is available:

```ts
useEffect(() => {
  if (!isLive) return;
  const controller = new AbortController();
  void loadSettingsState(controller.signal);
  return () => controller.abort();
}, [isLive, loadSettingsState]);
```

Add the shared save function:

```ts
const saveLlmProviderSettings = useCallback(async (input: UpdateLlmProviderSettingsInput) => {
  if (!writable) throw new Error(writeBlockedMessage);
  const nextSettings = await updateLlmProviderSettings(input, activeProjectionUrl);
  setSettingsState(nextSettings);
  setSettingsError(undefined);
  setSettingsLoadState("ready");
}, [activeProjectionUrl, writable, writeBlockedMessage]);
```

Return these values:

```ts
settingsError,
settingsLoadState,
settingsState,
loadSettingsState,
saveLlmProviderSettings,
```

In `src/app/App.tsx`, pass the shared settings state to both Settings and Sources:

```tsx
<SourcesPanel
  enrichment={settingsData.settingsState?.enrichment}
  llm={settingsData.settingsState?.llm}
  onSaveLlmProvider={settingsData.saveLlmProviderSettings}
  settingsBaseUrl={activeProjectionUrl}
/>
```

```tsx
<OperationsPanel
  settingsState={settingsData.settingsState}
  settingsError={settingsData.settingsError}
  settingsLoadState={settingsData.settingsLoadState}
  onReloadSettings={() => void settingsData.loadSettingsState()}
  onSaveLlmProvider={settingsData.saveLlmProviderSettings}
/>
```

In `src/ui/OperationsPanel.tsx`, add optional controlled props:

```ts
settingsError?: string;
settingsLoadState?: "loading" | "ready" | "error";
onReloadSettings?: () => void;
onSaveLlmProvider?: (input: UpdateLlmProviderSettingsInput) => Promise<void> | void;
```

Keep the existing self-loading fallback only when `settingsState` is not provided and no controlled load state is provided:

```ts
const externallyControlledSettings = settingsState !== undefined || props.settingsLoadState !== undefined;
```

Update `saveLlmProviderSettings` to delegate when provided:

```ts
const saveLlmProviderSettings = useCallback(async (input: UpdateLlmProviderSettingsInput) => {
  if (readOnly) throw new Error("Settings are read-only in this connection.");
  if (onSaveLlmProvider) {
    await onSaveLlmProvider(input);
    return;
  }
  const nextSettings = await updateLlmProviderSettings(input, baseUrl);
  setLoadedSettings(nextSettings);
  setSettingsError(undefined);
  setSettingsLoadState("ready");
}, [baseUrl, onSaveLlmProvider, readOnly]);
```

This is the state-sharing hinge for the rest of the plan. Do not duplicate provider state in Sources.

- [ ] **Step 4: Extract `LlmProviderControls`**

Move the stateful form logic from `src/ui/settings/EnrichmentSettings.tsx` into `src/ui/settings/LlmProviderControls.tsx`.

Use this prop type:

```ts
type LlmProviderControlsProps = {
  enrichment?: SettingsStateDto["enrichment"];
  llm?: SettingsStateDto["llm"];
  readOnly?: boolean;
  settingsBaseUrl?: string;
  onSaveProvider?: (input: UpdateLlmProviderSettingsInput) => Promise<void> | void;
};
```

The extracted component should render the existing `SettingsRow` controls and provider actions, but it should not render a `SettingsSection`.

Update `EnrichmentSettings.tsx` to become:

```tsx
import type { SettingsStateDto, UpdateLlmProviderSettingsInput } from "../../app/daemonClient";
import { SettingsSection } from "./SettingsSection";
import { LlmProviderControls } from "./LlmProviderControls";

type EnrichmentSettingsProps = {
  enrichment?: SettingsStateDto["enrichment"];
  llm?: SettingsStateDto["llm"];
  readOnly?: boolean;
  settingsBaseUrl?: string;
  onSaveProvider?: (input: UpdateLlmProviderSettingsInput) => Promise<void> | void;
};

export function EnrichmentSettings(props: EnrichmentSettingsProps) {
  return (
    <SettingsSection
      eyebrow="Enrichment"
      title="LLM provider"
      description="Connect optional LLM enrichment. Masthead still works locally when this is off."
    >
      <LlmProviderControls {...props} />
    </SettingsSection>
  );
}
```

- [ ] **Step 5: Render shared provider controls in harness detail**

In `src/ui/sources/SourceAdapterDetailModal.tsx`, add props:

```ts
enrichment?: SettingsStateDto["enrichment"];
llm?: SettingsStateDto["llm"];
onSaveLlmProvider?: (input: UpdateLlmProviderSettingsInput) => Promise<void> | void;
settingsBaseUrl?: string;
```

Import:

```ts
import type { SettingsStateDto, UpdateLlmProviderSettingsInput } from "../../app/daemonClient";
import { LlmProviderControls } from "../settings/LlmProviderControls";
```

Render:

```tsx
<section className="detail-section source-detail-section source-detail-enrichment" aria-label={`${label} Dossier enrichment`}>
  <div className="source-detail-section-head">
    <div>
      <p className="mono-label">Dossier enrichment</p>
      <h3>Provider and model</h3>
    </div>
  </div>
  <LlmProviderControls
    enrichment={enrichment}
    llm={llm}
    onSaveProvider={onSaveLlmProvider}
    readOnly={busy || !onSaveLlmProvider}
    settingsBaseUrl={settingsBaseUrl}
  />
</section>
```

Pass the props through `AdapterList` and `SourcesPanel` from `App`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/sources/__tests__/AdapterRow.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/App.tsx src/app/settings/useSettingsDataController.ts src/ui/OperationsPanel.tsx src/ui/settings/LlmProviderControls.tsx src/ui/settings/EnrichmentSettings.tsx src/ui/sources/SourceAdapterDetailModal.tsx src/ui/sources/AdapterList.tsx src/ui/SourcesPanel.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/sources/__tests__/AdapterRow.test.tsx
git commit -m "feat: share enrichment provider controls"
```

---

### Task 6: Setup Plan Runner With Logs And Partial Success

**Files:**

- Create: `src/app/sources/setupPlanRunner.ts`
- Create: `src/app/sources/__tests__/setupPlanRunner.test.ts`
- Modify: `src/shared/sourcesSetup.ts`

- [ ] **Step 1: Write runner tests**

Create `src/app/sources/__tests__/setupPlanRunner.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { runSourcesSetupPlan, type SourcesSetupPlan } from "../setupPlanRunner";

describe("runSourcesSetupPlan", () => {
  test("continues after hook install failure and reports needs attention", async () => {
    const plan: SourcesSetupPlan = {
      enrichmentMode: "skip",
      importMetadata: true,
      importTranscripts: false,
      liveCapture: [{ action: "install", runtime: "codex" }],
      queueEnrichment: false,
      sourceIds: ["codex-source"]
    };
    const logs: string[] = [];
    const runSetup = vi.fn(async () => ({ ok: true, setup: {} }));
    const runHookAction = vi.fn(async () => {
      throw new Error("hook config locked");
    });

    const result = await runSourcesSetupPlan(plan, {
      onLog: (entry) => logs.push(`${entry.status}:${entry.label}`),
      runHookAction,
      runSetup
    });

    expect(runHookAction).toHaveBeenCalledWith("install");
    expect(runSetup).toHaveBeenCalledWith({
      enrichmentMode: "skip",
      importMetadata: true,
      importTranscripts: false,
      queueEnrichment: false,
      sourceIds: ["codex-source"]
    });
    expect(result.status).toBe("needs_attention");
    expect(result.steps.map((step) => step.status)).toEqual(["failed", "succeeded"]);
    expect(logs).toEqual(expect.arrayContaining(["failed:Install Codex live capture", "succeeded:Import selected metadata"]));
  });

  test("returns succeeded when all requested steps complete", async () => {
    const result = await runSourcesSetupPlan(
      {
        enrichmentMode: "skip",
        importMetadata: true,
        importTranscripts: false,
        liveCapture: [{ action: "install", runtime: "codex" }],
        queueEnrichment: false,
        sourceIds: ["codex-source"]
      },
      {
        onLog: () => undefined,
        runHookAction: async () => undefined,
        runSetup: async () => ({ ok: true, setup: {} })
      }
    );

    expect(result.status).toBe("succeeded");
    expect(result.steps.every((step) => step.status === "succeeded")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm test -- --run src/app/sources/__tests__/setupPlanRunner.test.ts
```

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Add plan types**

In `src/shared/sourcesSetup.ts`, add:

```ts
export type SourcesSetupLiveCaptureAction = "install" | "test" | "uninstall" | "leave";

export type SourcesSetupLiveCaptureSelection = {
  runtime: string;
  action: SourcesSetupLiveCaptureAction;
};
```

- [ ] **Step 4: Implement the runner**

Create `src/app/sources/setupPlanRunner.ts`:

```ts
import type {
  SourcesSetupLiveCaptureSelection,
  SourcesSetupRunInput
} from "../../shared/sourcesSetup";

export type SourcesSetupPlan = SourcesSetupRunInput & {
  liveCapture: SourcesSetupLiveCaptureSelection[];
};

export type SetupRunLogEntry = {
  id: string;
  label: string;
  message: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  timestamp: string;
};

export type SetupRunReport = {
  status: "succeeded" | "needs_attention";
  steps: SetupRunLogEntry[];
};

type SetupPlanRunnerDeps = {
  onLog: (entry: SetupRunLogEntry) => void;
  runHookAction: (action: "install" | "test" | "uninstall") => Promise<unknown> | unknown;
  runSetup: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
};

export async function runSourcesSetupPlan(plan: SourcesSetupPlan, deps: SetupPlanRunnerDeps): Promise<SetupRunReport> {
  const steps: SetupRunLogEntry[] = [];

  for (const liveCapture of plan.liveCapture) {
    if (liveCapture.runtime !== "codex" || liveCapture.action === "leave") {
      appendStep(steps, deps, {
        id: `live:${liveCapture.runtime}`,
        label: `${liveCapture.runtime} live capture`,
        message: "No writable live hook action requested.",
        status: "skipped",
        timestamp: new Date().toISOString()
      });
      continue;
    }
    const label = liveCapture.action === "install" ? "Install Codex live capture" : `${liveCapture.action} Codex live capture`;
    appendStep(steps, deps, runningStep(`live:${liveCapture.runtime}:${liveCapture.action}`, label));
    try {
      await deps.runHookAction(liveCapture.action);
      appendStep(steps, deps, completedStep(`live:${liveCapture.runtime}:${liveCapture.action}`, label, "succeeded"));
    } catch (error) {
      appendStep(steps, deps, completedStep(`live:${liveCapture.runtime}:${liveCapture.action}`, label, "failed", errorMessage(error)));
    }
  }

  if (plan.importMetadata || plan.importTranscripts || plan.queueEnrichment) {
    const setupInput: SourcesSetupRunInput = {
      enrichmentMode: plan.enrichmentMode,
      importMetadata: plan.importMetadata,
      importScope: plan.importScope,
      importTranscripts: plan.importTranscripts,
      queueEnrichment: plan.queueEnrichment,
      runtimeApprovals: plan.runtimeApprovals,
      runtimes: plan.runtimes,
      sourceIds: plan.sourceIds,
      transcriptApproved: plan.transcriptApproved,
      transcriptApprovals: plan.transcriptApprovals
    };
    const label = plan.importMetadata ? "Import selected metadata" : "Run selected source setup";
    appendStep(steps, deps, runningStep("sources:setup", label));
    try {
      await deps.runSetup(setupInput);
      appendStep(steps, deps, completedStep("sources:setup", label, "succeeded"));
    } catch (error) {
      appendStep(steps, deps, completedStep("sources:setup", label, "failed", errorMessage(error)));
    }
  }

  return {
    status: steps.some((step) => step.status === "failed") ? "needs_attention" : "succeeded",
    steps
  };
}

function appendStep(steps: SetupRunLogEntry[], deps: SetupPlanRunnerDeps, entry: SetupRunLogEntry): void {
  steps.push(entry);
  deps.onLog(entry);
}

function runningStep(id: string, label: string): SetupRunLogEntry {
  return {
    id,
    label,
    message: "Running...",
    status: "running",
    timestamp: new Date().toISOString()
  };
}

function completedStep(id: string, label: string, status: "succeeded" | "failed", message?: string): SetupRunLogEntry {
  return {
    id,
    label,
    message: message ?? (status === "succeeded" ? "Complete." : "Failed."),
    status,
    timestamp: new Date().toISOString()
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- --run src/app/sources/__tests__/setupPlanRunner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/sourcesSetup.ts src/app/sources/setupPlanRunner.ts src/app/sources/__tests__/setupPlanRunner.test.ts
git commit -m "feat: add sources setup plan runner"
```

---

### Task 7: Shared Harness Setup Controls And Progress UI

**Files:**

- Create: `src/ui/sources/HarnessSetupControls.tsx`
- Create: `src/ui/sources/SetupRunProgress.tsx`
- Modify: `src/ui/sources/SourcesOnboardingModal.tsx`
- Test: `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`

- [ ] **Step 1: Add failing onboarding defaults test**

In `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`, add:

```tsx
test("onboarding defaults to detected sources with metadata only and no bulk enrichment", async () => {
  const onRunSetup = vi.fn(async () => undefined);
  const onHookAction = vi.fn(async () => undefined);
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <SourcesPanel
        adapters={[]}
        busy={false}
        hooks={installedHooks()}
        imports={[]}
        onCodexHookAction={onHookAction}
        onExcludePath={noop}
        onRefresh={noop}
        onRunSetup={onRunSetup}
        setup={setupWithScan()}
        sources={[]}
      />
    );
  });

  await act(async () => {
    buttonByText(container, "Set up sources").click();
  });

  expect(container.textContent).toContain("Metadata only");
  expect(container.textContent).toContain("Transcripts hydrate when a Dossier opens");
  expect(container.textContent).toContain("Enrich Dossiers when opened");

  await act(async () => {
    buttonByText(container, "Review setup").click();
    buttonByText(container, "Start setup").click();
    await Promise.resolve();
  });

  expect(onRunSetup).toHaveBeenCalledWith(expect.objectContaining({
    importMetadata: true,
    importTranscripts: false,
    queueEnrichment: false,
    sourceIds: ["codex-source"]
  }));
  await act(async () => root.unmount());
});
```

Add `setupWithScan()` helper using the existing `emptySetup` shape and a `latestScan` with one importable Codex source.

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: FAIL because onboarding still uses the older transcript/enrichment defaults.

- [ ] **Step 3: Implement `HarnessSetupControls`**

Create `src/ui/sources/HarnessSetupControls.tsx`:

```tsx
import type { FoundSourceDto } from "../../shared/sourcesSetup";
import { HarnessLiveCaptureSection } from "./HarnessLiveCaptureSection";
import type { CodexHookSettingsDto } from "../../app/daemonClient";

type Props = {
  hooks?: CodexHookSettingsDto;
  selectedSources: FoundSourceDto[];
  importMetadata: boolean;
  liveCaptureEnabled: boolean;
  onImportMetadataChange: (checked: boolean) => void;
  onLiveCaptureEnabledChange: (checked: boolean) => void;
};

export function HarnessSetupControls({
  hooks,
  importMetadata,
  liveCaptureEnabled,
  onImportMetadataChange,
  onLiveCaptureEnabledChange,
  selectedSources
}: Props) {
  const hasCodex = selectedSources.some((source) => source.runtime === "codex");
  return (
    <div className="harness-setup-controls">
      <label className="source-choice">
        <input type="checkbox" checked={importMetadata} onChange={(event) => onImportMetadataChange(event.currentTarget.checked)} />
        <span>
          <strong>Metadata only</strong>
          <small>Import session identity, timing, runtime, project, and searchable metadata without bulk transcript ingestion.</small>
        </span>
      </label>
      <div className="source-choice is-static">
        <span>
          <strong>Transcripts hydrate when a Dossier opens</strong>
          <small>Masthead imports the transcript for a session automatically when that session Dossier is opened.</small>
        </span>
      </div>
      <div className="source-choice is-static">
        <span>
          <strong>Enrich Dossiers when opened</strong>
          <small>Provider settings can be configured now, but setup does not enqueue enrichment for every imported session.</small>
        </span>
      </div>
      {hasCodex ? (
        <label className="source-choice">
          <input type="checkbox" checked={liveCaptureEnabled} onChange={(event) => onLiveCaptureEnabledChange(event.currentTarget.checked)} />
          <span>
            <strong>Install or repair Codex live capture</strong>
            <small>Backs up and updates the Masthead-managed Codex hook entries.</small>
          </span>
        </label>
      ) : null}
      {hasCodex ? <HarnessLiveCaptureSection hooks={hooks} runtime="codex" /> : null}
    </div>
  );
}
```

- [ ] **Step 4: Implement `SetupRunProgress`**

Create `src/ui/sources/SetupRunProgress.tsx`:

```tsx
import type { SetupRunLogEntry, SetupRunReport } from "../../app/sources/setupPlanRunner";
import { StatusBadge } from "../primitives/StatusBadge";

type Props = {
  logs: SetupRunLogEntry[];
  report?: SetupRunReport;
};

export function SetupRunProgress({ logs, report }: Props) {
  return (
    <section className="setup-run-progress" aria-label="Setup progress">
      <div className="source-detail-section-head">
        <div>
          <p className="mono-label">Setup progress</p>
          <h3>{report ? (report.status === "succeeded" ? "Setup complete" : "Needs attention") : "Running setup"}</h3>
        </div>
        {report ? <StatusBadge tone={report.status === "succeeded" ? "active" : "warning"}>{report.status.replaceAll("_", " ")}</StatusBadge> : null}
      </div>
      <ol className="setup-run-log">
        {logs.map((entry, index) => (
          <li className={`setup-run-log-entry ${entry.status}`} key={`${entry.id}:${index}`}>
            <span>{entry.status.replaceAll("_", " ")}</span>
            <div>
              <strong>{entry.label}</strong>
              <p>{entry.message}</p>
            </div>
            <time>{entry.timestamp}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 5: Wire controls into onboarding**

In `SourcesOnboardingModal.tsx`:

- Replace the old transcript approval step with `HarnessSetupControls`.
- Set default state:

```ts
const [importMetadata, setImportMetadata] = useState(true);
const [importTranscripts] = useState(false);
const [queueEnrichment] = useState(false);
const [liveCaptureEnabled, setLiveCaptureEnabled] = useState(true);
```

- When building the plan, call the runner:

```ts
const plan: SourcesSetupPlan = {
  enrichmentMode,
  importMetadata,
  importTranscripts,
  liveCapture: liveCaptureEnabled && selectedSources.some((source) => source.runtime === "codex")
    ? [{ runtime: "codex", action: "install" }]
    : [],
  queueEnrichment,
  sourceIds: selectedSources.map((source) => source.sourceId)
};
```

- Render `SetupRunProgress` during and after execution.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/sources/HarnessSetupControls.tsx src/ui/sources/SetupRunProgress.tsx src/ui/sources/SourcesOnboardingModal.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx
git commit -m "feat: add shared sources setup controls"
```

---

### Task 8: Full-Window First-Run Onboarding And Settings Rerun

**Files:**

- Modify: `src/app/App.tsx`
- Modify: `src/ui/SourcesPanel.tsx`
- Modify: `src/ui/sources/SourcesOnboardingModal.tsx`
- Modify: `src/ui/OperationsPanel.tsx`
- Create: `src/ui/settings/OnboardingSettings.tsx`
- Test: `src/app/__tests__/collectorAutostart.test.tsx`
- Test: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Test: `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`

- [ ] **Step 1: Add Settings rerun assertion**

In `src/ui/settings/__tests__/SettingsSurface.test.tsx`, update the main Settings surface test:

```ts
expect(html).toContain("Onboarding");
expect(html).toContain("Run onboarding again");
expect(html).not.toContain("Install/repair hooks");
expect(html).not.toContain("Test hooks");
expect(html).not.toContain("Uninstall hooks");
```

Remove the old expectations that Settings contains hook controls.

- [ ] **Step 2: Add controlled onboarding open assertion**

In `src/ui/sources/__tests__/SourcesPanelImports.test.tsx`, add:

```tsx
test("renders onboarding as a full-window blocking wizard when controlled open", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <SourcesPanel
        adapters={[]}
        busy={false}
        imports={[]}
        onboardingOpen
        onCloseOnboarding={noop}
        onExcludePath={noop}
        onRefresh={noop}
        setup={emptySetup()}
        sources={[]}
      />
    );
  });

  expect(container.querySelector(".sources-onboarding-full-window")).not.toBeNull();
  expect(container.textContent).toContain("Skip setup");
  await act(async () => root.unmount());
});
```

- [ ] **Step 3: Run focused failing tests**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: FAIL until Settings rerun and full-window props are implemented.

- [ ] **Step 4: Add `OnboardingSettings`**

Create `src/ui/settings/OnboardingSettings.tsx`:

```tsx
import { AppButton } from "../primitives/AppButton";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type Props = {
  onOpenOnboarding?: () => void;
  readOnly?: boolean;
};

export function OnboardingSettings({ onOpenOnboarding, readOnly = false }: Props) {
  return (
    <SettingsSection
      eyebrow="Setup"
      title="Onboarding"
      description="Reopen the first-run setup wizard for source detection, live capture, imports, and enrichment configuration."
    >
      <SettingsRow
        description="The wizard uses the same setup controls as Sources harness details."
        label="Setup wizard"
        control={
          <AppButton disabled={readOnly || !onOpenOnboarding} onClick={onOpenOnboarding}>
            Run onboarding again
          </AppButton>
        }
      />
    </SettingsSection>
  );
}
```

In `OperationsPanel.tsx`, add prop:

```ts
onOpenOnboarding?: () => void;
```

Render `OnboardingSettings` near Preferences and remove `HooksSettings` from Settings.

- [ ] **Step 5: Make `SourcesPanel` onboarding controlled**

In `src/ui/SourcesPanel.tsx`, add props:

```ts
onboardingOpen?: boolean;
onCloseOnboarding?: () => void;
onSkipOnboarding?: () => void;
```

Use controlled state:

```ts
const [localOnboardingOpen, setLocalOnboardingOpen] = useState(false);
const effectiveOnboardingOpen = props.onboardingOpen ?? localOnboardingOpen;
const closeOnboarding = () => {
  props.onCloseOnboarding?.();
  setLocalOnboardingOpen(false);
};
```

Pass `variant="fullWindow"` to `SourcesOnboardingModal` when `props.onboardingOpen` is controlled:

```tsx
<SourcesOnboardingModal
  variant={props.onboardingOpen === undefined ? "modal" : "fullWindow"}
  onSkip={props.onSkipOnboarding}
/>
```

- [ ] **Step 6: Add full-window variant to onboarding modal**

In `SourcesOnboardingModal.tsx`, add:

```ts
type Props = {
  variant?: "modal" | "fullWindow";
  onSkip?: () => void;
};
```

Use class:

```tsx
<div className={variant === "fullWindow" ? "sources-onboarding-full-window" : "modal-backdrop"} role="presentation">
```

Render a quiet skip action in the header:

```tsx
{onSkip ? (
  <AppButton type="button" variant="quiet" onClick={onSkip}>
    Skip setup
  </AppButton>
) : null}
```

- [ ] **Step 7: Wire first-run gate in App**

In `src/app/App.tsx`, import helpers:

```ts
import { readOnboardingDismissed, writeOnboardingDismissed } from "./onboardingPreference";
```

Add state:

```ts
const [onboardingDismissed, setOnboardingDismissed] = useState(() => readOnboardingDismissed());
const [manualOnboardingOpen, setManualOnboardingOpen] = useState(false);
```

Add helpers:

```ts
const shouldShowFirstRunOnboarding =
  !onboardingDismissed &&
  isLiveConnection &&
  connection.writable &&
  (sourcesSetup?.status === "empty" || sourcesSetup?.status === "scan_needed" || sourcesSetup?.status === "scan_available");

const onboardingOpen = manualOnboardingOpen || shouldShowFirstRunOnboarding;

const closeOnboarding = useCallback(() => {
  setManualOnboardingOpen(false);
  setOnboardingDismissed(true);
  writeOnboardingDismissed(true);
}, []);

const skipOnboarding = useCallback(() => {
  setManualOnboardingOpen(false);
  setOnboardingDismissed(true);
  writeOnboardingDismissed(true);
}, []);

const reopenOnboarding = useCallback(() => {
  setActiveSurface("sources");
  setOnboardingDismissed(false);
  writeOnboardingDismissed(false);
  setManualOnboardingOpen(true);
}, []);
```

Add an effect so the first-run gate mounts the Sources surface before rendering the controlled onboarding overlay:

```ts
useEffect(() => {
  if (shouldShowFirstRunOnboarding) setActiveSurface("sources");
}, [shouldShowFirstRunOnboarding]);
```

Pass to `SourcesPanel`:

```tsx
onboardingOpen={onboardingOpen}
onCloseOnboarding={closeOnboarding}
onSkipOnboarding={skipOnboarding}
```

Pass to `OperationsPanel`:

```tsx
onOpenOnboarding={reopenOnboarding}
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/App.tsx src/ui/SourcesPanel.tsx src/ui/sources/SourcesOnboardingModal.tsx src/ui/OperationsPanel.tsx src/ui/settings/OnboardingSettings.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx
git commit -m "feat: add first-run onboarding gate"
```

---

### Task 9: Rich Harness Detail Modal

**Files:**

- Modify: `src/ui/sources/AdapterRow.tsx`
- Modify: `src/ui/sources/SourceAdapterDetailModal.tsx`
- Modify: `src/styles/sources.css`
- Test: `src/ui/sources/__tests__/AdapterRow.test.tsx`

- [ ] **Step 1: Add failing modal content assertions**

In `src/ui/sources/__tests__/AdapterRow.test.tsx`, extend the detail modal render test:

```ts
expect(html).toContain("Harness overview");
expect(html).toContain("History import");
expect(html).toContain("Transcript policy");
expect(html).toContain("Live capture");
expect(html).toContain("Dossier enrichment");
```

Extend the compact card test:

```ts
expect(html).toContain("Live");
expect(html).not.toContain("/home/tyler/.codex/hooks.json");
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/AdapterRow.test.tsx
```

Expected: FAIL until the modal sections and card live summary are added.

- [ ] **Step 3: Keep the card compact and make live state visible**

In `AdapterRow.tsx`, add a fifth metric only if it fits the existing grid without wrapping. Use concise labels:

```tsx
<div>
  <dt>Live</dt>
  <dd>{view.lastSyncAt ? "Observed" : "Idle"}</dd>
</div>
```

If the grid becomes cramped, replace the `Issues` metric with `Live` only for connected harnesses and keep issues in the footer status.

- [ ] **Step 4: Add modal sections**

In `SourceAdapterDetailModal.tsx`, add sections in this order:

1. Harness overview.
2. Live capture.
3. History import.
4. Transcript policy.
5. Dossier enrichment.
6. Diagnostics.
7. Source locations.

Use existing actions for metadata, transcript approval, import transcripts, and sync. The transcript policy section must state the active behavior as product state, not instructional prose:

```tsx
<section className="detail-section source-detail-section" aria-label={`${label} transcript policy`}>
  <div className="source-detail-section-head">
    <div>
      <p className="mono-label">Transcript policy</p>
      <h3>Lazy Dossier hydration</h3>
    </div>
    <StatusBadge tone={view.policies.transcriptImport ? "active" : "neutral"}>
      {view.policies.transcriptImport ? "Approved" : "Metadata only"}
    </StatusBadge>
  </div>
  <p className="surface-status">
    Masthead imports transcript evidence for an individual session when its Dossier opens.
  </p>
</section>
```

- [ ] **Step 5: Add CSS for new modal sections**

In `src/styles/sources.css`, add:

```css
.harness-live-capture-proof,
.harness-overview-proof {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.harness-live-capture-proof div,
.harness-overview-proof div {
  border: 1px solid rgba(194, 221, 241, 0.13);
  border-radius: 5px;
  min-width: 0;
  padding: 10px;
}

.harness-live-capture-proof dd,
.harness-overview-proof dd {
  overflow-wrap: anywhere;
}

.setup-run-log {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.setup-run-log-entry {
  align-items: start;
  border: 1px solid rgba(194, 221, 241, 0.13);
  border-radius: 5px;
  display: grid;
  gap: 10px;
  grid-template-columns: 90px minmax(0, 1fr) auto;
  padding: 10px;
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/AdapterRow.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/sources/AdapterRow.tsx src/ui/sources/SourceAdapterDetailModal.tsx src/styles/sources.css src/ui/sources/__tests__/AdapterRow.test.tsx
git commit -m "feat: expand sources harness detail"
```

---

### Task 10: Remove Settings Hook Ownership

**Files:**

- Modify: `src/ui/OperationsPanel.tsx`
- Delete: `src/ui/settings/HooksSettings.tsx`
- Modify: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Modify: `src/ui/settings/__tests__/SettingsOperationalStates.test.tsx`
- Modify: `src/ui/__tests__/operationsPanel.test.tsx`

- [ ] **Step 1: Update Settings tests**

Replace Settings hook expectations with:

```ts
expect(html).not.toContain("Session capture");
expect(html).not.toContain("Live hook status");
expect(html).not.toContain("Install/repair hooks");
expect(html).not.toContain("Test hooks");
expect(html).not.toContain("Uninstall hooks");
expect(html).toContain("Onboarding");
expect(html).toContain("Run onboarding again");
```

- [ ] **Step 2: Run focused failing tests**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx src/ui/__tests__/operationsPanel.test.tsx
```

Expected: FAIL until `OperationsPanel` removes `HooksSettings`.

- [ ] **Step 3: Remove Settings hook card**

In `src/ui/OperationsPanel.tsx`:

- Remove `HooksSettings` import.
- Remove `<HooksSettings ... />` from the session column.
- Keep `<PreferencesSettings ... />`.
- Add `<OnboardingSettings ... />`.

Delete `src/ui/settings/HooksSettings.tsx` after confirming no imports remain:

```bash
rg "HooksSettings" src
```

Expected before delete: only `OperationsPanel.tsx` and tests. Expected after delete and edit: no output.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- --run src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx src/ui/__tests__/operationsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/OperationsPanel.tsx src/ui/settings/OnboardingSettings.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/settings/__tests__/SettingsOperationalStates.test.tsx src/ui/__tests__/operationsPanel.test.tsx
git rm src/ui/settings/HooksSettings.tsx
git commit -m "refactor: move hook ownership out of settings"
```

---

### Task 11: Visual QA And Browser Verification

**Files:**

- Modify CSS only if verification finds overlap or wrapping problems.

- [ ] **Step 1: Run build and unit checks before browser QA**

Run:

```bash
npm run typecheck
npm test -- --run
npm run build
npm run check:surface-contract
npm run verify:no-citations
```

Expected: PASS.

- [ ] **Step 2: Start a non-5173 dev UI for browser QA**

Run:

```bash
MASTHEAD_UI_PORT=5180 npm run dev
```

Use the printed URL. Do not start a browser-only Vite server on port `5173`.

- [ ] **Step 3: Inspect Sources at desktop width**

Use the in-app Browser plugin at the printed URL. Verify:

- Sources shows harness cards.
- Codex card opens detail on click and keyboard Enter.
- Detail modal shows overview, live capture, history import, transcript policy, Dossier enrichment, diagnostics, and source locations.
- Hook controls are present for Codex only.
- Long paths and hook commands wrap without overflowing.
- No card contains another card.

- [ ] **Step 4: Inspect onboarding at desktop width**

Clear the onboarding dismissal in dev tools or from app state:

```js
localStorage.removeItem("masthead:onboarding:dismissed:v1")
```

Verify:

- Full-window onboarding blocks the app.
- Skip setup is subtle and visible.
- Detected importable sources are selected by default.
- Metadata only is selected.
- Transcript copy says lazy Dossier hydration.
- Enrichment provider controls are the same provider controls used in Settings.
- Running setup shows logs.
- A failed step appears in the needs-attention report while later steps can still succeed.

- [ ] **Step 5: Inspect Settings**

Verify:

- Settings no longer shows hook install/test/uninstall controls.
- Settings shows Run onboarding again.
- Clicking Run onboarding again opens the full-window wizard.

- [ ] **Step 6: Inspect responsive widths**

Use browser widths:

```text
1440 x 900
1024 x 768
390 x 844
```

Verify:

- Modal content scrolls inside the modal, not behind it.
- Buttons do not overflow.
- Setup logs remain readable.
- Harness card metrics do not overlap.

- [ ] **Step 7: Stop the dev server**

Stop the `npm run dev` session cleanly with Ctrl-C and confirm no required session remains running.

- [ ] **Step 8: Commit CSS fixes if any**

```bash
git add src/styles/sources.css src/styles/settings.css src/styles/masthead.css
git commit -m "fix: polish sources onboarding layout"
```

Only commit if CSS changes were needed.

---

### Task 12: Final Verification Gate

**Files:** No source edits unless verification fails.

- [ ] **Step 1: Run full repo verification**

Run:

```bash
npm run typecheck
npm test -- --run
npm run build
npm run build:desktop
npm run test:electron
npm run test:electron-security
npm run check:surface-contract
npm run check:product-contract
npm run verify:no-citations
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Run packaged smoke**

Run:

```bash
node scripts/masthead-electron-packaged-smoke.js ./out/Masthead-linux-x64/masthead
```

Expected: PASS.

- [ ] **Step 3: Verify git status**

Run:

```bash
git status --short
```

Expected: only intended tracked changes remain. Ignored build output under `out/`, `dist/`, or local browser companion folders should not be committed.

- [ ] **Step 4: Write closeout**

If implementation completes, write a concise GBrain session page under `sessions/2026/07/` with:

- Sources owns harness setup and hook controls.
- Onboarding and harness detail share setup controls.
- Onboarding defaults to metadata-only and Dossier-lazy transcript/enrichment.
- Dev app identity uses the dev-badged icon.

- [ ] **Step 5: Final commit if needed**

If the previous tasks were not committed individually, make one final commit:

```bash
git add src public scripts docs
git commit -m "feat: add sources onboarding and harness setup"
```

## Self-Review

Spec coverage:

- Dev app identity is covered in Task 1.
- Sources-owned hook controls are covered in Tasks 3, 4, and 10.
- Clickable harness cards and rich detail modal are covered in Tasks 4 and 9.
- Same options in onboarding and detail are covered in Tasks 5, 6, 7, and 9.
- First-run full-window onboarding, skip, dismissal, and rerun are covered in Task 8.
- Metadata-only defaults and no bulk transcript/enrichment are covered in Tasks 6 and 7.
- Lazy transcript hydration is preserved and verified through existing progressive import tests in Task 12.
- Partial setup success with a needs-attention report is covered in Task 6.

Placeholder scan:

- No `TBD` markers.
- No deferred behavior is left unnamed.
- Every new file has a concrete responsibility.

Type consistency:

- Hook action type is consistently `"install" | "test" | "uninstall"` in UI and existing daemon client.
- Setup plan live capture actions allow `"leave"` for UI plans but only call hook APIs for install/test/uninstall.
- Provider settings reuse `SettingsStateDto["llm"]`, `SettingsStateDto["enrichment"]`, and `UpdateLlmProviderSettingsInput`.
