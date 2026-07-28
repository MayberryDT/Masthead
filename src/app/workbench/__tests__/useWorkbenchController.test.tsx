// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkbenchEnrollMissingResponse, WorkbenchQueueSessionDto } from "../../../shared/workbench";
import type { GuidedAuthoringReviewDto } from "../../../shared/guidedAuthoring";
import type { WorkbenchAuthoringV5CapabilitiesDto } from "../../../shared/workbenchAuthoringV5";
import {
  useWorkbenchController,
  type UseWorkbenchControllerResult,
  type WorkbenchActionKind
} from "../useWorkbenchController";
import {
  getWorkbenchAuthoringCapabilities,
  getWorkbenchActivity,
  getWorkbenchImportHealthSummary,
  getWorkbenchNotAddedSessions,
  getWorkbenchNotAddedSummary,
  getWorkbenchQualityReviewSessions,
  getWorkbenchQualityReviewSummary,
  getWorkbenchSessions,
  getDataRevisions,
  createGuidedAuthoringRequest,
  getIncompleteWorkbenchAuthoringRequest,
  listPendingGuidedCanaries,
  postWorkbenchCheckTranscript,
  postWorkbenchClaim,
  postWorkbenchEnrollMissing,
  postWorkbenchImportTranscript,
  postWorkbenchQuality,
  postWorkbenchReleaseClaim
} from "../../daemonClient";

