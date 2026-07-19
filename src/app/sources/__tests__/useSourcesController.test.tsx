// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AppSurface } from "../../../ui/ObservabilitySidebar";
import {
  getLiveHookSettings,
  getSourcesSetup,
  listAdapters,
  listImports,
  listSources
} from "../../daemonClient";
import { useSourcesController } from "../useSourcesController";

const daemonClientMocks = vi.hoisted(() => ({
  getLiveHookSettings: vi.fn(),
  getSourcesSetup: vi.fn(),
  listAdapters: vi.fn(),
  listImports: vi.fn(),
  listSources: vi.fn()
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
  activeSurface: AppSurface;
  isLive: boolean;
};

const baseUrl = "http://127.0.0.1:17373/projection";
let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.clearAllMocks();
});

describe("useSourcesController inventory loading", () => {
  test("does not load the full source inventory when the connection becomes live outside Sources", async () => {
    await renderHarness({ activeSurface: "now", isLive: false });
    await rerenderHarness({ activeSurface: "now", isLive: true });

    expect(getSourcesSetup).not.toHaveBeenCalled();
    expect(listAdapters).not.toHaveBeenCalled();
    expect(listSources).not.toHaveBeenCalled();
    expect(listImports).not.toHaveBeenCalled();
    expect(getLiveHookSettings).not.toHaveBeenCalled();
  });

  test("loads one coherent inventory when entering Sources on a live connection", async () => {
    vi.mocked(getSourcesSetup).mockResolvedValue({} as Awaited<ReturnType<typeof getSourcesSetup>>);
    vi.mocked(listAdapters).mockResolvedValue([]);
    vi.mocked(listSources).mockResolvedValue([]);
    vi.mocked(listImports).mockResolvedValue({ imports: [], limit: 50, offset: 0, total: 0 });
    vi.mocked(getLiveHookSettings).mockResolvedValue({} as Awaited<ReturnType<typeof getLiveHookSettings>>);

    await renderHarness({ activeSurface: "now", isLive: true });
    expect(listSources).not.toHaveBeenCalled();

    await rerenderHarness({ activeSurface: "sources", isLive: true });
    await waitFor(() => vi.mocked(listSources).mock.calls.length === 1);

    expect(getSourcesSetup).toHaveBeenCalledTimes(1);
    expect(listAdapters).toHaveBeenCalledTimes(1);
    expect(listSources).toHaveBeenCalledTimes(1);
    expect(getLiveHookSettings).toHaveBeenCalledTimes(1);
    expect(listImports).toHaveBeenCalledTimes(2);
  });
});

function Harness(props: HarnessProps) {
  useSourcesController({
    activeProjectionUrl: baseUrl,
    activeSurface: props.activeSurface,
    isLive: props.isLive,
    onLibraryChanged: vi.fn()
  });
  return null;
}

async function renderHarness(props: HarnessProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<Harness {...props} />));
}

async function rerenderHarness(props: HarnessProps) {
  await act(async () => root?.render(<Harness {...props} />));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition.");
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  }
}
