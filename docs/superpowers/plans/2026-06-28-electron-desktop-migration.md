# Electron Desktop Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Masthead's Tauri/WebKit desktop shell with an Electron/Chromium desktop shell while preserving the existing React/Vite UI, local daemon, MCP access, data ownership model, app-menu workflow, tray behavior, and release gates.

**Architecture:** Build Electron side-by-side with Tauri first, prove parity, then switch desktop defaults and remove Tauri. The renderer remains an unprivileged React/Vite web app; Electron main owns windows, tray, OS actions, packaging, and daemon process lifecycle; a preload script exposes a narrow typed bridge.

**Tech Stack:** Electron 42.5.0, Electron Forge 7.11.2, React 19.2.7, Vite 8.0.16, TypeScript 5.9.3, Node 24.15+, Masthead daemon compiled through `tsconfig.daemon.json`.

---

## Plan Optimization Rubric

Score target: 95/100 or higher before execution. The plan is optimized for correctness, test depth, rollback safety, and preserving Masthead's local-first product contract.

| Criterion | Weight | High-quality bar |
| --- | ---: | --- |
| Migration completeness | 18 | Every Tauri responsibility has a named Electron replacement or removal decision. |
| Security and privilege boundaries | 16 | Renderer has no Node/Electron access beyond a typed preload bridge; IPC sender and payload validation are tested. |
| Test coverage depth | 22 | Unit, integration, smoke, packaged-app, performance, CI, and manual UI checks are all explicit with commands and pass/fail criteria. |
| Sequencing and rollback safety | 14 | Side-by-side migration remains reversible until Electron passes objective gates; deletion of Tauri is late. |
| Packaging and distribution realism | 10 | Dev, packaged Linux, resources, MCP launch config, fuses, and app-menu launch are verified. |
| Product invariant preservation | 10 | Canonical daemon database, read-only MCP, browser dev, local-first data ownership, and design language are preserved. |
| Developer ergonomics | 6 | Scripts and launchers keep Tyler's no-terminal desktop workflow intact. |
| Documentation and handoff quality | 4 | Docs, PR template, issue template, release gates, and closeout state are updated. |

Optimization score trajectory:

- Initial plan: 84/100. Strong coverage, but testing was spread across tasks and missing baseline, CI, rollback, and negative-path detail.
- Round 1: 92/100. Added baseline capture, a layered testing strategy, and stronger smoke/performance criteria.
- Round 2: 96/100. Added CI/release gates, packaged smoke, explicit rollback blockers, and removal gates for Tauri.
- Round 3: 96/100. Plateau reached; further changes would mostly reformat instead of improving execution safety.

## Evidence Consulted

Official Electron and Forge docs:

- Electron process model: main process owns app lifecycle/window creation; renderers load web pages in separate processes. <https://www.electronjs.org/docs/latest/tutorial/process-model>
- Electron preload scripts: preload runs before the page and is the right bridge between renderer and privileged APIs. <https://www.electronjs.org/docs/latest/tutorial/tutorial-preload>
- Electron IPC: use `ipcMain.handle` with `ipcRenderer.invoke` for renderer-to-main calls that return results. <https://www.electronjs.org/docs/latest/tutorial/ipc>
- Electron context isolation: keep isolation enabled and expose APIs through `contextBridge`. <https://www.electronjs.org/docs/latest/tutorial/context-isolation>
- Electron security checklist: keep Node integration off, enable context isolation and sandboxing, define CSP, restrict navigation/new windows, validate IPC senders, avoid `file://`, use current Electron. <https://www.electronjs.org/docs/latest/tutorial/security>
- Electron `BrowserWindow` and `WebPreferences`: `nodeIntegration` defaults false, `sandbox` defaults true since Electron 20, preload must be an absolute path. <https://www.electronjs.org/docs/latest/api/browser-window>
- Electron app lifecycle: `app.whenReady()`, `window-all-closed`, `before-quit`, and `will-quit` control startup/shutdown. <https://www.electronjs.org/docs/latest/api/app>
- Electron tray: tray must be created after `ready`, retained globally, and can own the app's context menu. <https://www.electronjs.org/docs/latest/tutorial/tray>
- Electron custom protocol: register privileged schemes before `ready`; standard schemes resolve relative resources correctly. <https://www.electronjs.org/docs/latest/api/protocol>
- Electron GPU status: `app.getGPUFeatureStatus()` reports Chromium GPU feature status after `gpu-info-update`. <https://www.electronjs.org/docs/latest/api/app>
- Electron Forge packaging: Electron recommends Forge for packaging/distribution; Forge `make` packages then creates platform artifacts. <https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging>
- Electron Forge Vite plugin: official Vite plugin builds main, preload, and renderer entries, but is marked experimental as of Forge 7.5.0. <https://www.electronforge.io/config/plugins/vite>
- Electron Forge makers: makers generate platform artifacts; deb and rpm makers have Linux host package requirements. <https://www.electronforge.io/config/makers>
- Electron Forge fuses plugin: package-time fuses can disable Electron runtime features such as `RunAsNode`. <https://www.electronforge.io/config/plugins/fuses>

Local project files:

- `package.json`: current desktop scripts are `dev:desktop` -> `tauri dev` and `build:desktop` -> `tauri build`; current Tauri deps are `@tauri-apps/api` and `@tauri-apps/cli`.
- `src-tauri/tauri.conf.json`: Tauri opens `http://localhost:5173`, bundles `resources/daemon/**/*`, and uses `src-tauri/resources/daemon`.
- `src-tauri/src/lib.rs`: Tauri owns tray/menu and command registration.
- `src-tauri/src/connector.rs`: Tauri starts the daemon, probes `/health`, validates data-directory ownership, and builds MCP launch config.
- `src-tauri/src/system_actions.rs`: Tauri opens a Masthead-owned data directory through platform-specific commands.
- `src-tauri/src/native_store.rs`: Tauri exposes a legacy SQLite record store.
- `src/app/connectorClient.ts`, `src/app/nativeStoreClient.ts`, and `src/ui/OperationsPanel.tsx`: renderer imports Tauri APIs directly today.
- `src/daemon/config.ts` and `src/core/worktreeConnector.ts`: daemon CORS currently allows Vite and Tauri origins.
- `scripts/masthead-live-dev.js`: harness-neutral dev launcher already starts daemon, bridge, and Vite correctly for browser testing.
- `scripts/prepare-daemon-resources.js`: current packaging copies Node and `dist/daemon` into Tauri resources.
- `design.md` and `prd.md`: Electron migration must preserve Masthead as a local-first session data layer and dense developer console, not reframe it as a monitoring dashboard.

## Migration Decisions

1. Use Electron as a replacement desktop shell, not as a product rewrite.
2. Keep the React/Vite renderer and all surface UI intact unless a migration bug requires a small adaptation.
3. Keep the daemon as a separate Node process. This preserves failure isolation, keeps MCP launch config simple, and avoids making the renderer or Electron main process own canonical session data.
4. Continue bundling a Node runtime for packaged daemon and MCP entrypoints. This lets packaged Masthead expose an external MCP command without depending on `ELECTRON_RUN_AS_NODE`.
5. Use Electron Forge for initial packaging because Electron's official docs recommend Forge. Use `@electron-forge/plugin-vite` for side-by-side dev/build if it works cleanly with this repo's ESM setup; the fallback is a custom script that runs Vite plus Electron directly.
6. Use a custom `masthead://app` protocol for packaged renderer content. Dev still loads the Vite server from `http://127.0.0.1:5173`.
7. Do not port the Tauri legacy native SQLite store into Electron. The canonical daemon database is now Masthead's source of truth; renderer fallback can remain `localStorage` for no-daemon browser mode.
8. Keep Tauri until Electron passes acceptance gates. Remove Tauri only after Electron is the default desktop path and existing browser/dev workflows still pass.

## Target File Structure

Create:

- `src/electron/main.ts`: Electron app entrypoint, lifecycle, single-instance lock, window, tray, protocol, security, daemon startup.
- `src/electron/preload.ts`: `contextBridge` exposure for a minimal `window.mastheadDesktop` API.
- `src/electron/channels.ts`: string constants and DTO types for Electron IPC.
- `src/electron/ipc.ts`: IPC registration, sender validation, and handler wiring.
- `src/electron/window.ts`: secure `BrowserWindow` construction and dev/prod URL loading.
- `src/electron/protocol.ts`: privileged `masthead://app` scheme registration and static file serving.
- `src/electron/tray.ts`: tray icon, show, reconnect, open data directory, and quit actions.
- `src/electron/daemonLauncher.ts`: daemon launch target resolution, health probe, port fallback, child cleanup.
- `src/electron/pathPolicy.ts`: Masthead-owned data-directory validation and resource path helpers.
- `src/electron/gpuDiagnostics.ts`: GPU status collection for smoke/performance verification.
- `src/electron/__tests__/pathPolicy.test.ts`: data-directory and resource-path tests.
- `src/electron/__tests__/daemonLauncher.test.ts`: launch target and health parser tests.
- `src/electron/__tests__/ipcSecurity.test.ts`: sender validation and channel exposure tests.
- `src/electron/__tests__/windowSecurity.test.ts`: `BrowserWindow` security preferences and navigation denial tests.
- `src/electron/__tests__/protocol.test.ts`: custom protocol path traversal, fallback, and asset-serving tests.
- `src/electron/__tests__/tray.test.ts`: tray menu template and quit/show/open-directory action tests.
- `src/app/desktopBridge.ts`: browser-safe wrapper that detects Electron, Tauri during transition, or plain browser mode.
- `forge.config.ts`: Electron Forge config, makers, fuses, resources, icons, package hooks.
- `vite.main.config.ts`: Vite config for Electron main bundle.
- `vite.preload.config.ts`: Vite config for Electron preload bundle.
- `vite.renderer.config.ts`: Vite renderer config adapted from current `vite.config.ts`.
- `scripts/prepare-electron-resources.js`: copies Node runtime and `dist/daemon` into Electron resource staging.
- `scripts/masthead-electron-smoke.js`: launches Electron in smoke mode and verifies window, daemon, IPC, preload bridge, renderer security, GPU diagnostics, and hover latency.
- `scripts/masthead-electron-packaged-smoke.js`: launches the packaged Electron binary in smoke mode and verifies packaged daemon/MCP resources.
- `scripts/masthead-electron-security-check.js`: scans built Electron artifacts for insecure renderer settings and forbidden bridge exposure.
- `scripts/install-electron-dev-launcher.js`: installs or updates the local app-menu shortcut for Electron dev.

Modify:

- `package.json`: add Electron dependencies and scripts; keep Tauri scripts until Task 12.
- `package-lock.json`: dependency lock update.
- `tsconfig.json`: include Electron config and globals.
- `vite.config.ts`: either split into renderer config or re-export shared config.
- `src/vite-env.d.ts`: add Forge Vite globals and `window.mastheadDesktop` typing reference.
- `src/app/connectorClient.ts`: prefer `window.mastheadDesktop.startLiveConnector()`.
- `src/app/nativeStoreClient.ts`: remove direct Tauri import; use desktop bridge or browser fallback.
- `src/ui/OperationsPanel.tsx`: remove direct Tauri import; use desktop bridge for opening data directory.
- `src/daemon/config.ts`: add Electron custom-protocol and dev origins.
- `src/core/worktreeConnector.ts`: add Electron renderer origins to live-dev allowed origins.
- `scripts/sync-version.js`: keep package version as source of truth and stop writing Cargo/Tauri after Tauri removal.
- `.gitignore`: replace Tauri resource ignores with Electron Forge output/resource ignores.
- `.github/workflows/ci.yml`: replace Tauri CI setup with Electron unit, smoke, and packaged checks.
- `.github/workflows/release-smoke.yml`: run Electron packaged smoke before release artifacts are accepted.
- `.github/pull_request_template.md`: replace Tauri cargo check with Electron smoke/package checks.
- `README.md`, `docs/release-gates.md`, `docs/hook-onboarding.md`, `.github/ISSUE_TEMPLATE/*.yml`: update install mode and troubleshooting language.

Delete in final cleanup only:

- `src-tauri/`
- `@tauri-apps/api`
- `@tauri-apps/cli`
- Tauri-only launcher language in docs and issue templates.

## Global Acceptance Gates

Run these at the end of the side-by-side phase and again after Tauri removal:

```bash
npm run verify:no-citations
npm run check:product-contract
npm run check:surface-contract
npm run typecheck
npm test -- --run
npm run build
npm run smoke
npm run test:electron
npm run test:electron-security
npm run smoke:electron
npm run smoke:electron:packaged
npm run build:desktop
```

Manual acceptance:

- `npm run dev` still serves the browser workflow and shows live sessions.
- `npm run dev:electron` opens the Electron app with HMR, live sessions, Logbook, Sources, Agent Access, Settings, and no `No live connection` banner when the daemon is healthy.
- The app-menu shortcut opens Electron dev without a terminal.
- Hovering session cards in Electron follows the mouse immediately and does not lag one or two cards behind.
- Settings can open the Masthead data directory.
- Agent Access shows a valid MCP launch config and the MCP test passes.
- Packaged Linux build starts, creates a tray icon, starts or reuses the daemon, and exposes the same database identity as the dev build.
- Electron smoke reports GPU compositing state through `app.getGPUFeatureStatus()` and does not call `app.disableHardwareAcceleration()`.
- Electron smoke confirms the renderer cannot access `process`, `require`, `ipcRenderer`, or arbitrary channel invocation.
- Performance smoke uses a fixture board with at least 12 session cards and records hover round-trip latency; median must be under 16ms and p95 under 50ms on Tyler's machine.
- Packaged smoke confirms `resources/daemon/node`, `resources/daemon/dist/src/daemon/main.js`, and `resources/daemon/dist/src/mcp/server.js` exist and are executable/readable from the installed app context.
- No Tauri deletion is allowed until all Electron side-by-side checks pass locally and in CI.

## Testing Strategy

This migration needs testing at seven layers. Each layer has a different job; do not substitute one for another.

| Layer | Purpose | Required proof |
| --- | --- | --- |
| Baseline | Prove current browser/Tauri behavior before changing shell code. | `npm run verify`, Tauri cargo tests, current daemon `/health`, current browser render, and Tauri performance notes recorded in the baseline file. |
| Unit | Prove pure policy and parsing behavior. | Vitest coverage for bridge detection, sender validation, path policy, protocol path resolution, health parsing, launch target resolution, tray template, and MCP env overrides. |
| Integration | Prove renderer-to-main-to-daemon behavior without packaging. | `npm run dev:electron` and `npm run smoke:electron` start Electron, expose only `window.mastheadDesktop`, start/reuse the daemon, and load app surfaces. |
| Security | Prove Electron does not widen privileged access. | Renderer has no Node globals, no raw IPC object, no `webview`, no remote navigation, no file protocol, and all IPC calls validate sender plus payload shape. |
| Packaged | Prove installed artifacts work outside the repo. | `npm run build:desktop` plus `npm run smoke:electron:packaged` against the generated binary. |
| Performance | Prove the WebKitGTK hover lag is gone. | Synthetic fixture board and live board hover latency meet median/p95 thresholds; GPU status is logged. |
| Regression | Prove Masthead product behavior stayed intact. | Existing `npm run verify`, endpoint matrix, live/import/MCP smoke tests, product contract, and surface contract all pass. |

Required test additions by area:

- Desktop bridge: Electron path, Tauri transition path, browser fallback path, missing bridge errors, and storage fallback.
- Preload and IPC: allowed sender, denied sender, bad payloads, no direct `ipcRenderer` leakage, no arbitrary channel forwarding.
- Window security: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `webviewTag: false`, denied `window.open`, denied remote navigation.
- Protocol: path traversal rejection, deep-link fallback to `index.html`, asset resolution, unknown asset behavior, and no `file://` renderer load.
- Daemon launcher: compatible daemon reuse, incompatible daemon port fallback, missing daemon entry, data-directory mismatch, child env shape, startup timeout, and child cleanup on quit.
- MCP: packaged command override, packaged entry override, active database match, missing packaged entry diagnostics, and successful stdio test.
- Tray/app menu: tray object retained, menu labels correct, show focuses existing window, open data directory refuses unrelated paths, quit stops daemon.
- Packaged resources: Node runtime executable, daemon entry exists, MCP entry exists, app icon exists, generated artifacts not committed.
- CI: Linux headless Electron smoke via `xvfb-run`, package smoke, and release-smoke workflow without Tauri system dependencies after removal.

## Rollback And Hard Stop Rules

The side-by-side phase is intentionally reversible. Do not delete Tauri, change `dev:desktop` permanently, or merge to `main` while any hard stop is active.

Hard stops:

- `npm run verify` fails on changes not directly explained and fixed by the migration.
- Electron renderer exposes `process`, `require`, raw `ipcRenderer`, arbitrary IPC channel invocation, `webview`, or `file://` loading.
- Electron cannot start or reuse a compatible Masthead daemon with the correct data directory.
- MCP launch config points at a missing command, wrong database, or a repo-only script in a packaged build.
- Packaged app cannot run `scripts/masthead-electron-packaged-smoke.js`.
- Hover latency in Electron is not materially better than the Tauri baseline, or the smoke thresholds are exceeded on a fixture board with at least 12 cards.
- Browser `npm run dev` workflow regresses.
- CI still depends on Tauri after Task 12.

Rollback actions before Task 12:

```bash
git revert <electron-migration-commits>
npm install
npm run verify
cargo test --manifest-path src-tauri/Cargo.toml
```

Rollback actions after Task 12, if Tauri has been deleted but the branch has not merged:

```bash
git revert <tauri-removal-commit>
npm install
npm run verify
cargo test --manifest-path src-tauri/Cargo.toml
```

Do not use `git reset --hard` for rollback unless Tyler explicitly requests it.

## Task 0: Capture Baseline And Test Contract

**Files:**

- Create: `docs/superpowers/plans/2026-06-28-electron-baseline-results.md`
- No source code edits.

- [ ] **Step 1: Confirm starting branch state**

Run:

```bash
git status --short --branch
git log -1 --oneline
git worktree list
```

Expected:

```text
Current working tree is clean except this plan file if it has not been committed yet.
Branch intent is clear before implementation starts.
No unrelated dirty worktree is used as evidence for Electron behavior.
```

- [ ] **Step 2: Run current full gates before migration**

Run:

```bash
npm run verify
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. If either command fails on unmodified `main`, stop and fix or document the pre-existing failure before changing desktop architecture.

- [ ] **Step 3: Capture current daemon identity**

Run:

```bash
npm run build:daemon
npm run dev
```

In a second shell:

```bash
curl -fsS http://127.0.0.1:17373/health | node -e 'let body=""; process.stdin.on("data", c => body += c); process.stdin.on("end", () => { const h = JSON.parse(body); console.log(JSON.stringify({ product: h.product, apiVersion: h.apiVersion, capabilities: h.capabilities, data: h.data, runtime: h.runtime }, null, 2)); });'
```

Expected:

- `product` is `masthead`.
- `apiVersion` is `1`.
- Capabilities include `live_projection`, `canonical_sessions`, `logbook_search`, `source_discovery`, `adapter_inventory`, `mcp_status`, and `settings`.
- `data.databasePath` and `data.dataDirectory` point at a Masthead data directory.

- [ ] **Step 4: Capture browser baseline**

Open the `npm run dev` URL in the in-app Browser using the `iab` backend. Verify desktop width, tablet width, and narrow mobile width:

- Now loads without `No live connection` when the daemon is healthy.
- Logbook search loads.
- Sources shows adapters and import jobs.
- Agent Access loads MCP status and tools.
- Settings loads storage state and hook state.

Write the observed URL, viewport checks, and any pre-existing visual issues into `docs/superpowers/plans/2026-06-28-electron-baseline-results.md`.

- [ ] **Step 5: Capture Tauri performance baseline**

Run:

```bash
npm run dev:desktop:tauri
```

Manually test the session card hover path that motivated the migration. Record:

- Whether hover highlight lags behind the cursor.
- Approximate severity in plain language.
- GPU or WebKit environment overrides in effect.
- Whether production Tauri and dev Tauri are known to behave similarly.

Write the result into `docs/superpowers/plans/2026-06-28-electron-baseline-results.md`.

- [ ] **Step 6: Commit baseline artifact**

```bash
git add docs/superpowers/plans/2026-06-28-electron-baseline-results.md
git commit -m "docs: capture electron migration baseline"
```

## Task 1: Add Electron Dependencies And Side-By-Side Scripts

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `forge.config.ts`
- Create: `vite.main.config.ts`
- Create: `vite.preload.config.ts`
- Create: `vite.renderer.config.ts`

- [ ] **Step 1: Install exact desktop dependencies**

Run:

```bash
npm install --save-dev electron@42.5.0 @electron-forge/cli@7.11.2 @electron-forge/plugin-vite@7.11.2 @electron-forge/plugin-fuses@7.11.2 @electron/fuses@1.8.0 @electron-forge/maker-deb@7.11.2 @electron-forge/maker-rpm@7.11.2 @electron-forge/maker-zip@7.11.2
```

Expected:

```text
package.json and package-lock.json include Electron and Forge packages.
```

Note: `@electron-forge/plugin-fuses@7.11.2` declares `@electron/fuses@^1.0.0` as a peer dependency, so the implementation uses `@electron/fuses@1.8.0` rather than the latest 2.x line.

- [ ] **Step 2: Add side-by-side scripts**

Modify `package.json` scripts so these entries exist while existing Tauri scripts remain:

```json
{
  "main": ".vite/build/main.js",
  "scripts": {
    "dev": "npm run version:sync && npm run build:daemon && node scripts/masthead-live-dev.js",
    "dev:desktop": "npm run dev:electron",
    "dev:desktop:tauri": "npm run version:sync && tauri dev",
    "dev:electron": "npm run version:sync && npm run build:daemon && electron-forge start",
    "build": "npm run version:sync && tsc --noEmit && vite build && npm run build:daemon",
    "build:desktop": "npm run build:electron",
    "build:desktop:tauri": "npm run version:sync && tauri build",
    "build:electron": "npm run version:sync && npm run build && npm run prepare:electron-resources && electron-forge make",
    "package:electron": "npm run version:sync && npm run build && npm run prepare:electron-resources && electron-forge package",
    "prepare:electron-resources": "node scripts/prepare-electron-resources.js",
    "test:electron": "vitest --run src/electron/**/*.test.ts src/app/__tests__/connectorClient.test.ts src/app/__tests__/nativeStoreClient.test.ts src/mcp/__tests__/canonicalDatabaseLaunch.test.ts src/daemon/__tests__/mcpStatusApi.test.ts",
    "test:electron-security": "vitest --run src/electron/__tests__/ipcSecurity.test.ts src/electron/__tests__/windowSecurity.test.ts src/electron/__tests__/protocol.test.ts && node scripts/masthead-electron-security-check.js",
    "smoke:electron": "npm run build:daemon && node scripts/masthead-electron-smoke.js",
    "smoke:electron:packaged": "npm run build:desktop && node scripts/masthead-electron-packaged-smoke.js"
  }
}
```

Keep the rest of the existing scripts unchanged.

- [ ] **Step 3: Add initial Forge config**

Create `forge.config.ts`:

```ts
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: "ai.animas.masthead",
    appCategoryType: "public.app-category.developer-tools",
    executableName: "masthead",
    icon: "public/assets/masthead-logo-sail",
    name: "Masthead",
    extraResource: ["electron-resources/daemon"]
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux"]
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          categories: ["Development"],
          homepage: "https://usemasthead.com",
          maintainer: "Tyler Mayberry"
        }
      }
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          categories: ["Development"],
          homepage: "https://usemasthead.com"
        }
      }
    }
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          { entry: "src/electron/main.ts", config: "vite.main.config.ts" },
          { entry: "src/electron/preload.ts", config: "vite.preload.config.ts" }
        ],
        renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }]
      }
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