const daemonClientMocks = vi.hoisted(() => ({
  getDataRevisions: vi.fn().mockResolvedValue({ logbook: 0, workbench: 0 }),
  getWorkbenchAuthoringCapabilities: vi.fn(),
  getWorkbenchActivity: vi.fn(),
  getWorkbenchImportHealthSummary: vi.fn().mockResolvedValue({ ok: true, importJobIds: [], reasons: [], repairRequired: 0 }),
  getWorkbenchNotAddedSessions: vi.fn(),
  getWorkbenchNotAddedSummary: vi.fn(),
  getWorkbenchQualityReviewSessions: vi.fn(),
  getWorkbenchQualityReviewSummary: vi.fn(),
  getWorkbenchSessions: vi.fn(),
  createGuidedAuthoringRequest: vi.fn(),
  getIncompleteWorkbenchAuthoringRequest: vi.fn().mockResolvedValue({}),
  listPendingGuidedCanaries: vi.fn().mockResolvedValue([]),
  postWorkbenchCheckTranscript: vi.fn(),
  postWorkbenchClaim: vi.fn(),
  postWorkbenchEnrollMissing: vi.fn(),
  postWorkbenchImportTranscript: vi.fn(),
  postWorkbenchQuality: vi.fn(),
  postWorkbenchReleaseClaim: vi.fn()
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
  active: boolean;
  activeProjectionUrl: string;
  isLive: boolean;
  refreshKey: number;
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let latestResult: UseWorkbenchControllerResult | undefined;

const baseUrl = "http://127.0.0.1:17373/projection";

const ALL_ACTIONS: WorkbenchActionKind[] = [
  "enroll_missing",
  "check_transcript",
  "import_transcript",
  "quality_pass",
  "quality_fail",
  "quality_precheck",
  "claim",
  "release",
  "copy_agent_prompt"
];

const SELECTION_ACTIONS: WorkbenchActionKind[] = ALL_ACTIONS.filter((kind) => kind !== "enroll_missing");

afterEach(async () => {
  latestResult = undefined;
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.clearAllMocks();
  vi.mocked(getDataRevisions).mockResolvedValue({ logbook: 0, workbench: 0 });
  vi.mocked(getIncompleteWorkbenchAuthoringRequest).mockResolvedValue({});
});

describe("useWorkbenchController", () => {
  test("creates a durable guided request before returning the copied prompt", async () => {
    mockWorkbenchResponse([
      session("session:a", "First session"),
      session("session:b", "Second session")
    ]);
    vi.mocked(createGuidedAuthoringRequest).mockResolvedValue(guidedRequestResult("request:one"));

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions.length === 2);
    await act(async () => {
      latest().selectPage();
      await Promise.resolve();
    });

    let prompt = "";
    await act(async () => {
      prompt = await latest().copyAgentPrompt();
    });

    expect(createGuidedAuthoringRequest).toHaveBeenCalledWith(baseUrl, {
      buildSha: "build:test",
      databaseId: "database:test",
      creationToken: expect.any(String),
      expectedIdentity: {
        baseUrl: "http://127.0.0.1:17373",
        buildSha: "build:test",
        databaseId: "database:test",
        instanceId: "instance:test",
        instanceManifest: "/tmp/masthead/masthead-instance.json"
      },
      sessionIds: ["session:a", "session:b"]
    });
    expect(prompt).toContain("request:one");
    expect(prompt).toContain("workbench author bootstrap --request 'request:one' --json");
    expect(prompt).not.toContain("session:a");
    expect(prompt).not.toContain("session:b");
    expect(prompt).not.toContain("partition");
  });

  test("does not retain prompt text when guided request creation fails", async () => {
    mockWorkbenchResponse([session("session:a", "First session")]);
    vi.mocked(createGuidedAuthoringRequest)
      .mockResolvedValueOnce(guidedRequestResult("request:first"))
      .mockRejectedValueOnce(new Error("guided request unavailable"));

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions.length === 1);
    await select("session:a");

    let firstPrompt = "";
    await act(async () => {
      firstPrompt = await latest().copyAgentPrompt();
    });
    expect(firstPrompt).toContain("request:first");

    await expect(act(async () => {
      await latest().copyAgentPrompt();
    })).rejects.toThrow("guided request unavailable");
    await waitFor(() => latest().actionError === "guided request unavailable");
    expect(latest().actionError).toBe("guided request unavailable");
    expect(latest().activity).toEqual([]);
    expect(createGuidedAuthoringRequest).toHaveBeenCalledTimes(2);
  });

  test("reuses the creation token when the same failed selection is retried", async () => {
    mockWorkbenchResponse([session("session:a", "First session")]);
    vi.mocked(createGuidedAuthoringRequest).mockRejectedValue(new Error("response_lost"));

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions.length === 1);
    await select("session:a");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(act(async () => {
        await latest().copyAgentPrompt();
      })).rejects.toThrow("response_lost");
    }

    const tokens = vi.mocked(createGuidedAuthoringRequest).mock.calls.map(([, input]) => input.creationToken);
    expect(tokens).toEqual([expect.any(String), tokens[0]]);
  });

  test("keeps instance identity failures in transient action feedback without inventing Activity", async () => {
    mockWorkbenchResponse([session("session:a", "First session")]);
    vi.mocked(createGuidedAuthoringRequest).mockRejectedValue(new Error("database_identity_mismatch"));

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions.length === 1);
    await select("session:a");

    await expect(act(async () => {
      await latest().copyAgentPrompt();
    })).rejects.toThrow("database_identity_mismatch");
    await waitFor(() => latest().actionError === "database_identity_mismatch");
    expect(latest().activity).toEqual([]);
    expect(latest()).not.toHaveProperty("approveCanary");
    expect(latest()).not.toHaveProperty("rejectCanary");
  });

  test("does not poll or expose retired operator canary controls", async () => {
    mockWorkbenchResponse([]);
    vi.mocked(listPendingGuidedCanaries).mockResolvedValue([stagedReview("assignment:retired")]);

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().loading === false);

    expect(listPendingGuidedCanaries).not.toHaveBeenCalled();
    expect(latest()).not.toHaveProperty("pendingCanaryReviews");
    expect(latest()).not.toHaveProperty("approveCanary");
    expect(latest()).not.toHaveProperty("rejectCanary");
  });

  test("does not fetch hidden import-repair diagnostics for the human Workbench", async () => {
    mockWorkbenchResponse([]);

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().loading === false);

    expect(getWorkbenchImportHealthSummary).not.toHaveBeenCalled();
  });

  test("preserves selections across pages in one authoritative handoff", async () => {
    vi.mocked(getWorkbenchAuthoringCapabilities).mockResolvedValue(
      authoringCapabilities("database:test", "/home/test/.local/bin/mastheadctl")
    );
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
    vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue(qualityReviewSummary());
    vi.mocked(createGuidedAuthoringRequest).mockResolvedValue(guidedRequestResult("request:paged"));
    vi.mocked(getWorkbenchSessions).mockImplementation(async (_base, options = {}) => {
      const pageSessions = options.offset === 100
        ? [session("session:page-2", "Second page")]
        : [session("session:page-1", "First page")];
      return { ...response(pageSessions), offset: options.offset ?? 0, total: 101 };
    });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions[0]?.sessionId === "session:page-1");
    await act(async () => {
      latest().selectPage();
      await Promise.resolve();
    });

    await act(async () => {
      latest().setPage(1);
      await Promise.resolve();
    });
    await waitFor(() => latest().sessions[0]?.sessionId === "session:page-2");
    await act(async () => {
      latest().selectPage();
      await Promise.resolve();
    });

    expect(Array.from(latest().selectedSessionIds)).toEqual(["session:page-1", "session:page-2"]);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    await act(async () => {
      await latest().copyAgentPrompt();
    });
    expect(vi.mocked(createGuidedAuthoringRequest).mock.calls.at(-1)?.[1].sessionIds)
      .toEqual(["session:page-1", "session:page-2"]);
  });

  test("reconciles off-page compile readiness across refreshes without clearing selection", async () => {
    let firstPageReady = true;
    vi.mocked(getWorkbenchAuthoringCapabilities).mockResolvedValue(
      authoringCapabilities("database:test", "/home/test/.local/bin/mastheadctl")
    );
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
    vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue(qualityReviewSummary());
    vi.mocked(getWorkbenchSessions).mockImplementation(async (_base, options = {}) => {
      if (options.offset === 100) {
        return { ...response([session("session:page-2", "Second page")]), offset: 100, total: 101 };
      }
      const firstPage = session("session:page-1", "First page", firstPageReady
        ? {}
        : { qualityStatus: "unchecked" });
      return { ...response([firstPage]), limit: options.limit ?? 100, offset: options.offset ?? 0, total: 101 };
    });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions[0]?.sessionId === "session:page-1");
    await act(async () => {
      latest().selectPage();
      latest().setPage(1);
      await Promise.resolve();
    });
    await waitFor(() => latest().sessions[0]?.sessionId === "session:page-2");
    await act(async () => {
      latest().selectPage();
      await Promise.resolve();
    });
    expect(latest().canRun("copy_agent_prompt")).toBe(true);

    firstPageReady = false;
    await rerenderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 2 });
    await waitFor(() => latest().loading === false);

    expect(Array.from(latest().selectedSessionIds)).toEqual(["session:page-1", "session:page-2"]);
    expect(latest().agentPromptSessionCount).toBe(1);
    expect(latest().agentPromptExcludedCount).toBe(1);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    vi.mocked(createGuidedAuthoringRequest).mockResolvedValue(guidedRequestResult("request:ready-subset"));
    await act(async () => {
      await latest().copyAgentPrompt();
    });
    expect(vi.mocked(createGuidedAuthoringRequest).mock.calls.at(-1)?.[1].sessionIds).toEqual(["session:page-2"]);

    firstPageReady = true;
    await rerenderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 3 });
    await waitFor(() => latest().loading === false);

    expect(Array.from(latest().selectedSessionIds)).toEqual(["session:page-1", "session:page-2"]);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    vi.mocked(createGuidedAuthoringRequest).mockResolvedValue(guidedRequestResult("request:ready-all"));
    await act(async () => {
      await latest().copyAgentPrompt();
    });
    expect(vi.mocked(createGuidedAuthoringRequest).mock.calls.at(-1)?.[1].sessionIds)
      .toEqual(["session:page-1", "session:page-2"]);
  });

  test("uses the compile-ready subset of a V4 selection for Copy Agent Prompt", async () => {
    mockWorkbenchResponse([
      session("session:ready", "Ready", { nextAction: "enrich", qualityStatus: "passed", transcriptStatus: "imported" }),
      session("session:available", "Available", { qualityStatus: "passed", transcriptStatus: "available" }),
      session("session:not-ready", "Not ready", { qualityStatus: "unchecked", transcriptStatus: "unchecked" })
    ]);

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions.length === 3);

    expect(latest().canRun("copy_agent_prompt")).toBe(false);
    await select("session:not-ready");
    expect(latest().canRun("copy_agent_prompt")).toBe(false);
    await act(async () => {
      latest().toggleSession("session:ready");
      await Promise.resolve();
    });
    expect(latest().agentPromptSessionCount).toBe(1);
    expect(latest().agentPromptExcludedCount).toBe(1);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    vi.mocked(createGuidedAuthoringRequest).mockResolvedValue(guidedRequestResult("request:ready"));
    await act(async () => {
      await latest().copyAgentPrompt();
    });
    expect(vi.mocked(createGuidedAuthoringRequest).mock.calls.at(-1)?.[1].sessionIds).toEqual(["session:ready"]);
    await act(async () => {
      latest().toggleSession("session:not-ready");
      await Promise.resolve();
    });
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    await act(async () => {
      latest().toggleSession("session:available");
      await Promise.resolve();
    });
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    vi.mocked(createGuidedAuthoringRequest).mockResolvedValue(guidedRequestResult("request:ready-two"));
    await act(async () => {
      await latest().copyAgentPrompt();
    });
    expect(vi.mocked(createGuidedAuthoringRequest).mock.calls.at(-1)?.[1].sessionIds)
      .toEqual(["session:ready", "session:available"]);
  });

  test("keeps Copy Agent Prompt disabled for legacy authoring capabilities", async () => {
    mockWorkbenchResponse([session("session:ready", "Ready")]);
    vi.mocked(getWorkbenchAuthoringCapabilities).mockRejectedValue(new Error("legacy authoring contract"));

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions.length === 1);
    await select("session:ready");

    expect(latest().canRun("copy_agent_prompt")).toBe(false);
  });
  test("loads missing sessions only when Workbench is active and live", async () => {
    mockWorkbenchResponse([session("session:abc", "Workbench import review")]);
    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });

    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);

    expect(getWorkbenchSessions).toHaveBeenCalledWith(baseUrl, expect.objectContaining({ limit: 100, offset: 0 }));
    expect(getWorkbenchAuthoringCapabilities).toHaveBeenCalledWith(baseUrl, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(latest().sessions).toEqual([session("session:abc", "Workbench import review")]);
    expect(latest().activity).toEqual([]);
    expect(latest().notAddedSummary).toMatchObject({ total: 0 });
    expect(latest().qualityReviewSummary).toMatchObject({ total: 0 });
    expect(latest().actionBusy).toBe(false);
    expect(latest().notAddedOpen).toBe(false);
    expect(latest().notAddedSessions).toEqual([]);
    expect(latest().qualityReviewOpen).toBe(false);
    expect(latest().qualityReviewSessions).toEqual([]);
  });

  test("does not load while inactive or offline", async () => {
    mockWorkbenchResponse([session("session:abc", "Ignored session")]);

    await renderHarness({ active: false, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await flushAsync();
    await rerenderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: false, refreshKey: 2 });
    await flushAsync();

    expect(getWorkbenchSessions).not.toHaveBeenCalled();
    expect(latest().sessions).toEqual([]);
  });

  test("removes selected ids that disappear from the complete refreshed queue", async () => {
    vi.mocked(getWorkbenchSessions)
      .mockResolvedValueOnce(response([session("session:abc", "First session"), session("session:def", "Second session")]))
      .mockResolvedValueOnce(response([session("session:def", "Second session")]));
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
    vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue(qualityReviewSummary());

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 2);

    await act(async () => {
      latest().selectPage();
      await Promise.resolve();
    });

    expect(Array.from(latest().selectedSessionIds).sort()).toEqual(["session:abc", "session:def"]);

    await rerenderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 2 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);

    expect(latest().sessions.map((item) => item.sessionId)).toEqual(["session:def"]);
    expect(Array.from(latest().selectedSessionIds)).toEqual(["session:def"]);
  });

  test("removes a published session from selection when the Workbench revision advances", async () => {
    vi.mocked(getDataRevisions).mockResolvedValue({ logbook: 0, workbench: 0 });
    vi.mocked(getWorkbenchSessions)
      .mockResolvedValueOnce(response([session("session:a", "Selected")]))
      .mockResolvedValue(response([]));
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
    vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue(qualityReviewSummary());
    vi.mocked(getWorkbenchAuthoringCapabilities).mockResolvedValue(
      authoringCapabilities("database:test", "/home/test/.local/bin/mastheadctl")
    );

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions.length === 1);
    await select("session:a");

    vi.mocked(getDataRevisions).mockResolvedValue({ logbook: 1, workbench: 1 });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await waitFor(() => latest().sessions.length === 0);

    expect(Array.from(latest().selectedSessionIds)).toEqual([]);
  });

  test("supports toggle, select all visible, and clear selection without exposing selected metadata", async () => {
    mockWorkbenchResponse([
      session("session:abc", "npm run import review"),
      session("session:def", "Second session", { project: "schema.json cleanup", runtime: "mastheadctl runner" })
    ]);

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 2);

    await act(async () => {
      latest().toggleSession("session:abc");
      await Promise.resolve();
    });

    expect(Array.from(latest().selectedSessionIds)).toEqual(["session:abc"]);
    vi.mocked(createGuidedAuthoringRequest).mockResolvedValue(guidedRequestResult("request:sanitized"));
    let prompt = "";
    await act(async () => {
      prompt = await latest().copyAgentPrompt();
    });
    expect(prompt).not.toContain("session:abc");
    expect(prompt).not.toContain("session:def");
    expect(prompt).not.toContain("Second session");
    expect(prompt).not.toContain("npm run import review");

    await act(async () => {
      latest().selectPage();
      await Promise.resolve();
    });

    expect(Array.from(latest().selectedSessionIds).sort()).toEqual(["session:abc", "session:def"]);
    expect(prompt).not.toContain("schema.json cleanup");

    await act(async () => {
      latest().clearSelection();
      await Promise.resolve();
    });

    expect(Array.from(latest().selectedSessionIds)).toEqual([]);
  });

  test("uses the authoritative selection when request creation begins", async () => {
    mockWorkbenchResponse([
      session("session:a", "First session"),
      session("session:b", "Second session")
    ]);
    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 2);

    await act(async () => {
      latest().toggleSession("session:a");
      await Promise.resolve();
    });

    await act(async () => {
      latest().toggleSession("session:a");
      latest().toggleSession("session:b");
      await Promise.resolve();
    });

    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    vi.mocked(createGuidedAuthoringRequest).mockResolvedValue(guidedRequestResult("request:latest-selection"));
    await act(async () => {
      await latest().copyAgentPrompt();
    });
    expect(vi.mocked(createGuidedAuthoringRequest).mock.calls.at(-1)?.[1].sessionIds).toEqual(["session:b"]);
  });

  test("selectAll preserves a mixed selection while handing off only compile-ready sessions", async () => {
    vi.mocked(getWorkbenchAuthoringCapabilities).mockResolvedValue(
      authoringCapabilities("database:test", "/home/test/.local/bin/mastheadctl")
    );
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
    vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue(qualityReviewSummary());
    vi.mocked(getWorkbenchSessions).mockImplementation(async (_base, options = {}) => {
      if (options.limit === 500) {
        return {
          ...response([
            session("session:a", "First page", { qualityStatus: "unchecked", transcriptStatus: "unchecked" }),
            session("session:b", "Second page")
          ]),
          limit: 500
        };
      }
      return {
        ...response([session("session:a", "First page", { qualityStatus: "unchecked", transcriptStatus: "unchecked" })]),
        total: 2
      };
    });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await act(async () => {
      await latest().selectAll();
    });

    expect(Array.from(latest().selectedSessionIds).sort()).toEqual(["session:a", "session:b"]);
    expect(latest().agentPromptSessionCount).toBe(1);
    expect(latest().agentPromptExcludedCount).toBe(1);
    expect(latest().lastActionSummary).toBe(
      "Selected 2 package-path · 1 ready · 1 need quality review"
    );
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    vi.mocked(createGuidedAuthoringRequest).mockResolvedValue(guidedRequestResult("request:select-all"));
    await act(async () => {
      await latest().copyAgentPrompt();
    });
    expect(vi.mocked(createGuidedAuthoringRequest).mock.calls.at(-1)?.[1].sessionIds).toEqual(["session:b"]);
  });

  test("retries after a failed load", async () => {
    vi.mocked(getWorkbenchSessions)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(response([session("session:abc", "Recovered session")]));
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
    vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue(qualityReviewSummary());

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest()?.error === "temporary failure");

    expect(latest().sessions).toEqual([]);

    await act(async () => {
      latest().retry();
      await Promise.resolve();
    });

    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);

    expect(getWorkbenchSessions).toHaveBeenCalledTimes(2);
    expect(latest().error).toBeUndefined();
    expect(latest().sessions[0]?.sessionId).toBe("session:abc");
  });

  test("suppresses retry while inactive or offline", async () => {
    mockWorkbenchResponse([session("session:abc", "Ignored session")]);

    await renderHarness({ active: false, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });

    await act(async () => {
      latest().retry();
      await Promise.resolve();
    });

    await rerenderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: false, refreshKey: 2 });

    await act(async () => {
      latest().retry();
      await Promise.resolve();
    });

    expect(getWorkbenchSessions).not.toHaveBeenCalled();
    expect(latest().sessions).toEqual([]);
  });

  test("enablement matrix follows selection, next action, and claim state", async () => {
    mockWorkbenchResponse([
      session("session:check", "Check me", {
        nextAction: "check_transcript",
        transcriptStatus: "unchecked",
        qualityStatus: "passed"
      }),
      session("session:import", "Import me", {
        nextAction: "import_transcript",
        transcriptStatus: "available",
        qualityStatus: "passed"
      }),
      session("session:quality", "Quality me", {
        nextAction: "review_quality",
        transcriptStatus: "imported",
        qualityStatus: "unchecked"
      }),
      session("session:claimed", "Claimed me", {
        nextAction: "enrich",
        transcriptStatus: "imported",
        qualityStatus: "passed",
        activeClaim: {
          claimId: "claim:1",
          claimedBy: "workbench_ui",
          expiresAt: "2026-07-08T13:00:00.000Z"
        }
      }),
      session("session:enrich", "Enrich me", {
        nextAction: "enrich",
        transcriptStatus: "imported",
        qualityStatus: "passed"
      })
    ]);

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 5);

    expect(latest().canRun("enroll_missing")).toBe(true);
    for (const kind of SELECTION_ACTIONS) {
      expect(latest().canRun(kind)).toBe(false);
    }

    await select("session:check");
    expect(latest().canRun("enroll_missing")).toBe(true);
    expect(latest().canRun("check_transcript")).toBe(true);
    expect(latest().canRun("import_transcript")).toBe(false);
    expect(latest().canRun("quality_pass")).toBe(false);
    expect(latest().canRun("claim")).toBe(true);
    expect(latest().canRun("release")).toBe(false);
    expect(latest().canRun("copy_agent_prompt")).toBe(false);

    await select("session:import");
    expect(latest().canRun("import_transcript")).toBe(true);
    expect(latest().canRun("check_transcript")).toBe(true);

    await select("session:quality");
    expect(latest().canRun("quality_pass")).toBe(true);
    expect(latest().canRun("quality_fail")).toBe(true);
    expect(latest().canRun("quality_precheck")).toBe(true);

    await select("session:claimed");
    expect(latest().canRun("claim")).toBe(false);
    expect(latest().canRun("release")).toBe(true);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);

    await select("session:enrich");
    expect(latest().canRun("check_transcript")).toBe(false);
    expect(latest().canRun("import_transcript")).toBe(false);
    expect(latest().canRun("quality_pass")).toBe(false);
    expect(latest().canRun("claim")).toBe(true);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);

    await act(async () => {
      latest().clearSelection();
      await Promise.resolve();
    });
    expect(latest().canRun("copy_agent_prompt")).toBe(false);
    expect(latest().canRun("enroll_missing")).toBe(true);
  });

  test("does not create a guided request when daemon authoring capabilities are unavailable", async () => {
    mockWorkbenchResponse([session("session:abc", "Copy session")]);
    vi.mocked(getWorkbenchAuthoringCapabilities).mockRejectedValue(new Error("not available"));

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await select("session:abc");

    expect(latest().canRun("copy_agent_prompt")).toBe(false);
    expect(createGuidedAuthoringRequest).not.toHaveBeenCalled();
  });

  test("rebinds request creation after capabilities change without retaining the old database", async () => {
    mockWorkbenchResponse([session("session:abc", "Copy session")]);
    vi.mocked(getWorkbenchAuthoringCapabilities)
      .mockResolvedValueOnce(authoringCapabilities("database:first", "/first/mastheadctl"))
      .mockResolvedValueOnce(authoringCapabilities("database:second", "/second/mastheadctl"));
    vi.mocked(createGuidedAuthoringRequest)
      .mockResolvedValueOnce(guidedRequestResult("request:first"))
      .mockResolvedValueOnce(guidedRequestResult("request:second"));

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await select("session:abc");
    let firstPrompt = "";
    await act(async () => {
      firstPrompt = await latest().copyAgentPrompt();
    });
    expect(firstPrompt).toContain("request:first");
    expect(firstPrompt).not.toContain("database:first");

    await rerenderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 2 });
    await waitFor(() => latest().loading === false && latest().canRun("copy_agent_prompt"));
    let secondPrompt = "";
    await act(async () => {
      secondPrompt = await latest().copyAgentPrompt();
    });

    expect(secondPrompt).toContain("request:second");
    expect(secondPrompt).not.toContain("request:first");
    expect(vi.mocked(createGuidedAuthoringRequest).mock.calls.at(-1)?.[1]).toMatchObject({
      databaseId: "database:second",
      expectedIdentity: { databaseId: "database:second" }
    });
  });

  test("disables mutations while offline", async () => {
    mockWorkbenchResponse([
      session("session:check", "Check me", { nextAction: "check_transcript", transcriptStatus: "unchecked" })
    ]);

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await select("session:check");
    expect(latest().canRun("check_transcript")).toBe(true);

    await rerenderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: false, refreshKey: 2 });
    await flushAsync();

    for (const kind of ALL_ACTIONS) {
      expect(latest().canRun(kind)).toBe(false);
    }
  });

  test("runs check_transcript then reloads queue state", async () => {
    const checked = session("session:abc", "Checked session", {
      nextAction: "import_transcript",
      transcriptStatus: "available"
    });
    vi.mocked(getWorkbenchSessions)
      .mockResolvedValueOnce(response([session("session:abc", "Unchecked session")]))
      .mockResolvedValueOnce(response([checked]));
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
    vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue(qualityReviewSummary());
    vi.mocked(postWorkbenchCheckTranscript).mockResolvedValue({ ok: true });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await select("session:abc");

    await act(async () => {
      await latest().runAction("check_transcript");
    });

    expect(postWorkbenchCheckTranscript).toHaveBeenCalledWith(baseUrl, "session:abc");
    expect(getWorkbenchSessions).toHaveBeenCalledTimes(2);
    expect(latest().sessions[0]?.transcriptStatus).toBe("available");
    expect(latest().lastActionSummary).toBe("Checked transcript for 1 session");
    expect(latest().actionBusy).toBe(false);
    expect(latest().actionError).toBeUndefined();
  });

  test("maps transcript_permission_required to a plain-language import error", async () => {
    mockWorkbenchResponse([
      session("session:abc", "Import session", {
        nextAction: "import_transcript",
        transcriptStatus: "available"
      })
    ]);
    vi.mocked(postWorkbenchImportTranscript).mockRejectedValue(
      new Error("workbench import transcript failed: 409 transcript_permission_required")
    );

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await select("session:abc");

    await act(async () => {
      await latest().runAction("import_transcript");
    });

    expect(postWorkbenchImportTranscript).toHaveBeenCalledWith(baseUrl, "session:abc");
    expect(latest().actionError).toBe(
      "Transcript import needs source permission for this session's source. Grant it under Sources, then retry Import."
    );
    expect(latest().actionBusy).toBe(false);
  });

  test("runs quality, claim, and release against selected sessions", async () => {
    mockWorkbenchResponse([
      session("session:quality", "Quality", {
        nextAction: "review_quality",
        qualityStatus: "unchecked",
        transcriptStatus: "imported"
      }),
      session("session:open", "Open claim", {
        nextAction: "enrich",
        qualityStatus: "passed",
        transcriptStatus: "imported"
      }),
      session("session:held", "Held claim", {
        nextAction: "enrich",
        qualityStatus: "passed",
        transcriptStatus: "imported",
        activeClaim: {
          claimId: "claim:held",
          claimedBy: "workbench_ui",
          expiresAt: "2026-07-08T13:00:00.000Z"
        }
      })
    ]);
    vi.mocked(postWorkbenchQuality).mockResolvedValue({ ok: true });
    vi.mocked(postWorkbenchClaim).mockResolvedValue({ ok: true });
    vi.mocked(postWorkbenchReleaseClaim).mockResolvedValue({ ok: true });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 3);

    await select("session:quality");
    expect(latest().qualityReviewSelectedCount).toBe(1);
    await act(async () => {
      await latest().runAction("quality_pass");
    });
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:quality", { status: "passed" });
    expect(latest().lastActionSummary).toContain("Accepted quality for 1 review session");
    expect(latest().lastActionSummary).toContain("compile-ready");

    await select("session:quality");
    await act(async () => {
      await latest().runAction("quality_fail");
    });
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:quality", {
      status: "failed",
      reason: "operator_rejected"
    });
    expect(latest().lastActionSummary).toContain("Failed quality for 1 review session");
    expect(latest().lastActionSummary).toContain("Not Added");
    expect(latest().lastActionSummary).toContain("operator rejected");

    await select("session:quality");
    await act(async () => {
      await latest().runAction("quality_precheck");
    });
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:quality", { mode: "precheck" });

    await select("session:open");
    expect(latest().qualityReviewSelectedCount).toBe(0);
    expect(latest().canRun("quality_pass")).toBe(false);
    await act(async () => {
      await latest().runAction("claim");
    });
    expect(postWorkbenchClaim).toHaveBeenCalledWith(baseUrl, "session:open", {
      claimedBy: "workbench_ui",
      ttlSeconds: 900
    });

    await select("session:held");
    await act(async () => {
      await latest().runAction("release");
    });
    expect(postWorkbenchReleaseClaim).toHaveBeenCalledWith(baseUrl, "claim:held", {
      reason: "operator_release"
    });
  });

  test("bulk quality disposition only acts on review sessions; ready/passed stay untouched", async () => {
    mockWorkbenchResponse([
      session("session:review-a", "Review A", {
        nextAction: "review_quality",
        qualityStatus: "unchecked",
        transcriptStatus: "imported"
      }),
      session("session:review-b", "Review B", {
        nextAction: "review_quality",
        qualityStatus: "unchecked",
        transcriptStatus: "imported"
      }),
      session("session:ready", "Ready", {
        nextAction: "enrich",
        qualityStatus: "passed",
        transcriptStatus: "imported"
      })
    ]);
    vi.mocked(postWorkbenchQuality).mockResolvedValue({ ok: true });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 3);

    await act(async () => {
      latest().selectPage();
      await Promise.resolve();
    });
    expect(latest().selectedSessionIds.size).toBe(3);
    expect(latest().qualityReviewSelectedCount).toBe(2);
    expect(latest().canRun("quality_pass")).toBe(true);
    expect(latest().canRun("quality_fail")).toBe(true);

    await act(async () => {
      await latest().runAction("quality_pass");
    });

    expect(postWorkbenchQuality).toHaveBeenCalledTimes(2);
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:review-a", { status: "passed" });
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:review-b", { status: "passed" });
    expect(postWorkbenchQuality).not.toHaveBeenCalledWith(baseUrl, "session:ready", expect.anything());
    expect(latest().lastActionSummary).toContain("Accepted quality for 2 review sessions");
    expect(latest().lastActionSummary).toContain("1 ready/passed session");
    expect(latest().lastActionSummary).toContain("left unchanged");

    vi.mocked(postWorkbenchQuality).mockClear();
    await act(async () => {
      latest().selectPage();
      await Promise.resolve();
    });
    await act(async () => {
      await latest().runAction("quality_fail");
    });

    expect(postWorkbenchQuality).toHaveBeenCalledTimes(2);
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:review-a", {
      status: "failed",
      reason: "operator_rejected"
    });
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:review-b", {
      status: "failed",
      reason: "operator_rejected"
    });
    expect(postWorkbenchQuality).not.toHaveBeenCalledWith(baseUrl, "session:ready", expect.anything());
    expect(latest().lastActionSummary).toContain("Failed quality for 2 review sessions");
    expect(latest().lastActionSummary).toContain("Not Added");
    expect(latest().lastActionSummary).toContain("1 ready/passed session");
  });

  test("copy_agent_prompt reports ready and excluded selected sessions without posting", async () => {
    mockWorkbenchResponse([
      session("session:ready", "Copy session"),
      session("session:review", "Review session", { qualityStatus: "unchecked" })
    ]);

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 2);
    await act(async () => {
      latest().selectPage();
      await Promise.resolve();
    });

    const loadsBefore = vi.mocked(getWorkbenchSessions).mock.calls.length;
    await act(async () => {
      await latest().runAction("copy_agent_prompt");
    });

    expect(latest().lastActionSummary).toBe(
      "Agent prompt copied for 1 ready session; 1 selected session needs review and was left out"
    );
    expect(postWorkbenchCheckTranscript).not.toHaveBeenCalled();
    expect(getWorkbenchSessions).toHaveBeenCalledTimes(loadsBefore);
  });

  test("loads Not Added sessions when the panel is opened", async () => {
    mockWorkbenchResponse([session("session:abc", "Queue session")]);
    vi.mocked(getWorkbenchNotAddedSessions).mockResolvedValue({
      ok: true,
      generatedAt: "2026-07-07T12:00:00.000Z",
      limit: 50,
      total: 1,
      sessions: [
        {
          sessionId: "session:not-added",
          title: "Hook-only noise",
          runtime: "codex",
          lifecycle: "ended",
          lastActivityAt: "2026-07-07T11:00:00.000Z",
          reason: "hook_only"
        }
      ]
    });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);

    expect(getWorkbenchNotAddedSessions).not.toHaveBeenCalled();

    await act(async () => {
      latest().setNotAddedOpen(true);
      await Promise.resolve();
    });

    await waitFor(() => (latest()?.notAddedSessions.length ?? 0) === 1);

    expect(getWorkbenchNotAddedSessions).toHaveBeenCalledWith(baseUrl, expect.objectContaining({ limit: 50 }));
    expect(latest().notAddedOpen).toBe(true);
    expect(latest().notAddedSessions[0]?.sessionId).toBe("session:not-added");

    await act(async () => {
      latest().loadNotAdded();
      await Promise.resolve();
    });
    await waitFor(() => vi.mocked(getWorkbenchNotAddedSessions).mock.calls.length >= 2);
  });

  test("loads Quality review sessions when the panel is opened", async () => {
    mockWorkbenchResponse([session("session:abc", "Queue session")]);
    vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue({
      ok: true,
      total: 538,
      reasons: [{ reason: "insufficient_evidence", count: 538 }]
    });
    vi.mocked(getWorkbenchQualityReviewSessions).mockResolvedValue({
      ok: true,
      generatedAt: "2026-07-07T12:00:00.000Z",
      limit: 50,
      total: 538,
      sessions: [
        {
          sessionId: "session:review",
          title: "Insufficient evidence",
          runtime: "grok",
          lifecycle: "ended",
          lastActivityAt: "2026-07-07T11:00:00.000Z",
          reason: "insufficient_evidence"
        }
      ]
    });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);

    expect(getWorkbenchQualityReviewSummary).toHaveBeenCalled();
    expect(latest().qualityReviewSummary).toMatchObject({ total: 538 });
    expect(getWorkbenchQualityReviewSessions).not.toHaveBeenCalled();

    await act(async () => {
      latest().setQualityReviewOpen(true);
      await Promise.resolve();
    });

    await waitFor(() => (latest()?.qualityReviewSessions.length ?? 0) === 1);

    expect(getWorkbenchQualityReviewSessions).toHaveBeenCalledWith(baseUrl, expect.objectContaining({ limit: 50 }));
    expect(latest().qualityReviewOpen).toBe(true);
    expect(latest().qualityReviewSessions[0]?.sessionId).toBe("session:review");

    await act(async () => {
      latest().loadQualityReview();
      await Promise.resolve();
    });
    await waitFor(() => vi.mocked(getWorkbenchQualityReviewSessions).mock.calls.length >= 2);
  });

  test("selects Quality review panel rows as review even when not on the current queue page", async () => {
    mockWorkbenchResponse([
      session("session:ready", "Ready on page", {
        nextAction: "enrich",
        qualityStatus: "passed",
        transcriptStatus: "imported"
      })
    ]);
    vi.mocked(getWorkbenchQualityReviewSessions).mockResolvedValue({
      ok: true,
      generatedAt: "2026-07-07T12:00:00.000Z",
      limit: 50,
      total: 2,
      sessions: [
        {
          sessionId: "session:off-page-a",
          title: "Off page A",
          runtime: "grok",
          lifecycle: "ended",
          lastActivityAt: "2026-07-07T11:00:00.000Z",
          reason: "insufficient_evidence"
        },
        {
          sessionId: "session:off-page-b",
          title: "Off page B",
          runtime: "codex",
          lifecycle: "ended",
          lastActivityAt: "2026-07-07T11:01:00.000Z",
          reason: "insufficient_evidence"
        }
      ]
    });
    vi.mocked(postWorkbenchQuality).mockResolvedValue({ ok: true });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);

    await act(async () => {
      latest().setQualityReviewOpen(true);
      await Promise.resolve();
    });
    await waitFor(() => (latest()?.qualityReviewSessions.length ?? 0) === 2);

    await act(async () => {
      latest().selectQualityReviewVisible();
      await Promise.resolve();
    });

    expect(latest().selectedSessionIds.has("session:off-page-a")).toBe(true);
    expect(latest().selectedSessionIds.has("session:off-page-b")).toBe(true);
    expect(latest().qualityReviewSelectedCount).toBe(2);
    expect(latest().canRun("quality_pass")).toBe(true);
    expect(latest().canRun("quality_fail")).toBe(true);

    await act(async () => {
      latest().toggleSession("session:off-page-a");
      await Promise.resolve();
    });
    expect(latest().selectedSessionIds.has("session:off-page-a")).toBe(false);
    expect(latest().qualityReviewSelectedCount).toBe(1);

    await act(async () => {
      latest().toggleSession("session:off-page-a");
      await Promise.resolve();
    });
    expect(latest().qualityReviewSelectedCount).toBe(2);

    const listCallsBefore = vi.mocked(getWorkbenchQualityReviewSessions).mock.calls.length;
    await act(async () => {
      await latest().runAction("quality_fail");
    });

    expect(postWorkbenchQuality).toHaveBeenCalledTimes(2);
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:off-page-a", {
      status: "failed",
      reason: "operator_rejected"
    });
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:off-page-b", {
      status: "failed",
      reason: "operator_rejected"
    });
    expect(latest().lastActionSummary).toContain("Failed quality for 2 review sessions");
    await waitFor(() => vi.mocked(getWorkbenchQualityReviewSessions).mock.calls.length > listCallsBefore);
  });

  test("busy state disables actions until the mutation finishes", async () => {
    mockWorkbenchResponse([session("session:abc", "Busy session")]);
    let resolveCheck: ((value: unknown) => void) | undefined;
    vi.mocked(postWorkbenchCheckTranscript).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        })
    );

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await select("session:abc");

    let actionPromise: Promise<void> | undefined;
    await act(async () => {
      actionPromise = latest().runAction("check_transcript");
      await Promise.resolve();
    });

    await waitFor(() => latest()?.actionBusy === true);
    expect(latest().canRun("check_transcript")).toBe(false);
    expect(latest().canRun("copy_agent_prompt")).toBe(false);
    expect(latest().canRun("claim")).toBe(false);
    expect(latest().canRun("enroll_missing")).toBe(false);

    await act(async () => {
      resolveCheck?.({ ok: true });
      await actionPromise;
    });

    await waitFor(() => latest()?.actionBusy === false);
    expect(latest().canRun("check_transcript")).toBe(true);
    expect(latest().canRun("enroll_missing")).toBe(true);
  });

  test("enroll_missing posts, reloads queue, and reports summary", async () => {
    const enrolled = session("session:enrolled", "Newly enrolled", {
      nextAction: "check_transcript",
      transcriptStatus: "unchecked"
    });
    vi.mocked(getWorkbenchSessions)
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([enrolled]));
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
    vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue(qualityReviewSummary());
    vi.mocked(postWorkbenchEnrollMissing).mockResolvedValue({
      ok: true,
      enrolled: 2,
      heldForImportRepair: 0,
      skippedExisting: 1,
      enrolledSessionIds: ["session:enrolled", "session:other"],
      limit: 500,
      generatedAt: "2026-07-08T00:00:00.000Z"
    });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest()?.loading === false);

    expect(latest().canRun("enroll_missing")).toBe(true);

    await act(async () => {
      await latest().runAction("enroll_missing");
    });

    expect(postWorkbenchEnrollMissing).toHaveBeenCalledWith(baseUrl, { limit: 500 });
    expect(getWorkbenchSessions).toHaveBeenCalledTimes(2);
    expect(latest().sessions).toEqual([enrolled]);
    expect(latest().lastActionSummary).toBe("Enrolled 2 sessions");
    expect(latest().actionBusy).toBe(false);
    expect(latest().actionError).toBeUndefined();
  });

  test("enroll_missing reports zero enrollments and busy disables double-run", async () => {
    mockWorkbenchResponse([]);
    let resolveEnroll: ((value: WorkbenchEnrollMissingResponse) => void) | undefined;
    vi.mocked(postWorkbenchEnrollMissing).mockImplementation(
      () =>
        new Promise<WorkbenchEnrollMissingResponse>((resolve) => {
          resolveEnroll = resolve;
        })
    );

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest()?.loading === false);

    let actionPromise: Promise<void> | undefined;
    await act(async () => {
      actionPromise = latest().runAction("enroll_missing");
      await Promise.resolve();
    });

    await waitFor(() => latest()?.actionBusy === true);
    expect(latest().canRun("enroll_missing")).toBe(false);

    await act(async () => {
      resolveEnroll?.({
        ok: true,
        enrolled: 0,
        heldForImportRepair: 0,
        skippedExisting: 3,
        enrolledSessionIds: [],
        limit: 500,
        generatedAt: "2026-07-08T00:00:00.000Z"
      });
      await actionPromise;
    });

    await waitFor(() => latest()?.actionBusy === false);
    expect(postWorkbenchEnrollMissing).toHaveBeenCalledWith(baseUrl, { limit: 500 });
    expect(latest().lastActionSummary).toBe("No missing sessions to enroll");
    expect(latest().canRun("enroll_missing")).toBe(true);
  });

  test("surfaces incomplete V5 authoring request and reuses bootstrap handoff for resume", async () => {
    mockWorkbenchResponse([session("session:a", "Ready")]);
    vi.mocked(getIncompleteWorkbenchAuthoringRequest).mockResolvedValue({
      request: {
        requestId: "authoring-v5-request:resume",
        status: "active",
        packsCompleted: 1,
        packCount: 3,
        sessionsCompleted: 10,
        sessionCount: 30,
        handoff: {
          requestId: "authoring-v5-request:resume",
          startCommand:
            "/home/test/.local/bin/mastheadctl workbench author bootstrap --request 'authoring-v5-request:resume' --json"
        },
        updatedAt: "2026-07-28T12:00:00.000Z"
      }
    });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().incompleteAuthoring?.requestId === "authoring-v5-request:resume");

    expect(getIncompleteWorkbenchAuthoringRequest).toHaveBeenCalledWith(
      baseUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(latest().incompleteAuthoring).toMatchObject({
      packsCompleted: 1,
      packCount: 3,
      sessionsCompleted: 10,
      sessionCount: 30
    });

    let prompt = "";
    await act(async () => {
      prompt = await latest().copyResumePrompt();
    });
    expect(prompt).toContain("authoring-v5-request:resume");
    expect(prompt).toContain("workbench author bootstrap --request 'authoring-v5-request:resume' --json");
    expect(createGuidedAuthoringRequest).not.toHaveBeenCalled();
  });

  test("omits incomplete authoring when no open request exists", async () => {
    mockWorkbenchResponse([session("session:a", "Ready")]);
    vi.mocked(getIncompleteWorkbenchAuthoringRequest).mockResolvedValue({});

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().loading === false);

    expect(latest().incompleteAuthoring).toBeUndefined();
    await expect(act(async () => {
      await latest().copyResumePrompt();
    })).rejects.toThrow("No incomplete authoring request to resume");
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
    root?.render(<WorkbenchHarness {...props} />);
  });
  await flushAsync();
}

