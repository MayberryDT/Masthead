// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HarnessConnectorsSnapshotDto } from "../../../shared/harnessConnectors";
import { mastheadOnboardingDismissedStorageKey } from "../../onboardingPreference";
import {
  useSourcesConnectorsController,
  type UseSourcesConnectorsControllerResult
} from "../useSourcesConnectorsController";
import {
  confirmHarnessConnectorActivation,
  discoverHarnessConnectors,
  enableHarnessConnector,
  listHarnessConnectors,
  testHarnessConnector,
  uninstallHarnessConnector
} from "../../daemonClient";

const daemonClientMocks = vi.hoisted(() => ({
  confirmHarnessConnectorActivation: vi.fn(),
  discoverHarnessConnectors: vi.fn(),
  enableHarnessConnector: vi.fn(),
  listHarnessConnectors: vi.fn(),
  testHarnessConnector: vi.fn(),
  uninstallHarnessConnector: vi.fn()
}));

vi.mock("../../daemonClient", async () => {
  const actual = await vi.importActual<typeof import("../../daemonClient")>("../../daemonClient");
  return {
    ...actual,
    ...daemonClientMocks
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessProps = {
  activeProjectionUrl: string;
  readOnly?: boolean;
  autoLoad?: boolean;
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let latestResult: UseSourcesConnectorsControllerResult | undefined;

const baseUrl = "http://127.0.0.1:17373/projection";

afterEach(async () => {
  latestResult = undefined;
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.clearAllMocks();
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("useSourcesConnectorsController", () => {
  test("auto-loads connectors and opens first-run onboarding when none are ready but some are found", async () => {
    vi.mocked(listHarnessConnectors).mockResolvedValue(snapshot({ ready: 0, found: true }));

    await renderHarness({ activeProjectionUrl: baseUrl });
    await waitFor(() => latest()?.snapshot !== undefined);

    expect(listHarnessConnectors).toHaveBeenCalledWith(baseUrl);
    expect(latest().snapshot?.summary.ready).toBe(0);
    expect(latest().onboardingOpen).toBe(true);
  });

  test("does not auto-open onboarding when preference is dismissed", async () => {
    window.localStorage.setItem(mastheadOnboardingDismissedStorageKey, "1");
    vi.mocked(listHarnessConnectors).mockResolvedValue(snapshot({ ready: 0, found: true }));

    await renderHarness({ activeProjectionUrl: baseUrl });
    await waitFor(() => latest()?.snapshot !== undefined);

    expect(latest().onboardingOpen).toBe(false);
  });

  test("discover replaces snapshot and sets status", async () => {
    vi.mocked(listHarnessConnectors).mockResolvedValue(snapshot({ ready: 0, found: true }));
    vi.mocked(discoverHarnessConnectors).mockResolvedValue(
      snapshot({ ready: 1, found: true, live: "ready" })
    );

    await renderHarness({ activeProjectionUrl: baseUrl });
    await waitFor(() => latest()?.snapshot !== undefined);

    await act(async () => {
      await latest().discover();
    });

    expect(discoverHarnessConnectors).toHaveBeenCalledWith(baseUrl);
    expect(latest().snapshot?.summary.ready).toBe(1);
    expect(latest().status).toMatch(/Refreshed connections/i);
  });

  test("enable updates snapshot; readOnly actions no-op", async () => {
    vi.mocked(listHarnessConnectors).mockResolvedValue(snapshot({ ready: 0, found: true }));
    vi.mocked(enableHarnessConnector).mockResolvedValue(
      snapshot({ ready: 1, found: true, live: "ready" })
    );

    await renderHarness({ activeProjectionUrl: baseUrl, readOnly: true });
    await waitFor(() => latest()?.snapshot !== undefined);

    await act(async () => {
      await latest().enable("codex");
    });
    expect(enableHarnessConnector).not.toHaveBeenCalled();
    expect(latest().status).toMatch(/read-only/i);

    await rerenderHarness({ activeProjectionUrl: baseUrl, readOnly: false });
    await act(async () => {
      await latest().enable("codex");
    });

    expect(enableHarnessConnector).toHaveBeenCalledWith("codex", baseUrl);
    expect(latest().snapshot?.summary.ready).toBe(1);
  });

  test("enableAllDetected enables found connectors that are not ready", async () => {
    const initial = snapshot({ ready: 0, found: true });
    initial.connectors = [
      connector("codex", { presence: "found", live: "not_installed" }),
      connector("claude_code", { presence: "found", live: "ready" }),
      connector("cursor", { presence: "not_found", live: "not_installed" })
    ];
    initial.summary = {
      ready: 1,
      needsAction: 0,
      notInstalled: 2,
      notFound: 1,
      error: 0
    };
    vi.mocked(listHarnessConnectors).mockResolvedValue(initial);
    vi.mocked(enableHarnessConnector).mockImplementation(async (runtime) => {
      const next = structuredClone(initial);
      const row = next.connectors.find((item) => item.runtime === runtime);
      if (row) row.live = "ready";
      next.summary.ready = next.connectors.filter((item) => item.live === "ready").length;
      return next;
    });

    await renderHarness({ activeProjectionUrl: baseUrl });
    await waitFor(() => latest()?.snapshot !== undefined);

    await act(async () => {
      await latest().enableAllDetected();
    });

    expect(enableHarnessConnector).toHaveBeenCalledTimes(1);
    expect(enableHarnessConnector).toHaveBeenCalledWith("codex", baseUrl);
    expect(latest().status).toMatch(/Enable all complete/i);
  });

  test("test, uninstall, and confirmActivation call daemon clients", async () => {
    vi.mocked(listHarnessConnectors).mockResolvedValue(snapshot({ ready: 1, found: true, live: "ready" }));
    vi.mocked(testHarnessConnector).mockResolvedValue(snapshot({ ready: 1, found: true, live: "ready" }));
    vi.mocked(uninstallHarnessConnector).mockResolvedValue(
      snapshot({ ready: 0, found: true, live: "not_installed" })
    );
    vi.mocked(confirmHarnessConnectorActivation).mockResolvedValue(
      snapshot({ ready: 1, found: true, live: "ready" })
    );

    await renderHarness({ activeProjectionUrl: baseUrl });
    await waitFor(() => latest()?.snapshot !== undefined);

    await act(async () => {
      await latest().test("codex");
      await latest().uninstall("codex");
      await latest().confirmActivation("codex");
    });

    expect(testHarnessConnector).toHaveBeenCalledWith("codex", baseUrl);
    expect(uninstallHarnessConnector).toHaveBeenCalledWith("codex", baseUrl);
    expect(confirmHarnessConnectorActivation).toHaveBeenCalledWith("codex", baseUrl);
  });
});

function Harness(props: HarnessProps) {
  latestResult = useSourcesConnectorsController(props.activeProjectionUrl, {
    readOnly: props.readOnly,
    autoLoad: props.autoLoad
  });
  return null;
}

async function renderHarness(props: HarnessProps) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Harness {...props} />);
  });
}

async function rerenderHarness(props: HarnessProps) {
  await act(async () => {
    root?.render(<Harness {...props} />);
  });
}

function latest(): UseSourcesConnectorsControllerResult {
  if (!latestResult) throw new Error("controller result missing");
  return latestResult;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function snapshot(input: {
  ready: number;
  found: boolean;
  live?: "not_installed" | "needs_action" | "ready" | "error";
}): HarnessConnectorsSnapshotDto {
  const live = input.live ?? (input.ready > 0 ? "ready" : "not_installed");
  return {
    generatedAt: "2026-07-08T00:00:00.000Z",
    summary: {
      ready: input.ready,
      needsAction: live === "needs_action" ? 1 : 0,
      notInstalled: live === "not_installed" ? 1 : 0,
      notFound: input.found ? 0 : 1,
      error: live === "error" ? 1 : 0
    },
    connectors: [connector("codex", { presence: input.found ? "found" : "not_found", live })]
  };
}

function connector(
  runtime: string,
  state: { presence: "found" | "not_found"; live: "not_installed" | "needs_action" | "ready" | "error" }
) {
  return {
    runtime: runtime as "codex",
    label: runtime === "codex" ? "Codex" : runtime,
    presence: state.presence,
    live: state.live,
    supportsActions: true
  };
}
