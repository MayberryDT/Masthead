export interface PackageBoundCrashBoundary {
  current: "baseline" | "candidate";
  journalPhase: string | null;
  ownedStageCount?: number | null;
  present: string[];
  absent: string[];
}

export function packageBoundCrashBoundaryContract(): Record<string, PackageBoundCrashBoundary>;

export function assertPackageBoundCrashBoundary(
  definition: { id: string },
  fixture: Record<string, unknown>,
  receiptInput?: Record<string, unknown>
): Promise<void>;
