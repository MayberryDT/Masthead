# Sources V2 Live-Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Sources as the harness live-connect control plane (Discover → Enable → Activate → Test → Ready), using existing scan + live-connector install APIs, without import-job UX.

**Architecture:** Add a daemon merge layer that turns presence preflight + live connector settings + activation flags into a single `HarnessConnectorDto[]`. Expose Discover/list via Sources APIs. Rebuild Sources UI around connector rows + detail. Keep history/import daemon code for Workbench; stop driving it from Sources primary UX. First-run uses the same connector loop.

**Tech Stack:** TypeScript daemon, React/Vitest renderer, existing `/settings/hooks/*` install paths, source preflight/scan services, SQLite only for optional activation flags if needed.

**Contract:** `docs/reference/sources-v2.md` + `docs/adr/0010-sources-v2-live-connect-only.md`  
**Design:** `design.md` Sources archetype  
**Worktree:** `/home/tyler/.codex/worktrees/f503/Masthead`  
**Port rule:** Do not steal `5173` from Electron Dev. Prefer verifying in Electron / existing UI; for browser-only use `MASTHEAD_UI_PORT=5180 npm run dev`.

---

## Out Of Scope

- Workbench transcript/import/publish feature work (beyond not breaking handoff).
- Forging Codex `trusted_hash` values in `config.toml`.
- Whole-home filesystem scans.
- New harness adapters beyond the 8 live targets.
- Full PRD rewrite.
- Deleting daemon import APIs (leave for Workbench; only remove from Sources primary UI).

---

## File Map

| Path | Responsibility |
|---|---|
| `src/shared/harnessConnectors.ts` | **Create** — shared DTO types + pure status helpers |
| `src/daemon/sources/harnessConnectorService.ts` | **Create** — merge presence + live + activation → DTO list; discover |
| `src/daemon/sources/connectorActivationStore.ts` | **Create** — pending host-activation flags (codex trust, etc.) |
| `src/daemon/__tests__/harnessConnectorService.test.ts` | **Create** — unit tests for merge/activation |
| `src/daemon/server.ts` | **Modify** — `GET/POST /sources/connectors`, discover route |
| `src/app/daemonClient.ts` | **Modify** — client types + `listHarnessConnectors` / `discoverHarnessConnectors` / actions |
| `src/app/sources/useSourcesConnectorsController.ts` | **Create** — slim controller for V2 surface |
| `src/app/sources/useSourcesController.ts` | **Modify or thin-wrap** — stop import polling as core path; prefer V2 controller from App |
| `src/app/App.tsx` | **Modify** — wire Sources surface + first-run gate to connectors |
| `src/ui/SourcesPanel.tsx` | **Rewrite composition** — connector list shell |
| `src/ui/sources/HarnessConnectorList.tsx` | **Create** |
| `src/ui/sources/HarnessConnectorRow.tsx` | **Create** |
| `src/ui/sources/HarnessConnectorDetail.tsx` | **Create** |
| `src/ui/sources/SourcesConnectOnboarding.tsx` | **Create** — first-run Discover/Enable/Activate |
| `src/ui/sources/SourcesOnboardingModal.tsx` | **Replace usage** or slim to wrap V2 onboarding |
| `src/ui/sources/ImportJobsTable.tsx` etc. | **Stop importing** from Sources primary panel (keep files for now) |
| `src/daemon/liveConnectorSettings.ts` | **Modify** — after install set activation pending for codex; hermes already enables |
| `src/daemon/settingsService.ts` | **Modify** — optional: map integrations description already updated |
| `scripts/masthead-doctor.js` | **Modify** — connector ready / needs_action summary |
| `src/styles/masthead.css` (or sources CSS) | **Modify** — connector list density only as needed |
| Tests under `src/ui/sources/__tests__/` | **Add** connector UI tests; retire/skip import-primary assertions |

---

## Confirmed Reuse

Do **not** rebuild installers:

- Install/repair/uninstall/test already work via `installLiveConnector` / `/settings/hooks/:runtime/{install,test,uninstall}`.
- Hermes Python plugin + `plugins.enabled` already implemented in `liveConnectorSettings.ts`.
- Presence paths already in `sourcePreflight.ts` / `sourceScanService.ts`.
- Live targets: `LIVE_CONNECTOR_RUNTIMES` in `src/adapters/liveRuntimes.ts`.

---

## Task 1: Shared connector types and pure status helpers