export default config;
```

- [ ] **Step 4: Add Vite configs**

Create `vite.renderer.config.ts` by moving the current `vite.config.ts` app build settings into a reusable renderer config. Preserve `mastheadConnectorManager()` in the renderer config until the browser dev workflow is moved to a shared plugin.

Create `vite.main.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      external: ["electron"]
    }
  },
  resolve: {
    conditions: ["node"]
  }
});
```

Create `vite.preload.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      external: ["electron"]
    }
  },
  resolve: {
    conditions: ["node"]
  }
});
```

- [ ] **Step 5: Verify dependency and config parse**

Run:

```bash
npm run typecheck
npm run test:electron
```

Expected: TypeScript and tests may fail because Electron source files do not exist yet. The expected failures are only missing `src/electron/main.ts`, `src/electron/preload.ts`, or missing Electron test files that are created in subsequent tasks. Any package JSON, Forge config, or existing app type error must be fixed before continuing.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json forge.config.ts vite.main.config.ts vite.preload.config.ts vite.renderer.config.ts
git commit -m "chore: add electron desktop scaffold"
```

## Task 2: Create A Platform-Neutral Desktop Bridge

**Files:**

- Create: `src/app/desktopBridge.ts`
- Modify: `src/app/connectorClient.ts`
- Modify: `src/app/nativeStoreClient.ts`
- Modify: `src/ui/OperationsPanel.tsx`
- Modify: `src/vite-env.d.ts`
- Test: `src/app/__tests__/connectorClient.test.ts`
- Test: `src/app/__tests__/nativeStoreClient.test.ts`

- [ ] **Step 1: Create bridge types**

Create `src/app/desktopBridge.ts`:

```ts
import type { PruneLocalDataResult, RetentionPolicy } from "../core/retention";
import type { StoreRecord } from "../core/store";
import type { ClearLocalDataResult } from "./nativeStoreClient";
import type { ConnectorStartResult } from "./connectorClient";

export type DesktopRuntimeKind = "electron" | "tauri" | "browser";

export type MastheadDesktopBridge = {
  runtime: {
    kind: DesktopRuntimeKind;
    version?: string;
  };
  startLiveConnector?: () => Promise<ConnectorStartResult>;
  openDataDirectory?: (path: string) => Promise<void>;
  storage?: {
    appendLocalRecords(records: StoreRecord[]): Promise<void>;
    clearLocalData(): Promise<ClearLocalDataResult>;
    exportLocalData(exportedAtIso: string): Promise<string>;
    pruneLocalData(policy: RetentionPolicy): Promise<PruneLocalDataResult>;
    readLocalRecords(): Promise<StoreRecord[]>;
  };
};

declare global {
  interface Window {
    mastheadDesktop?: MastheadDesktopBridge;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function getDesktopBridge(): MastheadDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.mastheadDesktop;
}

export function canUseTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
```

- [ ] **Step 2: Update connector client to prefer Electron bridge**

Modify `src/app/connectorClient.ts` so it imports `getDesktopBridge` and `canUseTauri` instead of defining `canUseTauri` locally:

```ts
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { canUseTauri, getDesktopBridge } from "./desktopBridge";
```

Update `startLiveConnector()`:

```ts
export async function startLiveConnector(invoke?: Invoke): Promise<ConnectorStartResult> {
  const bridge = getDesktopBridge();
  if (!invoke && bridge?.startLiveConnector) return bridge.startLiveConnector();

  if (!invoke && !canUseTauri()) {
    const devServerResult = await startViaDevServer();
    if (devServerResult) return devServerResult;

    return {
      ok: false,
      supported: false,
      command: LOCAL_CONNECTOR_COMMAND,
      message: "Run npm run dev from /home/tyler/Documents/Masthead, then choose Check again."
    };
  }

  if (invoke) return invoke("start_live_connector_command");
  return tauriInvoke<ConnectorStartResult>("start_live_connector_command");
}
```

Remove the local `canUseTauri()` function from `connectorClient.ts`.

- [ ] **Step 3: Update native store client to remove hard Tauri dependency**

Modify `src/app/nativeStoreClient.ts` so it imports `canUseTauri` and `getDesktopBridge` from `desktopBridge`.

Each function should first check `getDesktopBridge()?.storage`, then Tauri, then browser fallback. Example for export:

```ts
export async function exportLocalData(exportedAt = new Date(), invoke?: Invoke): Promise<string> {
  const bridgeStorage = getDesktopBridge()?.storage;
  if (!invoke && bridgeStorage) return bridgeStorage.exportLocalData(exportedAt.toISOString());

  if (!invoke && !canUseTauri()) {
    return JSON.stringify({
      metadata: {
        format: "masthead.native-store.v1",
        schemaVersion: 1,
        exportedAt: exportedAt.toISOString(),
        recordCount: readBrowserRecords().length
      },
      records: readBrowserRecords()
    });
  }

  return (invoke ?? tauriInvoke)<string>("export_store_records_command", { exportedAt: exportedAt.toISOString() });
}
```

Apply the same ordering to `clearLocalData`, `pruneLocalData`, `readLocalRecords`, and `appendLocalRecords`.

- [ ] **Step 4: Update Settings open-directory action**

Modify `src/ui/OperationsPanel.tsx`:

```ts
import { getDesktopBridge } from "../app/desktopBridge";
```

Replace direct `tauriInvoke` usage:

```ts
const openDataDirectory = async () => {
  const dataDirectory = effectiveSettings?.storage.dataDirectory ?? effectiveSettings?.data.dataDirectory;
  if (!dataDirectory) return;
  try {
    const bridge = getDesktopBridge();
    if (!bridge?.openDataDirectory) throw new Error("Opening the data directory is available in the desktop app.");
    await bridge.openDataDirectory(dataDirectory);
    setSettingsError(undefined);
  } catch (error) {
    setSettingsError(error instanceof Error ? error.message : String(error));
  }
};
```

Remove `import { invoke as tauriInvoke } from "@tauri-apps/api/core";`.

- [ ] **Step 5: Add bridge tests**

Update `src/app/__tests__/connectorClient.test.ts` with an Electron bridge case:

```ts
test("uses Electron desktop bridge before Tauri or dev server fallback", async () => {
  window.mastheadDesktop = {
    runtime: { kind: "electron", version: "42.5.0" },
    startLiveConnector: async () => ({
      ok: true,
      started: true,
      baseUrl: "http://127.0.0.1:17373",
      command: "masthead daemon",
      health: { apiVersion: 1, databaseId: "db" },
      message: "Started local Masthead collector.",
      projectionUrl: "http://127.0.0.1:17373/projection"
    })
  };

  await expect(startLiveConnector()).resolves.toMatchObject({
    ok: true,
    started: true,
    baseUrl: "http://127.0.0.1:17373"
  });
});
```

Update `src/app/__tests__/nativeStoreClient.test.ts` with one bridge storage test:

```ts
test("exports through desktop bridge storage when available", async () => {
  window.mastheadDesktop = {
    runtime: { kind: "electron" },
    storage: {
      appendLocalRecords: async () => undefined,
      clearLocalData: async () => ({ removedRecords: 0, touchedExternalState: false }),
      exportLocalData: async (exportedAtIso) =>
        JSON.stringify({ metadata: { format: "masthead.native-store.v1", exportedAt: exportedAtIso, recordCount: 0 }, records: [] }),
      pruneLocalData: async () => ({ removedRecords: 0, removedRecordIds: [], removedByType: {}, retainedRecords: 0, touchedExternalState: false }),
      readLocalRecords: async () => []
    }
  };

  const exported = await exportLocalData(new Date("2026-06-28T12:00:00.000Z"));
  expect(exported).toContain("2026-06-28T12:00:00.000Z");
});
```

- [ ] **Step 6: Run focused tests**

```bash
npm test -- --run src/app/__tests__/connectorClient.test.ts src/app/__tests__/nativeStoreClient.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/desktopBridge.ts src/app/connectorClient.ts src/app/nativeStoreClient.ts src/ui/OperationsPanel.tsx src/vite-env.d.ts src/app/__tests__/connectorClient.test.ts src/app/__tests__/nativeStoreClient.test.ts
git commit -m "refactor: add desktop bridge abstraction"
```

## Task 3: Build The Secure Electron Shell

**Files:**

- Create: `src/electron/channels.ts`
- Create: `src/electron/preload.ts`
- Create: `src/electron/window.ts`
- Create: `src/electron/protocol.ts`
- Create: `src/electron/main.ts`
- Create: `src/electron/ipc.ts`
- Test: `src/electron/__tests__/ipcSecurity.test.ts`
- Test: `src/electron/__tests__/windowSecurity.test.ts`
- Test: `src/electron/__tests__/protocol.test.ts`

- [ ] **Step 1: Define IPC channels**

Create `src/electron/channels.ts`:

```ts
export const channels = {
  openDataDirectory: "masthead:open-data-directory",
  runtimeInfo: "masthead:runtime-info",
  startLiveConnector: "masthead:start-live-connector"
} as const;

export type ElectronIpcChannel = (typeof channels)[keyof typeof channels];
```

- [ ] **Step 2: Create preload bridge**

Create `src/electron/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import { channels } from "./channels";

const invoke = <T>(channel: string, args?: Record<string, unknown>): Promise<T> => ipcRenderer.invoke(channel, args) as Promise<T>;

contextBridge.exposeInMainWorld("mastheadDesktop", {
  runtime: {
    kind: "electron",
    version: process.versions.electron
  },
  openDataDirectory: (path: string) => invoke<void>(channels.openDataDirectory, { path }),
  startLiveConnector: () => invoke(channels.startLiveConnector)
});
```