function WorkbenchHarness(props: HarnessProps) {
  latestResult = useWorkbenchController(props);
  return null;
}

function latest(): UseWorkbenchControllerResult {
  expect(latestResult).toBeDefined();
  return latestResult as UseWorkbenchControllerResult;
}

async function select(sessionId: string): Promise<void> {
  await act(async () => {
    latest().clearSelection();
    await Promise.resolve();
  });
  await act(async () => {
    latest().toggleSession(sessionId);
    await Promise.resolve();
  });
}

function session(sessionId: string, title: string, overrides: Partial<WorkbenchQueueSessionDto> = {}): WorkbenchQueueSessionDto {
  const transcriptStatus = overrides.transcriptStatus ?? "imported";
  return {
    bugFixTraceStatus: "unknown",
    compileReady: overrides.compileReady ?? (
      (transcriptStatus === "available" || transcriptStatus === "imported") &&
      (overrides.qualityStatus ?? "passed") === "passed"
    ),
    latestActivity: undefined,
    nextAction: "check_transcript",
    publicationStatus: "publish_path",
    qualityStatus: "passed",
    sessionDossierStatus: "missing",
    sessionEnrichmentStatus: "missing",
    transcriptStatus,
    lastActivityAt: "2026-07-07T12:00:00.000Z",
    lifecycle: "ended",
    project: "Masthead",
    runtime: "codex",
    sessionId,
    title,
    ...overrides
  };
}