**Files:**
- Create: `src/shared/harnessConnectors.ts`
- Create: `src/shared/__tests__/harnessConnectors.test.ts`

- [ ] **Step 1: Write failing tests for status helpers**

```ts
import { describe, expect, test } from "vitest";
import { deriveLiveStatus, type ConnectorActivation, type ConnectorPresence } from "../harnessConnectors";

describe("deriveLiveStatus", () => {
  test("not installed when connector missing", () => {
    expect(
      deriveLiveStatus({
        installed: false,
        configExists: false,
        missingEvents: ["plugin"],
        mismatchedEvents: [],
        error: undefined,
        activation: undefined,
        lastLiveEventAt: undefined
      })
    ).toEqual({ live: "not_installed" });
  });

  test("needs_action when activation pending even if installed", () => {
    expect(
      deriveLiveStatus({
        installed: true,
        configExists: true,
        missingEvents: [],
        mismatchedEvents: [],
        error: undefined,
        activation: { required: "trust_hooks", message: "Open Codex and run /hooks" },
        lastLiveEventAt: undefined
      })
    ).toEqual({
      live: "needs_action",
      actionRequired: "trust_hooks",
      actionMessage: "Open Codex and run /hooks"
    });
  });

  test("ready when installed and no activation pending", () => {
    expect(
      deriveLiveStatus({
        installed: true,
        configExists: true,
        missingEvents: [],
        mismatchedEvents: [],
        error: undefined,
        activation: undefined,
        lastLiveEventAt: "2026-07-08T12:00:00.000Z"
      })
    ).toEqual({ live: "ready" });
  });

  test("error wins over activation", () => {
    expect(
      deriveLiveStatus({
        installed: false,
        configExists: true,
        missingEvents: [],
        mismatchedEvents: [],
        error: "permission denied",
        activation: { required: "repair", message: "x" },
        lastLiveEventAt: undefined
      })
    ).toEqual({ live: "error", actionMessage: "permission denied" });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

```bash
cd /home/tyler/.codex/worktrees/f503/Masthead
npx vitest run src/shared/__tests__/harnessConnectors.test.ts
```

- [ ] **Step 3: Implement `src/shared/harnessConnectors.ts`**

```ts
import type { LiveConnectorRuntime } from "../adapters/liveRuntimes.ts";

export type ConnectorPresence = "not_found" | "found";
export type ConnectorLive = "not_installed" | "needs_action" | "ready" | "error";
export type ConnectorActionRequired =
  | "trust_hooks"
  | "enable_plugin"
  | "login"
  | "repair"
  | "restart_host"
  | "confirm_activation";

export type ConnectorActivation = {
  required: ConnectorActionRequired;
  message: string;
};

export type HarnessConnectorDto = {
  runtime: LiveConnectorRuntime;
  label: string;
  presence: ConnectorPresence;
  live: ConnectorLive;
  actionRequired?: ConnectorActionRequired;
  actionMessage?: string;
  configPath?: string;
  endpoint?: string;
  stateEndpoint?: string;
  lastLiveEventAt?: string;
  lastTest?: { status: "passed" | "failed"; testedAt: string; message: string };
  checkedPaths?: string[];
  diagnostics?: string[];
  supportsActions: boolean;
  historyFound?: boolean;
  historySessionCount?: number;
};

export type HarnessConnectorsSnapshotDto = {
  generatedAt: string;
  summary: {
    ready: number;
    needsAction: number;
    notInstalled: number;
    notFound: number;
    error: number;
  };
  connectors: HarnessConnectorDto[];
};

export function deriveLiveStatus(input: {
  installed: boolean;
  configExists: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
  error?: string;
  activation?: ConnectorActivation;
  lastLiveEventAt?: string;
}): { live: ConnectorLive; actionRequired?: ConnectorActionRequired; actionMessage?: string } {
  if (input.error) {
    return { live: "error", actionMessage: input.error };
  }
  if (input.mismatchedEvents.length > 0 || (input.configExists && !input.installed && input.missingEvents.length > 0 && input.missingEvents.some((e) => e !== "enabled"))) {
    // installed-but-stale or partial file → repair, unless only "enabled" missing (handled as activation)
  }
  if (!input.installed) {
    if (input.missingEvents.includes("enabled") && input.configExists) {
      return {
        live: "needs_action",
        actionRequired: "enable_plugin",
        actionMessage: "Plugin files present but not enabled in host config."
      };
    }
    if (input.configExists && (input.mismatchedEvents.length > 0 || input.missingEvents.length > 0)) {
      return {
        live: "needs_action",
        actionRequired: "repair",
        actionMessage: "Live connector files need repair."
      };
    }
    return { live: "not_installed" };
  }
  if (input.activation) {
    return {
      live: "needs_action",
      actionRequired: input.activation.required,
      actionMessage: input.activation.message
    };
  }
  return { live: "ready" };
}

