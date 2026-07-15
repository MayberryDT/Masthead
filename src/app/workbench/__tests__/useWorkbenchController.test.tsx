// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkbenchEnrollMissingResponse, WorkbenchQueueSessionDto } from "../../../shared/workbench";
import type { WorkbenchAuthoringCapabilitiesDto } from "../../../shared/workbenchAuthoring";
import {
  useWorkbenchController,
  type UseWorkbenchControllerResult,
  type WorkbenchActionKind
} from "../useWorkbenchController";
import {
  getWorkbenchAuthoringCapabilities,
  getWorkbenchActivity,
  getWorkbenchNotAddedSessions,
  getWorkbenchNotAddedSummary,
  getWorkbenchSessions,
  postWorkbenchCheckTranscript,
  postWorkbenchClaim,
  postWorkbenchEnrollMissing,
  postWorkbenchImportTranscript,
  postWorkbenchQuality,
  postWorkbenchReleaseClaim
} from "../../daemonClient";

const daemonClientMocks = vi.hoisted(() => ({
  getWorkbenchAuthoringCapabilities: vi.fn(),
  getWorkbenchActivity: vi.fn(),
  getWorkbenchNotAddedSessions: vi.fn(),
  getWorkbenchNotAddedSummary: vi.fn(),
  getWorkbenchSessions: vi.fn(),
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
});

describe("useWorkbenchController", () => {
  test("preserves selections across pages in one authoritative handoff", async () => {
    vi.mocked(getWorkbenchAuthoringCapabilities).mockResolvedValue(
      authoringCapabilities("database:test", "/home/test/.local/bin/mastheadctl")
    );
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
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
    expect(machineRequest().sessionIds).toEqual(["session:page-1", "session:page-2"]);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
  });
  test("requires V3 capabilities and a compile-ready selection for Copy Agent Prompt", async () => {
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
    expect(latest().handoffText).toBe("");
    await act(async () => {
      latest().toggleSession("session:ready");
      await Promise.resolve();
    });
    expect(latest().canRun("copy_agent_prompt")).toBe(false);
    expect(latest().handoffText).toBe("");
    await act(async () => {
      latest().toggleSession("session:not-ready");
      await Promise.resolve();
    });
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    expect(latest().handoffText).toContain('"bundleVersion":"workbench-authoring-v3"');
    expect(latest().handoffText).toContain('"sessionIds":["session:ready"]');
    await act(async () => {
      latest().toggleSession("session:available");
      await Promise.resolve();
    });
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
    expect(machineRequest().sessionIds).toEqual(["session:ready", "session:available"]);
  });

  test("keeps Copy Agent Prompt disabled for legacy authoring capabilities", async () => {
    mockWorkbenchResponse([session("session:ready", "Ready")]);
    vi.mocked(getWorkbenchAuthoringCapabilities).mockResolvedValue({
      bundleVersion: "workbench-authoring-v1",
      capability: "artifact_authoring",
      command: "/home/test/.local/bin/mastheadctl",
      databaseId: "database:test",
      evidencePolicy: "all_canonical_redacted_evidence",
      operations: ["open", "status", "evidence", "submit", "finish"],
      protocol: "masthead.workbench.authoring/v1",
      transport: "daemon_http"
    });

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => latest().sessions.length === 1);
    await select("session:ready");

    expect(latest().canRun("copy_agent_prompt")).toBe(false);
    expect(latest().handoffText).toBe("");
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

  test("preserves selected ids when a refresh page does not contain them", async () => {
    vi.mocked(getWorkbenchSessions)
      .mockResolvedValueOnce(response([session("session:abc", "First session"), session("session:def", "Second session")]))
      .mockResolvedValueOnce(response([session("session:def", "Second session")]));
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());

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
    expect(Array.from(latest().selectedSessionIds).sort()).toEqual(["session:abc", "session:def"]);
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
    expect(latest().handoffText).toContain("masthead.workbench.authoring/v1");
    expect(latest().handoffText).toContain("runbook");
    expect(latest().handoffText).toContain('"command":"/home/test/.local/bin/mastheadctl"');
    expect(latest().handoffText).not.toContain("npm run import review");

    await act(async () => {
      latest().selectPage();
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

  test("updates authoritative handoff IDs immediately across rapid selection changes", async () => {
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
    expect(machineRequest().sessionIds).toEqual(["session:a"]);

    await act(async () => {
      latest().toggleSession("session:a");
      latest().toggleSession("session:b");
      await Promise.resolve();
    });

    expect(machineRequest().sessionIds).toEqual(["session:b"]);
    expect(latest().canRun("copy_agent_prompt")).toBe(true);
  });

  test("selectAll rejects an off-page mixed-readiness selection from the authoritative handoff", async () => {
    vi.mocked(getWorkbenchAuthoringCapabilities).mockResolvedValue(
      authoringCapabilities("database:test", "/home/test/.local/bin/mastheadctl")
    );
    vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
    vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
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
    expect(latest().handoffText).toBe("");
    expect(latest().canRun("copy_agent_prompt")).toBe(false);
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

  test("does not generate a copied handoff when daemon authoring capabilities are unavailable", async () => {
    mockWorkbenchResponse([session("session:abc", "Copy session")]);
    vi.mocked(getWorkbenchAuthoringCapabilities).mockRejectedValue(new Error("not available"));

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await select("session:abc");

    expect(latest().handoffText).toBe("");
    expect(latest().canRun("copy_agent_prompt")).toBe(false);
  });

  test("rebinds copied handoff after capabilities change without retaining the old database", async () => {
    mockWorkbenchResponse([session("session:abc", "Copy session")]);
    vi.mocked(getWorkbenchAuthoringCapabilities)
      .mockResolvedValueOnce(authoringCapabilities("database:first", "/first/mastheadctl"))
      .mockResolvedValueOnce(authoringCapabilities("database:second", "/second/mastheadctl"));

    await renderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 1 });
    await waitFor(() => (latest()?.sessions.length ?? 0) === 1);
    await select("session:abc");
    await waitFor(() => latest()?.handoffText.includes("database:first") === true);
    expect(latest().handoffText).toContain("database:first");

    await rerenderHarness({ active: true, activeProjectionUrl: baseUrl, isLive: true, refreshKey: 2 });
    await waitFor(() => latest()?.handoffText.includes("database:second") === true);

    expect(latest().handoffText).toContain("/second/mastheadctl");
    expect(latest().handoffText).not.toContain("database:first");
    expect(latest().handoffText).not.toContain("/first/mastheadctl");
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

    expect(latest().lastActionSummary).toBe("Agent prompt copied for 1 sessions");
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
    await Promise.resolve();
  });
  await act(async () => {
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
    qualityStatus: "passed",
    sessionDossierStatus: "missing",
    sessionEnrichmentStatus: "missing",
    transcriptStatus: "imported",
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

function mockWorkbenchResponse(sessions: WorkbenchQueueSessionDto[]): void {
  vi.mocked(getWorkbenchAuthoringCapabilities).mockResolvedValue(
    authoringCapabilities("database:test", "/home/test/.local/bin/mastheadctl")
  );
  vi.mocked(getWorkbenchSessions).mockResolvedValue(response(sessions));
  vi.mocked(getWorkbenchActivity).mockResolvedValue(activityResponse());
  vi.mocked(getWorkbenchNotAddedSummary).mockResolvedValue(notAddedSummary());
}

function authoringCapabilities(databaseId: string, command: string): WorkbenchAuthoringCapabilitiesDto {
  return {
    bundleVersion: "workbench-authoring-v3",
    capability: "artifact_authoring",
    command,
    databaseId,
    evidencePolicy: "selected_session_canonical_evidence",
    maxSessionsPerRun: 12,
    operations: ["suggestions", "open", "status", "evidence", "context", "submit", "finish"],
    protocol: "masthead.workbench.authoring/v1",
    suggestionsAreBinding: false,
    transport: "daemon_http"
  };
}

function machineRequest(): { sessionIds: string[] } {
  const line = latest().handoffText.split("\n").find((value) => value.startsWith('{"protocol"'));
  expect(line).toBeDefined();
  return JSON.parse(line ?? "{}") as { sessionIds: string[] };
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
