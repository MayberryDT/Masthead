// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkbenchEnrollMissingResponse, WorkbenchQueueSessionDto } from "../../../shared/workbench";
import {
  useWorkbenchController,
  type UseWorkbenchControllerResult,
  type WorkbenchActionKind
} from "../useWorkbenchController";
import {
  getWorkbenchActivity,
  getWorkbenchNotAddedSessions,
  getWorkbenchNotAddedSummary,
  getWorkbenchSessions,
  postWorkbenchCheckTranscript,
  postWorkbenchClaim,
  postWorkbenchEnrollMissing,
  postWorkbenchImportTranscript,
  postWorkbenchPublish,
  postWorkbenchQuality,
  postWorkbenchReleaseClaim
} from "../../daemonClient";

const daemonClientMocks = vi.hoisted(() => ({
  getWorkbenchActivity: vi.fn(),
  getWorkbenchNotAddedSessions: vi.fn(),
  getWorkbenchNotAddedSummary: vi.fn(),
  getWorkbenchSessions: vi.fn(),
  postWorkbenchCheckTranscript: vi.fn(),
  postWorkbenchClaim: vi.fn(),
  postWorkbenchEnrollMissing: vi.fn(),
  postWorkbenchImportTranscript: vi.fn(),
  postWorkbenchPublish: vi.fn(),
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
  "publish",
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
});

describe("useWorkbenchController", () => {
  test("loads missing sessions only when Workbench is active and live", async () => {
    mockWorkbenchResponse([session("session:abc", "Workbench import review")]);
    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });

    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);

    expect(getWorkbenchSessions).toHaveBeenCalledWith(baseUrl, expect.objectContaining({ limit: 50 }));
    expect(latest().sessions).toEqual([session("session:abc", "Workbench import review")]);
    expect(latest().activity).toEqual([]);
    expect(latest().notAddedSummary).toMatchObject({ total: 0 });
    expect(latest().actionBusy).toBe(false);
    expect(latest().notAddedOpen).toBe(false);
    expect(latest().notAddedSessions).toEqual([]);
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

  test("prunes selected ids when refresh drops sessions", async () => {
    vi.mocked(getWorkbenchSessions)
      .mockResolvedValueOnce(response([session("session:abc", "First session"), session("session:def", "Second session")]))
      .mockResolvedValueOnce(response([session("session:def", "Second session")]));
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 2);

    await act(async () => {
      latest().selectAllVisible();
      await Promise.resolve();
    });

    expect(Array.from(latest().selectedSessionIds).sort()).toEqual(["session:abc", "session:def"]);

    await rerenderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 2 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);

    expect(latest().sessions.map((item) => item.sessionId)).toEqual(["session:def"]);
    expect(Array.from(latest().selectedSessionIds)).toEqual(["session:def"]);
  });

  test("supports toggle, select all visible, and clear selection while keeping selected metadata sanitized", async () => {
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
    expect(latest().handoffText).toContain("session:abc");
    expect(latest().handoffText).not.toContain("session:def");
    expect(latest().handoffText).not.toContain("Second session");
    expect(latest().handoffText).toContain("node dist/daemon/src/cli/mastheadctl.js workbench status --json");
    expect(latest().handoffText).not.toContain("npm run import review");

    await act(async () => {
      latest().selectAllVisible();
      await Promise.resolve();
    });

    expect(Array.from(latest().selectedSessionIds).sort()).toEqual(["session:abc", "session:def"]);
    expect(latest().handoffText).not.toContain("schema.json cleanup");

    await act(async () => {
      latest().clearSelection();
      await Promise.resolve();
    });

    expect(Array.from(latest().selectedSessionIds)).toEqual([]);
  });

  test("retries after a failed load", async () => {
    vi.mocked(getWorkbenchSessions)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(response([session("session:abc", "Recovered session")]));
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());

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
      session("session:publish", "Publish me", {
        nextAction: "publish",
        transcriptStatus: "imported",
        qualityStatus: "passed"
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
    await waitFor(() => (latest()?.sessions.length ?? 0) === 6);

    expect(latest().canRun("enroll_missing")).toBe(true);
    for (const kind of SELECTION_ACTIONS) {
      expect(latest().canRun(kind)).toBe(false);
    }

    await select("session:check");
    expect(latest().canRun("enroll_missing")).toBe(true);
    expect(latest().canRun("check_transcript")).toBe(true);
    expect(latest().canRun("import_transcript")).toBe(false);
    expect(latest().canRun("quality_pass")).toBe(false);
    expect(latest().canRun("publish")).toBe(false);
    expect(latest().canRun("claim")).toBe(true);
    expect(latest().canRun("release")).toBe(false);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);

    await select("session:import");
    expect(latest().canRun("import_transcript")).toBe(true);
    expect(latest().canRun("check_transcript")).toBe(true);
    expect(latest().canRun("publish")).toBe(false);

    await select("session:quality");
    expect(latest().canRun("quality_pass")).toBe(true);
    expect(latest().canRun("quality_fail")).toBe(true);
    expect(latest().canRun("quality_precheck")).toBe(true);

    await select("session:publish");
    expect(latest().canRun("publish")).toBe(true);
    expect(latest().canRun("claim")).toBe(true);
    expect(latest().canRun("release")).toBe(false);

    await select("session:claimed");
    expect(latest().canRun("claim")).toBe(false);
    expect(latest().canRun("release")).toBe(true);
    expect(latest().canRun("publish")).toBe(false);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);

    await select("session:enrich");
    expect(latest().canRun("check_transcript")).toBe(false);
    expect(latest().canRun("import_transcript")).toBe(false);
    expect(latest().canRun("quality_pass")).toBe(false);
    expect(latest().canRun("publish")).toBe(false);
    expect(latest().canRun("claim")).toBe(true);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);

    await act(async () => {
      latest().clearSelection();
      await Promise.resolve();
    });
    expect(latest().canRun("copy_agent_prompt")).toBe(false);
    expect(latest().canRun("enroll_missing")).toBe(true);
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

  test("runs quality, publish, claim, and release against selected sessions", async () => {
    mockWorkbenchResponse([
      session("session:quality", "Quality", {
        nextAction: "review_quality",
        qualityStatus: "unchecked",
        transcriptStatus: "imported"
      }),
      session("session:publish", "Publish", {
        nextAction: "publish",
        qualityStatus: "passed",
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
    vi.mocked(postWorkbenchPublish).mockResolvedValue({ ok: true });
    vi.mocked(postWorkbenchClaim).mockResolvedValue({ ok: true });
    vi.mocked(postWorkbenchReleaseClaim).mockResolvedValue({ ok: true });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 4);

    await select("session:quality");
    await act(async () => {
      await latest().runAction("quality_pass");
    });
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:quality", { status: "passed" });

    await select("session:quality");
    await act(async () => {
      await latest().runAction("quality_fail");
    });
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:quality", {
      status: "failed",
      reason: "operator_rejected"
    });

    await select("session:quality");
    await act(async () => {
      await latest().runAction("quality_precheck");
    });
    expect(postWorkbenchQuality).toHaveBeenCalledWith(baseUrl, "session:quality", { mode: "precheck" });

    await select("session:publish");
    await act(async () => {
      await latest().runAction("publish");
    });
    expect(postWorkbenchPublish).toHaveBeenCalledWith(baseUrl, "session:publish");

    await select("session:open");
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

  test("copy_agent_prompt only sets summary without posting", async () => {
    mockWorkbenchResponse([session("session:abc", "Copy session")]);

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await select("session:abc");

    const loadsBefore = vi.mocked(getWorkbenchSessions).mock.calls.length;
    await act(async () => {
      await latest().runAction("copy_agent_prompt");
    });

    expect(latest().lastActionSummary).toBe("Agent prompt ready to copy");
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
    vi.mocked(postWorkbenchEnrollMissing).mockResolvedValue({
      ok: true,
      enrolled: 2,
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
    latest().toggleSession(sessionId);
    await Promise.resolve();
  });
}

function session(sessionId: string, title: string, overrides: Partial<WorkbenchQueueSessionDto> = {}): WorkbenchQueueSessionDto {
  return {
    bugFixTraceStatus: "unknown",
    latestActivity: undefined,
    nextAction: "check_transcript",
    publicationStatus: "publish_path",
    qualityStatus: "unchecked",
    sessionDossierStatus: "missing",
    sessionEnrichmentStatus: "missing",
    transcriptStatus: "unchecked",
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
    limit: 50,
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

function mockWorkbenchResponse(sessions: WorkbenchQueueSessionDto[]): void {
  vi.mocked(getWorkbenchSessions).mockResolvedValue(response(sessions));
  vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
  vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
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