export function summarizeConnectors(connectors: HarnessConnectorDto[]): HarnessConnectorsSnapshotDto["summary"] {
  return {
    ready: connectors.filter((c) => c.live === "ready").length,
    needsAction: connectors.filter((c) => c.live === "needs_action").length,
    notInstalled: connectors.filter((c) => c.live === "not_installed").length,
    notFound: connectors.filter((c) => c.presence === "not_found").length,
    error: connectors.filter((c) => c.live === "error").length
  };
}
```

Refine the mismatched/repair branch so tests stay green; keep logic pure and unit-tested. Prefer: `installed === false && configExists` → repair or not_installed based on missingEvents; `activation` only when installed or enable_plugin case.

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/shared/__tests__/harnessConnectors.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/harnessConnectors.ts src/shared/__tests__/harnessConnectors.test.ts
git commit -m "$(cat <<'EOF'
feat(sources): add shared harness connector status types

Sources V2 shared DTO and pure live-status derivation for Discover/Enable/Ready.
EOF
)"
```

---

## Task 2: Activation store (Codex trust pending)

**Why:** Install writes files but Codex still needs `/hooks` trust. Synthetic test cannot clear that. Store a pending flag cleared only by user confirm or real live event.

**Files:**
- Create: `src/daemon/sources/connectorActivationStore.ts`
- Create: `src/daemon/sources/__tests__/connectorActivationStore.test.ts`
- Modify: `src/daemon/liveConnectorSettings.ts` (call after codex install)
- Modify: schema only if using SQLite; **prefer file under data dir** to avoid migration scope

**Preferred storage (YAGNI):** JSON file next to daemon data:

`{dataDirectory}/connector-activation.json`

```json
{
  "codex": { "required": "trust_hooks", "message": "Open Codex and run /hooks to trust Masthead hooks.", "setAt": "..." }
}
```

