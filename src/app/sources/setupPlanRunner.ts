/**
 * Legacy import + live-capture setup planner used by SourcesOnboardingModal / import modal.
 * Sources V2 first-run uses `SourcesConnectOnboarding` (Discover → Enable → Activate) and does
 * not require metadata import through this runner.
 */
import { HARNESS_CATALOG, harnessForRuntime } from "../../adapters/harnessCatalog";
import type { RuntimeKind } from "../../adapters/types";
import type {
  SourcesSetupLiveCaptureSelection,
  SourcesSetupRunInput
} from "../../shared/sourcesSetup";
type HookAction = "install" | "test" | "uninstall";

const SUPPORTED_HOOK_RUNTIMES = new Set(HARNESS_CATALOG.filter((entry) => entry.supportsLiveWatch).map((entry) => entry.runtime));


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

    if (!SUPPORTED_HOOK_RUNTIMES.has(liveCapture.runtime as RuntimeKind)) {
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

  if (plan.importMetadata || plan.queueEnrichment) {
    const targets = setupTargets(plan);
    for (const target of targets) {
      const setupInput: SourcesSetupRunInput = {
        enrichmentMode: plan.enrichmentMode,
        importMetadata: plan.importMetadata,
        importScope: plan.importScope,
        queueEnrichment: plan.queueEnrichment,
        runtimes: target.runtime ? [target.runtime] : plan.runtimes,
        sourceIds: target.sourceIds ?? plan.sourceIds
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
  const runtimes = Array.from(new Set(plan.runtimes ?? []));
  if (runtimes.length === 0) return [{ sourceIds: plan.sourceIds }];

  return runtimes.map((runtime) => {
    const sourceIds = sourceIdsForRuntime(plan.sourceIds, runtime);
    return { runtime, sourceIds };
  });
}

function sourceIdsForRuntime(sourceIds: string[] | undefined, runtime: string): string[] | undefined {
  if (!sourceIds) return undefined;
  const prefixes = [`${runtime}-`, `${runtime}:`];
  const dashRuntime = runtime.replaceAll("_", "-");
  if (dashRuntime !== runtime) prefixes.push(`${dashRuntime}-`, `${dashRuntime}:`);
  const matched = sourceIds.filter((sourceId) => prefixes.some((prefix) => sourceId.startsWith(prefix)));
  return matched.length > 0 ? matched : sourceIds;
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