function response(sessions: WorkbenchQueueSessionDto[]) {
  return {
    generatedAt: "2026-07-07T12:00:00.000Z",
    limit: 100,
    offset: 0,
    total: sessions.length,
    ok: true as const,
    scope: "default" as const,
    sessions
  };
}

function activityResponse() {
  return { activity: [], generatedAt: "2026-07-07T12:00:00.000Z", limit: 30, ok: true as const };
}

function notAddedSummary() {
  return { ok: true as const, reasons: [], total: 0 };
}

function qualityReviewSummary() {
  return { ok: true as const, reasons: [], total: 0 };
}

function mockWorkbenchResponse(sessions: WorkbenchQueueSessionDto[]): void {
  vi.mocked(getWorkbenchAuthoringCapabilities).mockResolvedValue(
    authoringCapabilities("database:test", "/home/test/.local/bin/mastheadctl")
  );
  vi.mocked(getWorkbenchSessions).mockResolvedValue(response(sessions));
  vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
  vi.mocked(listPendingGuidedCanaries).mockResolvedValue([]);
  vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
  vi.mocked(getWorkbenchQualityReviewSummary).mockResolvedValue(qualityReviewSummary());
  vi.mocked(getWorkbenchImportHealthSummary).mockResolvedValue({ ok: true, importJobIds: [], reasons: [], repairRequired: 0 });
  vi.mocked(getIncompleteWorkbenchAuthoringRequest).mockResolvedValue({});
}