- [ ] **Step 1: Failing test — set/get/clear activation**

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConnectorActivation,
  getConnectorActivation,
  setConnectorActivation
} from "../connectorActivationStore";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("connectorActivationStore", () => {
  test("persists and clears runtime activation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-act-"));
    dirs.push(dir);
    await setConnectorActivation(dir, "codex", {
      required: "trust_hooks",
      message: "Open Codex /hooks"
    });
    expect(await getConnectorActivation(dir, "codex")).toMatchObject({ required: "trust_hooks" });
    await clearConnectorActivation(dir, "codex");
    expect(await getConnectorActivation(dir, "codex")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement store with atomic write (0o600)**

Use `writeFile` temp + rename; path `join(dataDirectory, "connector-activation.json")`.

- [ ] **Step 3: On successful `installLiveConnector(config, "codex")`, set activation pending**

In `installLiveConnector`, after writing codex hooks:

```ts
if (runtime === "codex") {
  await setConnectorActivation(dirname(config.databasePath), "codex", {
    required: "trust_hooks",
    message:
      "Open Codex and run /hooks to review and trust Masthead hooks. Untrusted hooks are skipped, including for codex exec."
  });
}
```

- [ ] **Step 4: On real live state or raw event for codex (optional auto-clear)**

In harness connector service (Task 3), if `lastLiveEventAt` is after activation `setAt`, treat activation as cleared (or clear file). Prefer auto-clear on observed live event so dogfood doesn’t need a button — still expose **Confirm trusted** for users who trusted but haven’t run yet.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/sources/connectorActivationStore.ts src/daemon/sources/__tests__/connectorActivationStore.test.ts src/daemon/liveConnectorSettings.ts
git commit -m "$(cat <<'EOF'
feat(sources): track pending host activation after connector install

Codex install marks trust_hooks pending until confirmed or real live capture.
EOF
)"
```

---

## Task 3: `harnessConnectorService` merge layer

**Files:**
- Create: `src/daemon/sources/harnessConnectorService.ts`
- Create: `src/daemon/sources/__tests__/harnessConnectorService.test.ts`

- [ ] **Step 1: Write failing integration-style unit test with temp home**

```ts
// Sketch — use temp home with fake preflight by injecting deps or env MASTHEAD_* paths
test("lists all LIVE_CONNECTOR_RUNTIMES with presence and live status", async () => {
  const snapshot = await listHarnessConnectors(db, config);
  expect(snapshot.connectors.map((c) => c.runtime).sort()).toEqual([...LIVE_CONNECTOR_RUNTIMES].sort());
  expect(snapshot.summary).toMatchObject({
    ready: expect.any(Number),
    needsAction: expect.any(Number)
  });
});

test("hermes missing enabled is needs_action enable_plugin", async () => {
  // install plugin files without enabled list → live needs_action
});

test("codex with pending trust is needs_action not ready", async () => {
  // installed hooks + activation store pending
});
```

- [ ] **Step 2: Implement `listHarnessConnectors(db, config)`**

Pseudo-implementation:

```ts
export async function listHarnessConnectors(db: MastheadDatabase, config: DaemonConfig): Promise<HarnessConnectorsSnapshotDto> {
  const now = new Date().toISOString();
  const context = { homeDir: config.codexHomeDir, now, exclusions: [] as string[] };
  const [preflights, liveSettings, latestByRuntime] = await Promise.all([
    preflightAllAdapters(context), // may not include codex — bridge codex presence separately
    getLiveConnectorSettings(config),
    latestLiveEventAtByRuntime(db) // query live_state_reports or raw sessions
  ]);

  const connectors: HarnessConnectorDto[] = [];
  for (const runtime of LIVE_CONNECTOR_RUNTIMES) {
    const live = liveSettings.find((s) => s.runtime === runtime)!;
    const pre = preflights.find((p) => p.runtime === runtime);
    const presence: ConnectorPresence =
      pre && pre.state !== "not_detected" && pre.state !== "planned"
        ? "found"
        : (await pathHintsExist(runtime, config))
          ? "found"
          : "not_found";

    // Hermes enable gap already in missingEvents
    let activation = await getConnectorActivation(dirname(config.databasePath), runtime);
    if (!activation && live.missingEvents.includes("enabled")) {
      activation = {
        required: "enable_plugin",
        message: "Enable the Masthead plugin in the host harness config."
      };
    }
    // Auto-clear trust pending if live event after setAt
    if (activation && latestByRuntime.get(runtime) && isAfter(latestByRuntime.get(runtime)!, activation.setAt)) {
      await clearConnectorActivation(dirname(config.databasePath), runtime);
      activation = undefined;
    }

    const derived = deriveLiveStatus({
      installed: live.installed,
      configExists: live.configExists,
      missingEvents: live.missingEvents,
      mismatchedEvents: live.mismatchedEvents,
      error: live.error,
      activation,
      lastLiveEventAt: latestByRuntime.get(runtime)
    });

    connectors.push({
      runtime,
      label: live.label,
      presence,
      live: derived.live,
      actionRequired: derived.actionRequired,
      actionMessage: derived.actionMessage,
      configPath: live.configPath,
      endpoint: live.endpoint,
      stateEndpoint: live.stateEndpoint,
      lastLiveEventAt: latestByRuntime.get(runtime),
      lastTest: undefined, // fill from settings lastTest if runtime-scoped later
      checkedPaths: pre?.checkedPaths.map((p) => p.path) ?? [],
      diagnostics: (pre?.diagnostics ?? []).map((d) => d.message),
      supportsActions: true,
      historyFound: (pre?.discoveredCount ?? 0) > 0,
      historySessionCount: pre?.discoveredCount
    });
  }

  return {
    generatedAt: now,
    summary: summarizeConnectors(connectors),
    connectors
  };
}
```

**Codex presence:** `supportedAdapters` may omit codex. Add explicit codex path check: `exists(~/.codex)` or `hooks.json` / `config.toml` under `config.codexHomeDir` / real home. Implement `pathHintsExist("codex", config)` using `existsSync(join(home, ".codex"))`.

- [ ] **Step 3: Implement `discoverHarnessConnectors`**

Same as list for V1 (rescan is recompute). Optional: persist last discover timestamp in activation file or setup table. Return same snapshot + `discoveredAt`.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/daemon/sources/__tests__/harnessConnectorService.test.ts src/daemon/sources/__tests__/connectorActivationStore.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/daemon/sources/harnessConnectorService.ts src/daemon/sources/__tests__/harnessConnectorService.test.ts
git commit -m "$(cat <<'EOF'
feat(sources): merge presence and live connectors into HarnessConnectorDto

Daemon Discover/list snapshot for Sources V2 rows.
EOF
)"
```

---

## Task 4: HTTP API + client

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `scripts/masthead-endpoint-matrix.js` (add routes)
- Test: `src/daemon/__tests__/server.test.ts` or new `harnessConnectorsApi.test.ts`

- [ ] **Step 1: Add routes**

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/sources/connectors` | `listHarnessConnectors` |
| `POST` | `/sources/connectors/discover` | recompute list (same as GET for now) |
| `POST` | `/sources/connectors/:runtime/enable` | `installRuntimeHooks` then return connector row snapshot |
| `POST` | `/sources/connectors/:runtime/test` | existing test hooks |
| `POST` | `/sources/connectors/:runtime/uninstall` | uninstall hooks |
| `POST` | `/sources/connectors/:runtime/confirm-activation` | `clearConnectorActivation` for that runtime |

Bridge enable/test/uninstall to existing `installRuntimeHooks` / `test` / `uninstall` in settingsService so behavior stays identical.

- [ ] **Step 2: Worktree bridge allowlist**

If `src/core/worktreeConnector.ts` has a read-route matcher, add `GET /sources/connectors` as read-only. Mutating POSTs stay primary-only.

- [ ] **Step 3: daemonClient**

```ts
export async function listHarnessConnectors(baseUrl = defaultLiveProjectionUrl()): Promise<HarnessConnectorsSnapshotDto> {
  return getJson(baseUrl, "/sources/connectors");
}
export async function discoverHarnessConnectors(baseUrl = defaultLiveProjectionUrl()): Promise<HarnessConnectorsSnapshotDto> {
  return postJson(baseUrl, "/sources/connectors/discover", {});
}
export async function enableHarnessConnector(runtime: string, baseUrl = defaultLiveProjectionUrl()): Promise<HarnessConnectorsSnapshotDto> {
  return postJson(baseUrl, `/sources/connectors/${encodeURIComponent(runtime)}/enable`, {});
}
// test, uninstall, confirmActivation similarly
```

Export `HarnessConnectorDto` types from shared (re-export in daemonClient for UI convenience).

- [ ] **Step 4: API test**

```ts
test("GET /sources/connectors returns eight live targets", async () => {
  const body = await getJson(baseUrl, "/sources/connectors");
  expect(body.ok).toBe(true);
  expect(body.connectors).toHaveLength(8);
});
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(sources): expose harness connectors HTTP API

List/discover/enable/test/uninstall/confirm-activation for Sources V2.
EOF
)"
```

---

## Task 5: Slim Sources controller

**Files:**
- Create: `src/app/sources/useSourcesConnectorsController.ts`
- Create: `src/app/sources/__tests__/useSourcesConnectorsController.test.ts` (optional light)
- Modify: `src/app/App.tsx` to use V2 controller for Sources surface

- [ ] **Step 1: Controller API**

```ts
export function useSourcesConnectorsController(activeProjectionUrl: string, options?: { readOnly?: boolean }) {
  // state: snapshot, busy, status, selectedRuntime, onboardingOpen
  // load: listHarnessConnectors
  // discover: discoverHarnessConnectors
  // enable(runtime) / enableAllDetected()
  // test(runtime) / uninstall(runtime)
  // confirmActivation(runtime)
  // no import polling
}
```

- [ ] **Step 2: First-run open gate**

Open onboarding when:

```ts
snapshot.summary.ready === 0 && snapshot.connectors.some((c) => c.presence === "found")
```

or never ready and never dismissed (`onboardingPreference`). Prefer connect-oriented status over old `importing` setup status for Sources entry.

- [ ] **Step 3: Wire App.tsx Sources branch**

Pass V2 props into `SourcesPanel`; remove required import-job props from primary path (keep optional for advanced later if needed).

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(sources): add live-connect controller for Sources V2

Discover/enable/test without import-job polling.
EOF
)"
```

