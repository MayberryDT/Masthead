import type {
  SourcesSetupLiveCaptureSelection,
  SourcesSetupRunInput
} from "../../shared/sourcesSetup";

export type SourcesSetupPlan = SourcesSetupRunInput & {
  liveCapture: SourcesSetupLiveCaptureSelection[];
};

export type SetupRunLogEntry = {
  id: string;
  label: string;
  message: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  timestamp: string;
};

export type SetupRunReport = {
  status: "succeeded" | "needs_attention";
  steps: SetupRunLogEntry[];
};

type SetupPlanRunnerDeps = {
  onLog: (entry: SetupRunLogEntry) => void;
  runHookAction: (action: "install" | "test" | "uninstall") => Promise<unknown> | unknown;
  runSetup: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
};

export async function runSourcesSetupPlan(plan: SourcesSetupPlan, deps: SetupPlanRunnerDeps): Promise<SetupRunReport> {
  const steps: SetupRunLogEntry[] = [];

  for (const liveCapture of plan.liveCapture) {
    if (liveCapture.runtime !== "codex" || liveCapture.action === "leave") {
      appendStep(steps, deps, {
        id: `live:${liveCapture.runtime}`,
        label: `${liveCapture.runtime} live capture`,
        message: "No writable live hook action requested.",
        status: "skipped",
        timestamp: new Date().toISOString()
      });
      continue;
    }

    const label = liveCapture.action === "install" ? "Install Codex live capture" : `${liveCapture.action} Codex live capture`;
    appendStep(steps, deps, runningStep(`live:${liveCapture.runtime}:${liveCapture.action}`, label));
    try {
      await deps.runHookAction(liveCapture.action);
      appendStep(steps, deps, completedStep(`live:${liveCapture.runtime}:${liveCapture.action}`, label, "succeeded"));
    } catch (error) {
      appendStep(steps, deps, completedStep(`live:${liveCapture.runtime}:${liveCapture.action}`, label, "failed", errorMessage(error)));
    }
  }

  if (plan.importMetadata || plan.importTranscripts || plan.queueEnrichment) {
    const setupInput: SourcesSetupRunInput = {
      enrichmentMode: plan.enrichmentMode,
      importMetadata: plan.importMetadata,
      importScope: plan.importScope,
      importTranscripts: plan.importTranscripts,
      queueEnrichment: plan.queueEnrichment,
      runtimeApprovals: plan.runtimeApprovals,
      runtimes: plan.runtimes,
      sourceIds: plan.sourceIds,
      transcriptApproved: plan.transcriptApproved,
      transcriptApprovals: plan.transcriptApprovals
    };
    const label = plan.importMetadata ? "Import selected metadata" : "Run selected source setup";
    appendStep(steps, deps, runningStep("sources:setup", label));
    try {
      await deps.runSetup(setupInput);
      appendStep(steps, deps, completedStep("sources:setup", label, "succeeded"));
    } catch (error) {
      appendStep(steps, deps, completedStep("sources:setup", label, "failed", errorMessage(error)));
    }
  }

  return {
    status: steps.some((step) => step.status === "failed") ? "needs_attention" : "succeeded",
    steps
  };
}

function appendStep(steps: SetupRunLogEntry[], deps: SetupPlanRunnerDeps, entry: SetupRunLogEntry): void {
  steps.push(entry);
  deps.onLog(entry);
}

function runningStep(id: string, label: string): SetupRunLogEntry {
  return {
    id,
    label,
    message: "Running...",
    status: "running",
    timestamp: new Date().toISOString()
  };
}

function completedStep(id: string, label: string, status: "succeeded" | "failed", message?: string): SetupRunLogEntry {
  return {
    id,
    label,
    message: message ?? (status === "succeeded" ? "Complete." : "Failed."),
    status,
    timestamp: new Date().toISOString()
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