function authoringCapabilities(databaseId: string, command: string): WorkbenchAuthoringV5CapabilitiesDto {
  return {
    bundleVersion: "workbench-authoring-v5",
    capability: "artifact_authoring",
    baseUrl: "http://127.0.0.1:17373",
    buildSha: "build:test",
    command,
    databaseId,
    instanceId: "instance:test",
    instanceManifest: "/tmp/masthead/masthead-instance.json",
    maximumSessionsPerPack: 12,
    minimumSessionsPerPack: 5,
    operations: ["bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"],
    policyVersion: "workbench-authoring-v5",
    protocol: "masthead.workbench.authoring/v1",
  };
}

function guidedIdentity() {
  return {
    baseUrl: "http://127.0.0.1:17373",
    buildSha: "build:test",
    databaseId: "database:test",
    instanceId: "instance:test",
    instanceManifest: "/tmp/masthead/masthead-instance.json"
  };
}

function guidedRequestResult(requestId: string) {
  return {
    handoff: {
      requestId,
      startCommand: `/home/test/.local/bin/mastheadctl workbench author bootstrap --request '${requestId}' --json`
    },
    request: {
      requestId,
      actorId: "workbench",
      contractVersion: "workbench-authoring-v5" as const,
      status: "active" as const,
      baseUrl: "http://127.0.0.1:17373",
      databaseId: "database:test",
      buildSha: "build:test",
      instanceManifest: "/tmp/masthead/masthead-instance.json",
      creationInstanceId: "instance:test",
      sessionCount: 2,
      attemptedSessionCount: 0,
      publishedSessionCount: 0,
      softFlaggedSessionCount: 0,
      rejectedSessionCount: 0,
      packCount: 1,
      packSizes: [2],
      currentPackId: "authoring-v5-pack:one",
      createdAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z"
    },
    nextAction: {
      command: `/home/test/.local/bin/mastheadctl workbench author start --request '${requestId}' --json`,
      kind: "start" as const,
      reason: "Start or resume the next fixed pack."
    },
    selection: {
      eligibleSessionCount: 2,
      excludedSessionCount: 0,
      excludedSessions: [],
      requestedSessionCount: 2
    }
  };
}

function stagedReview(assignmentId: string): GuidedAuthoringReviewDto {
  return {
    requestId: "request:canary",
    assignmentId,
    status: "staged_canary",
    evidenceRevision: "evidence:four",
    draftRevision: 4,
    draft: {
      bundleVersion: "workbench-authoring-v4",
      assignmentId,
      evidenceRevision: "evidence:four",
      sessionEnrichments: [],
      opportunityDispositions: [],
      artifacts: []
    },
    findings: [],
    editorialQuestions: [],
    coverage: [],
    operatorReviews: [],
    nextAction: {
      kind: "await_operator",
      command: "/home/test/.local/bin/mastheadctl workbench author review --assignment assignment:canary --json",
      reason: "The canary is waiting for operator review."
    }
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await flushAsync();
  }
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
