import { harnessForRuntime } from "../../adapters/harnessCatalog";
import type { RuntimeKind } from "../../adapters/types";
import type {
  SourcesSetupLiveCaptureSelection,
  SourcesSetupRunInput
} from "../../shared/sourcesSetup";
type HookAction = "install" | "test" | "uninstall";

const SUPPORTED_HOOK_RUNTIMES: Record<string, true> = {
  claude_code: true,
  codex: true,
  cursor: true,
  grok: true,
  omp: true,
  opencode: true
};


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
  runHookAction: (runtime: string, action: HookAction) => Promise<unknown> | unknown;
  runSetup: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
};

export async function runSourcesSetupPlan(plan: SourcesSetupPlan, deps: SetupPlanRunnerDeps): Promise<SetupRunReport> {
  const steps: SetupRunLogEntry[] = [];

  for (const liveCapture of plan.liveCapture) {
    if (liveCapture.action === "leave") {
      appendStep(steps, deps, {
        id: `live:${liveCapture.runtime}`,
        label: `${runtimeLabel(liveCapture.runtime)} live capture`,
        message: "No writable live hook action requested.",
        status: "skipped",
        timestamp: new Date().toISOString()
      });
      continue;
    }

    if (!SUPPORTED_HOOK_RUNTIMES[liveCapture.runtime]) {
      appendStep(steps, deps, {
        id: `live:${liveCapture.runtime}`,
        label: `${runtimeLabel(liveCapture.runtime)} live capture`,
        message: "Live capture is required but this harness does not have a writable adapter yet.",
        status: "failed",
        timestamp: new Date().toISOString()
      });
      continue;
    }

    const label = liveCapture.action === "install" ? `Install ${runtimeLabel(liveCapture.runtime)} live capture` : `${liveCapture.action} ${runtimeLabel(liveCapture.runtime)} live capture`;
    appendStep(steps, deps, runningStep(`live:${liveCapture.runtime}:${liveCapture.action}`, label));
    try {
      await deps.runHookAction(liveCapture.runtime, liveCapture.action);
      appendStep(steps, deps, completedStep(`live:${liveCapture.runtime}:${liveCapture.action}`, label, "succeeded"));
    } catch (error) {
      appendStep(steps, deps, completedStep(`live:${liveCapture.runtime}:${liveCapture.action}`, label, "failed", errorMessage(error)));
    }
  }

  if (plan.importMetadata || plan.importTranscripts || plan.queueEnrichment) {
    const targets = setupTargets(plan);
    for (const target of targets) {
      const setupInput: SourcesSetupRunInput = {
        enrichmentMode: plan.enrichmentMode,
        importMetadata: plan.importMetadata,
        importScope: plan.importScope,
        importTranscripts: plan.importTranscripts,
        queueEnrichment: plan.queueEnrichment,
        runtimeApprovals: filterRuntimeApprovals(plan.runtimeApprovals, target.runtime),
        runtimes: target.runtime ? [target.runtime] : plan.runtimes,
        sourceIds: target.sourceIds ?? plan.sourceIds,
        transcriptApproved: plan.transcriptApproved,
        transcriptApprovals: filterTranscriptApprovals(plan.transcriptApprovals, target.runtime)
      };
      const label = setupLabel(plan, target.runtime);
      appendStep(steps, deps, runningStep(`sources:setup:${target.runtime ?? "selected"}`, label));
      try {
        await deps.runSetup(setupInput);
        appendStep(steps, deps, completedStep(`sources:setup:${target.runtime ?? "selected"}`, label, "succeeded"));
      } catch (error) {
        appendStep(steps, deps, completedStep(`sources:setup:${target.runtime ?? "selected"}`, label, "failed", errorMessage(error)));
      }
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

function setupTargets(plan: SourcesSetupPlan): Array<{ runtime?: string; sourceIds?: string[] }> {
  const runtimes = Array.from(new Set(plan.runtimes ?? plan.transcriptApprovals?.map((approval) => approval.runtime) ?? []));
  if (runtimes.length === 0) return [{ sourceIds: plan.sourceIds }];

  return runtimes.map((runtime) => {
    const sourceIds = plan.transcriptApprovals
      ?.filter((approval) => approval.runtime === runtime)
      .map((approval) => approval.sourceId);
    return {
      runtime,
      sourceIds: sourceIds && sourceIds.length > 0 ? sourceIds : undefined
    };
  });
}

function filterRuntimeApprovals(
  approvals: SourcesSetupRunInput["runtimeApprovals"],
  runtime: string | undefined
): SourcesSetupRunInput["runtimeApprovals"] {
  if (!approvals || !runtime) return approvals;
  return approvals.filter((approval) => approval.runtime === runtime);
}

function filterTranscriptApprovals(
  approvals: SourcesSetupRunInput["transcriptApprovals"],
  runtime: string | undefined
): SourcesSetupRunInput["transcriptApprovals"] {
  if (!approvals || !runtime) return approvals;
  return approvals.filter((approval) => approval.runtime === runtime);
}

function setupLabel(plan: SourcesSetupPlan, runtime: string | undefined): string {
  if (!runtime) return plan.importMetadata ? "Import selected metadata" : "Run selected source setup";
  const label = runtimeLabel(runtime);
  if (plan.importMetadata) return `Import ${label} metadata`;
  return `Run ${label} source setup`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtimeLabel(runtime: string): string {
  return harnessForRuntime(runtime as RuntimeKind)?.label ?? runtime.replaceAll("_", " ");
}
