import type { ImportJobDto, ImportJobKind } from "../db/importJobRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { queueImportJob, type ImportJobControls, type ImportWorkResult } from "../import/importCoordinator.ts";
import { setSourcePolicy } from "../db/sourcePolicyRepository.ts";
import type { RuntimeKind } from "../../adapters/types.ts";
import type { ImportScopeDto } from "../../shared/sourceImport.ts";
import type { SourceScanResult } from "./sourceScanService.ts";

export type ConnectSourcesRequest = {
  runtimes: RuntimeKind[];
  importMetadata: boolean;
  importTranscripts: boolean;
  queueEnrichment: boolean;
  importScope?: ImportScopeDto;
  transcriptApproved?: boolean;
};

export type ConnectSourcesResult = {
  jobs: ImportJobDto[];
  skipped: Array<{ runtime: RuntimeKind; reason: string }>;
};

export function connectSelectedSources(
  db: MastheadDatabase,
  scan: SourceScanResult,
  request: ConnectSourcesRequest,
  runImport: (kind: ImportJobKind, runtime: RuntimeKind, controls: ImportJobControls) => Promise<ImportWorkResult>
): ConnectSourcesResult {
  const jobs: ImportJobDto[] = [];
  const skipped: Array<{ runtime: RuntimeKind; reason: string }> = [];
  const selected = new Set(request.runtimes);

  if (request.transcriptApproved) {
    setSourcePolicy(db, {
      decidedAt: new Date().toISOString(),
      enabled: true,
      policyKind: "transcript_import",
      reason: "Source connector transcript import approved."
    });
  }

  for (const adapter of scan.adapters.filter((adapter) => selected.has(adapter.runtime))) {
    const parentSource = adapter.sources[0];
    if (!parentSource) {
      skipped.push({ runtime: adapter.runtime, reason: "No recognized local history was detected for this coding harness." });
      continue;
    }
    if (request.importMetadata) {
      jobs.push(queueImportJob(db, { importKind: "metadata", sourceId: parentSource.sourceId }, (controls) => runImport("metadata", adapter.runtime, controls)));
    }
    if (request.importTranscripts) {
      jobs.push(queueImportJob(db, { importKind: "transcript", sourceId: parentSource.sourceId }, (controls) => runImport("transcript", adapter.runtime, controls)));
    }
  }

  return { jobs, skipped };
}
