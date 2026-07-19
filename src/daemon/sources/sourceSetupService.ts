import type { DiscoveredSource } from "../../adapters/types.ts";
import { adapterCapabilityProfile, canImportMetadata, canImportTranscripts } from "../../adapters/capabilities.ts";
import type {
  ConnectedSourceDto,
  FoundSourceDto,
  SetupStatus,
  SourcesOnboardingScanDto,
  SourcesSetupDto
} from "../../shared/sourcesSetup.ts";
import { adapterStatusesFromSources, getSourceStatuses, type SourceStatusDto } from "../import/sourceStatusService.ts";
import { listImportJobPage } from "../db/importJobRepository.ts";
import { getLatestSourceScanRun } from "../db/sourceSetupRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import type { SourceScanResult } from "./sourceScanService.ts";

export function buildSourcesSetupState(db: MastheadDatabase, options: { now: string }): SourcesSetupDto {
  const sourceStatuses = getSourceStatuses(db);
  const connectedSources = sourceStatuses.map((source) => connectedSourceFromStatus(source));
  const activeImports = listImportJobPage(db, { limit: 500, offset: 0, status: "active" }).jobs;
  const activeSourceIds = new Set(activeImports.map((job) => job.sourceId));
  const connectedSourcesWithJobs = connectedSources.map((source) => {
    if (!activeSourceIds.has(source.sourceId)) return source;
    return { ...source, status: "importing" as const };
  });
  const scan = getLatestSourceScanRun(db);
  const status = setupStatus(connectedSourcesWithJobs, scan);

  return {
    advanced: {
      adapters: adapterStatusesFromSources(sourceStatuses),
      imports: listImportJobPage(db, { limit: 50, offset: 0 }).jobs,
      sources: connectedSourcesWithJobs
    },
    connectedSources: connectedSourcesWithJobs,
    ...(scan ? { scan } : {}),
    setupId: `setup:${options.now}`,
    status,
    updatedAt: options.now
  };
}

export function scanResultToOnboardingScan(scan: SourceScanResult, status: SourcesOnboardingScanDto["status"] = "completed"): SourcesOnboardingScanDto {
  const adapters = scan.adapters.map((adapter) => ({
    diagnostics: adapter.diagnostics,
    foundSources: adapter.sources.map(foundSourceFromDiscovered),
    runtime: adapter.runtime,
    state: adapter.state,
    summary: {
      foundSources: adapter.sources.length,
      sessions: adapter.discoveredSessions
    }
  }));
  const foundSources = adapters.flatMap((adapter) => adapter.foundSources);
  return {
    adapters,
    foundSources,
    generatedAt: scan.generatedAt,
    observers: scan.observers ?? [],
    scanId: scan.scanId,
    status,
    summary: {
      detectedHarnesses: adapters.filter((adapter) => adapter.foundSources.length > 0).length,
      foundSources: foundSources.length,
      scannedHarnesses: adapters.length
    }
  };
}

function connectedSourceFromStatus(source: SourceStatusDto): ConnectedSourceDto {
  const needsAttention: ConnectedSourceDto["needsAttention"] = [];
  if (source.failureCount > 0) needsAttention.push("import_failures");
  if (!source.transcriptImportEnabled) needsAttention.push("transcript_import");
  if (!source.enrichmentEnabled) needsAttention.push("enrichment");
  return {
    confidence: source.confidence,
    enrichmentEnabled: source.enrichmentEnabled,
    failureCount: source.failureCount,
    importedRecords: source.importedRecords,
    importedSessions: source.importedSessions,
    lastSyncAt: source.lastSyncAt,
    mcpEnabled: source.mcpEnabled,
    needsAttention,
    path: source.path,
    queuedRecords: source.queuedRecords,
    runtime: source.runtime,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    status: source.queuedRecords > 0 ? "importing" : needsAttention.length > 0 ? "needs_attention" : "ready",
    transcriptImportEnabled: source.transcriptImportEnabled
  };
}

function setupStatus(connectedSources: ConnectedSourceDto[], scan: SourcesOnboardingScanDto | undefined): SetupStatus {
  if (connectedSources.length === 0) {
    return scan && scan.foundSources.length > 0 ? "detected" : "empty";
  }
  if (connectedSources.some((source) => source.status === "importing")) return "importing";
  if (connectedSources.some((source) => source.status === "needs_attention")) return "needs_attention";
  return "ready";
}

function foundSourceFromDiscovered(source: DiscoveredSource): FoundSourceDto {
  const capability = adapterCapabilityProfile(source.runtime);
  const importable = canImportMetadata(capability) && capability.sourceKinds.includes(source.sourceKind) && Boolean(source.path) && source.sourceKind !== "inference";
  const transcriptImportRequiresApproval = importable && canImportTranscripts(capability);
  return {
    confidence: source.confidence,
    importable,
    label: capability.label,
    path: source.path,
    runtime: source.runtime,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    state: importable ? "importable" : "detected",
    transcriptAvailable: transcriptImportRequiresApproval,
    transcriptApproval: {
      approved: false,
      required: transcriptImportRequiresApproval,
      summary: transcriptImportRequiresApproval ? "Prompts, code, file paths, command output, and private data may be present." : undefined
    }
  };
}