Do not expose `ipcRenderer`, `process`, `require`, `shell`, or filesystem modules to the renderer.

- [ ] **Step 3: Register custom protocol**

Create `src/electron/protocol.ts`:

```ts
import { net, protocol } from "electron";
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

export const appProtocol = "masthead";
export const appOrigin = "masthead://app";

export function registerMastheadScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: appProtocol,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true
      }
    }
  ]);
}

export function handleMastheadProtocol(rendererDist: string): void {
  protocol.handle(appProtocol, (request) => {
    const url = new URL(request.url);
    const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const relativePath = decodeURIComponent(rawPath).replace(/^\/+/, "");
    const candidate = normalize(join(rendererDist, relativePath));
    const target = candidate.startsWith(normalize(rendererDist)) && existsSync(candidate) ? candidate : join(rendererDist, "index.html");
    return net.fetch(pathToFileURL(target).toString());
  });
}
```

- [ ] **Step 4: Create secure window**

Create `src/electron/window.ts`:

```ts
import { BrowserWindow } from "electron";
import { join } from "node:path";
import { appOrigin } from "./protocol";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Masthead",
    backgroundColor: "#031019",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      preload: join(__dirname, "preload.js"),
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedRendererUrl(url)) return;
    event.preventDefault();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadURL(`${appOrigin}/${MAIN_WINDOW_VITE_NAME}/index.html`);
  }

  return window;
}

function isAllowedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "masthead:" && url.host === "app") return true;
    if (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Register app lifecycle**

Create `src/electron/main.ts`:

```ts
import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";
import { registerIpcHandlers } from "./ipc";
import { registerMastheadScheme, handleMastheadProtocol } from "./protocol";
import { createMainWindow } from "./window";

registerMastheadScheme();

let mainWindow: BrowserWindow | undefined;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    handleMastheadProtocol(join(process.resourcesPath, "app", ".vite", "renderer"));
    registerIpcHandlers({ getMainWindow: () => mainWindow });
    installContentSecurityPolicy();
    mainWindow = createMainWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return;
    app.quit();
  });
}

function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self' masthead://app; script-src 'self' masthead://app; style-src 'self' masthead://app 'unsafe-inline'; img-src 'self' masthead://app data:; font-src 'self' masthead://app data:; connect-src 'self' masthead://app http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
        ]
      }
    });
  });
}
```

- [ ] **Step 6: Add temporary IPC handlers**

Create `src/electron/ipc.ts`:

```ts
import { BrowserWindow, ipcMain } from "electron";
import type { WebFrameMain } from "electron";
import { channels } from "./channels";

type IpcContext = {
  getMainWindow(): BrowserWindow | undefined;
};

export function registerIpcHandlers(_context: IpcContext): void {
  ipcMain.handle(channels.runtimeInfo, (event) => {
    validateIpcSender(event.senderFrame);
    return { kind: "electron", version: process.versions.electron };
  });

  ipcMain.handle(channels.startLiveConnector, (event) => {
    validateIpcSender(event.senderFrame);
    return {
      ok: false,
      supported: false,
      command: "masthead daemon",
      message: "Electron daemon launcher is not wired yet."
    };
  });

  ipcMain.handle(channels.openDataDirectory, (event) => {
    validateIpcSender(event.senderFrame);
    throw new Error("Electron open-data-directory is not wired yet.");
  });
}

export function validateIpcSender(frame: WebFrameMain | null): void {
  if (!frame) throw new Error("Missing IPC sender frame.");
  const url = new URL(frame.url);
  if (url.protocol === "masthead:" && url.host === "app") return;
  if (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) return;
  throw new Error(`Blocked IPC sender: ${frame.url}`);
}
```

- [ ] **Step 7: Add IPC sender tests**

Create `src/electron/__tests__/ipcSecurity.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { validateIpcSender } from "../ipc";

function frame(url: string) {
  return { url } as never;
}

describe("Electron IPC sender validation", () => {
  test("accepts Masthead app protocol", () => {
    expect(() => validateIpcSender(frame("masthead://app/index.html"))).not.toThrow();
  });

  test("accepts local Vite dev origins", () => {
    expect(() => validateIpcSender(frame("http://127.0.0.1:5173/"))).not.toThrow();
    expect(() => validateIpcSender(frame("http://localhost:5173/"))).not.toThrow();
  });

  test("rejects remote or file senders", () => {
    expect(() => validateIpcSender(frame("https://example.com"))).toThrow(/Blocked IPC sender/);
    expect(() => validateIpcSender(frame("file:///tmp/index.html"))).toThrow(/Blocked IPC sender/);
  });
});
```

- [ ] **Step 8: Add window security tests**

Create `src/electron/__tests__/windowSecurity.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mastheadWindowPreferences, isAllowedRendererUrl } from "../window";

describe("Electron BrowserWindow security contract", () => {
  test("keeps renderer unprivileged", () => {
    expect(mastheadWindowPreferences()).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    });
  });

  test("allows only app protocol and local dev origins", () => {
    expect(isAllowedRendererUrl("masthead://app/index.html")).toBe(true);
    expect(isAllowedRendererUrl("http://127.0.0.1:5173/")).toBe(true);
    expect(isAllowedRendererUrl("http://localhost:5173/")).toBe(true);
    expect(isAllowedRendererUrl("https://example.com/")).toBe(false);
    expect(isAllowedRendererUrl("file:///tmp/index.html")).toBe(false);
  });
});
```

To make this pass, expose testable pure helpers from `src/electron/window.ts`:

```ts
export function mastheadWindowPreferences(): Electron.BrowserWindowConstructorOptions["webPreferences"] {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    preload: join(__dirname, "preload.js"),
    sandbox: true,
    webSecurity: true,
    webviewTag: false
  };
}

export function isAllowedRendererUrl(value: string): boolean {
  // existing implementation
}
```

Use `webPreferences: mastheadWindowPreferences()` in `createMainWindow()`.

- [ ] **Step 9: Add protocol path tests**

Create `src/electron/__tests__/protocol.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { resolveProtocolPath } from "../protocol";

describe("Electron app protocol path resolution", () => {
  test("serves index for root and client-side routes", () => {
    expect(resolveProtocolPath("/tmp/dist", "masthead://app/")).toBe("/tmp/dist/index.html");
    expect(resolveProtocolPath("/tmp/dist", "masthead://app/logbook/session/123")).toBe("/tmp/dist/index.html");
  });

  test("serves known assets inside renderer dist", () => {
    expect(resolveProtocolPath("/tmp/dist", "masthead://app/assets/app.js", new Set(["/tmp/dist/assets/app.js"]))).toBe("/tmp/dist/assets/app.js");
  });

  test("rejects traversal outside renderer dist", () => {
    expect(resolveProtocolPath("/tmp/dist", "masthead://app/../secret.txt", new Set(["/tmp/secret.txt"]))).toBe("/tmp/dist/index.html");
  });
});
```

To make this pass, refactor `src/electron/protocol.ts` so `handleMastheadProtocol()` calls a pure helper:

```ts
export function resolveProtocolPath(rendererDist: string, requestUrl: string, existingPaths?: ReadonlySet<string>): string {
  const url = new URL(requestUrl);
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const relativePath = decodeURIComponent(rawPath).replace(/^\/+/, "");
  const candidate = normalize(join(rendererDist, relativePath));
  const normalizedRoot = normalize(rendererDist);
  const exists = existingPaths ? existingPaths.has(candidate) : existsSync(candidate);
  if (candidate.startsWith(normalizedRoot) && exists) return candidate;
  return join(rendererDist, "index.html");
}
```

- [ ] **Step 10: Run focused tests**

```bash
npm test -- --run src/electron/__tests__/ipcSecurity.test.ts src/electron/__tests__/windowSecurity.test.ts src/electron/__tests__/protocol.test.ts
```

Expected: PASS after test import issues are resolved.

- [ ] **Step 11: Commit**

```bash
git add src/electron/channels.ts src/electron/preload.ts src/electron/window.ts src/electron/protocol.ts src/electron/main.ts src/electron/ipc.ts src/electron/__tests__/ipcSecurity.test.ts src/electron/__tests__/windowSecurity.test.ts src/electron/__tests__/protocol.test.ts
git commit -m "feat: add secure electron shell"
```

## Task 4: Port Daemon Launch And Health Compatibility

**Files:**

- Create: `src/electron/daemonLauncher.ts`
- Create: `src/electron/pathPolicy.ts`
- Modify: `src/electron/ipc.ts`
- Test: `src/electron/__tests__/daemonLauncher.test.ts`
- Test: `src/electron/__tests__/pathPolicy.test.ts`

- [ ] **Step 1: Port path/resource policy**

Create `src/electron/pathPolicy.ts`:

```ts
import { app } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function appDataDirectory(): string {
  const directory = process.env.MASTHEAD_DATA_DIR || app.getPath("userData") || defaultMastheadDataDirectory();
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function defaultMastheadDataDirectory(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Masthead Dev");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Masthead Dev");
  return join(homedir(), ".local", "share", "masthead-dev");
}

export function daemonResourceRoot(): string {
  if (process.env.MASTHEAD_DAEMON_RESOURCE_ROOT) return resolve(process.env.MASTHEAD_DAEMON_RESOURCE_ROOT);
  if (app.isPackaged) return join(process.resourcesPath, "daemon");
  return resolve(".");
}

export function bundledNodePath(resourceRoot = daemonResourceRoot()): string {
  if (process.env.MASTHEAD_NODE_PATH) return process.env.MASTHEAD_NODE_PATH;
  if (!app.isPackaged) return process.execPath.includes("electron") ? "node" : process.execPath;
  return join(resourceRoot, process.platform === "win32" ? "node.exe" : "node");
}

export function daemonEntryPath(resourceRoot = daemonResourceRoot()): string {
  if (process.env.MASTHEAD_DAEMON_ENTRY) return resolve(process.env.MASTHEAD_DAEMON_ENTRY);
  if (app.isPackaged) return join(resourceRoot, "dist", "src", "daemon", "main.js");
  return resolve("dist/daemon/src/daemon/main.js");
}

export function mcpEntryPath(resourceRoot = daemonResourceRoot()): string {
  if (process.env.MASTHEAD_MCP_ENTRY) return resolve(process.env.MASTHEAD_MCP_ENTRY);
  if (app.isPackaged) return join(resourceRoot, "dist", "src", "mcp", "server.js");
  return resolve("dist/daemon/src/mcp/server.js");
}

export function isMastheadOwnedDirectory(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .some((part) => part.toLowerCase().includes("masthead"));
}

export function assertMastheadDirectory(path: string): void {
  if (!existsSync(path)) throw new Error(`Data directory does not exist: ${path}`);
  if (!isMastheadOwnedDirectory(path)) throw new Error(`Refusing to open a non-Masthead data directory: ${path}`);
}
```

- [ ] **Step 2: Add path policy tests**

Create `src/electron/__tests__/pathPolicy.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { isMastheadOwnedDirectory } from "../pathPolicy";

