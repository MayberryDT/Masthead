# Electron Collector Autostart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Dispatch one fresh subagent per task. After each task, the main agent must inspect the diff, run the listed verification, and only then dispatch the next task.

**Goal:** Make the Electron window appear immediately, start or reuse the local Masthead collector after first paint, keep Now, Logbook, Sources, Usage, and Settings on one truthful connection state, and show visible startup progress while the collector comes online.

**Architecture:** Keep Electron main-process startup fast and non-blocking. The renderer asks the existing desktop bridge to start the collector after the app has painted, then the shared connection provider probes the returned connector URL and becomes the single source of connection truth for every surface. Startup status is rendered inside the existing recovery strip, not through a splash screen or blocking window creation.

**Tech Stack:** Electron Forge, React, TypeScript, Vite, Vitest, happy-dom, existing Masthead daemon IPC, packaged daemon resources.

---

## Optimized For Subagent-Driven Execution

Use these handoff rules for every task:

- One task per subagent.
- The subagent may only touch files listed in its task.
- The subagent must run that task's verification commands and report exact results.
- The main agent reviews the diff before dispatching the next task.
- Do not rebuild or install production until Task 7.
- Do not modify local launcher files until Task 7.
- Do not push or merge.

Review gates:

1. Task 1 must land before any renderer autostart work, because all surfaces depend on the connection provider contract.
2. Task 2 must land before Task 3, because progress UI should display real startup state rather than a speculative state model.
3. Task 4 is a test-only surface verification task; it may reveal Task 2 defects, but should not include broad UI refactors.
4. Task 5 must land before production install, because the previous packaged smoke did not exercise the normal launch path.
5. Task 7 is the only task allowed to update the installed production bundle.

## Current Diagnosis

Normal Electron launch creates the window and loads the renderer, but it does not call `startLiveConnector`. The collector currently starts only from:

- `src/electron/main.ts` smoke mode when `MASTHEAD_ELECTRON_SMOKE=1`
- the manual UI action behind `Start collector`

There is also connection-state drift. `App.tsx` can load Now data after the collector starts, while `MastheadConnectionProvider` can remain `offline` when the returned connector URL is still the default `http://127.0.0.1:17373/projection`. That leaves Logbook, Sources, Usage, and Settings stuck behind the offline recovery strip.

The prior production verification missed this because `scripts/masthead-electron-packaged-smoke.js` used the smoke-only startup path. It proved packaged daemon resources work, but not that a normal menu launch starts the collector.

## Implementation Boundaries

Planned code changes:

- `src/app/connection/MastheadConnectionProvider.tsx`
  - Add `connectTo(url)` so a connector start can force a probe even when the base URL is unchanged.

- `src/app/App.tsx`
  - Start the collector after first paint when running in Electron and the connection is offline or incompatible.
  - Reuse one startup function for automatic and manual starts.
  - Call `connection.connectTo(result.projectionUrl)` after startup.
  - Keep a bounded, non-sensitive startup log.

- `src/ui/ConnectionRecoveryPanel.tsx`
  - Render collector startup state and a compact startup timeline.

- `src/styles/masthead.css`
  - Add restrained startup animation and timeline styles.

- `src/electron/main.ts`
  - Add smoke support for normal renderer-driven autostart.

- `scripts/masthead-electron-packaged-smoke.js`
  - Make packaged smoke verify renderer autostart, not only the old main-process shortcut.

Planned tests:

- `src/app/connection/__tests__/MastheadConnectionProvider.test.tsx`
- `src/app/__tests__/collectorAutostart.test.tsx`
- `src/ui/__tests__/ConnectionRecoveryPanel.test.tsx`
- existing Electron packaged smoke script

---

### Task 1: Make The Connection Provider Re-Probe Returned URLs

**Purpose:** Fix the root cause of Now being live while Logbook, Sources, Usage, and Settings stay offline.

**Files:**
- Modify: `src/app/connection/MastheadConnectionProvider.tsx`
- Modify: `src/app/connection/__tests__/MastheadConnectionProvider.test.tsx`

- [ ] **Step 1: Write the failing provider test**

Add this test inside `describe("MastheadConnectionProvider helpers", ...)`:

