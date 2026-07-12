// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { KnowledgeFlowSummaryDto } from "../../../shared/knowledgeFlow";
import {
  useKnowledgeFlowSummary,
  type UseKnowledgeFlowSummaryResult
} from "../useKnowledgeFlowSummary";
import { getKnowledgeFlowSummary } from "../../daemonClient";

const daemonClientMocks = vi.hoisted(() => ({
  getKnowledgeFlowSummary: vi.fn()
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
  isLive: boolean;
  refreshKey: number;
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let latestResult: UseKnowledgeFlowSummaryResult | undefined;
let renderedResults: UseKnowledgeFlowSummaryResult[] = [];

const baseUrl = "http://127.0.0.1:17373/projection";
const summary: KnowledgeFlowSummaryDto = {
  capturedSessions: 17,
  workbenchSessions: 6,
  publishedArtifacts: 11,
  automaticallyResolvedSessions: 4
};

afterEach(async () => {
  latestResult = undefined;
  renderedResults = [];
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useKnowledgeFlowSummary", () => {
  test("loads the current knowledge flow summary while live", async () => {
    vi.mocked(getKnowledgeFlowSummary).mockResolvedValue(summary);

    await renderHarness({ activeProjectionUrl: baseUrl, isLive: true, refreshKey: 0 });
    await waitFor(() => current().loading === false && current().summary !== undefined);

    expect(getKnowledgeFlowSummary).toHaveBeenCalledWith(baseUrl, { signal: expect.any(AbortSignal) });
    expect(current()).toMatchObject({
      loading: false,
      error: undefined,
      summary: {
        capturedSessions: 17,
        workbenchSessions: 6,
        publishedArtifacts: 11,
        automaticallyResolvedSessions: 4
      }
    });
  });

  test("aborts an in-flight request on unmount without writing error state", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.mocked(getKnowledgeFlowSummary).mockImplementation((_url, options) => {
      requestSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });

    await renderHarness({ activeProjectionUrl: baseUrl, isLive: true, refreshKey: 0 });
    expect(current()).toMatchObject({ loading: true, error: undefined });

    await act(async () => root?.unmount());
    root = undefined;
    await act(async () => Promise.resolve());

    expect(requestSignal?.aborted).toBe(true);
    expect(current().error).toBeUndefined();
  });

  test("clears a loaded summary and reports unavailable when the connection drops", async () => {
    vi.mocked(getKnowledgeFlowSummary).mockResolvedValue(summary);

    await renderHarness({ activeProjectionUrl: baseUrl, isLive: true, refreshKey: 0 });
    await waitFor(() => current().summary !== undefined);
    await rerenderHarness({ activeProjectionUrl: baseUrl, isLive: false, refreshKey: 0 });

    expect(current()).toMatchObject({ loading: false, summary: undefined });
    expect(current().error).toBeDefined();
  });

  test("reports unavailable on the initial disconnected render", async () => {
    await renderHarness({ activeProjectionUrl: baseUrl, isLive: false, refreshKey: 0 });

    expect(renderedResults[0]?.error).toBeDefined();
    expect(current()).toMatchObject({ loading: false, summary: undefined });
    expect(current().error).toBeDefined();
    expect(getKnowledgeFlowSummary).not.toHaveBeenCalled();
  });

  test("reloads when the app refresh key changes", async () => {
    vi.mocked(getKnowledgeFlowSummary).mockResolvedValue(summary);

    await renderHarness({ activeProjectionUrl: baseUrl, isLive: true, refreshKey: 0 });
    await waitFor(() => current().summary !== undefined);
    expect(getKnowledgeFlowSummary).toHaveBeenCalledTimes(1);

    await rerenderHarness({ activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => current().summary !== undefined && current().loading === false);
    expect(getKnowledgeFlowSummary).toHaveBeenCalledTimes(2);
  });

  test("polls every 60 seconds without blanking loaded values", async () => {
    vi.useFakeTimers();
    let resolvePoll: ((value: KnowledgeFlowSummaryDto) => void) | undefined;
    vi.mocked(getKnowledgeFlowSummary)
      .mockResolvedValueOnce(summary)
      .mockImplementationOnce(
        () =>
          new Promise<KnowledgeFlowSummaryDto>((resolve) => {
            resolvePoll = resolve;
          })
      );

    await renderHarness({ activeProjectionUrl: baseUrl, isLive: true, refreshKey: 0 });
    await act(async () => Promise.resolve());
    expect(current()).toMatchObject({ loading: false, summary });

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(getKnowledgeFlowSummary).toHaveBeenCalledTimes(2);
    expect(current()).toMatchObject({ loading: false, summary });

    await act(async () => resolvePoll?.({ ...summary, capturedSessions: 18 }));
    expect(current().summary?.capturedSessions).toBe(18);
  });

  test("ignores an older poll response after a newer poll completes", async () => {
    vi.useFakeTimers();
    let resolveOlderPoll: ((value: KnowledgeFlowSummaryDto) => void) | undefined;
    vi.mocked(getKnowledgeFlowSummary)
      .mockResolvedValueOnce(summary)
      .mockImplementationOnce(
        () =>
          new Promise<KnowledgeFlowSummaryDto>((resolve) => {
            resolveOlderPoll = resolve;
          })
      )
      .mockResolvedValueOnce({ ...summary, capturedSessions: 19 });

    await renderHarness({ activeProjectionUrl: baseUrl, isLive: true, refreshKey: 0 });
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(current().summary?.capturedSessions).toBe(19);

    await act(async () => resolveOlderPoll?.({ ...summary, capturedSessions: 18 }));
    expect(current().summary?.capturedSessions).toBe(19);
  });

  test("exposes request failures while retaining the last successful values", async () => {
    vi.mocked(getKnowledgeFlowSummary)
      .mockResolvedValueOnce(summary)
      .mockRejectedValueOnce(new Error("summary endpoint unavailable"));

    await renderHarness({ activeProjectionUrl: baseUrl, isLive: true, refreshKey: 0 });
    await waitFor(() => current().summary !== undefined);
    await rerenderHarness({ activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => current().error === "summary endpoint unavailable");

    expect(current()).toMatchObject({
      loading: false,
      error: "summary endpoint unavailable",
      summary
    });
  });
});

async function renderHarness(props: HarnessProps): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await rerenderHarness(props);
}

async function rerenderHarness(props: HarnessProps): Promise<void> {
  await act(async () => {
    root?.render(<KnowledgeFlowHarness {...props} />);
  });
  await act(async () => Promise.resolve());
}

function KnowledgeFlowHarness(props: HarnessProps) {
  latestResult = useKnowledgeFlowSummary(props);
  renderedResults.push(latestResult);
  return null;
}

function current(): UseKnowledgeFlowSummaryResult {
  expect(latestResult).toBeDefined();
  return latestResult as UseKnowledgeFlowSummaryResult;
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for hook state");
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
}