describe("Electron path policy", () => {
  test("accepts Masthead-owned data paths", () => {
    expect(isMastheadOwnedDirectory("/home/tyler/.local/share/masthead-dev")).toBe(true);
    expect(isMastheadOwnedDirectory("/tmp/masthead-doctor-acceptance")).toBe(true);
  });

  test("rejects unrelated directories", () => {
    expect(isMastheadOwnedDirectory("/home/tyler/Documents")).toBe(false);
    expect(isMastheadOwnedDirectory("/tmp/project")).toBe(false);
  });
});
```

- [ ] **Step 3: Create daemon launcher**

Create `src/electron/daemonLauncher.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { appDataDirectory, bundledNodePath, daemonEntryPath, mcpEntryPath } from "./pathPolicy";

const DEFAULT_CONNECTOR_PORT = 17373;

export type MastheadHealthSummary = {
  apiVersion?: number;
  buildSha?: string;
  databaseId?: string;
  databasePath?: string;
  dataDirectory?: string;
  mode?: string;
};

export type StartLiveConnectorResult =
  | {
      ok: true;
      started: boolean;
      baseUrl: string;
      command: string;
      health: MastheadHealthSummary;
      message: string;
      projectionUrl: string;
    }
  | {
      ok: false;
      supported: false;
      command: string;
      message: string;
    };

let daemonProcess: ChildProcess | undefined;

export async function startLiveConnector(): Promise<StartLiveConnectorResult> {
  const dataDirectory = appDataDirectory();
  const requestedPort = parsePort(process.env.MASTHEAD_PORT, DEFAULT_CONNECTOR_PORT);
  const requestedBaseUrl = connectorBaseUrl(requestedPort);
  const requestedProbe = await probeCollector(requestedPort, dataDirectory);

  if (requestedProbe.state === "compatible") {
    return connectorResult(false, requestedBaseUrl, "Local Masthead collector is already running.", requestedProbe.health);
  }

  const port = requestedProbe.state === "incompatible" ? await findAvailablePort(requestedPort + 1) : requestedPort;
  const baseUrl = connectorBaseUrl(port);

  if (daemonProcess && daemonProcess.exitCode === null) {
    const health = await waitForCompatibleCollector(port, dataDirectory);
    return connectorResult(false, baseUrl, "Local Masthead collector is already starting.", health);
  }

  const entryPath = daemonEntryPath();
  const nodePath = bundledNodePath();
  if (!existsSync(entryPath)) {
    return {
      ok: false,
      supported: false,
      command: "masthead daemon",
      message: `Masthead daemon entry not found at ${entryPath}`
    };
  }

  daemonProcess = spawn(nodePath, [entryPath], {
    cwd: dataDirectory,
    env: {
      ...process.env,
      MASTHEAD_ALLOWED_ORIGINS: allowedOrigins(port),
      MASTHEAD_DATA_DIR: dataDirectory,
      MASTHEAD_DB_PATH: join(dataDirectory, "masthead.sqlite"),
      MASTHEAD_DIAGNOSTIC_LOG_FILE: join(dataDirectory, "runtime", "daemon.log"),
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_MCP_COMMAND: nodePath,
      MASTHEAD_MCP_ENTRY: mcpEntryPath(),
      MASTHEAD_NODE_PATH: nodePath,
      MASTHEAD_PORT: String(port),
      MASTHEAD_STORE_PATH: join(dataDirectory, "legacy", "events.ndjson")
    },
    stdio: "ignore"
  });
  daemonProcess.unref();

  const health = await waitForCompatibleCollector(port, dataDirectory);
  return connectorResult(true, baseUrl, "Started local Masthead collector.", health);
}

export function stopLiveConnector(): void {
  if (daemonProcess && daemonProcess.exitCode === null) daemonProcess.kill("SIGTERM");
  daemonProcess = undefined;
}

export function parseCompatibleHealth(value: unknown, expectedDataDirectory: string): MastheadHealthSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || record.product !== "masthead" || typeof record.apiVersion !== "number" || record.apiVersion < 1) return undefined;
  const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
  for (const capability of ["live_projection", "canonical_sessions", "logbook_search", "source_discovery", "adapter_inventory", "mcp_status", "settings"]) {
    if (!capabilities.includes(capability)) return undefined;
  }
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : {};
  if (data.migrationState === "failed") return undefined;
  if (typeof data.dataDirectory === "string" && data.dataDirectory !== expectedDataDirectory) return undefined;
  const runtime = record.runtime && typeof record.runtime === "object" ? (record.runtime as Record<string, unknown>) : {};
  return {
    apiVersion: record.apiVersion,
    buildSha: typeof record.buildSha === "string" ? record.buildSha : undefined,
    databaseId: typeof data.databaseId === "string" ? data.databaseId : undefined,
    databasePath: typeof data.databasePath === "string" ? data.databasePath : undefined,
    dataDirectory: typeof data.dataDirectory === "string" ? data.dataDirectory : undefined,
    mode: typeof runtime.mode === "string" ? runtime.mode : undefined
  };
}

async function probeCollector(port: number, expectedDataDirectory: string): Promise<{ state: "compatible"; health: MastheadHealthSummary } | { state: "incompatible" | "offline" }> {
  try {
    const response = await fetch(`${connectorBaseUrl(port)}/health`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return { state: "incompatible" };
    const health = parseCompatibleHealth(await response.json(), expectedDataDirectory);
    return health ? { state: "compatible", health } : { state: "incompatible" };
  } catch {
    return { state: "offline" };
  }
}

async function waitForCompatibleCollector(port: number, expectedDataDirectory: string): Promise<MastheadHealthSummary> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const probe = await probeCollector(port, expectedDataDirectory);
    if (probe.state === "compatible") return probe.health;
    await delay(150);
  }
  throw new Error(`Masthead collector did not become healthy at ${connectorBaseUrl(port)}/health`);
}

function connectorResult(started: boolean, baseUrl: string, message: string, health: MastheadHealthSummary): Extract<StartLiveConnectorResult, { ok: true }> {
  return {
    ok: true,
    started,
    baseUrl,
    command: "masthead daemon",
    health,
    message,
    projectionUrl: `${baseUrl}/projection`
  };
}

function connectorBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function allowedOrigins(port: number): string {
  return [`http://127.0.0.1:5173`, `http://localhost:5173`, `http://127.0.0.1:${port}`, `masthead://app`].join(",");
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  return fallback;
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available Masthead connector port found from ${startPort}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Before moving on, make these helpers exported from `src/electron/daemonLauncher.ts` so they can be unit tested without launching real child processes:

```ts
export function connectorBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function allowedOrigins(port: number): string {
  return [`http://127.0.0.1:5173`, `http://localhost:5173`, `http://127.0.0.1:${port}`, `masthead://app`].join(",");
}

export function buildDaemonEnv(input: {
  dataDirectory: string;
  nodePath: string;
  daemonPort: number;
  mcpEntry: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MASTHEAD_ALLOWED_ORIGINS: allowedOrigins(input.daemonPort),
    MASTHEAD_DATA_DIR: input.dataDirectory,
    MASTHEAD_DB_PATH: join(input.dataDirectory, "masthead.sqlite"),
    MASTHEAD_DIAGNOSTIC_LOG_FILE: join(input.dataDirectory, "runtime", "daemon.log"),
    MASTHEAD_HOST: "127.0.0.1",
    MASTHEAD_MCP_COMMAND: input.nodePath,
    MASTHEAD_MCP_ENTRY: input.mcpEntry,
    MASTHEAD_NODE_PATH: input.nodePath,
    MASTHEAD_PORT: String(input.daemonPort),
    MASTHEAD_STORE_PATH: join(input.dataDirectory, "legacy", "events.ndjson")
  };
}
```

- [ ] **Step 4: Add launcher tests**

Create `src/electron/__tests__/daemonLauncher.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildDaemonEnv, connectorBaseUrl, parseCompatibleHealth } from "../daemonLauncher";

const capabilities = [
  "live_projection",
  "canonical_sessions",
  "logbook_search",
  "source_discovery",
  "adapter_inventory",
  "mcp_status",
  "settings"
];

describe("Electron daemon launcher health parsing", () => {
  test("accepts current Masthead protocol identity", () => {
    const parsed = parseCompatibleHealth(
      {
        ok: true,
        product: "masthead",
        apiVersion: 1,
        capabilities,
        buildSha: "abc123",
        runtime: { mode: "primary" },
        data: {
          databaseId: "db",
          databasePath: "/tmp/masthead-data/masthead.sqlite",
          dataDirectory: "/tmp/masthead-data",
          migrationState: "ready"
        }
      },
      "/tmp/masthead-data"
    );

    expect(parsed).toMatchObject({
      apiVersion: 1,
      databaseId: "db",
      dataDirectory: "/tmp/masthead-data",
      mode: "primary"
    });
  });

  test("rejects legacy or wrong-directory daemons", () => {
    expect(parseCompatibleHealth({ ok: true, events: 12 }, "/tmp/masthead-data")).toBeUndefined();
    expect(
      parseCompatibleHealth(
        {
          ok: true,
          product: "masthead",
          apiVersion: 1,
          capabilities,
          data: { dataDirectory: "/tmp/other", migrationState: "ready" }
        },
        "/tmp/masthead-data"
      )
    ).toBeUndefined();
  });

  test("builds daemon env with canonical database and MCP paths", () => {
    expect(
      buildDaemonEnv({
        dataDirectory: "/tmp/masthead-data",
        daemonPort: 17374,
        mcpEntry: "/opt/Masthead/resources/daemon/dist/src/mcp/server.js",
        nodePath: "/opt/Masthead/resources/daemon/node"
      })
    ).toMatchObject({
      MASTHEAD_ALLOWED_ORIGINS: "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:17374,masthead://app",
      MASTHEAD_DATA_DIR: "/tmp/masthead-data",
      MASTHEAD_DB_PATH: "/tmp/masthead-data/masthead.sqlite",
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_MCP_COMMAND: "/opt/Masthead/resources/daemon/node",
      MASTHEAD_MCP_ENTRY: "/opt/Masthead/resources/daemon/dist/src/mcp/server.js",
      MASTHEAD_NODE_PATH: "/opt/Masthead/resources/daemon/node",
      MASTHEAD_PORT: "17374",
      MASTHEAD_STORE_PATH: "/tmp/masthead-data/legacy/events.ndjson"
    });
  });

  test("connector base URL stays loopback-only", () => {
    expect(connectorBaseUrl(17373)).toBe("http://127.0.0.1:17373");
  });
});
```

- [ ] **Step 5: Wire launcher into IPC**

Modify `src/electron/ipc.ts`:

```ts
import { shell } from "electron";
import { startLiveConnector } from "./daemonLauncher";
import { assertMastheadDirectory } from "./pathPolicy";
```

Replace the placeholder handlers:

```ts
ipcMain.handle(channels.startLiveConnector, async (event) => {
  validateIpcSender(event.senderFrame);
  return startLiveConnector();
});