```tsx
test("connectTo probes the returned URL even when the normalized base URL is unchanged", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response("offline", { status: 503 }))
    .mockResolvedValueOnce(jsonResponse(currentHealth));
  vi.stubGlobal("fetch", fetchMock);

  const container = document.createElement("div");
  const root = createRoot(container);
  let latest: MastheadConnectionContextValue | undefined;

  function Consumer() {
    latest = useMastheadConnection();
    return <span>{latest.state.state}</span>;
  }

  await act(async () => {
    root.render(
      <MastheadConnectionProvider initialUrl="http://127.0.0.1:17373/projection">
        <Consumer />
      </MastheadConnectionProvider>
    );
    await flushEffects();
  });

  expect(latest?.state.state).toBe("offline");

  await act(async () => {
    await latest?.connectTo("http://127.0.0.1:17373/projection");
    await flushEffects();
  });

  expect(latest?.state.state).toBe("ready");
  expect(latest?.baseUrl).toBe("http://127.0.0.1:17373");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  root.unmount();
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/app/connection/__tests__/MastheadConnectionProvider.test.tsx --run
```

Expected: fail because `connectTo` does not exist.

- [ ] **Step 3: Add `connectTo` to the context type**

Update `MastheadConnectionContextValue`:

```tsx
export type MastheadConnectionContextValue = {
  api: MastheadApiClient;
  baseUrl: string;
  connectTo: (url: string) => Promise<void>;
  setBaseUrl: (url: string) => void;
  refresh: () => Promise<void>;
  state: MastheadConnectionState;
  writable: boolean;
};
```

- [ ] **Step 4: Refactor probing into a target-base helper**

Inside `MastheadConnectionProvider`, replace the current `refresh` body with a reusable helper. Use a fresh `MastheadApiClient` for the target URL so the probe does not depend on React state settling first.

```tsx
const probeBaseUrl = useCallback(async (targetBaseUrl: string) => {
  const requestId = refreshRequestIdRef.current + 1;
  refreshRequestIdRef.current = requestId;
  const isCurrentRequest = () => refreshRequestIdRef.current === requestId;
  const startedAt = performance.now();
  const targetApi = new MastheadApiClient(targetBaseUrl);

  setState({ state: "probing", baseUrl: targetBaseUrl });
  try {
    const health = await targetApi.getHealth();
    if (!isCurrentRequest()) return;

    if (health.runtime?.writable === false) {
      logConnectionProbe({ baseUrl: targetBaseUrl, elapsedMs: elapsedMs(startedAt), state: "read_only" });
      setState({ state: "read_only", baseUrl: targetBaseUrl, health, writable: false });
      return;
    }

    logConnectionProbe({ baseUrl: targetBaseUrl, elapsedMs: elapsedMs(startedAt), state: "ready" });
    setState({ state: "ready", baseUrl: targetBaseUrl, health, writable: true });
  } catch (error) {
    if (!isCurrentRequest()) return;

    if (error instanceof MastheadApiError && error.kind === "incompatible") {
      logConnectionProbe({
        baseUrl: targetBaseUrl,
        elapsedMs: elapsedMs(startedAt),
        error: error.message,
        state: "incompatible",
        status: error.status,
        url: error.url
      });
      setState({ state: "incompatible", baseUrl: targetBaseUrl, error: error.message });
      return;
    }

    logConnectionProbe({
      baseUrl: targetBaseUrl,
      elapsedMs: elapsedMs(startedAt),
      error: error instanceof Error ? error.message : String(error),
      state: "offline",
      status: error instanceof MastheadApiError ? error.status : undefined,
      url: error instanceof MastheadApiError ? error.url : undefined
    });
    setState({ state: "offline", baseUrl: targetBaseUrl, error: error instanceof Error ? error.message : String(error) });
  }
}, []);
```

Then define:

```tsx
const refresh = useCallback(async () => {
  await probeBaseUrl(baseUrl);
}, [baseUrl, probeBaseUrl]);

const connectTo = useCallback(
  async (url: string) => {
    const nextBaseUrl = normalizeDaemonBaseUrl(url);
    setBaseUrlState(nextBaseUrl);
    await probeBaseUrl(nextBaseUrl);
  },
  [probeBaseUrl]
);
```

Add `connectTo` to the context value.

- [ ] **Step 5: Run the provider tests**

Run:

```bash
npm test -- src/app/connection/__tests__/MastheadConnectionProvider.test.tsx --run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/connection/MastheadConnectionProvider.tsx src/app/connection/__tests__/MastheadConnectionProvider.test.tsx
git commit -m "fix: refresh masthead connection after connector start"
```

