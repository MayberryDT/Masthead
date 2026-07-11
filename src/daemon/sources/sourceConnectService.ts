import type { ImportJobDto, ImportJobKind } from "../db/importJobRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { queueImportJob, type ImportJobControls, type ImportWorkResult } from "../import/importCoordinator.ts";
import { adapterForRuntime } from "../../adapters/registry.ts";
import type { RuntimeKind } from "../../adapters/types.ts";
import type { ImportScopeDto } from "../../shared/sourceImport.ts";
import type { SourceScanResult } from "./sourceScanService.ts";
import type { DiscoveredSource } from "../../adapters/types.ts";
import { setSourcePolicy } from "../db/sourcePolicyRepository.ts";

export type ConnectSourcesRequest = {
  runtimes: RuntimeKind[];
  importMetadata: boolean;
  queueEnrichment: boolean;
  importScope?: ImportScopeDto;
  sourceIds?: string[];
};

export type ConnectSourcesResult = {
  jobs: ImportJobDto[];
  skipped: Array<{ runtime: RuntimeKind; reason: string }>;
};

export function connectSelectedSources(
  db: MastheadDatabase,
  scan: SourceScanResult,
  request: ConnectSourcesRequest,
  runImport: (kind: ImportJobKind, runtime: RuntimeKind, sources: DiscoveredSource[], controls: ImportJobControls) => Promise<ImportWorkResult>
): ConnectSourcesResult {
  const jobs: ImportJobDto[] = [];
  const skipped: Array<{ runtime: RuntimeKind; reason: string }> = [];
  const selected = new Set(request.runtimes);
  const selectedSourceIds = new Set(request.sourceIds ?? []);

  for (const adapter of scan.adapters.filter((adapter) => selected.has(adapter.runtime))) {
    if (!adapterForRuntime(adapter.runtime)) {
      skipped.push({ runtime: adapter.runtime, reason: "Masthead can detect this harness, but import is not supported yet." });
      continue;
    }
    const sources = selectedSourceIds.size > 0 ? adapter.sources.filter((source) => selectedSourceIds.has(source.sourceId)) : adapter.sources;
    const parentSource = sources[0];
    if (!parentSource) {
      skipped.push({ runtime: adapter.runtime, reason: "No recognized local history was detected for this coding harness." });
      continue;
    }
    const importsTranscripts = request.importScope?.mode === "transcript_full" || request.importScope?.mode === "transcript_recent";
    if (request.importMetadata && !importsTranscripts) {
      jobs.push(queueImportJob(db, { importKind: "metadata", sourceId: parentSource.sourceId }, (controls) => runImport("metadata", adapter.runtime, sources, controls)));
    }
    if (importsTranscripts) {
      const decidedAt = new Date().toISOString();
      for (const source of sources) {
        setSourcePolicy(db, {
          decidedAt,
          enabled: true,
          policyKind: "transcript_import",
          reason: `Explicit ${request.importScope?.mode === "transcript_full" ? "Everything" : "recent-history"} import selected during setup.`,
          sourceId: source.sourceId
        });
      }
      jobs.push(queueImportJob(db, { importKind: "transcript", sourceId: parentSource.sourceId }, (controls) => runImport("transcript", adapter.runtime, sources, controls)));
    }
  }

  return { jobs, skipped };
}