ipcMain.handle(channels.openDataDirectory, async (event, args: { path?: unknown }) => {
  validateIpcSender(event.senderFrame);
  if (typeof args?.path !== "string") throw new Error("Data directory path is required.");
  assertMastheadDirectory(args.path);
  const result = await shell.openPath(args.path);
  if (result) throw new Error(result);
});
```

- [ ] **Step 6: Stop daemon during app quit**

Modify `src/electron/main.ts`:

```ts
import { stopLiveConnector } from "./daemonLauncher";
```

Add:

```ts
app.on("before-quit", () => {
  stopLiveConnector();
});
```

- [ ] **Step 7: Run focused tests**

```bash
npm test -- --run src/electron/__tests__/pathPolicy.test.ts src/electron/__tests__/daemonLauncher.test.ts src/electron/__tests__/ipcSecurity.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/electron/daemonLauncher.ts src/electron/pathPolicy.ts src/electron/ipc.ts src/electron/main.ts src/electron/__tests__/daemonLauncher.test.ts src/electron/__tests__/pathPolicy.test.ts
git commit -m "feat: port daemon launch to electron"
```

## Task 5: Update Daemon Origins And MCP Launch Config

**Files:**

- Modify: `src/daemon/config.ts`
- Modify: `src/core/worktreeConnector.ts`
- Test: `src/core/__tests__/viteConnectorManager.test.ts`
- Test: `src/mcp/__tests__/canonicalDatabaseLaunch.test.ts`
- Test: `src/daemon/__tests__/mcpStatusApi.test.ts`

- [ ] **Step 1: Add Electron renderer origin to daemon defaults**

Modify `src/daemon/config.ts` default allowed origins:

```ts
const allowedOrigins = (env.MASTHEAD_ALLOWED_ORIGINS || [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "tauri://localhost",
  "http://tauri.localhost",
  "masthead://app"
].join(","))
```

- [ ] **Step 2: Add Electron origin to worktree dev allowed origins**

Modify `src/core/worktreeConnector.ts`:

```ts
const origins = new Set([`http://${host}:${uiPort}`, "tauri://localhost", "http://tauri.localhost", "masthead://app"]);
```

- [ ] **Step 3: Verify MCP launch config uses packaged Node env overrides**

The existing `src/daemon/mcpStatusService.ts` already honors:

```ts
const command = process.env.MASTHEAD_MCP_COMMAND || process.env.MASTHEAD_NODE_PATH || process.execPath;
const entryPath = process.env.MASTHEAD_MCP_ENTRY || resolve(process.cwd(), "dist/daemon/src/mcp/server.js");
```

Add a test in `src/mcp/__tests__/canonicalDatabaseLaunch.test.ts`:

```ts
test("MCP launch config honors packaged Electron command and entry overrides", () => {
  const previousCommand = process.env.MASTHEAD_MCP_COMMAND;
  const previousEntry = process.env.MASTHEAD_MCP_ENTRY;
  process.env.MASTHEAD_MCP_COMMAND = "/opt/Masthead/resources/daemon/node";
  process.env.MASTHEAD_MCP_ENTRY = "/opt/Masthead/resources/daemon/dist/src/mcp/server.js";
  try {
    const launchConfig = getMcpLaunchConfig("/home/tyler/.local/share/masthead-dev/masthead.sqlite", "/home/tyler/.local/share/masthead-dev");
    expect(launchConfig.command).toBe("/opt/Masthead/resources/daemon/node");
    expect(launchConfig.args).toEqual(["/opt/Masthead/resources/daemon/dist/src/mcp/server.js"]);
    expect(launchConfig.env.MASTHEAD_DATA_DIR).toBe("/home/tyler/.local/share/masthead-dev");
    expect(launchConfig.env.MASTHEAD_DB_PATH).toBe("/home/tyler/.local/share/masthead-dev/masthead.sqlite");
  } finally {
    if (previousCommand === undefined) delete process.env.MASTHEAD_MCP_COMMAND;
    else process.env.MASTHEAD_MCP_COMMAND = previousCommand;
    if (previousEntry === undefined) delete process.env.MASTHEAD_MCP_ENTRY;
    else process.env.MASTHEAD_MCP_ENTRY = previousEntry;
  }
});
```

- [ ] **Step 4: Run focused tests**

```bash
npm test -- --run src/core/__tests__/viteConnectorManager.test.ts src/mcp/__tests__/canonicalDatabaseLaunch.test.ts src/daemon/__tests__/mcpStatusApi.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/config.ts src/core/worktreeConnector.ts src/mcp/__tests__/canonicalDatabaseLaunch.test.ts
git commit -m "fix: allow electron desktop daemon origins"
```

## Task 6: Prepare Packaged Daemon Resources

**Files:**

- Create: `scripts/prepare-electron-resources.js`
- Modify: `.gitignore`
- Modify: `forge.config.ts`
- Test: `scripts/masthead-electron-smoke.js` in Task 9 consumes this output.

- [ ] **Step 1: Add Electron resource preparation script**

Create `scripts/prepare-electron-resources.js`:

```js
#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const resourceRoot = resolve("electron-resources/daemon");
const nodeTarget = resolve(resourceRoot, process.platform === "win32" ? "node.exe" : "node");
const distTarget = resolve(resourceRoot, "dist");

await rm(resourceRoot, { force: true, recursive: true });
await mkdir(resourceRoot, { recursive: true });
await writeFile(resolve(resourceRoot, "README.txt"), "Generated daemon resources are copied here by `npm run prepare:electron-resources`.\n");
await cp(process.execPath, nodeTarget);
await cp(resolve("dist/daemon"), distTarget, { recursive: true });