**Main-agent review gate:** Confirm the provider exposes `connectTo`, existing `refresh` behavior still works, and no surface code was changed in this task.

---

### Task 2: Start The Collector After First Paint

**Purpose:** Preserve fast window appearance while automatically starting or reusing the packaged collector after the renderer paints.

**Files:**
- Modify: `src/app/App.tsx`
- Create: `src/app/__tests__/collectorAutostart.test.tsx`

- [ ] **Step 1: Write the failing autostart test**

Create `src/app/__tests__/collectorAutostart.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import currentHealth from "../../../fixtures/protocol/current-health.json";
import { App } from "../App";
import { MastheadConnectionProvider } from "../connection/MastheadConnectionProvider";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("collector autostart", () => {
  test("renders Masthead before starting the collector through the desktop bridge", async () => {
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("start_live_connector_command");
      return {
        ok: true,
        started: true,
        baseUrl: "http://127.0.0.1:17373",
        command: "masthead daemon",
        health: { apiVersion: 1, databaseId: "db", mode: "primary" },
        message: "Started local Masthead collector.",
        projectionUrl: "http://127.0.0.1:17373/projection"
      };
    });

    window.mastheadDesktop = { invoke };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => window.clearTimeout(id));

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("offline", { status: 503 }))
        .mockResolvedValueOnce(jsonResponse(currentHealth))
        .mockResolvedValue(jsonResponse(liveProjectionResponse()))
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17373/projection">
          <App />
        </MastheadConnectionProvider>
      );
    });

    expect(container.textContent).toContain("Masthead");
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      await flushTimers();
      await flushTimers();
      await flushTimers();
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    root.unmount();
    delete window.mastheadDesktop;
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function liveProjectionResponse() {
  return {
    ok: true,
    source: "live",
    generatedAt: "2026-07-04T00:00:00.000Z",
    projection: emptyProjection(),
    events: [],
    gitSnapshots: [],
    diagnostics: []
  };
}

function emptyProjection() {
  return {
    summary: { active: 0, needsAttention: 0, conflicts: 0, completed: 0, running: 0, needsAction: 0, idle: 0 },
    lanes: [
      { laneId: "running", title: "Running", count: 0, sessionIds: [] },
      { laneId: "idle", title: "Idle", count: 0, sessionIds: [] },
      { laneId: "needs_action", title: "Needs action", count: 0, sessionIds: [] },
      { laneId: "history", title: "History", count: 0, sessionIds: [] }
    ],
    cards: [],
    attentionQueue: [],
    conflicts: []
  };
}
```

- [ ] **Step 2: Run the failing autostart test**

Run:

```bash
npm test -- src/app/__tests__/collectorAutostart.test.tsx --run
```

Expected: fail because no automatic bridge call occurs.

- [ ] **Step 3: Import the bridge availability helper**

In `src/app/App.tsx`, add:

```tsx
import { isDesktopBridgeAvailable } from "./desktopBridge";
```

- [ ] **Step 4: Add an in-flight guard and shared startup callback**

In `App`, add refs near the existing refs:

```tsx
const autoStartAttemptedRef = useRef(false);
const collectorStartInFlightRef = useRef(false);
```

Replace `handleStartConnector` with one shared callback:

```tsx
const startCollector = useCallback(
  async ({ automatic = false }: { automatic?: boolean } = {}) => {
    if (collectorStartInFlightRef.current) return;
    collectorStartInFlightRef.current = true;
    setConnectorAction({
      state: "starting",
      message: automatic ? "Starting local collector after app launch..." : "Starting local collector..."
    });

    try {
      const result = await startLiveConnector();
      if (result.ok) {
        await connection.connectTo(result.projectionUrl);
        setConnectorAction({
          state: "started",
          message: `${result.message} Connected to ${result.baseUrl}.`
        });
        await loadLiveProjection();
        return;
      }

      setConnectorAction({ state: "unsupported", message: result.message });
    } catch (error) {
      setConnectorAction({
        state: "error",
        message: `Could not start collector: ${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      collectorStartInFlightRef.current = false;
    }
  },
  [connection, loadLiveProjection]
);