---

## Task 6: Sources UI rebuild (list + detail)

**Files:**
- Rewrite: `src/ui/SourcesPanel.tsx`
- Create: `src/ui/sources/HarnessConnectorList.tsx`
- Create: `src/ui/sources/HarnessConnectorRow.tsx`
- Create: `src/ui/sources/HarnessConnectorDetail.tsx`
- Create: `src/ui/sources/__tests__/HarnessConnectorList.test.tsx`
- CSS: minimal classes in `src/styles/masthead.css` if needed

### UI requirements (contract §4)

**Top bar:** title Sources, Discover button, summary chips (`N ready · N needs action · N not found`), optional Enable all detected.

**List:** one row per connector — label, presence badge, live badge, last event, primary CTA.

**Detail:** drawer/panel — paths, endpoints, action message, Enable/Repair, Test, Uninstall, Confirm trusted (if `trust_hooks`), advanced checked paths.

**Do not render:** `ImportJobsTable`, `ImportProgressPanel`, `SourcesImportModal`, bulk metadata import CTAs.

- [ ] **Step 1: Failing UI test**

```tsx
test("renders connector rows and Discover", () => {
  const snapshot = {
    generatedAt: "2026-07-08T00:00:00.000Z",
    summary: { ready: 1, needsAction: 1, notInstalled: 1, notFound: 5, error: 0 },
    connectors: [
      {
        runtime: "claude_code",
        label: "Claude Code",
        presence: "found",
        live: "ready",
        supportsActions: true
      },
      {
        runtime: "codex",
        label: "Codex",
        presence: "found",
        live: "needs_action",
        actionRequired: "trust_hooks",
        actionMessage: "Open Codex /hooks",
        supportsActions: true
      }
    ]
  };
  // render SourcesPanel with snapshot
  expect(html).toContain("Discover");
  expect(html).toContain("Claude Code");
  expect(html).toContain("Needs action");
  expect(html).not.toContain("Import jobs");
});
```

