import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { catalogPathCandidatesForHarness } from "../catalogPathCandidates.ts";
import type { HarnessCatalogEntry } from "../harnessCatalog.ts";
import type { AdapterDiagnostic, DiscoveredSource, DiscoveryContext, IngestCursor, SessionAdapter, SourceInventory } from "../types.ts";

export function createDetectorAdapter(harness: HarnessCatalogEntry): SessionAdapter {
  return {
    runtime: harness.runtime,
    discover: (context) => discoverDetectedSources(harness, context),
    inspect: inspectDetectorSource,
    async *backfill(_source: DiscoveredSource, _cursor?: IngestCursor) {
      return;
    },
    async *watch() {
      return;
    }
  };
}

async function discoverDetectedSources(harness: HarnessCatalogEntry, context: DiscoveryContext): Promise<DiscoveredSource[]> {
  const sources: DiscoveredSource[] = [];
  for (const candidate of catalogPathCandidatesForHarness(harness, context)) {
    try {
      const info = await stat(candidate.relativePath);
      if (!info.isFile() && !info.isDirectory()) continue;
      sources.push({
        confidence: candidate.confidence,
        path: candidate.relativePath,
        runtime: harness.runtime,
        runtimeVersion: context.now,
        schemaVersion: `${harness.runtime}-detector-only`,
        sourceId: `${harness.runtime}:detector:${hash(candidate.relativePath)}`,
        sourceKind: "inference"
      });
    } catch {
      // Missing or unreadable detector candidates are reported by preflight.
    }
  }
  return sources;
}

async function inspectDetectorSource(source: DiscoveredSource): Promise<SourceInventory> {
  return {
    failures: [detectorDiagnostic(source)],
    recordCount: 0,
    sessionCount: 0,
    source
  };
}

function detectorDiagnostic(source: DiscoveredSource): AdapterDiagnostic {
  return {
    code: `${source.runtime}_detector_only`,
    message: `${source.runtime} was detected, but Masthead does not have an import adapter for this runtime yet.`,
    observedAt: source.runtimeVersion ?? new Date().toISOString(),
    severity: "info",
    sampleSourceIds: [source.sourceId]
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
