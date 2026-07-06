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

    expect(runHookAction).toHaveBeenCalledWith("codex", "install");
    expect(runSetup).toHaveBeenCalledWith({
      enrichmentMode: "skip",
      importMetadata: true,
      importScope: undefined,
      importTranscripts: false,
      queueEnrichment: false,
      runtimeApprovals: undefined,
      runtimes: undefined,
      sourceIds: ["codex-source"],
      transcriptApproved: undefined,
      transcriptApprovals: undefined
    });
    expect(result.status).toBe("needs_attention");
    expect(result.steps.map((step) => step.status)).toEqual(["running", "failed", "running", "succeeded"]);
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
    expect(result.steps.filter((step) => step.status !== "running").every((step) => step.status === "succeeded")).toBe(true);
  });

  test("runs hook actions for supported non-Codex live-capture runtimes", async () => {
    const runSetup = vi.fn(async () => ({ ok: true, setup: {} }));
    const runHookAction = vi.fn(async () => undefined);

    const result = await runSourcesSetupPlan(
      {
        enrichmentMode: "skip",
        importMetadata: true,
        importTranscripts: false,
        liveCapture: [
          { action: "install", runtime: "codex" },
          { action: "install", runtime: "omp" }
        ],
        queueEnrichment: false,
        sourceIds: ["codex-source", "omp-source"]
      },
      {
        onLog: () => undefined,
        runHookAction,
        runSetup
      }
    );

    expect(runHookAction).toHaveBeenNthCalledWith(1, "codex", "install");
    expect(runHookAction).toHaveBeenNthCalledWith(2, "omp", "install");
    expect(runHookAction).toHaveBeenCalledTimes(2);
    expect(runSetup).toHaveBeenCalledWith(expect.objectContaining({
      sourceIds: ["codex-source", "omp-source"]
    }));
    expect(result.status).toBe("succeeded");
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Install Oh My Pi live capture",
        status: "succeeded"
      })
    ]));
  });

  test("runs metadata setup once per selected harness and labels progress rows by harness", async () => {
    const runSetup = vi.fn(async () => ({ ok: true, setup: {} }));

    const result = await runSourcesSetupPlan(
      {
        enrichmentMode: "skip",
        importMetadata: true,
        importTranscripts: false,
        liveCapture: [],
        queueEnrichment: false,
        runtimes: ["codex", "opencode", "hermes"],
        sourceIds: ["codex-source", "opencode-source", "hermes-source"],
        transcriptApprovals: [
          { approved: false, runtime: "codex", sourceId: "codex-source" },
          { approved: false, runtime: "opencode", sourceId: "opencode-source" },
          { approved: false, runtime: "hermes", sourceId: "hermes-source" }
        ]
      },
      {
        onLog: () => undefined,
        runHookAction: async () => undefined,
        runSetup
      }
    );

    expect(runSetup).toHaveBeenCalledTimes(3);
    expect(runSetup).toHaveBeenNthCalledWith(1, expect.objectContaining({
      runtimes: ["codex"],
      sourceIds: ["codex-source"]
    }));
    expect(runSetup).toHaveBeenNthCalledWith(2, expect.objectContaining({
      runtimes: ["opencode"],
      sourceIds: ["opencode-source"]
    }));
    expect(runSetup).toHaveBeenNthCalledWith(3, expect.objectContaining({
      runtimes: ["hermes"],
      sourceIds: ["hermes-source"]
    }));
    expect(result.steps.map((step) => `${step.status}:${step.label}`)).toEqual([
      "running:Import Codex metadata",
      "succeeded:Import Codex metadata",
      "running:Import OpenCode metadata",
      "succeeded:Import OpenCode metadata",
      "running:Import Hermes metadata",
      "succeeded:Import Hermes metadata"
    ]);
  });
});