- [ ] **Step 2: Implement components**

Reuse `AppButton`, `StatusBadge`, metal surface classes from Workbench/Logbook. Phosphor icons if already used for refresh/plugs.

Row CTA mapping:

| live | CTA |
|---|---|
| not_installed | Enable |
| needs_action + repair | Repair (calls enable/install) |
| needs_action + trust_hooks | Confirm trusted + copy |
| ready | Test |
| error | Repair |

- [ ] **Step 3: Visual check**

Electron Dev or `MASTHEAD_UI_PORT=5180 npm run dev` — desktop width. No live-card DOM reuse.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(sources): rebuild Sources panel as harness connector inventory

Discover/Enable/Activate/Test rows replace import-primary UI.
EOF
)"
```

---

## Task 7: First-run connect onboarding

**Files:**
- Create: `src/ui/sources/SourcesConnectOnboarding.tsx`
- Modify/retire usage: `SourcesOnboardingModal.tsx` (wrap or replace)
- Tests: onboarding opens with found harnesses; Enable selected calls enable

Steps in UI:

1. Intro — “Wire local harnesses for live capture”
2. Discover (auto-run on open)
3. Select found harnesses (default all found)
4. Enable
5. Activation list (only needs_action rows)
6. Done

- [ ] **Step 1: Implement modal using same controller actions**
- [ ] **Step 2: Remove setup plan runner steps that queue metadata import as required**

Modify `src/app/sources/setupPlanRunner.ts` if still used: live capture install only; no `importAdapterMetadata` required step.

- [ ] **Step 3: Tests for onboarding without import preview requirement**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(sources): first-run onboarding for live connector enablement

Discover and enable harnesses without bulk history import ceremony.
EOF
)"
```

---

## Task 8: Doctor + endpoint matrix + docs touch

**Files:**
- `scripts/masthead-doctor.js`
- `scripts/masthead-endpoint-matrix.js`
- `openwiki/sources.md` (already V2 — verify links)
- `docs/reference/daemon-api.md` — document new routes briefly

- [ ] **Step 1: Doctor check `harness-connectors`**

```js
// GET /sources/connectors
// warn if any presence=found && live not ready
// ok if all found are ready or no found
```

- [ ] **Step 2: Endpoint matrix entries for new routes**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(sources): doctor and API matrix for Sources V2 connectors
EOF
)"
```

---

## Task 9: Test cleanup and regression

**Files:**
- Update: `src/ui/sources/__tests__/SourcesPanelImports.test.tsx` — drop or rewrite for V2 (no import modal requirement)
- Update: adapter detail tests that assume import CTAs
- Keep: live connector settings tests (Hermes plugin, etc.)

- [ ] **Step 1: Run focused suites**

```bash
npx vitest run \
  src/shared/__tests__/harnessConnectors.test.ts \
  src/daemon/sources/__tests__/ \
  src/daemon/__tests__/liveConnectorSettings.test.ts \
  src/daemon/__tests__/settingsApi.test.ts \
  src/ui/sources/__tests__/HarnessConnectorList.test.tsx \
  src/ui/sources/__tests__/SourcesPanelImports.test.tsx
