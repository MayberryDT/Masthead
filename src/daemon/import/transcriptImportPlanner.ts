import { adapterForRuntime } from "../../adapters/registry.ts";
import type { TranscriptUnitPlan } from "../../adapters/transcriptUnits.ts";
import type { DiscoveredSource } from "../../adapters/types.ts";
import type { ImportWorkUnitDto } from "../../shared/sourceImport.ts";

export async function planTranscriptImportUnits(sources: DiscoveredSource[]): Promise<TranscriptUnitPlan[]> {
  const planned: TranscriptUnitPlan[] = [];
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
    planned.push(...units);
  }
  return planned;
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
