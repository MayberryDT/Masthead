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

    expect(runHookAction).toHaveBeenCalledWith("install");
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
});