```

- [ ] **Step 2: Fix failures without reintroducing import-primary UX**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(sources): align Sources tests with live-connect V2 surface
EOF
)"
```

---

## Task 10: Dogfood acceptance (manual)

Run from worktree with healthy daemon on `17373`.

- [ ] **Step 1: Discover**

```bash
curl -sS http://127.0.0.1:17373/sources/connectors | jq '.summary, [.connectors[] | {runtime, presence, live, actionRequired}]'
```

- [ ] **Step 2: Enable Claude + Hermes + Codex**

```bash
curl -sS -X POST http://127.0.0.1:17373/sources/connectors/claude_code/enable | jq '.connectors[] | select(.runtime=="claude_code")'
curl -sS -X POST http://127.0.0.1:17373/sources/connectors/hermes/enable | jq '.connectors[] | select(.runtime=="hermes")'
curl -sS -X POST http://127.0.0.1:17373/sources/connectors/codex/enable | jq '.connectors[] | select(.runtime=="codex")'
# expect codex live=needs_action actionRequired=trust_hooks
```

- [ ] **Step 3: Real capture**

- Claude: short CLI turn → session on Now  
- Hermes: `hermes chat -q "ping"` → hermes session  
- Codex: after `/hooks` trust, or `codex exec --dangerously-bypass-hook-trust "ping"` → codex session; pending trust auto-clears on real event  

- [ ] **Step 4: UI**

Sources shows Ready / Needs action correctly; no Import jobs table; Discover after uninstall+reinstall of a harness works.

- [ ] **Step 5: Final commit if dogfood fixes needed**

---

## Implementation order (summary)

```text
Task 1 types
  → Task 2 activation store
  → Task 3 merge service
  → Task 4 API + client
  → Task 5 controller
  → Task 6 UI
  → Task 7 first-run
  → Task 8 doctor/docs
  → Task 9 tests
  → Task 10 dogfood
```

---

## Spec coverage checklist

| Contract requirement | Task |
|---|---|
| Discover non-mutating | 3, 4, 6 |
| Enable install hooks | 4 (reuse install), 6 |
| Activate Codex trust | 2, 3, 6 |
| Hermes enable_plugin | 3 (missingEvents), existing install |
| Test synthetic | 4 bridge to existing test |
| Ready ≠ installed | 1, 3 |
| No import dashboard | 6, 7, 9 |
| First install loop | 7 |
| Later Discover | 4, 5, 6 |
| Full 8 runtime catalog | 3 |
| Bounded scan | 3 uses preflight |
| Workbench boundary | out of scope + UI non-goals |
| Doctor | 8 |
| Acceptance dogfood | 10 |

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Codex trust hash unknowable | Activation flag + auto-clear on real live event + Confirm button |
| Preflight omits codex | Explicit `~/.codex` presence hint |
| Breaking Settings hooks UI | Keep `/settings/hooks/*`; Sources wraps same installers |
| Large SourcesPanel rewrite regressions | New components; thin SourcesPanel; keep old files unused until deleted in follow-up |
| Worktree CORS | Use `npm run dev` launcher; don’t hardcode primary projection from secondary UI |

---

## Definition of done

- [ ] `GET /sources/connectors` returns 8 runtimes with presence + live
- [ ] Sources UI is connector inventory only (no import jobs primary)
- [ ] Enable installs connectors; Codex shows needs_action until trust/real event
- [ ] Hermes enable leaves plugin enabled (existing installer)
- [ ] First-run onboarding uses Discover/Enable/Activate
- [ ] Doctor reports connector readiness
- [ ] Focused tests pass; manual dogfood for Claude + Hermes + Codex path
- [ ] Contract `docs/reference/sources-v2.md` still accurate (update only if API names differ)

---

## Self-review notes

- No placeholder “TBD” tasks — each task names files, commands, and code sketches.
- Types `HarnessConnectorDto` / `deriveLiveStatus` defined in Task 1 and reused consistently.
- Import APIs intentionally not deleted — only decoupled from Sources UX.
- Activation store is file-based to avoid schema migration blocking the UI rebuild; can move to SQLite later if needed.