console.log(`Prepared daemon resources in ${resourceRoot}`);
console.log(`Bundled Node runtime as ${basename(nodeTarget)}`);
```

- [ ] **Step 2: Ignore generated Electron resources**

Modify `.gitignore`:

```gitignore
electron-resources/daemon/*
!electron-resources/daemon/README.txt
out/
.vite/
```

Keep existing Tauri ignores until Task 12.

- [ ] **Step 3: Add tracked README placeholder**

Create `electron-resources/daemon/README.txt`:

```text
Generated daemon resources are copied here by `npm run prepare:electron-resources`.
```

- [ ] **Step 4: Verify resource preparation**

Run:

```bash
npm run build:daemon
npm run prepare:electron-resources
test -x electron-resources/daemon/node || test -x electron-resources/daemon/node.exe
test -f electron-resources/daemon/dist/src/daemon/main.js
test -f electron-resources/daemon/dist/src/mcp/server.js
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/prepare-electron-resources.js .gitignore electron-resources/daemon/README.txt forge.config.ts
git commit -m "build: stage daemon resources for electron"
```

## Task 7: Add Tray, Menu, And Desktop Lifecycle Parity

**Files:**

- Create: `src/electron/tray.ts`
- Modify: `src/electron/main.ts`
- Modify: `src/electron/window.ts`
- Test: `src/electron/__tests__/tray.test.ts`

- [ ] **Step 1: Add tray implementation**

Create `src/electron/tray.ts`:

```ts
import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import { join, resolve } from "node:path";
import { appDataDirectory } from "./pathPolicy";

let tray: Tray | undefined;

export function createMastheadTray(getMainWindow: () => BrowserWindow | undefined, openDataDirectory: (path: string) => Promise<void>): Tray {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "app", "public", "assets", "masthead-logo-sail.png")
    : resolve("public/assets/masthead-logo-sail.png");
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image);
  tray.setToolTip("Masthead");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show Masthead",
        click: () => {
          const window = getMainWindow();
          if (!window) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        }
      },
      {
        label: "Open Data Directory",
        click: () => {
          void openDataDirectory(appDataDirectory());
        }
      },
      { type: "separator" },
      { label: "Quit Masthead", click: () => app.quit() }
    ])
  );
  return tray;
}

export function destroyMastheadTray(): void {
  tray?.destroy();
  tray = undefined;
}
```

Expose the menu template builder separately so it can be tested without a real system tray:

```ts
export function buildTrayMenuTemplate(input: {
  getMainWindow: () => BrowserWindow | undefined;
  openDataDirectory: (path: string) => Promise<void>;
}): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: "Show Masthead",
      click: () => {
        const window = input.getMainWindow();
        if (!window) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
    },
    {
      label: "Open Data Directory",
      click: () => {
        void input.openDataDirectory(appDataDirectory());
      }
    },
    { type: "separator" },
    { label: "Quit Masthead", click: () => app.quit() }
  ];
}
```

- [ ] **Step 2: Wire tray into main lifecycle**

Modify `src/electron/main.ts`:

```ts
import { shell } from "electron";
import { createMastheadTray, destroyMastheadTray } from "./tray";
import { appDataDirectory, assertMastheadDirectory } from "./pathPolicy";
```

After `mainWindow = createMainWindow();`:

```ts
createMastheadTray(
  () => mainWindow,
  async (path) => {
    assertMastheadDirectory(path);
    const result = await shell.openPath(path);
    if (result) throw new Error(result);
  }
);
```

In `before-quit`:

```ts
destroyMastheadTray();
```

- [ ] **Step 3: Add tray behavior tests**

Create `src/electron/__tests__/tray.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { buildTrayMenuTemplate } from "../tray";

describe("Electron tray menu", () => {
  test("exposes expected actions in order", () => {
    const menu = buildTrayMenuTemplate({ getMainWindow: () => undefined, openDataDirectory: async () => undefined });
    expect(menu.map((item) => "label" in item ? item.label : item.type)).toEqual([
      "Show Masthead",
      "Open Data Directory",
      "separator",
      "Quit Masthead"
    ]);
  });

  test("show action focuses existing window", () => {
    const window = {
      focus: vi.fn(),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn()
    };
    const menu = buildTrayMenuTemplate({ getMainWindow: () => window as never, openDataDirectory: async () => undefined });
    const showItem = menu[0];
    showItem.click?.({} as never, {} as never, {} as never);
    expect(window.restore).toHaveBeenCalled();
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Decide close behavior**

For first Electron parity, closing the window quits on Linux/Windows just like normal app behavior. Do not hide-to-tray on close in the first migration; tray still provides show and quit while the app is running. If Tyler wants background tray persistence after Electron parity, add it as a focused follow-up.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- --run src/electron/__tests__/tray.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify launch by hand**

Run:

```bash
npm run dev:electron
```

Expected:

- Electron app opens.
- Tray icon appears.
- Show Masthead focuses the existing window.
- Open Data Directory opens a Masthead-owned data directory.
- Quit Masthead exits the app and daemon child process.

- [ ] **Step 7: Commit**

```bash
git add src/electron/tray.ts src/electron/main.ts src/electron/window.ts src/electron/__tests__/tray.test.ts
git commit -m "feat: add electron tray lifecycle"
```

## Task 8: Install The Electron Dev App-Menu Shortcut

**Files:**

- Create: `scripts/install-electron-dev-launcher.js`
- Modify: `package.json`

- [ ] **Step 1: Add launcher installer**

Create `scripts/install-electron-dev-launcher.js`:

```js
#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const binDir = join(homedir(), ".local", "bin");
const appDir = join(homedir(), ".local", "share", "applications");
const stateDir = join(homedir(), ".local", "state", "masthead");
const launcherPath = join(binDir, "masthead-electron-dev");
const desktopPath = join(appDir, "ai.animas.masthead-electron-dev.desktop");
const logPath = join(stateDir, "electron-dev.log");

await mkdir(binDir, { recursive: true });
await mkdir(appDir, { recursive: true });
await mkdir(stateDir, { recursive: true });

await writeFile(
  launcherPath,
  `#!/usr/bin/env bash
set -euo pipefail
cd ${JSON.stringify(repo)}
exec npm run dev:electron >> ${JSON.stringify(logPath)} 2>&1
`,
  { mode: 0o755 }
);

await writeFile(
  desktopPath,
  `[Desktop Entry]
Type=Application
Name=Masthead Electron Dev
Comment=Run Masthead with the Electron desktop shell
Exec=${launcherPath}
Icon=${repo}/public/assets/masthead-logo-sail.png
Terminal=false
Categories=Development;
StartupNotify=true
`,
  { mode: 0o644 }
);

console.log(`Installed ${desktopPath}`);
console.log(`Logs: ${logPath}`);
```

- [ ] **Step 2: Add package script**

Modify `package.json`:

```json
{
  "scripts": {
    "install:electron-dev-launcher": "node scripts/install-electron-dev-launcher.js"
  }
}
```

- [ ] **Step 3: Install launcher locally**

Run:

```bash
npm run install:electron-dev-launcher
gtk-update-icon-cache ~/.local/share/icons 2>/dev/null || true
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

Expected:

```text
Installed /home/tyler/.local/share/applications/ai.animas.masthead-electron-dev.desktop
```

- [ ] **Step 4: Commit**

```bash
git add scripts/install-electron-dev-launcher.js package.json
git commit -m "chore: add electron dev launcher installer"
```

## Task 9: Add Electron Smoke And GPU/Performance Checks

**Files:**

- Create: `src/electron/gpuDiagnostics.ts`
- Modify: `src/electron/main.ts`
- Create: `scripts/masthead-electron-smoke.js`
- Create: `scripts/masthead-electron-packaged-smoke.js`
- Create: `scripts/masthead-electron-security-check.js`
- Modify: `package.json`

- [ ] **Step 1: Add GPU diagnostic helper**

Create `src/electron/gpuDiagnostics.ts`:

```ts
import { app } from "electron";

export type GpuDiagnostics = {
  featureStatus: Record<string, string>;
};

export function waitForGpuDiagnostics(timeoutMs = 3_000): Promise<GpuDiagnostics> {
  return new Promise((resolve) => {
    const finish = () => resolve({ featureStatus: app.getGPUFeatureStatus() as unknown as Record<string, string> });
    const timeout = setTimeout(finish, timeoutMs);
    app.once("gpu-info-update", () => {
      clearTimeout(timeout);
      finish();
    });
  });
}
```

- [ ] **Step 2: Add smoke mode to Electron main**

Modify `src/electron/main.ts` after window creation:

```ts
if (process.env.MASTHEAD_ELECTRON_SMOKE === "1") {
  void runSmokeMode();
}
```

Add:

```ts
async function runSmokeMode(): Promise<void> {
  const { waitForGpuDiagnostics } = await import("./gpuDiagnostics");
  const diagnostics = await waitForGpuDiagnostics();
  const renderer = mainWindow
    ? await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            const cards = Array.from(document.querySelectorAll('.session-card[data-session-id]')).slice(0, 12);
            const hoverSamples = [];
            for (const card of cards) {
              const startedAt = performance.now();
              card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
              hoverSamples.push(performance.now() - startedAt);
            }
            requestAnimationFrame(() => {
              const sorted = hoverSamples.slice().sort((a, b) => a - b);
              const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
              const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
              resolve({
                cardCount: cards.length,
                hasNodeProcess: typeof window.process !== 'undefined',
                hasRequire: typeof window.require !== 'undefined',
                hasRawIpc: Boolean(window.ipcRenderer || window.electron || window.__TAURI_INTERNALS__),
                hasDesktopBridge: Boolean(window.mastheadDesktop && window.mastheadDesktop.runtime?.kind === 'electron'),
                hoverMedianMs: median,
                hoverP95Ms: p95
              });
            });
          });
        })
      `)
    : undefined;
  console.log(
    JSON.stringify({
      ok: true,
      product: "masthead",
      smoke: "electron",
      electron: process.versions.electron,
      gpu: diagnostics.featureStatus,
      renderer
    })
  );
  app.quit();
}
```

- [ ] **Step 3: Add smoke script**

Create `scripts/masthead-electron-smoke.js`:

```js
#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

const electronBin = resolve("node_modules/.bin/electron-forge");
const child = spawn(electronBin, ["start"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    MASTHEAD_ELECTRON_SMOKE: "1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const timeout = setTimeout(() => {
  child.kill("SIGTERM");
}, 20_000);

const [code] = await once(child, "exit");
clearTimeout(timeout);

const jsonLine = stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line.startsWith("{") && line.includes('"smoke":"electron"'));

if (code !== 0 || !jsonLine) {
  console.error(stderr || stdout || `Electron smoke exited with ${code}`);
  process.exit(1);
}

const parsed = JSON.parse(jsonLine);
if (parsed.ok !== true || parsed.product !== "masthead") {
  console.error(`Unexpected Electron smoke result: ${jsonLine}`);
  process.exit(1);
}
if (!parsed.renderer?.hasDesktopBridge) {
  console.error("Electron preload bridge was not exposed.");
  process.exit(1);
}
if (parsed.renderer?.hasNodeProcess || parsed.renderer?.hasRequire || parsed.renderer?.hasRawIpc) {
  console.error(`Renderer exposed forbidden privileged globals: ${JSON.stringify(parsed.renderer)}`);
  process.exit(1);
}
if (parsed.renderer?.cardCount >= 12 && (parsed.renderer.hoverMedianMs > 16 || parsed.renderer.hoverP95Ms > 50)) {
  console.error(`Electron hover latency exceeded threshold: ${JSON.stringify(parsed.renderer)}`);
  process.exit(1);
}

console.log(`Electron smoke passed. Electron ${parsed.electron}. GPU keys: ${Object.keys(parsed.gpu || {}).join(", ")}`);
```

- [ ] **Step 4: Add packaged smoke script**

Create `scripts/masthead-electron-packaged-smoke.js`:

```js
#!/usr/bin/env node
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";

async function canExecute(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findPackagedBinary(root = "out") {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findPackagedBinary(path);
      if (nested) {
        return nested;
      }
      continue;
    }

    const expectedName = process.platform === "win32" ? "masthead.exe" : "masthead";
    if (entry.name === expectedName && await canExecute(path)) {
      return path;
    }
  }
  return "";
}

const binary = process.env.MASTHEAD_ELECTRON_PACKAGED_BIN || process.argv[2] || await findPackagedBinary();
if (!binary) {
  console.error("Could not find packaged Masthead binary. Pass a path, set MASTHEAD_ELECTRON_PACKAGED_BIN, or run npm run build:desktop first.");
  process.exit(1);
}

const resources = join(dirname(binary), "resources", "daemon");
await access(join(resources, process.platform === "win32" ? "node.exe" : "node"), constants.X_OK);
await access(join(resources, "dist", "src", "daemon", "main.js"), constants.R_OK);
await access(join(resources, "dist", "src", "mcp", "server.js"), constants.R_OK);

const child = spawn(binary, [], {
  env: { ...process.env, MASTHEAD_ELECTRON_SMOKE: "1" },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const timeout = setTimeout(() => child.kill("SIGTERM"), 25_000);
const [code] = await once(child, "exit");
clearTimeout(timeout);

const jsonLine = stdout.split(/\r?\n/).find((line) => line.includes('"smoke":"electron"'));
if (code !== 0 || !jsonLine) {
  console.error(stderr || stdout || `Packaged Electron smoke exited with ${code}`);
  process.exit(1);
}
```

If the generated Linux packaged binary places `resources` in a different relative location, update the script with a tested lookup that searches only under the packaged app directory.

- [ ] **Step 5: Add static Electron security check**

Create `scripts/masthead-electron-security-check.js`:

```js
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = [
  "src/electron/preload.ts",
  "src/electron/window.ts",
  "src/electron/ipc.ts",
  "src/electron/protocol.ts"
];

const forbidden = [
  { file: "src/electron/preload.ts", pattern: /exposeInMainWorld\([^,]+,\s*ipcRenderer/s, message: "preload must not expose ipcRenderer directly" },
  { file: "src/electron/preload.ts", pattern: /exposeInMainWorld\([^,]+,\s*process/s, message: "preload must not expose process directly" },
  { file: "src/electron/window.ts", pattern: /nodeIntegration:\s*true/, message: "renderer must not enable nodeIntegration" },
  { file: "src/electron/window.ts", pattern: /contextIsolation:\s*false/, message: "renderer must not disable contextIsolation" },
  { file: "src/electron/window.ts", pattern: /webSecurity:\s*false/, message: "renderer must not disable webSecurity" },
  { file: "src/electron/window.ts", pattern: /webviewTag:\s*true/, message: "renderer must not enable webviewTag" },
  { file: "src/electron/window.ts", pattern: /loadURL\(['"]file:\/\//, message: "renderer must not load file protocol" }
];

for (const file of files) {
  await readFile(resolve(file), "utf8");
}

for (const rule of forbidden) {
  const source = await readFile(resolve(rule.file), "utf8");
  if (rule.pattern.test(source)) {
    console.error(`${rule.file}: ${rule.message}`);
    process.exit(1);
  }
}

console.log("Electron security source check passed.");
```

- [ ] **Step 6: Run smoke and security checks**

```bash
npm run test:electron-security
npm run smoke:electron
```

Expected:

```text
Electron security source check passed.
Electron smoke passed. Electron 42.5.0. GPU keys: ...
```

- [ ] **Step 7: Commit**

```bash
git add src/electron/gpuDiagnostics.ts src/electron/main.ts scripts/masthead-electron-smoke.js scripts/masthead-electron-packaged-smoke.js scripts/masthead-electron-security-check.js package.json
git commit -m "test: add electron smoke coverage"
```

## Task 10: Build And Verify Packaged Electron App

**Files:**

- Modify: `forge.config.ts`
- Modify: `package.json`
- Generated only: `out/`

- [ ] **Step 1: Build packaged app**

Run:

```bash
npm run build:electron
```

Expected:

- `out/` exists.
- Linux artifacts include a packaged app and a `.deb` or `.rpm` if host requirements are installed.
- If `fakeroot`, `dpkg`, or `rpm` tooling is missing, install the missing system package or temporarily run `npm run package:electron` to verify app packaging before maker output.

- [ ] **Step 2: Run packaged binary**

Run the generated binary from `out/`:

```bash
find out -type f -name masthead -perm -111 -print -quit
```

Then run that path manually:

```bash
OUT_BIN="$(find out -type f -name masthead -perm -111 -print -quit)"
"$OUT_BIN"
```

Expected:

- Masthead window opens.
- Tray appears.
- Live connector starts or reuses the correct data directory.
- Settings shows the same database path as `/health`.
- Agent Access MCP test passes.

- [ ] **Step 3: Verify packaged resources**

Run:

```bash
find out -path '*resources/daemon/node' -o -path '*resources/daemon/node.exe'
find out -path '*resources/daemon/dist/src/daemon/main.js'
find out -path '*resources/daemon/dist/src/mcp/server.js'
```

Expected: each command prints at least one path.

- [ ] **Step 4: Verify package-time fuses**

Run:

```bash
npx @electron/fuses read --app "$(find out -maxdepth 2 -type d -name 'Masthead*.app' -print -quit)" 2>/dev/null || true
```

On Linux, if `@electron/fuses read --app` does not support the generated app layout, record that in the closeout and rely on Forge packaging logs. Do not block Linux migration solely on a macOS-specific fuses inspection command.

- [ ] **Step 5: Run packaged smoke**

Run:

```bash
OUT_BIN="$(find out -type f -name masthead -perm -111 -print -quit)"
node scripts/masthead-electron-packaged-smoke.js "$OUT_BIN"
```

Expected:

```text
Packaged smoke exits 0 after verifying daemon resources and Electron smoke output.
```

- [ ] **Step 6: Commit config corrections**

```bash
git add forge.config.ts package.json package-lock.json
git commit -m "build: verify electron package output"
```

If no config corrections were required, skip this commit.

## Task 11: Add CI, PR Template, And Release Smoke Coverage

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release-smoke.yml`
- Modify: `.github/pull_request_template.md`
- Modify: `package.json`

- [ ] **Step 1: Update CI while Tauri still exists**

Modify `.github/workflows/ci.yml` so the main job runs both existing verification and Electron side-by-side checks:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: ["**"]
  merge_group:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24.15.0
          cache: npm
      - run: npm ci
      - run: npm run verify
      - name: Install Tauri system dependencies
        run: sudo apt-get update && sudo apt-get install -y libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
      - run: cargo test --manifest-path src-tauri/Cargo.toml

  electron:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24.15.0
          cache: npm
      - run: npm ci
      - name: Install Electron smoke dependencies
        run: sudo apt-get update && sudo apt-get install -y xvfb libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 fakeroot dpkg rpm
      - run: npm run test:electron
      - run: npm run test:electron-security
      - run: xvfb-run -a npm run smoke:electron
      - run: npm run package:electron
      - name: Run packaged smoke
        run: |
          OUT_BIN="$(find out -type f -name masthead -perm -111 -print -quit)"
          xvfb-run -a node scripts/masthead-electron-packaged-smoke.js "$OUT_BIN"
```

This still keeps Tauri CI alive until the final removal task.

- [ ] **Step 2: Update release smoke**

Modify `.github/workflows/release-smoke.yml` so tags and manual release checks run Electron package checks:

```yaml
name: Release Smoke

on:
  workflow_dispatch:
  push:
    tags:
      - "v*"

permissions:
  contents: read

jobs:
  release-smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24.15.0
          cache: npm
      - run: npm ci
      - name: Install Electron package dependencies
        run: sudo apt-get update && sudo apt-get install -y xvfb libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 fakeroot dpkg rpm
      - run: npm run verify
      - run: npm run test:electron-security
      - run: xvfb-run -a npm run smoke:electron
      - run: npm run build:desktop
      - name: Run packaged smoke
        run: |
          OUT_BIN="$(find out -type f -name masthead -perm -111 -print -quit)"
          xvfb-run -a node scripts/masthead-electron-packaged-smoke.js "$OUT_BIN"
      - run: npm run dogfood:fixture
```

- [ ] **Step 3: Update PR template**

Modify `.github/pull_request_template.md`:

```markdown
## Summary

-

## Verification

- [ ] `npm run check:product-contract`
- [ ] `npm run verify:no-citations`
- [ ] `npm run verify`
- [ ] `npm run test:electron`
- [ ] `npm run test:electron-security`
- [ ] `npm run smoke:electron`
- [ ] `npm run smoke:electron:packaged`
- [ ] Other:

## Checklist

- [ ] Product contract considered: Masthead remains a local-first, harness-neutral session data layer.
- [ ] Tests run and results noted above.
- [ ] Docs updated when behavior changed.
- [ ] No dev citations remain and `VITE_MASTHEAD_DEV_CITATIONS` is not enabled.
- [ ] No write-capable MCP tools added.
- [ ] Release-gate impact noted.
- [ ] Electron renderer does not expose Node, raw IPC, or file protocol loading.
```

- [ ] **Step 4: Run CI-equivalent local checks**

```bash
npm run verify
npm run test:electron
npm run test:electron-security
npm run smoke:electron
npm run package:electron
OUT_BIN="$(find out -type f -name masthead -perm -111 -print -quit)"
node scripts/masthead-electron-packaged-smoke.js "$OUT_BIN"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release-smoke.yml .github/pull_request_template.md package.json
git commit -m "ci: add electron desktop verification"
```

## Task 12: Switch Desktop Defaults And Remove Tauri

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `scripts/sync-version.js`
- Delete: `src-tauri/`
- Modify: `README.md`
- Modify: `docs/release-gates.md`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`

- [ ] **Step 1: Remove Tauri scripts and dependencies**

Modify `package.json`:

```json
{
  "scripts": {
    "dev:desktop": "npm run dev:electron",
    "build:desktop": "npm run build:electron"
  },
  "dependencies": {
  },
  "devDependencies": {
  }
}
```

Remove:

```json
"@tauri-apps/api": "...",
"@tauri-apps/cli": "..."
```

Remove these scripts:

```json
"dev:desktop:tauri": "...",
"build:desktop:tauri": "..."
```

Run:

```bash
npm install
```

- [ ] **Step 2: Remove Tauri source tree**

Run:

```bash
git rm -r src-tauri
```

- [ ] **Step 3: Update version sync**

Modify `scripts/sync-version.js` so it only reads `package.json`, validates the version, and prints:

```js
console.log(`Version sync complete. Source of truth remains package.json (${version}).`);
```

Remove all Cargo/Tauri file writes from the script.

- [ ] **Step 4: Remove Tauri ignores**

Modify `.gitignore` and remove:

```gitignore
src-tauri/target/
src-tauri/gen/
src-tauri/resources/daemon/*
!src-tauri/resources/daemon/README.txt
```

- [ ] **Step 5: Remove remaining Tauri imports**

Run:

```bash
rg -n "@tauri|tauri|__TAURI__|start_live_connector_command|open_data_directory_command|src-tauri" .
```

Expected remaining matches:

- Historical docs under `docs/superpowers/plans/` only.
- The transition fallback in `desktopBridge.ts` only if this task intentionally keeps browser compatibility for old builds.

If active source still imports `@tauri-apps/api`, remove that source before continuing.

- [ ] **Step 6: Update docs and issue templates**

In `README.md`, `docs/release-gates.md`, and `.github/ISSUE_TEMPLATE/bug_report.yml`:

- Replace `npm run dev:desktop` descriptions so they refer to Electron.
- Replace `packaged app` troubleshooting references that name Tauri.
- Add `npm run smoke:electron` to the desktop verification checklist.
- Keep product language as local-first session data layer and session manager.

- [ ] **Step 7: Run full verification**

```bash
npm run verify
npm run test:electron
npm run test:electron-security
npm run smoke:electron
npm run smoke:electron:packaged
npm run build:desktop
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore scripts/sync-version.js README.md docs/release-gates.md .github/ISSUE_TEMPLATE/bug_report.yml
git add -u src-tauri
git commit -m "chore: replace tauri desktop shell with electron"
```

## Task 13: Final Browser And Desktop Verification

**Files:**

- No source edits unless verification exposes a migration bug.

- [ ] **Step 1: Verify browser dev still works**

Run:

```bash
npm run dev
```

Open the printed URL in the in-app Browser using the `iab` backend. Verify:

- Now shows live sessions or a truthful connected empty state.
- Logbook loads.
- Sources loads adapter state and onboarding completion status.
- Agent Access loads MCP status.
- Settings loads storage and hook state.

- [ ] **Step 2: Verify Electron dev works**

Run:

```bash
npm run dev:electron
```

Verify:

- Electron opens without terminal-only setup.
- HMR works for a harmless text or style change, then revert that change.
- Hovering session cards tracks the cursor without the WebKitGTK lag.
- Tray menu actions work.
- Settings opens the data directory.
- Agent Access MCP test passes.

- [ ] **Step 3: Verify packaged app works**

Run:

```bash
npm run build:desktop
OUT_BIN="$(find out -type f -name masthead -perm -111 -print -quit)"
"$OUT_BIN"
```

Verify:

- Packaged app opens.
- Daemon starts from bundled resources.
- `/health` reports `product: "masthead"`, `apiVersion: 1`, expected capabilities, and a Masthead data directory.
- MCP launch config points at packaged `resources/daemon/node` and `resources/daemon/dist/src/mcp/server.js`.

- [ ] **Step 4: Run final full gate**

```bash
npm run verify:no-citations
npm run check:product-contract
npm run check:surface-contract
npm run typecheck
npm test -- --run
npm run build
npm run check:endpoint-matrix
npm run smoke
npm run test:electron
npm run test:electron-security
npm run smoke:electron
npm run smoke:electron:packaged
npm run build:desktop
```

Expected: PASS.

- [ ] **Step 5: Commit any verification fixes**

If verification required source fixes:

```bash
git add <changed-files>
git commit -m "fix: close electron migration verification gaps"
```

If no source fixes were needed, do not create an empty commit.

## Task 14: Closeout And GitHub Sync

**Files:**

- No source edits unless closeout docs need a correction.

- [ ] **Step 1: Inspect final state**

```bash
git status --short --branch
git log --oneline -8
```

Expected:

```text
## <branch>...origin/<branch>
```

No uncommitted source changes.

- [ ] **Step 2: Push branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 3: Open PR**

Use the GitHub app or `gh pr create` with:

```text
Title: Migrate Masthead desktop shell to Electron

Summary:
- replaces the Tauri/WebKit desktop shell with an Electron/Chromium shell
- preserves the React/Vite renderer, daemon, MCP launch config, tray, packaged resources, and app-menu workflow
- adds Electron smoke, GPU diagnostics, packaging, and security gates

Verification:
- npm run verify
- npm run smoke:electron
- npm run build:desktop
```

- [ ] **Step 4: Merge only after CI and local gates pass**

Use the normal repository merge flow. Do not merge if:

- `npm run verify` fails.
- Electron packaged app cannot start the daemon.
- MCP launch config is invalid.
- The renderer regresses to direct privileged APIs.
- Tauri removal leaves active source references to `@tauri-apps/api`.

## Self-Review

Spec coverage:

- Electron official docs are reflected in the target architecture: main process, renderer process, preload, context isolation, IPC, CSP, navigation restrictions, tray lifecycle, custom protocol, Forge packaging, fuses, and GPU diagnostics.
- Current Masthead code is covered: Tauri command surface, daemon launch, MCP launch config, native store fallback, app-menu workflow, CORS origins, version sync, packaging resources, tests, docs, and cleanup.
- Product invariants are preserved: canonical local database stays daemon-owned, MCP remains read-only, renderer stays unprivileged, and browser dev remains supported.

Placeholder scan:

- No undecided placeholder markers.
- No task-marker placeholders.
- No unscoped "add validation" steps.
- Conditional packaging host requirements are handled with exact commands and fallback verification.

Type consistency:

- The renderer bridge name is `window.mastheadDesktop`.
- Electron IPC channels use `masthead:*` names.
- Existing Masthead DTO names remain unchanged.
- Daemon/MCP env names remain `MASTHEAD_DATA_DIR`, `MASTHEAD_DB_PATH`, `MASTHEAD_NODE_PATH`, `MASTHEAD_MCP_COMMAND`, and `MASTHEAD_MCP_ENTRY`.