const handleStartConnector = useCallback(() => {
  void startCollector();
}, [startCollector]);
```

- [ ] **Step 5: Add the after-first-paint effect**

Place this effect after `startCollector` is defined:

```tsx
useEffect(() => {
  if (showDemoData) return;
  if (!isDesktopBridgeAvailable()) return;
  if (autoStartAttemptedRef.current) return;
  if (connection.state.state !== "offline" && connection.state.state !== "incompatible") return;

  autoStartAttemptedRef.current = true;
  let cancelled = false;
  let secondFrame: number | undefined;
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => {
      if (!cancelled) void startCollector({ automatic: true });
    });
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(firstFrame);
    if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
  };
}, [connection.state.state, showDemoData, startCollector]);
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- src/app/__tests__/collectorAutostart.test.tsx src/app/__tests__/connectorClient.test.ts --run
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/App.tsx src/app/__tests__/collectorAutostart.test.tsx
git commit -m "feat: autostart masthead collector after renderer paint"
```

**Main-agent review gate:** Confirm the app still renders before `invoke` is called, and autostart is gated to Electron bridge availability.

---

### Task 3: Add Collector Startup Progress UI

**Purpose:** Make startup transparent without blocking the app or turning Masthead into a noisy log viewer.

**Files:**
- Modify: `src/ui/ConnectionRecoveryPanel.tsx`
- Modify: `src/styles/masthead.css`
- Modify: `src/ui/__tests__/ConnectionRecoveryPanel.test.tsx`

- [ ] **Step 1: Write the failing recovery-panel test**

Add to `src/ui/__tests__/ConnectionRecoveryPanel.test.tsx`:

```tsx
test("renders collector startup progress without direct-address language", () => {
  const html = renderToStaticMarkup(
    <ConnectionRecoveryPanel
      connection={{ state: "offline", baseUrl: "http://127.0.0.1:17373", error: "fetch failed" }}
      action={{ state: "starting", message: "Starting local collector after app launch..." }}
      startupLog={[
        { id: "probe", label: "Checked local collector endpoint", detail: "127.0.0.1:17373" },
        { id: "bridge", label: "Requested desktop bridge start", detail: "Using packaged daemon resources." }
      ]}
      onRetry={() => undefined}
      onStart={() => undefined}
    />
  );

  expect(html).toContain("Starting local collector after app launch");
  expect(html).toContain("Checked local collector endpoint");
  expect(html).toContain("Requested desktop bridge start");
  expect(html).toContain("Starting");
  expect(html).not.toMatch(/\byou|your|panic|urgent|critical/i);
});
```

- [ ] **Step 2: Run the failing panel test**

Run:

```bash
npm test -- src/ui/__tests__/ConnectionRecoveryPanel.test.tsx --run
```

Expected: fail because the new props do not exist.

- [ ] **Step 3: Add typed props**

In `src/ui/ConnectionRecoveryPanel.tsx`, add:

```tsx
type ConnectorActionView = {
  state: "idle" | "starting" | "started" | "unsupported" | "error";
  message?: string;
};

export type CollectorStartupLogEntry = {
  id: string;
  label: string;
  detail?: string;
};
```

Extend `ConnectionRecoveryPanelProps`:

```tsx
type ConnectionRecoveryPanelProps = {
  action?: ConnectorActionView;
  connection: MastheadConnectionState;
  onRetry: () => void;
  onStart: () => void;
  retryLabel?: string;
  startupLog?: CollectorStartupLogEntry[];
};
```

- [ ] **Step 4: Render startup status and timeline**

Inside `ConnectionRecoveryPanel`, compute:

```tsx
const actionMessage = action?.message;
const starting = action?.state === "starting";
```

Add this inside `.connection-detail`, below the current message:

```tsx
{actionMessage ? (
  <div className={`collector-startup-status ${starting ? "is-starting" : ""}`}>
    <span className="collector-startup-pulse" aria-hidden="true" />
    <span>{actionMessage}</span>
  </div>
) : null}

{startupLog?.length ? (
  <ol className="collector-startup-log" aria-label="Collector startup log">
    {startupLog.map((entry) => (
      <li key={entry.id}>
        <span>{entry.label}</span>
        {entry.detail ? <small>{entry.detail}</small> : null}
      </li>
    ))}
  </ol>
) : null}
```

Update the start button:

```tsx
<AppButton variant="primary" disabled={starting} onClick={onStart}>
  {starting ? "Starting" : copy.startLabel}
