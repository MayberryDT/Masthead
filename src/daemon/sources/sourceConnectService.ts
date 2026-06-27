import type { ImportJobDto, ImportJobKind } from "../db/importJobRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { queueImportJob, type ImportJobControls, type ImportWorkResult } from "../import/importCoordinator.ts";
import { setSourcePolicy } from "../db/sourcePolicyRepository.ts";
import type { RuntimeKind } from "../../adapters/types.ts";
import type { SourceScanResult } from "./sourceScanService.ts";

export type ConnectSourcesRequest = {
  runtimes: RuntimeKind[];
  importMetadata: boolean;
  importTranscripts: boolean;
  queueEnrichment: boolean;
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
  runImport: (kind: ImportJobKind, sourceId: string, controls: ImportJobControls) => Promise<ImportWorkResult>
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
    if (adapter.sources.length === 0) {
      skipped.push({ runtime: adapter.runtime, reason: "No recognized local source files were detected." });
      continue;
    }
    for (const source of adapter.sources) {
      if (request.importMetadata) {
        jobs.push(queueImportJob(db, { importKind: "metadata", sourceId: source.sourceId }, (controls) => runImport("metadata", source.sourceId, controls)));
      }
      if (request.importTranscripts) {
        jobs.push(queueImportJob(db, { importKind: "transcript", sourceId: source.sourceId }, (controls) => runImport("transcript", source.sourceId, controls)));
      }
    }
  }

  return { jobs, skipped };
}
