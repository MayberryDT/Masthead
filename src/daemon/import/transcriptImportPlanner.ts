import { adapterForRuntime } from "../../adapters/registry.ts";
import type { TranscriptUnitPlan } from "../../adapters/transcriptUnits.ts";
import type { DiscoveredSource } from "../../adapters/types.ts";
import type { ImportWorkUnitDto } from "../../shared/sourceImport.ts";

export async function planTranscriptImportUnits(sources: DiscoveredSource[]): Promise<TranscriptUnitPlan[]> {
  const planned: Array<{ inputSource: DiscoveredSource; plan: TranscriptUnitPlan }> = [];
  for (const source of sources) {
    const adapter = adapterForRuntime(source.runtime);
    if (!adapter) throw new Error(`Transcript planning failed: no adapter for runtime ${source.runtime}.`);
    let units: TranscriptUnitPlan[];
    try {
      units = await adapter.planTranscriptUnits(source);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Transcript planning failed for ${source.path ?? source.sourceId}: ${detail}`);
    }
    if (units.length === 0) {
      throw new Error(`Transcript planning failed for ${source.path ?? source.sourceId}: adapter produced no import units.`);
    }
    planned.push(...units.map((plan) => ({ inputSource: source, plan })));
  }
  const canonical = new Map<string, { inputSource: DiscoveredSource; plan: TranscriptUnitPlan }>();
  for (const candidate of planned) {
    const key = transcriptOwnershipKey(candidate.plan);
    const current = canonical.get(key);
    if (!current || comparePlanOwnership(candidate, current) < 0) canonical.set(key, candidate);
  }
  return [...canonical.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, { plan }]) => plan);
}

export function transcriptPlanForWorkUnit(
  plans: TranscriptUnitPlan[],
  unit: Pick<ImportWorkUnitDto, "runtime" | "sourcePath" | "sourceSessionId" | "workUnitId">
): TranscriptUnitPlan {
  const matching = plans.filter((candidate) =>
    candidate.runtime === unit.runtime &&
    candidate.source.path === unit.sourcePath &&
    (!unit.sourceSessionId || candidate.sourceSessionId === unit.sourceSessionId)
  );
  if (matching.length !== 1) {
    throw new Error(
      `Transcript planning failed for work unit ${unit.workUnitId}: expected one planned unit, found ${matching.length}.`
    );
  }
  return matching[0];
}

function transcriptOwnershipKey(plan: TranscriptUnitPlan): string {
  return [
    plan.runtime,
    plan.source.path ?? plan.source.sourceId,
    plan.sourceSessionId ?? ""
  ].join("\0");
}

function comparePlanOwnership(
  left: { inputSource: DiscoveredSource; plan: TranscriptUnitPlan },
  right: { inputSource: DiscoveredSource; plan: TranscriptUnitPlan }
): number {
  const leftCanonical = left.inputSource.path === left.plan.source.path ? 0 : 1;
  const rightCanonical = right.inputSource.path === right.plan.source.path ? 0 : 1;
  if (leftCanonical !== rightCanonical) return leftCanonical - rightCanonical;
  return left.plan.source.sourceId.localeCompare(right.plan.source.sourceId);
}