</AppButton>
```

- [ ] **Step 5: Add CSS near existing connection styles**

Add to `src/styles/masthead.css`:

```css
.collector-startup-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--body);
  font-size: 12px;
}

.collector-startup-pulse {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--blue);
  box-shadow: 0 0 0 0 rgba(46, 167, 255, 0.35);
}

.collector-startup-status.is-starting .collector-startup-pulse {
  animation: collector-startup-pulse 1200ms ease-out infinite;
}

.collector-startup-log {
  display: grid;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 11px;
}

.collector-startup-log li {
  display: grid;
  gap: 2px;
}

.collector-startup-log small {
  color: var(--ash);
  font-size: 11px;
}

@keyframes collector-startup-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(46, 167, 255, 0.35);
  }
  100% {
    box-shadow: 0 0 0 9px rgba(46, 167, 255, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .collector-startup-status.is-starting .collector-startup-pulse {
    animation: none;
  }
}
```

- [ ] **Step 6: Run UI tests**

Run:

```bash
npm test -- src/ui/__tests__/ConnectionRecoveryPanel.test.tsx --run
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/ConnectionRecoveryPanel.tsx src/styles/masthead.css src/ui/__tests__/ConnectionRecoveryPanel.test.tsx
git commit -m "feat: show collector startup progress"
```

**Main-agent review gate:** Confirm the panel still renders existing offline, incompatible, probing, and read-only states.

---

### Task 4: Wire Real Startup Timeline Into App

**Purpose:** Feed the progress UI with real, bounded status from the shared startup path.

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/__tests__/collectorAutostart.test.tsx`

- [ ] **Step 1: Extend the autostart test to assert progress text**

In `src/app/__tests__/collectorAutostart.test.tsx`, after the first render assertion and before flushing timers, add:

```tsx
expect(container.textContent).toContain("No Masthead daemon is responding");
```

After flushing timers, add:

```tsx
expect(container.textContent).toMatch(/Starting local collector|Collector connected/);
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/app/__tests__/collectorAutostart.test.tsx --run
```

Expected: fail because `App` does not pass action or startup log props to the panel yet.

- [ ] **Step 3: Import the log entry type**

In `src/app/App.tsx`, change the recovery panel import:

```tsx
import { ConnectionRecoveryPanel, type CollectorStartupLogEntry } from "../ui/ConnectionRecoveryPanel";
```

- [ ] **Step 4: Add bounded startup log state**

Inside `App`, near `connectorAction`, add:

```tsx
const [collectorStartupLog, setCollectorStartupLog] = useState<CollectorStartupLogEntry[]>([]);
```

Add this helper near other callbacks:

```tsx
const appendCollectorStartupLog = useCallback((entry: Omit<CollectorStartupLogEntry, "id">) => {
  setCollectorStartupLog((current) => [
    ...current.slice(-5),
    { ...entry, id: `${Date.now()}-${current.length}` }
  ]);
}, []);
```

- [ ] **Step 5: Add timeline entries to `startCollector`**

Inside `startCollector`, before `startLiveConnector()`:

```tsx
appendCollectorStartupLog({
  label: "Checked local collector endpoint",
  detail: `${connection.baseUrl}/health`
});
appendCollectorStartupLog({
  label: "Requested desktop bridge start",
  detail: "Using packaged daemon resources."
});
```

After a successful `result.ok` response and before `connection.connectTo(...)`:

```tsx
appendCollectorStartupLog({
  label: "Waiting for compatible health",
  detail: result.baseUrl
});
```

After `connection.connectTo(...)`:

```tsx
appendCollectorStartupLog({
  label: "Collector connected",
  detail: result.baseUrl
});
```

On unsupported and error cases:

```tsx
appendCollectorStartupLog({
  label: "Collector start did not complete",
  detail: result.message
});
```

```tsx
appendCollectorStartupLog({
  label: "Collector start failed",
  detail: error instanceof Error ? error.message : String(error)
});
```

- [ ] **Step 6: Pass state to the panel**

Update `recoveryPanel`:

```tsx
const recoveryPanel = (
  <ConnectionRecoveryPanel
    action={connectorAction}
    connection={connection.state}
    onRetry={connection.refresh}
    onStart={handleStartConnector}
    startupLog={collectorStartupLog}
  />
);
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- src/app/__tests__/collectorAutostart.test.tsx src/ui/__tests__/ConnectionRecoveryPanel.test.tsx --run
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/App.tsx src/app/__tests__/collectorAutostart.test.tsx
git commit -m "feat: wire collector startup timeline"
```

**Main-agent review gate:** Confirm startup log entries do not include secrets, environment values, raw command output, or local database contents.

---

### Task 5: Verify Secondary Surfaces Leave Offline State

**Purpose:** Prevent the exact production symptom from returning.

**Files:**
- Modify: `src/app/__tests__/collectorAutostart.test.tsx`
- Modify only if the test fails for a real product bug: `src/app/App.tsx`

- [ ] **Step 1: Add the secondary-surface regression test**

Add this test to `src/app/__tests__/collectorAutostart.test.tsx`:

```tsx
test("after autostart, secondary surfaces do not remain offline", async () => {
  const invoke = vi.fn(async () => ({
    ok: true,
    started: true,
    baseUrl: "http://127.0.0.1:17373",
    command: "masthead daemon",
    health: { apiVersion: 1, databaseId: "db", mode: "primary" },
    message: "Started local Masthead collector.",
    projectionUrl: "http://127.0.0.1:17373/projection"
  }));

  window.mastheadDesktop = { invoke };
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
    return window.setTimeout(() => callback(performance.now()), 0);
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => window.clearTimeout(id));

  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("offline", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(currentHealth))
      .mockResolvedValue(jsonResponse(liveProjectionResponse()))
  );

  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MastheadConnectionProvider initialUrl="http://127.0.0.1:17373/projection">
        <App />
      </MastheadConnectionProvider>
    );
    await flushTimers();
    await flushTimers();
    await flushTimers();
  });

  const logbookButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Logbook"));
  await act(async () => {
    logbookButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushTimers();
  });

  expect(container.textContent).not.toContain("No Masthead daemon is responding");
  expect(container.textContent).not.toContain("Collector offline");
  root.unmount();
  delete window.mastheadDesktop;
});
```

- [ ] **Step 2: Run the regression test**

Run:

```bash
npm test -- src/app/__tests__/collectorAutostart.test.tsx --run
```

Expected: pass after Tasks 1, 2, and 4. If it fails, inspect `needsRecoveryPanel`, `effectiveLiveConnection`, and the relevant surface controller inputs before changing code.

- [ ] **Step 3: Apply the smallest surface-state fix only if needed**

If `connection.state.state` is `ready` and secondary surfaces still render recovery UI, make the gating explicit in `App.tsx`:

```tsx
const needsRecoveryPanel = connection.state.state === "offline" || connection.state.state === "incompatible";
const isLiveConnection =
  (connection.state.state === "ready" || connection.state.state === "read_only") &&
  liveConnection.state === "live";
```

Do not make Logbook, Sources, Usage, or Settings infer readiness from Now cards alone. They should use the central provider state so writable/read-only capability remains truthful.

- [ ] **Step 4: Run focused app and UI tests**

Run:

```bash
npm test -- src/app src/ui --run
```

Expected: pass.

- [ ] **Step 5: Commit**

If only the test changed:

```bash
git add src/app/__tests__/collectorAutostart.test.tsx
git commit -m "test: cover connected secondary masthead surfaces"
```

If `App.tsx` also changed:

```bash
git add src/app/App.tsx src/app/__tests__/collectorAutostart.test.tsx
git commit -m "fix: keep masthead surfaces connected after collector start"
```

**Main-agent review gate:** Confirm the test switches at least one secondary surface and fails against the old drift behavior.

---

### Task 6: Make Packaged Smoke Verify Normal Renderer Autostart

**Purpose:** Close the production verification gap that let the current bug ship.

**Files:**
- Modify: `src/electron/main.ts`
- Modify: `scripts/masthead-electron-packaged-smoke.js`

- [ ] **Step 1: Add imports in `src/electron/main.ts`**

Extend the existing daemon launcher import:

```ts
import {
  connectorBaseUrl,
  mcpLaunchConfig,
  parseCompatibleHealth,
  resolveDaemonLaunchTarget,
  type StartLiveConnectorResult,
  startLiveConnector,
  stopOwnedDaemons,
  validateMcpLaunchConfig
} from "./daemonLauncher";
```

- [ ] **Step 2: Add smoke mode branching**

Change:

```ts
if (process.env.MASTHEAD_ELECTRON_SMOKE === "1") {
  void runSmokeAndQuit(mainWindow);
}
```

to:

```ts
if (process.env.MASTHEAD_ELECTRON_SMOKE === "1") {
  void runSmokeAndQuit(mainWindow, process.env.MASTHEAD_ELECTRON_SMOKE_MODE);
}
```

Change the function signature:

```ts
async function runSmokeAndQuit(window: BrowserWindow, mode = "main-start"): Promise<void> {
```

- [ ] **Step 3: Split connector startup inside smoke**

Inside `runSmokeAndQuit`, replace the direct connector start with:

```ts
const connector =
  mode === "renderer-autostart"
    ? await waitForRendererStartedConnector()
    : await startLiveConnector(
        {
          currentDir: process.cwd(),
          defaultDataDir: isElectronDevMode() ? electronDevDataDirectory() : undefined,
          env: electronDaemonEnv(),
          resourcesPath: process.resourcesPath,
          userDataDir: app.getPath("userData")
        },
        rendererTrustedOrigins({ allowDevServer: isElectronDevMode() }),
        ownedDaemonChildren
      );
```

- [ ] **Step 4: Add the renderer-autostart wait helper**

Add this helper in `src/electron/main.ts` near `stopSmokeDaemons`:

```ts
async function waitForRendererStartedConnector(timeoutMs = 12_000): Promise<StartLiveConnectorResult> {
  const target = resolveDaemonLaunchTarget({
    currentDir: process.cwd(),
    defaultDataDir: isElectronDevMode() ? electronDevDataDirectory() : undefined,
    env: electronDaemonEnv(),
    resourcesPath: process.resourcesPath,
    userDataDir: app.getPath("userData")
  });
  const baseUrl = connectorBaseUrl(target.port);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) }).catch(() => undefined);
    if (response?.ok) {
      const health = parseCompatibleHealth(await response.json());
      if (health?.dataDirectory === target.dataDirectory) {
        await fetch(`${baseUrl}/projection`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
        return {
          ok: true,
          started: true,
          baseUrl,
          command: "masthead daemon",
          health,
          message: "Renderer autostart started local Masthead collector.",
          projectionUrl: `${baseUrl}/projection`
        };
      }
    }
    await delay(250);
  }

  throw new Error("Renderer autostart did not start a compatible Masthead collector.");
}
```

- [ ] **Step 5: Update packaged smoke environment**

In `scripts/masthead-electron-packaged-smoke.js`, update the child environment:

```js
env: {
  ...process.env,
  ...disableSandboxForCi,
  MASTHEAD_DATA_DIR: dataDir,
  MASTHEAD_ELECTRON_SMOKE: "1",
  MASTHEAD_ELECTRON_SMOKE_MODE: "renderer-autostart",
  MASTHEAD_GIT_REFRESH_MS: "0"
}
```

Add this assertion after parsing smoke JSON:

```js
if (!parsed.connector?.baseUrl || parsed.connector?.health?.dataDirectory !== dataDir) {
  console.error(`Renderer autostart did not use the smoke data directory: ${JSON.stringify(parsed.connector)}`);
  process.exit(1);
}
if (!parsed.connector?.message?.includes("Renderer autostart")) {
  console.error(`Packaged smoke did not exercise renderer autostart: ${JSON.stringify(parsed.connector)}`);
  process.exit(1);
}
```

- [ ] **Step 6: Run Electron tests**

Run:

```bash
npm run test:electron
npm run test:electron-security
```

Expected: pass.

- [ ] **Step 7: Build package and run packaged smoke**

Run:

```bash
npm run build:desktop
node scripts/masthead-electron-packaged-smoke.js ./out/Masthead-linux-x64/masthead
```

Expected: packaged smoke passes and reports renderer autostart.

- [ ] **Step 8: Commit**

```bash
git add src/electron/main.ts scripts/masthead-electron-packaged-smoke.js
git commit -m "test: smoke normal electron collector autostart"
```

**Main-agent review gate:** Confirm the smoke can no longer pass by calling `startLiveConnector` directly from `main.ts`.

---

### Task 7: Full Verification, Production Rebuild, Install, And Closeout

**Purpose:** Produce and install the fixed production app only after the normal launch path is verified.

**Files:**
- Local production bundle and symlink only after all repo checks pass.
- No planned source edits.

- [ ] **Step 1: Run full repo verification**

Run:

```bash
npm run typecheck
npm test -- --run
npm run build
npm run check:surface-contract
npm run check:product-contract
npm run verify:no-citations
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Run Electron verification**

Run:

```bash
npm run test:electron
npm run test:electron-security
npm run build:desktop
node scripts/masthead-electron-packaged-smoke.js ./out/Masthead-linux-x64/masthead
```

Expected: all pass. The packaged smoke output must prove renderer autostart, not main-process smoke startup.

- [ ] **Step 3: Install a versioned production bundle**

Run:

```bash
version=$(node -p "require('./package.json').version")
commit=$(git rev-parse --short HEAD)
target="$HOME/.local/share/masthead-production/Masthead-linux-x64-$version-$commit"
rm -rf "$target.tmp"
cp -a out/Masthead-linux-x64 "$target.tmp"
mv "$target.tmp" "$target"
ln -sfn "$target" "$HOME/.local/share/masthead-production/current"
```

Do not replace the production desktop entry if it already points at `/home/tyler/.local/bin/masthead-production`.

- [ ] **Step 4: Verify normal production launch**

Stop existing production and dev Masthead processes only if they would mask the test. Then run:

```bash
gtk-launch ai.animas.masthead
sleep 8
pgrep -a -u "$(id -u)" -f '[/]home/tyler/.local/share/masthead-production/.*/masthead'
pgrep -a -u "$(id -u)" -f '[/]home/tyler/.local/share/masthead-production/.*/resources/daemon/node'
curl -fsS --max-time 3 http://127.0.0.1:17373/health
wmctrl -lx | rg -i 'masthead'
```

Expected:

- Electron window appears immediately.
- Startup progress appears while the collector starts.
- `/health` reports `product: "masthead"`, `apiVersion: 1`, and `runtime.writable: true`.
- Process paths point at `/home/tyler/.local/share/masthead-production/Masthead-linux-x64-<version>-<commit>`.
- No production process points at `/home/tyler/Documents/Masthead/src-tauri`.

- [ ] **Step 5: Verify secondary surfaces manually**

Use the production app window:

1. Open `Logbook`.
2. Open `Sources`.
3. Open `Usage`.
4. Open `Settings`.

Expected:

- None of these surfaces show `No Masthead daemon is responding`.
- None show `Collector offline` after startup completes.
- Sources, Usage, and Settings can issue their normal read requests against the connected collector.

- [ ] **Step 6: Verify dev remains usable**

Run:

```bash
systemctl --user restart masthead-dev-electron.service
sleep 8
systemctl --user is-active masthead-dev-electron.service
pgrep -a -u "$(id -u)" -f '[/]home/tyler/Documents/Masthead/node_modules/electron/dist/electron'
```

Expected: `Masthead Dev` remains separate from production and still starts through the dev service.

- [ ] **Step 7: Write GBrain closeout**

Write a concise session closeout under `sessions/2026/07/` with:

- final commit hash
- production bundle path
- desktop entry path
- startup behavior verified
- production and dev process paths
- commands run
- remaining risks

**Main-agent review gate:** Confirm final response includes the production bundle path, desktop entry path, whether dev was preserved, and any verification that could not be completed.

---

## Optimizer Score

Final score: 93/100.

Rubric:

- Goal clarity, 10/10: objective and definition of done are measurable.
- Completeness, 18/20: covers provider state, renderer autostart, progress UI, packaged smoke, production install, and dev preservation.
- Sequencing and dependencies, 18/20: subagent order is explicit and review-gated. Some tasks still depend on test timing in happy-dom, which is acceptable but worth watching.
- Feasibility, 14/15: uses existing bridge and daemon launch path; avoids a new launcher system.
- Risks and mitigations, 14/15: closes the prior smoke gap and avoids secret/log leakage. Manual surface verification remains necessary.
- Success metrics, 10/10: each task has concrete commands and expected outcomes.
- Specificity, 9/10: code snippets and paths are explicit. Electron smoke helper typing may need a small local adjustment during implementation.

Score trajectory: 82 -> 90 -> 93 -> 93.

Substantive optimizer changes:

- Split progress UI from app wiring so subagents can review UI and startup behavior separately.
- Added a provider-level same-URL probe fix as the first hard dependency.
- Reworked packaged smoke so it cannot pass through the old main-process-only shortcut.
- Added explicit subagent review gates and a manual secondary-surface production check.
