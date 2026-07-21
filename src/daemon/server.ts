import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  canonicalInstancePaths,
  acquireMastheadInstanceManifestGuard,
  identityFromManifest,
  removeOwnedMastheadInstanceManifest,
  writeMastheadInstanceManifestAtomic,
  type GuidedAuthoringExpectedIdentity,
  type MastheadInstanceManifest,
  type MastheadInstanceManifestGuard
} from "../shared/instanceIdentity.ts";
import type { AdapterMaturity } from "../adapters/capabilities.ts";
import { adapterRecordFromLiveHook, liveHookSourceForRuntime } from "../adapters/live/hookAdapter.ts";
import { LIVE_CONNECTOR_RUNTIMES } from "../adapters/liveRuntimes.ts";
import { adapterForRuntime } from "../adapters/registry.ts";
import { createDeterministicEnrichmentProvider } from "../enrichment/deterministicProvider.ts";
import { createEnrichmentCoordinator, EnrichmentFailedError } from "../enrichment/enrichmentCoordinator.ts";
import { ALL_RUNTIME_KINDS, RUNTIME_KINDS, type AdapterDiagnostic, type IngestCursor, type RuntimeKind } from "../adapters/types.ts";
import type { DiscoveredSource } from "../adapters/types.ts";
import { createIngestionState, ingestNormalizedEvent, removeEventFromLiveProjectionState } from "../core/ingestion.ts";
import { eventLiveProcessingMode } from "../core/liveSessionFacts.ts";
import { deriveLiveBlockers } from "../core/liveBlockers.ts";
import {
  acquireDatabaseWriterLock,
  acquireLegacyDataDirectoryGuard,
  assertWritableDatabaseLocation,
  type DatabaseWriterLock,
  type LegacyDataDirectoryGuard
} from "../core/daemonOwnership.ts";
import { approvalBlockerTtlMsForRefresh, projectLiveEvents } from "../core/liveProjection.ts";
import { selectEffectiveLiveState } from "../core/liveProjectionState.ts";
import { normalizeLiveStateReport, type LiveStateReport } from "../core/liveState.ts";
import { deriveSessions } from "../core/sessionReducer.ts";
import { buildBoardBrief } from "../core/boardBrief.ts";
import { createBoardHeadlineEnricher, type BoardHeadlineAppliedEvent, type BoardHeadlineGenerationFinishedEvent, type BoardHeadlineProviderConfig } from "../core/boardHeadlineEnricher.ts";
import { createFileBackedStore, validateRetentionPolicy, type StoreRecord } from "../core/store.ts";
import type { ReviewDisposition } from "../core/store.ts";
import type { PruneLocalDataResult, RetentionPolicy } from "../core/retention.ts";
import { liveStateReportFromHookPayload, type LiveHookDiagnostic } from "../core/liveHookAdapter.ts";
import type { GitSnapshot, LiveBoardProjection, NormalizedEvent, SessionCardView } from "../core/types.ts";
import type { DaemonConfig } from "./config.ts";
import { createVerifiedMigrationBackupInsideDaemonStartup } from "./databaseBackup.ts";
import {
  applyDefaultRetention,
  deleteAllMastheadData,
  deleteMastheadData,
  exportSessionGraph,
  getDataSummary,
  type DeleteMastheadDataScope
} from "./db/dataLifecycleRepository.ts";
import { getDataRevisions } from "./db/dataRevisionRepository.ts";
import {
  createImportJob,
  getImportJob,
  listImportJobPage,
  listImportJobs,
  updateImportJob,
  type ImportJobDto,
  type ImportJobKind,
  type ImportJobListStatus
} from "./db/importJobRepository.ts";
import { getImportManifestSummary, getImportWorkUnit, listAllImportWorkUnits, listImportFailureGroups, listImportWorkUnits } from "./db/importLedgerRepository.ts";
import { listMcpAuditRows } from "./db/mcpQueryRepository.ts";
import { liveProjectionEnrichments } from "./db/enrichmentViewRepository.ts";
import { liveProjectionTranscriptFacts } from "./db/liveTranscriptFactsRepository.ts";
import { latestLiveStateForSession, latestLiveStateReports, upsertLiveStateReport } from "./db/liveStateRepository.ts";
import { upsertFileEffectsFromGitSnapshot } from "./db/gitSnapshotEffectsRepository.ts";
import { createRawEventRepository, type RawEventRepository, type RawEventSource } from "./db/rawEventRepository.ts";
import { getSessionDossier } from "./db/sessionDossierRepository.ts";
import { getSessionTranscript, type SessionTranscriptKindFilter } from "./db/sessionTranscriptRepository.ts";
import { initializeSessionTranscriptFingerprintIndex } from "./db/sessionTranscriptFingerprintIndex.ts";
import {
  claimWorkbenchSessions,
  countWorkbenchQueue,
  listWorkbenchActivity,
  listWorkbenchQueue,
  markWorkbenchQuality,
  markWorkbenchQualityForReview,
  readWorkbenchSessionState,
  recordWorkbenchActivity,
  releaseWorkbenchClaim,
  type WorkbenchActivityRecord,
  type WorkbenchSessionStateRecord
} from "./db/workbenchPipelineRepository.ts";
import { workbenchSessionIsPublished } from "./db/workbenchPublicationSql.ts";
import { currentBoardHeadlineFrames, insertBoardHeadlineGeneration, upsertBoardHeadlineFrame } from "./db/boardHeadlineFrameRepository.ts";
import { listReviewDispositions, upsertReviewDisposition } from "./db/reviewDispositionRepository.ts";
import { readCursor, upsertCursor } from "./db/cursorRepository.ts";
import { indexCanonicalSessionSearch, searchSessions } from "./db/searchRepository.ts";
import { getKnowledgeFlowSummary } from "./db/knowledgeFlowRepository.ts";
import { getLogbookSummary } from "./db/logbookSummaryRepository.ts";
import {
  getLogbookArtifactDetail,
  getLogbookArtifactSummary,
  searchLogbookArtifacts
} from "./db/logbookArtifactRepository.ts";
import { getSessionDetail, getSessionExcerpts, listProjects, querySessions, type SessionQuery } from "./db/sessionQueryRepository.ts";
import { getOrCreateDatabaseIdentity, hasPendingMigrations, migrateDatabase } from "./db/schema.ts";
import { canonicalSessionId, createSessionRepository, ingestAdapterRecord, runtimeIdFor, type SessionRepository } from "./db/sessionRepository.ts";
import { readSessionImportHealth, summarizeCurrentSessionImportHealth } from "./db/sessionImportHealthRepository.ts";
import { saveSourceScanRun, saveSourceSetupState } from "./db/sourceSetupRepository.ts";
import { getSessionUsageSummaries, getUsageStats, type UsageWindow } from "./db/usageStatsRepository.ts";
import {
  checkpointMastheadDatabase,
  openMastheadDatabase,
  quickCheckMastheadDatabase,
  type MastheadDatabase
} from "./db/sqlite.ts";
import { legacyCandidatesFromDirectory, maybeCopyLegacySqliteBeforeOpen } from "./legacyDataMigration.ts";
import { migrateLegacyJournalOnce } from "./legacyJournalMigration.ts";
import { runLegacyWorkbenchPublicationBackfill } from "../workbench/legacyPublicationBackfill.ts";
import { runCaptureQualityPrecheck } from "../workbench/qualityPrecheck.ts";
import { authoringEvidenceRevision } from "../workbench/authoring/evidenceCatalog.ts";
import { addSourceExclusion, sourceIsExcluded, sourceRecordIsExcluded } from "./db/sourceRepository.ts";
import { setSourcePolicy, sourcePolicyExplicitlyEnabled, type SourcePolicyKind } from "./db/sourcePolicyRepository.ts";
import {
  cancelImportJob,
  getImportQueueState,
  recoverInterruptedImportJobs,
  queueImportJob,
  resumeImportJob,
  type ImportJobControls,
  type ImportWorkResult
} from "./import/importCoordinator.ts";
import { buildImportCompletionReport, settleImportSessionClassifications } from "./import/importCompletionReport.ts";
import { buildImportManifestPlan, createManifestForJob } from "./import/importManifestService.ts";
import { planTranscriptImportUnits, transcriptPlanForWorkUnit } from "./import/transcriptImportPlanner.ts";
import { countImportedRecord, emptyImportResult } from "./import/importWorker.ts";
import { runImportWorkUnit } from "./import/importWorkUnitRunner.ts";
import { applyImportRepair, previewImportRepair } from "./import/importRepair.ts";
import { reconcileMissingImportedWorkbenchSessions } from "../workbench/importReconciliation.ts";
import { reconcileImportedTranscript } from "../workbench/transcriptQualityReconciler.ts";
import { getAdapterStatuses, getSourceStatuses } from "./import/sourceStatusService.ts";
import { recordRequestDiagnostic, recordRuntimeDiagnostic, runtimeDiagnosticsSnapshot } from "./diagnostics.ts";
import { discoverSourceSnapshot, type SourceDiscoverySnapshot } from "./sources/sourceDiscoveryService.ts";
import { scanLocalSources, type SourceScanResult } from "./sources/sourceScanService.ts";
import { connectSelectedSources, type ConnectSourcesRequest } from "./sources/sourceConnectService.ts";
import { buildSourcesSetupState, scanResultToOnboardingScan } from "./sources/sourceSetupService.ts";
import { clearConnectorActivation, setConnectorActivation } from "./sources/connectorActivationStore.ts";
import { discoverHarnessConnectors, listHarnessConnectors, withHistoryDiscovery } from "./sources/harnessConnectorService.ts";
import type { ImportScopeDto, ImportWorkUnitStatus } from "../shared/sourceImport.ts";
import type { ImportRepairJobPlan, ImportRepairSourceMapping } from "../shared/importRepair.ts";
import type { SessionDossierDto, SessionDossierManualEnrichmentJob } from "../shared/sessionDossier.ts";
import type {
  WorkbenchActivityDto,
  WorkbenchActivityResponse,
  WorkbenchEnrollMissingResponse,
  WorkbenchMissingSessionDto,
  WorkbenchMissingSessionsResponse,
  WorkbenchNotAddedResponse,
  WorkbenchNotAddedSessionDto,
  WorkbenchNotAddedSummaryDto,
  WorkbenchQueueSessionDto,
  WorkbenchSessionsResponse
} from "../shared/workbench.ts";
import { queueWorkbenchSessions } from "../workbench/queueRepository.ts";
import {
  checkWorkbenchTranscript,
  createWorkbenchTranscriptImport,
  previewWorkbenchTranscriptImport
} from "../workbench/transcriptWorkflow.ts";
import { collectGitSnapshot, gitSnapshotSignature } from "./gitSnapshots.ts";
import { createLiveIngestQueue } from "./liveIngestQueue.ts";
import { buildMastheadHealth } from "./healthService.ts";
import { recentHookEventsWithTranscriptPathsForSessions } from "./hookTranscriptRecovery.ts";
import { coerceMcpLaunchConfig, getMcpLaunchConfig, getMcpStatus, listMcpTools, testMcpConnection, validateMcpLaunchConfig } from "./mcpStatusService.ts";
import { createSettingsBackedEnrichmentProvider, effectiveLlmProvider, listLlmProviderModels, updateLlmProviderSettings } from "./llmSettings.ts";
import {
  getLiveHookSettings,
  getRuntimeHookSettings,
  getSettingsState,
  installRuntimeHooks,
  settingsRuntimeIdentity,
  testRuntimeHooks,
  uninstallRuntimeHooks
} from "./settingsService.ts";
import { isLiveConnectorRuntime } from "./liveConnectorSettings.ts";
import {
  authoringInvalidJsonResult,
  getWorkbenchAuthoringBodyLimit,
  isWorkbenchAuthoringPath,
  routeWorkbenchAuthoringRequest
} from "./workbenchAuthoringApi.ts";

export type MastheadDaemon = {
  server: Server;
  database: MastheadDatabase;
  startBackgroundHydration: () => void;
  waitForBackgroundHydration: () => Promise<void>;
  close: () => Promise<void>;
  instanceIdentity: () => MastheadInstanceManifest;
  publishInstanceManifest: () => Promise<MastheadInstanceManifest>;
};

export const LIVE_BOARD_RAW_RECORD_LIMIT = 500;
const HOOK_TRANSCRIPT_CATCHUP_RECORD_LIMIT = 200;
const HOOK_TRANSCRIPT_CATCHUP_REQUEUE_MS = 250;
const VISIBLE_TRANSCRIPT_CATCHUP_BUDGET_MS = 750;
const RESPONSE_BACKGROUND_GRACE_MS = 50;
const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const LIVE_STATE_BODY_LIMIT_BYTES = 65_536;
const INGEST_BODY_LIMIT_BYTES = 262_144;
const LIVE_INGEST_RUNTIMES = LIVE_CONNECTOR_RUNTIMES;

type TranscriptImportOptions = {
  maxRecordsPerSource?: number;
  queueEnrichment?: boolean;
};

export async function createMastheadDaemon(config: DaemonConfig): Promise<MastheadDaemon> {
  const writableDataDirectory = config.dataDirectory ?? dirname(config.databasePath);
  await assertWritableDatabaseLocation(config.databasePath, writableDataDirectory);
  await mkdir(dirname(config.storePath), { recursive: true });
  const writerLock = await acquireDatabaseWriterLock(config.databasePath);
  let legacyDataDirectoryGuard: LegacyDataDirectoryGuard | undefined;
  let hookTranscriptCatchupQueue: Promise<void> = Promise.resolve();
  const hookTranscriptCatchups = new Map<string, Promise<void>>();
  const disabledHookTranscriptCatchupDiagnostics = new Set<string>();

  try {
    legacyDataDirectoryGuard = await acquireLegacyDataDirectoryGuard(writableDataDirectory);
    // Legacy compatibility store. Do not add new product writes here.
    // Canonical session data must be written to SQLite/raw_events/session graph.
    const store = await createFileBackedStore(config.storePath);
    const legacyCandidates = config.legacyDataDirectory ? legacyCandidatesFromDirectory(config.legacyDataDirectory) : [];
    const legacySqliteCandidate = legacyCandidates.find((candidate) => candidate.kind === "sqlite");
    const legacySqliteMigration = legacySqliteCandidate
      ? await maybeCopyLegacySqliteBeforeOpen({
          targetDatabasePath: config.databasePath,
          legacyDatabasePath: legacySqliteCandidate.path
        })
      : { copied: false, reason: "legacy_missing" as const };
    const legacyNdjsonCandidate = legacyCandidates.find((candidate) => candidate.kind === "ndjson");
    const legacyEventStore =
      legacyNdjsonCandidate && resolve(legacyNdjsonCandidate.path) !== resolve(config.storePath)
        ? await createFileBackedStore(legacyNdjsonCandidate.path)
        : undefined;
    const database = await openMastheadDatabase(config.databasePath);
    try {
      const pendingMigrations = hasPendingMigrations(database);
      if (pendingMigrations) {
        await backupDatabaseBeforeMigration(config.databasePath);
      }
      migrateDatabase(database);
      if (pendingMigrations && !config.skipMigrationQuickCheck) quickCheckMastheadDatabase(database);
      initializeSessionTranscriptFingerprintIndex(database);
      runLegacyWorkbenchPublicationBackfill(database);
      const databaseIdentity = getOrCreateDatabaseIdentity(database);
      const interruptedImportJobIds = recoverInterruptedImportJobs(database);

    const defaultLiveRuntime: RuntimeKind = "claude_code";
    const defaultLiveSource = liveHookSourceForRuntime(defaultLiveRuntime);
    const liveHookSources = new Map<RuntimeKind, DiscoveredSource>(
      LIVE_INGEST_RUNTIMES.map((runtime) => [runtime, liveHookSourceForRuntime(runtime)])
    );
    const liveRawJournals = new Map(
      [...liveHookSources.values()].map((source) => [source.sourceId, createRawEventRepository(database, rawEventSourceFromDiscoveredSource(source))])
    );
    const hookRawJournal = liveRawJournalForSource(defaultLiveSource);
    const observerRawJournal = createRawEventRepository(database, {
      adapter: "masthead",
      confidence: "authoritative",
      sourceId: "masthead-git-observer",
      sourceKind: "inference",
      sourcePath: config.storePath
    });
    const sessions = createSessionRepository(database, {
      hostId: `host:${config.host}`,
      hostname: config.host,
      runtimeKind: defaultLiveRuntime
    });
    const liveSessionRepositories = new Map<RuntimeKind, SessionRepository>(
      LIVE_INGEST_RUNTIMES.map((runtime) => [
        runtime,
        runtime === defaultLiveRuntime
          ? sessions
          : createSessionRepository(database, {
              hostId: `host:${config.host}`,
              hostname: config.host,
              runtimeKind: runtime
            })
      ] as const)
    );
    const canonicalSessionIdForSource = (sourceSessionId: string, runtime: RuntimeKind = defaultLiveRuntime): string =>
      canonicalSessionId(`host:${config.host}`, runtimeIdFor(runtime, undefined), sourceSessionId);
    const state = createIngestionState(canonicalLiveEvents(database), {
      includeInLiveProjection: (event) => eventLiveProcessingMode(event) === "immediate"
    });
    const gitSnapshots = canonicalGitSnapshots(database);
    for (const gitSnapshot of gitSnapshots) {
      upsertFileEffectsFromGitSnapshot(database, canonicalSessionIdForSource(gitSnapshot.sessionId, liveRuntimeForSourceSessionId(gitSnapshot.sessionId)), gitSnapshot);
    }
    const gitSnapshotSignatures = new Map(gitSnapshots.map((snapshot) => [snapshot.sessionId, gitSnapshotSignature(snapshot)]));
    const terminalGitSnapshotSessionIds = new Set(gitSnapshots.filter(isTerminalGitSnapshot).map((snapshot) => snapshot.sessionId));
    const completedLiveSessionIds = new Set<string>();
    for (const event of state.events) rememberCompletedLiveSession(event);
    const persistBoardHeadlineFrame = (event: BoardHeadlineAppliedEvent): void => {
      try {
        const sessionId = canonicalSessionIdForSource(event.sessionId, liveRuntimeForSourceSessionId(event.sessionId));
        const row = database
          .prepare("SELECT session_id AS sessionId, source_session_id AS sourceSessionId FROM sessions WHERE source_session_id = ? AND session_id = ?")
          .get(event.sessionId, sessionId) as { sessionId: string; sourceSessionId: string } | undefined;
        if (!row) return;

        upsertBoardHeadlineFrame(database, {
          sessionId: row.sessionId,
          sourceSessionId: row.sourceSessionId,
          provider: event.provider,
          model: event.model,
          generatedAt: event.generatedAt,
          frame: event.frame
        });
      } catch (error) {
        recordRuntimeDiagnostic({
          details: {
            error,
            generatedAt: event.generatedAt,
            model: event.model,
            provider: event.provider,
            sourceSessionId: event.sessionId
          },
          kind: "board_headline_frame_persist_failed",
          message: `Board headline frame persistence failed for ${event.sessionId}`,
          severity: "warning"
        });
      }
    };
    const persistBoardHeadlineGeneration = (event: BoardHeadlineGenerationFinishedEvent): void => {
      try {
        const sessionId = canonicalSessionIdForSource(event.sessionId, liveRuntimeForSourceSessionId(event.sessionId));
        const row = database
          .prepare("SELECT session_id AS sessionId, source_session_id AS sourceSessionId FROM sessions WHERE source_session_id = ? AND session_id = ?")
          .get(event.sessionId, sessionId) as { sessionId: string; sourceSessionId: string } | undefined;
        if (!row) return;

        insertBoardHeadlineGeneration(database, {
          completedAt: event.completedAt,
          failureMessage: event.failureMessage,
          frame: event.frame,
          latencyMs: event.latencyMs,
          model: event.model,
          provider: event.provider,
          refreshKey: event.refreshKey,
          requestedAt: event.requestedAt,
          sessionId: row.sessionId,
          sourceSessionId: row.sourceSessionId,
          status: event.status,
          transcriptExcerpt: event.input.facts.transcriptExcerpt ?? []
        });
        if (event.frame) {
          upsertBoardHeadlineFrame(database, {
            sessionId: row.sessionId,
            sourceSessionId: row.sourceSessionId,
            provider: event.provider,
            model: event.model,
            generatedAt: event.completedAt,
            frame: event.frame,
            refreshKey: event.refreshKey
          });
        }
      } catch (error) {
        recordRuntimeDiagnostic({
          details: {
            error,
            completedAt: event.completedAt,
            model: event.model,
            provider: event.provider,
            sourceSessionId: event.sessionId,
            status: event.status
          },
          kind: "board_headline_generation_persist_failed",
          message: `Board headline generation persistence failed for ${event.sessionId}`,
          severity: "warning"
        });
      }
    };
    const boardHeadlineEnricher = createBoardHeadlineEnricher({
      providerConfig: () => boardHeadlineProviderConfig(database, config),
      onGenerationFinished: persistBoardHeadlineGeneration,
      onFrameApplied: persistBoardHeadlineFrame,
      timeoutMs: config.liveCopyTimeoutMs
    });
    const daemonInstanceId = randomUUID();
    const daemonStartedAt = new Date().toISOString();
    const instancePaths = canonicalInstancePaths(
      resolve(process.env.MASTHEAD_INSTANCE_DIR || writableDataDirectory)
    );
    const instanceManifestPath = resolve(process.env.MASTHEAD_INSTANCE_MANIFEST || instancePaths.instanceManifest);
    const authoringCommand = resolve(process.env.MASTHEAD_CLI_COMMAND || instancePaths.launcherPath);
    const buildSha = process.env.MASTHEAD_BUILD_SHA || "development";
    const databaseId = getOrCreateDatabaseIdentity(database);
    let instanceManifestPublished = false;
    let instanceManifestPublishPromise: Promise<MastheadInstanceManifest> | undefined;
    let instanceManifestGuard: MastheadInstanceManifestGuard | undefined;
    const enrichmentProvider = createSettingsBackedEnrichmentProvider(database, config);
    const enrichment = createEnrichmentCoordinator(database, enrichmentProvider, {
      failureBackoffAfterMs: Date.parse(daemonStartedAt)
    });
    const queuedEnrichmentSessionIds = new Set<string>();
    const queuedSearchIndexSessionIds = new Set<string>();
    const manualDossierEnrichmentJobs = new Map<string, SessionDossierManualEnrichmentJob>();
    let enrichmentQueueScheduled = false;
    let searchIndexQueueScheduled = false;

  function queueSessionSearchIndex(sessionId: string | undefined): void {
    if (closed) return;
    if (!sessionId) return;
    queuedSearchIndexSessionIds.add(sessionId);
    if (searchIndexQueueScheduled) return;
    searchIndexQueueScheduled = true;
    setImmediate(() => {
      void flushSearchIndexQueue().catch((error) => {
        recordRuntimeDiagnostic({
          details: { error },
          kind: "search_index_flush_failed",
          message: "Session search indexing failed.",
          severity: "warning"
        });
      });
    });
  }

  async function flushSearchIndexQueue(): Promise<void> {
    searchIndexQueueScheduled = false;
    if (closed) {
      queuedSearchIndexSessionIds.clear();
      return;
    }
    const sessionIds = [...queuedSearchIndexSessionIds];
    queuedSearchIndexSessionIds.clear();
    for (let index = 0; index < sessionIds.length; index += 1) {
      const sessionId = sessionIds[index];
      try {
        indexCanonicalSessionSearch(database, sessionId);
      } catch (error) {
        recordRuntimeDiagnostic({
          details: { error, sessionId },
          kind: "search_index_failed",
          message: `Session search indexing failed for ${sessionId}`,
          severity: "warning"
        });
      }
      if ((index + 1) % 2 === 0) await yieldToEventLoop();
    }
    if (queuedSearchIndexSessionIds.size > 0 && !searchIndexQueueScheduled) {
      if (closed) {
        queuedSearchIndexSessionIds.clear();
        return;
      }
      searchIndexQueueScheduled = true;
      setImmediate(() => {
        void flushSearchIndexQueue().catch((error) => {
          recordRuntimeDiagnostic({
            details: { error },
            kind: "search_index_flush_failed",
            message: "Session search indexing failed.",
            severity: "warning"
          });
        });
      });
    }
  }

  function queueSessionEnrichment(sessionId: string | undefined): void {
    if (closed) return;
    if (!sessionId) return;
    queuedEnrichmentSessionIds.add(sessionId);
    if (enrichmentQueueScheduled) return;
    enrichmentQueueScheduled = true;
    setImmediate(() => {
      void flushEnrichmentQueue();
    });
  }

  function queueSessionEnrichments(sessionIds: Iterable<string>): void {
    for (const sessionId of sessionIds) queueSessionEnrichment(sessionId);
  }

  async function flushEnrichmentQueue(): Promise<void> {
    enrichmentQueueScheduled = false;
    if (closed) {
      queuedEnrichmentSessionIds.clear();
      return;
    }
    const sessionIds = [...queuedEnrichmentSessionIds];
    queuedEnrichmentSessionIds.clear();
    for (let index = 0; index < sessionIds.length; index += 1) {
      const sessionId = sessionIds[index];
      if (!sessionId) continue;
      try {
        await enrichment.ensureCurrent(sessionId);
        queueSessionSearchIndex(sessionId);
      } catch (error) {
        recordRuntimeDiagnostic({
          details:
            error instanceof EnrichmentFailedError
              ? {
                  failureCode: error.status,
                  failureMessage: error.failureMessage,
                  model: error.model,
                  provider: error.provider,
                  sessionId,
                  status: error.status
                }
              : { error, sessionId },
          kind: "enrichment_failed",
          message: `Session enrichment failed for ${sessionId}`,
          severity: "warning"
        });
      }
      await yieldToEventLoop();
    }
    if (queuedEnrichmentSessionIds.size > 0 && !enrichmentQueueScheduled) {
      enrichmentQueueScheduled = true;
      setImmediate(() => {
        void flushEnrichmentQueue();
      });
    }
  }

  async function rebuildEnrichments(input: Record<string, unknown>): Promise<{
    dryRun?: boolean;
    mode?: "configured" | "deterministic";
    requested: number;
    succeeded: number;
    failed: number;
    sessions: Array<{ sessionId: string; status: "dry_run" | "succeeded" | "failed"; failureCode?: string; failureMessage?: string }>;
  }> {
    const limit = parseBoundedInteger(String(input.limit ?? "100"), 100, 1, 500);
    if (!limit.ok) throw new Error("invalid_limit");
    const sessionIds = selectEnrichmentRebuildSessionIds(database, input, limit.value);
    const dryRun = input.dryRun === true;
    const deterministicOnly = input.deterministicOnly === true;
    const depth = input.depth === "summary" ? "summary" : "full";
    const sessions: Array<{ sessionId: string; status: "dry_run" | "succeeded" | "failed"; failureCode?: string; failureMessage?: string }> = [];
    if (dryRun) {
      return {
        dryRun: true,
        failed: 0,
        mode: depth === "summary" || deterministicOnly ? "deterministic" : "configured",
        requested: sessionIds.length,
        sessions: sessionIds.map((sessionId) => ({ sessionId, status: "dry_run" })),
        succeeded: 0
      };
    }
    const rebuildCoordinator = depth === "summary" ? enrichment : deterministicOnly ? createEnrichmentCoordinator(database, createDeterministicEnrichmentProvider()) : enrichment;
    let succeeded = 0;
    let failed = 0;
    for (const sessionId of sessionIds) {
      try {
        await (depth === "summary" ? rebuildCoordinator.enrichSummary(sessionId) : rebuildCoordinator.enrich(sessionId));
        queueSessionSearchIndex(sessionId);
        succeeded += 1;
        sessions.push({ sessionId, status: "succeeded" });
      } catch (error) {
        failed += 1;
        if (error instanceof EnrichmentFailedError) {
          recordRuntimeDiagnostic({
            details: {
              failureCode: error.status,
              failureMessage: error.failureMessage,
              model: error.model,
              provider: error.provider,
              sessionId,
              status: error.status
            },
            kind: "enrichment_failed",
            message: `Session enrichment failed for ${sessionId}`,
            severity: "warning"
          });
          sessions.push({
            failureCode: error.status,
            failureMessage: error.failureMessage,
            sessionId,
            status: "failed"
          });
        } else {
          recordRuntimeDiagnostic({
            details: { error, sessionId },
            kind: "enrichment_failed",
            message: `Session enrichment failed for ${sessionId}`,
            severity: "warning"
          });
          sessions.push({ failureMessage: error instanceof Error ? error.message : String(error), sessionId, status: "failed" });
        }
      }
      await yieldToEventLoop();
    }
    return {
      failed,
      mode: depth === "summary" || deterministicOnly ? "deterministic" : "configured",
      requested: sessionIds.length,
      sessions,
      succeeded
    };
  }

  function appendStoreRecordToRawJournal(record: StoreRecord): void {
    if (record.recordType === "event") {
      liveRawJournalForEvent(record.value).appendStoreRecord(record);
      return;
    }
    observerRawJournal.appendStoreRecord(record);
  }

  function liveRawJournalForEvent(event: NormalizedEvent): RawEventRepository {
    return liveRawJournalForSource(liveSourceForRuntime(liveRuntimeForEvent(event)));
  }

  function liveRawJournalForSource(source: DiscoveredSource): RawEventRepository {
    const journal = liveRawJournals.get(source.sourceId);
    if (!journal) throw new Error(`Unsupported live source: ${source.sourceId}`);
    return journal;
  }

  function liveSessionRepositoryForEvent(event: NormalizedEvent): SessionRepository {
    return liveSessionRepositories.get(liveRuntimeForEvent(event)) ?? sessions;
  }

  function liveSourceForRuntime(runtime: RuntimeKind): DiscoveredSource {
    return liveHookSources.get(runtime) ?? defaultLiveSource;
  }

  function liveRuntimeForEvent(event: NormalizedEvent): RuntimeKind {
    return isRuntimeKind(event.source.adapter) ? event.source.adapter : defaultLiveRuntime;
  }

  function liveRuntimeForSourceSessionId(sourceSessionId: string): RuntimeKind {
    const event = state.events.find((candidate) => candidate.sessionId === sourceSessionId && isRuntimeKind(candidate.source.adapter));
    return event && isRuntimeKind(event.source.adapter) ? event.source.adapter : defaultLiveRuntime;
  }

  function liveRawJournalRecords(limit = 500): StoreRecord[] {
    return [...liveRawJournals.values()].flatMap((journal) => journal.pageStoreRecords({ limit }).records);
  }

  function clearLiveRawJournals(): { removedRecords: number; touchedExternalState: false } {
    const results = [...liveRawJournals.values()].map((journal) => journal.clearStoreRecords());
    return {
      removedRecords: results.reduce((total, result) => total + result.removedRecords, 0),
      touchedExternalState: false
    };
  }

  function pruneLiveRawJournals(policy: RetentionPolicy): PruneLocalDataResult {
    const results = [...liveRawJournals.values()].map((journal) => journal.pruneStoreRecords(policy));
    return {
      removedRecords: results.reduce((total, result) => total + result.removedRecords, 0),
      removedRecordIds: results.flatMap((result) => result.removedRecordIds),
      removedByType: {
        attention_item: sumRemovedByType(results, "attention_item"),
        conflict_card: sumRemovedByType(results, "conflict_card"),
        event: sumRemovedByType(results, "event"),
        git_snapshot: sumRemovedByType(results, "git_snapshot"),
        review_disposition: sumRemovedByType(results, "review_disposition")
      },
      retainedRecords: results.reduce((total, result) => total + result.retainedRecords, 0),
      touchedExternalState: false
    };
  }

  function sumRemovedByType(results: PruneLocalDataResult[], key: keyof PruneLocalDataResult["removedByType"]): number {
    return results.reduce((total, result) => total + (result.removedByType[key] ?? 0), 0);
  }

  const deferredLiveIngestQueue = createLiveIngestQueue({
    flushDelayMs: 750,
    maxBatchSize: 100,
    onError: (error, events) => {
      recordRuntimeDiagnostic({
        details: {
          error,
          eventIds: events.map((event) => event.eventId),
          sourceSessionIds: [...new Set(events.flatMap((event) => (event.sessionId ? [event.sessionId] : [])))]
        },
        kind: "deferred_live_ingest_flush_failed",
        message: `Deferred live ingest flush failed for ${events.length} event${events.length === 1 ? "" : "s"}.`,
        severity: "warning"
      });
    },
    onFlush: async (events) => {
      const latestEventBySession = new Map<string, NormalizedEvent>();
      const touchedSessionIds = new Set<string>();
      database.exec("BEGIN IMMEDIATE;");
      try {
        for (const event of events) {
          appendStoreRecordToRawJournal({
            recordId: `event:${event.eventId}`,
            recordType: "event",
            observedAt: event.occurredAt,
            value: event
          });
          const sessionId = liveSessionRepositoryForEvent(event).upsertLiveEvent(event);
          if (sessionId) touchedSessionIds.add(sessionId);
          if (event.sessionId) latestEventBySession.set(event.sessionId, event);
        }
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
      for (const sessionId of touchedSessionIds) queueSessionSearchIndex(sessionId);
      for (const event of latestEventBySession.values()) {
        try {
          if (event.sessionId && isTerminalProtectedSession(event.sessionId)) continue;
          const gitSnapshot = await collectGitSnapshot(event);
          if (gitSnapshot) await appendGitSnapshotIfChanged(gitSnapshot);
        } catch (error) {
          recordRuntimeDiagnostic({
            details: {
              error,
              eventId: event.eventId,
              sourceSessionId: event.sessionId
            },
            kind: "deferred_live_ingest_git_snapshot_failed",
            message: `Deferred live ingest Git snapshot failed for ${event.sessionId ?? event.eventId}.`,
            severity: "warning"
          });
        }
      }
    }
  });
  let immediateLiveIngestPersistence: Promise<void> = Promise.resolve();

  function scheduleImmediateLiveIngestPersistence(
    event: NormalizedEvent,
    liveStateReportInput: ReturnType<typeof liveStateReportFromHookPayload>
  ): void {
    immediateLiveIngestPersistence = immediateLiveIngestPersistence
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((resolve) => {
            setImmediate(() => {
              try {
                persistHookLiveStateReport(database, liveStateReportInput);
                const sessionId = liveSessionRepositoryForEvent(event).upsertLiveEvent(event);
                if (sessionId) {
                  rememberCompletedLiveSession(event);
                  if (shouldDeferLiveEnrichmentToHookTranscript(event)) queueSessionSearchIndex(sessionId);
                  else queueSessionEnrichment(sessionId);
                }
                appendStoreRecordToRawJournal({
                  recordId: `event:${event.eventId}`,
                  recordType: "event",
                  observedAt: event.occurredAt,
                  value: event
                });
              } catch (error) {
                recordRuntimeDiagnostic({
                  details: { error, eventId: event.eventId, sourceSessionId: event.sessionId },
                  kind: "immediate_live_ingest_persistence_failed",
                  message: `Immediate live ingest persistence failed for ${event.sessionId ?? event.eventId}.`,
                  severity: "warning"
                });
              } finally {
                resolve();
              }
            });
          })
      );
  }

  let closed = false;
  let closePromise: Promise<void> | undefined;
  let hydrationStarted = false;
  let hydrationPromise: Promise<void> = Promise.resolve();


  function startBackgroundHydration(): void {
    if (hydrationStarted) return;
    hydrationStarted = true;
    hydrationPromise = new Promise((resolve) => {
      setTimeout(() => {
        void runBackgroundHydration().finally(resolve);
      }, 1_000).unref();
    });
  }

  async function runBackgroundHydration(): Promise<void> {
    try {
      const migration = await migrateLegacyJournalOnce({
        appendStoreRecord: appendStoreRecordToRawJournal,
        database,
        indexSession: (sessionId) => indexCanonicalSessionSearch(database, sessionId),
        legacyStorePath: legacyNdjsonCandidate?.path,
        onTouchedSessions: queueSessionEnrichments,
        shouldStop: () => closed,
        sqliteCopied: legacySqliteMigration.copied,
        storePath: config.storePath,
        targetDatabaseId: databaseIdentity,
        upsertLiveEvent: (event) => liveSessionRepositoryForEvent(event).upsertLiveEvent(event),
        yieldToEventLoop
      });
      if (migration.importedRecords > 0) {
        await indexExistingCanonicalSessions();
        rebuildLiveStateFromCanonical();
      }
    } catch (error: unknown) {
      console.error("[masthead] background journal hydration failed", error);
    }
  }

  async function indexExistingCanonicalSessions(): Promise<number> {
    let indexed = 0;
    const batchSize = 5;
    while (!closed) {
      const batch = database
        .prepare(
          `SELECT sessions.session_id AS sessionId
          FROM sessions
          WHERE NOT EXISTS (
            SELECT 1
            FROM session_search
            WHERE session_search.session_id = sessions.session_id
          )
          ORDER BY sessions.last_activity_at DESC
          LIMIT ?`
        )
        .all(batchSize) as Array<{ sessionId: string }>;
      if (batch.length === 0) return indexed;

      database.exec("BEGIN IMMEDIATE;");
      try {
        for (const row of batch) {
          indexCanonicalSessionSearch(database, row.sessionId);
        }
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
      indexed += batch.length;
      queueSessionEnrichments(batch.map((row) => row.sessionId));
      await yieldToEventLoop();
    }
    return indexed;
  }

  function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  }

  function rebuildLiveStateFromCanonical(): void {
    const nextState = createIngestionState(canonicalLiveEvents(database), {
      includeInLiveProjection: (event) => eventLiveProcessingMode(event) === "immediate"
    });
    state.events.length = 0;
    state.events.push(...nextState.events);
    state.seenEventIds.clear();
    for (const eventId of nextState.seenEventIds) state.seenEventIds.add(eventId);
    state.seenPayloadHashes.clear();
    for (const hash of nextState.seenPayloadHashes) state.seenPayloadHashes.add(hash);
    state.seenProviderEventIds.clear();
    for (const providerEventId of nextState.seenProviderEventIds) state.seenProviderEventIds.add(providerEventId);
    rebuildCompletedLiveSessionIdsFromState();

    gitSnapshots.length = 0;
    gitSnapshots.push(...canonicalGitSnapshots(database));
    gitSnapshotSignatures.clear();
    terminalGitSnapshotSessionIds.clear();
    for (const gitSnapshot of gitSnapshots) {
      gitSnapshotSignatures.set(gitSnapshot.sessionId, gitSnapshotSignature(gitSnapshot));
      if (isTerminalGitSnapshot(gitSnapshot)) terminalGitSnapshotSessionIds.add(gitSnapshot.sessionId);
    }
  }

  async function appendGitSnapshotIfChanged(gitSnapshot: GitSnapshot, options: { terminalEvent?: NormalizedEvent } = {}): Promise<boolean> {
    const signature = gitSnapshotSignature(gitSnapshot);
    const terminalEvent = options.terminalEvent;
    if (!terminalEvent && isTerminalProtectedSession(gitSnapshot.sessionId)) return false;
    if (!terminalEvent && gitSnapshotSignatures.get(gitSnapshot.sessionId) === signature) return false;

    gitSnapshotSignatures.set(gitSnapshot.sessionId, signature);
    const snapshotToAppend = terminalEvent ? terminalGitSnapshot(gitSnapshot, terminalEvent) : gitSnapshot;
    if (terminalEvent) {
      rememberCompletedLiveSession(terminalEvent);
      terminalGitSnapshotSessionIds.add(gitSnapshot.sessionId);
    }
    gitSnapshots.push(snapshotToAppend);
    appendStoreRecordToRawJournal({
      recordId: `git_snapshot:${snapshotToAppend.snapshotId}`,
      recordType: "git_snapshot",
      observedAt: snapshotToAppend.observedAt,
      value: snapshotToAppend
    });
    upsertFileEffectsFromGitSnapshot(
      database,
      canonicalSessionIdForSource(snapshotToAppend.sessionId, liveRuntimeForSourceSessionId(snapshotToAppend.sessionId)),
      snapshotToAppend
    );
    return true;
  }

  async function clearVolatileAndLegacyCompatibilityState(): Promise<{ removedRecords: number; touchedExternalState: boolean }> {
    const legacy = await store.clearLocalData();
    const hook = clearLiveRawJournals();
    const observer = observerRawJournal.clearStoreRecords();
    state.events.length = 0;
    completedLiveSessionIds.clear();
    gitSnapshots.length = 0;
    gitSnapshotSignatures.clear();
    terminalGitSnapshotSessionIds.clear();
    return {
      removedRecords: legacy.removedRecords + hook.removedRecords + observer.removedRecords,
      touchedExternalState: false
    };
  }

  let destructiveDeferredLiveIngestBarrier: Promise<void> | undefined;
  let destructiveMutationEpoch = 0;

  async function waitForDeferredLiveIngestDestructiveBarrier(): Promise<void> {
    while (destructiveDeferredLiveIngestBarrier) {
      await destructiveDeferredLiveIngestBarrier;
    }
  }

  async function withDeferredLiveIngestBarrierForDestructiveMutation<T>(mutation: () => Promise<T> | T): Promise<T> {
    const previousBarrier = destructiveDeferredLiveIngestBarrier;
    const activeGitRefreshPromise = activeGitRefreshWorkPromise;
    let releaseBarrier: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    destructiveMutationEpoch += 1;
    destructiveDeferredLiveIngestBarrier = barrier;
    try {
      if (previousBarrier) await previousBarrier;
      if (activeGitRefreshPromise) await activeGitRefreshPromise;
      try {
        await deferredLiveIngestQueue.flushNow();
      } catch {
        // The queue's onError hook records flush diagnostics. Deletion privacy takes precedence over retrying deferred tool stats.
        deferredLiveIngestQueue.discardPending();
      }
      return await mutation();
    } finally {
      if (destructiveDeferredLiveIngestBarrier === barrier) {
        destructiveDeferredLiveIngestBarrier = undefined;
      }
      releaseBarrier();
    }
  }

  function refreshVolatileStateFromRawRecords(): void {
    const records = [
      ...store.readAll(),
      ...liveRawJournalRecords(500),
      ...observerRawJournal.pageStoreRecords({ limit: 500 }).records
    ];
    state.events.length = 0;
    state.events.push(
      ...records
        .filter((record) => record.recordType === "event")
        .map((record) => record.value as NormalizedEvent)
        .filter((event) => eventLiveProcessingMode(event) === "immediate")
    );
    rebuildCompletedLiveSessionIdsFromState();
    gitSnapshots.length = 0;
    gitSnapshots.push(...records.filter((record) => record.recordType === "git_snapshot").map((record) => record.value as GitSnapshot));
    gitSnapshotSignatures.clear();
    terminalGitSnapshotSessionIds.clear();
    for (const gitSnapshot of gitSnapshots) {
      gitSnapshotSignatures.set(gitSnapshot.sessionId, gitSnapshotSignature(gitSnapshot));
      if (isTerminalGitSnapshot(gitSnapshot)) terminalGitSnapshotSessionIds.add(gitSnapshot.sessionId);
    }
  }

  async function refreshKnownGitSnapshots(): Promise<number> {
    let refreshed = 0;
    for (const candidate of latestRefreshableGitEvents()) {
      const event = candidate.event;
      if (!event?.sessionId) continue;
      const gitSnapshot = await collectGitSnapshot(event, { includeDiffStats: false });
      if (!gitSnapshot) continue;
      if (await appendGitSnapshotIfChanged(gitSnapshot, { terminalEvent: candidate.terminalEvent })) refreshed += 1;
    }
    return refreshed;
  }

  function latestRefreshableGitEvents(): Array<{ event: NormalizedEvent; terminalEvent?: NormalizedEvent }> {
    const eventsBySession = new Map<string, { event: NormalizedEvent; terminalEvent?: NormalizedEvent }>();
    const skippedCompletedSessions = new Set<string>();
    const eventWindow = state.events.slice(-100);
    const completedEventsBySession = latestCompletedEventsBySession(eventWindow);
    for (let index = eventWindow.length - 1; index >= 0 && eventsBySession.size < 5; index -= 1) {
      const event = eventWindow[index];
      if (!event?.sessionId || eventsBySession.has(event.sessionId) || skippedCompletedSessions.has(event.sessionId)) continue;
      const completedEvent = completedEventsBySession.get(event.sessionId);
      if (completedEvent && hasTerminalGitSnapshot(completedEvent)) {
        skippedCompletedSessions.add(event.sessionId);
        continue;
      }
      if (completedEvent && event.type !== "session.completed" && event.occurredAt > completedEvent.occurredAt) continue;
      if (!event.workspace?.cwd && !event.workspace?.repoRoot && !event.workspace?.worktreePath) continue;
      eventsBySession.set(event.sessionId, { event, terminalEvent: completedEvent });
    }
    return [...eventsBySession.values()];
  }

  function latestCompletedEventsBySession(events: NormalizedEvent[]): Map<string, NormalizedEvent> {
    const completedEventsBySession = new Map<string, NormalizedEvent>();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type !== "session.completed" || !event.sessionId || completedEventsBySession.has(event.sessionId)) continue;
      completedEventsBySession.set(event.sessionId, event);
    }
    return completedEventsBySession;
  }

  function hasTerminalGitSnapshot(event: NormalizedEvent): boolean {
    if (event.type !== "session.completed" || !event.sessionId) return false;
    return terminalGitSnapshotSessionIds.has(event.sessionId);
  }

  function rememberCompletedLiveSession(event: NormalizedEvent): void {
    if (event.type === "session.completed" && event.sessionId) completedLiveSessionIds.add(event.sessionId);
  }

  function rebuildCompletedLiveSessionIdsFromState(): void {
    completedLiveSessionIds.clear();
    for (const event of state.events) rememberCompletedLiveSession(event);
  }

  function isTerminalProtectedSession(sessionId: string): boolean {
    return completedLiveSessionIds.has(sessionId) || terminalGitSnapshotSessionIds.has(sessionId);
  }

  function terminalGitSnapshot(gitSnapshot: GitSnapshot, event: NormalizedEvent): GitSnapshot {
    return {
      ...gitSnapshot,
      snapshotId: `${gitSnapshot.snapshotId}:terminal:${event.eventId}`,
      terminalEventId: event.eventId,
      terminalObservedAt: event.occurredAt
    } as GitSnapshot;
  }

  function isTerminalGitSnapshot(gitSnapshot: GitSnapshot): boolean {
    return typeof (gitSnapshot as GitSnapshot & { terminalEventId?: unknown }).terminalEventId === "string";
  }

  let gitRefreshPromise: Promise<number> | undefined;
  let activeGitRefreshWorkPromise: Promise<number> | undefined;
  async function refreshKnownGitSnapshotsAfterBarrier(): Promise<number> {
    if (destructiveDeferredLiveIngestBarrier) await waitForDeferredLiveIngestDestructiveBarrier();
    const workPromise = refreshKnownGitSnapshots();
    activeGitRefreshWorkPromise = workPromise;
    try {
      return await workPromise;
    } finally {
      if (activeGitRefreshWorkPromise === workPromise) activeGitRefreshWorkPromise = undefined;
    }
  }

  function refreshKnownGitSnapshotsSingleFlight(): Promise<number> {
    gitRefreshPromise ??= refreshKnownGitSnapshotsAfterBarrier().finally(() => {
      gitRefreshPromise = undefined;
    });
    return gitRefreshPromise;
  }

  let latestScan: SourceScanResult | undefined;

  async function discoverSourceSnapshotAndPersist(): Promise<SourceDiscoverySnapshot> {
    const snapshot = await discoverSourceSnapshot({ homeDir: config.codexHomeDir, now: new Date().toISOString(), exclusions: [] });
    getSourceStatuses(database, snapshot.sources);
    return snapshot;
  }

  async function scanSourcesAndPersist(): Promise<SourceScanResult> {
    latestScan = await scanLocalSources({ homeDir: config.codexHomeDir, now: new Date().toISOString(), exclusions: [] });
    getSourceStatuses(database, latestScan.adapters.flatMap((adapter) => adapter.sources));
    saveSourceScanRun(database, scanResultToOnboardingScan(latestScan));
    return latestScan;
  }

  function buildSourcesSetup() {
    return buildSourcesSetupState(database, { now: new Date().toISOString() });
  }

  function buildAndPersistSourcesSetup() {
    const setup = buildSourcesSetup();
    saveSourceSetupState(database, setup);
    return setup;
  }

  function cachedSourceScanResult(): SourceScanResult {
    const generatedAt = latestScan?.generatedAt ?? new Date().toISOString();
    return {
      adapters: getAdapterStatuses(database)
        .map((adapter) => ({
          checkedPaths: [],
          diagnostics: adapter.diagnostics,
          discoveredSessions: adapter.discoveredSessions,
          label: adapter.label,
          maturity: adapter.maturity as AdapterMaturity,
          runtime: adapter.runtime,
          sources: [],
          state: adapter.state === "disabled" ? "degraded" : adapter.state
        })),
      generatedAt,
      scanId: latestScan?.scanId ?? "scan:cached"
    };
  }

  async function discoverAllSourcesAndPersist(): Promise<DiscoveredSource[]> {
    const snapshot = await discoverSourceSnapshotAndPersist();
    return snapshot.sources;
  }

  async function sourceById(sourceId: string): Promise<DiscoveredSource | undefined> {
    const scanned = latestScan?.adapters.flatMap((adapter) => adapter.sources).find((source) => source.sourceId === sourceId);
    if (scanned) return scanned;
    return (await discoverAllSourcesAndPersist()).find((source) => source.sourceId === sourceId);
  }

  async function repairSourceMappings(importJobIds: string[]): Promise<{
    mappings: ImportRepairSourceMapping[];
    discoveredBySourceId: Map<string, DiscoveredSource>;
  }> {
    const jobIds = [...new Set(importJobIds)].sort();
    const jobs = jobIds.map((importJobId) => getImportJob(database, importJobId)).filter((job): job is ImportJobDto => Boolean(job));
    const sourceIds = [...new Set(jobs.map((job) => job.sourceId))].sort();
    const snapshot = await discoverSourceSnapshot({ homeDir: config.codexHomeDir, now: new Date().toISOString(), exclusions: [] });
    const discoveredBySourceId = new Map<string, DiscoveredSource>();
    const preliminaryMappings = sourceIds.map((sourceId): ImportRepairSourceMapping => {
      const stored = database.prepare(`SELECT adapter, source_kind AS sourceKind, schema_version AS schemaVersion,
          runtime_version AS runtimeVersion
        FROM ingest_sources WHERE source_id = ?`)
        .get(sourceId) as {
          adapter: RuntimeKind;
          runtimeVersion: string | null;
          schemaVersion: string | null;
          sourceKind: DiscoveredSource["sourceKind"];
        } | undefined;
      const exact = snapshot.sources.find((source) => source.sourceId === sourceId);
      const compatible = exact || !stored ? [] : snapshot.sources.filter((source) =>
        source.runtime === stored.adapter &&
        source.sourceKind === stored.sourceKind &&
        metadataMatchesWhenAvailable(stored.schemaVersion, source.schemaVersion) &&
        metadataMatchesWhenAvailable(stored.runtimeVersion, source.runtimeVersion)
      );
      if (!exact && compatible.length > 1) return { available: false, reason: "ambiguous_candidates", sourceId };
      const discovered = exact ?? compatible[0];
      if (!discovered) return { available: false, reason: "source_not_discovered", sourceId };
      const adapter = adapterForRuntime(discovered.runtime);
      if (!adapter) return { available: false, reason: "adapter_unavailable", sourceId };
      if (stored && discovered.runtime !== stored.adapter) return { available: false, reason: "runtime_mismatch", sourceId };
      discoveredBySourceId.set(sourceId, discovered);
      return {
        adapterRuntime: adapter.runtime,
        available: true,
        correctedSourceId: discovered.sourceId,
        sourceId
      };
    });
    const correctedCounts = new Map<string, number>();
    for (const mapping of preliminaryMappings) {
      if (mapping.available && mapping.correctedSourceId) {
        correctedCounts.set(mapping.correctedSourceId, (correctedCounts.get(mapping.correctedSourceId) ?? 0) + 1);
      }
    }
    const mappings = preliminaryMappings.map((mapping): ImportRepairSourceMapping => {
      if (mapping.correctedSourceId && (correctedCounts.get(mapping.correctedSourceId) ?? 0) > 1) {
        discoveredBySourceId.delete(mapping.sourceId);
        return { available: false, reason: "ambiguous_many_to_one", sourceId: mapping.sourceId };
      }
      return mapping;
    });
    return { discoveredBySourceId, mappings };
  }

  async function importMetadataSources(sources: DiscoveredSource[], controls?: ImportJobControls): Promise<ImportWorkResult> {
    const result = emptyImportResult();
    for (const source of sources) {
      const adapter = adapterForRuntime(source.runtime);
      if (!adapter) continue;
      controls?.throwIfCancelled();
      controls?.updateProgress({ currentPath: source.path ?? source.sourceId, stage: "metadata" });
      const touchedSessionIds = new Set<string>();
      let recordsSinceYield = 0;
      for await (const record of adapter.backfill(source)) {
        controls?.throwIfCancelled();
        const { sessionId } = ingestAdapterRecord(database, record, {
          hostId: `host:${config.host}`,
          hostname: config.host,
          runtimeKind: source.runtime
        });
        if (sessionId) touchedSessionIds.add(sessionId);
        queueSessionEnrichment(sessionId);
        countImportedRecord(result, record, Boolean(sessionId));
        controls?.updateProgress({
          currentPath: record.normalized.sourceRef.sourcePath ?? record.source.path ?? source.path ?? source.sourceId,
          discoveredCount: result.discoveredCount,
          failureCount: result.failureCount,
          importedCount: result.importedCount,
          processedCount: result.processedCount,
          queuedCount: result.queuedCount
        });
        recordsSinceYield += 1;
        if (recordsSinceYield >= 1) {
          recordsSinceYield = 0;
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
          controls?.throwIfCancelled();
        }
      }
      for (const sessionId of touchedSessionIds) queueSessionSearchIndex(sessionId);
    }
    return result;
  }

  async function importTranscriptSources(
    sources: DiscoveredSource[],
    controls?: ImportJobControls,
    options: TranscriptImportOptions = {}
  ): Promise<ImportWorkResult> {
    const maxRecordsPerSource = options.maxRecordsPerSource;
    const queueEnrichmentForImport = options.queueEnrichment ?? true;
    const result = emptyImportResult();
    for (const source of sources) {
      const adapter = adapterForRuntime(source.runtime);
      if (!adapter) continue;
      controls?.throwIfCancelled();
      for (const transcriptSource of await transcriptSources(source)) {
        controls?.throwIfCancelled();
        controls?.updateProgress({ currentPath: transcriptSource.path ?? transcriptSource.sourceId });
        if (!transcriptSourceImportAllowed(source, transcriptSource)) {
          result.queuedCount += 1;
          controls?.updateProgress({
            currentPath: transcriptSource.path ?? transcriptSource.sourceId,
            queuedCount: result.queuedCount
          });
          continue;
        }
        if (!transcriptSource.path || sourceIsExcluded(database, { sourceId: transcriptSource.sourceId, sourcePath: transcriptSource.path })) {
          result.queuedCount += 1;
          controls?.updateProgress({
            currentPath: transcriptSource.path ?? transcriptSource.sourceId,
            queuedCount: result.queuedCount
          });
          continue;
        }
        const cursor = readCursor(database, transcriptSource.sourceId, transcriptSource.path);
        const info = await stat(transcriptSource.path);
        let latestOffset = cursor && cursor.byteOffset > info.size ? 0 : cursor?.byteOffset ?? 0;
        let cursorContext = cursorContextFromCursor(cursor);
        const enrichmentSessionIds = new Set<string>();
        let recordsForSource = 0;
        let recordsSinceYield = 0;
        for await (const record of adapter.backfill(transcriptSource, cursor)) {
          controls?.throwIfCancelled();
          const nextCursor = record.cursorAfter;
          const nextOffset = nextCursor?.byteOffset ?? latestOffset;
          if (sourceRecordIsExcluded(database, record)) {
            latestOffset = nextOffset;
            countImportedRecord(result, record, false);
            controls?.updateProgress({
              currentPath: transcriptSource.path,
              discoveredCount: result.discoveredCount,
              failureCount: result.failureCount,
              importedCount: result.importedCount,
              processedCount: result.processedCount,
              queuedCount: result.queuedCount
            });
            continue;
          }
          cursorContext = nextCursor
            ? { cwd: nextCursor.cwd, model: nextCursor.model, sourceSessionId: nextCursor.sourceSessionId }
            : cursorContextFromRecord(record, cursorContext);
          const { sessionId } = ingestAdapterRecord(database, record, {
            cursor: {
              byteOffset: nextOffset,
              contentFingerprint: nextCursor?.contentFingerprint,
              modifiedAt: nextCursor?.modifiedAt,
              ...cursorContext
            },
            hostId: `host:${config.host}`,
            hostname: config.host,
            runtimeKind: source.runtime
          });
          latestOffset = nextOffset;
          if (sessionId) {
            enrichmentSessionIds.add(sessionId);
          }
          countImportedRecord(result, record, Boolean(sessionId));
          controls?.updateProgress({
            currentPath: transcriptSource.path,
            discoveredCount: result.discoveredCount,
            failureCount: result.failureCount,
            importedCount: result.importedCount,
            processedCount: result.processedCount,
            queuedCount: result.queuedCount
          });
          recordsForSource += 1;
          recordsSinceYield += 1;
          if (maxRecordsPerSource && recordsForSource >= maxRecordsPerSource) {
            result.limited = true;
            break;
          }
          if (recordsSinceYield >= 25) {
            recordsSinceYield = 0;
            await new Promise<void>((resolve) => {
              setImmediate(resolve);
            });
          }
        }
        for (const sessionId of enrichmentSessionIds) {
          reconcileImportedTranscript(database, sessionId);
          queueSessionSearchIndex(sessionId);
        }
        if (queueEnrichmentForImport && !result.limited) {
          for (const sessionId of enrichmentSessionIds) queueSessionEnrichment(sessionId);
        }
        controls?.throwIfCancelled();
        upsertCursor(database, {
          byteOffset: latestOffset,
          contentFingerprint: `${info.size}:${Math.trunc(info.mtimeMs)}`,
          modifiedAt: info.mtime.toISOString(),
          sourceId: transcriptSource.sourceId,
          sourcePath: transcriptSource.path,
          ...cursorContext
        });
      }
    }
    return result;
  }

  function transcriptSourceImportAllowed(source: DiscoveredSource, transcriptSource: DiscoveredSource): boolean {
    return sourcePolicyExplicitlyEnabled(database, "transcript_import", transcriptSource.sourceId) ||
      sourcePolicyExplicitlyEnabled(database, "transcript_import", source.sourceId);
  }

  async function importTranscriptSourcesWithLedger(
    sources: DiscoveredSource[],
    controls: ImportJobControls,
    scope: ImportScopeDto = defaultTranscriptImportScope(),
    queueEnrichmentForImport = true
  ): Promise<ImportWorkResult> {
    const result = emptyImportResult();
    const runtime = sources[0]?.runtime ?? defaultLiveRuntime;
    const transcriptFiles = (
      await Promise.all(sources.map((source) => transcriptSources(source)))
    ).flat().filter((source) => !source.path || !sourceIsExcluded(database, { sourceId: source.sourceId, sourcePath: source.path }));
    const cursors = readCursorsForSources(transcriptFiles);
    const manifestTranscriptUnits = await planTranscriptImportUnits(transcriptFiles);
    controls.updateProgress({
      currentPath: sources[0]?.path ?? sources[0]?.sourceId ?? runtime,
      heartbeatAt: new Date().toISOString(),
      scope,
      stage: "manifest"
    });
    const existingUnits = listAllImportWorkUnits(database, { importJobId: controls.importJobId });
    const existingSummary = existingUnits[0] ? getImportManifestSummary(database, existingUnits[0].manifestId) : undefined;
    const manifest = existingUnits.length > 0 && existingSummary
      ? { summary: existingSummary, units: existingUnits }
      : await createManifestForJob(database, {
          cursors,
          generatedAt: new Date().toISOString(),
          importJobId: controls.importJobId,
          importKind: "transcript",
          runtime,
          scope,
          sourceId: sources[0]?.sourceId,
          sources: transcriptFiles,
          transcriptUnits: manifestTranscriptUnits
        });
    controls.updateProgress({
      stage: "transcript",
      totalWorkUnits: manifest.units.length,
      skippedWorkUnits: manifest.units.filter((unit) => unit.status === "skipped").length
    });

    for (const unit of manifest.units) {
      controls.throwIfCancelled();
      if (["succeeded", "succeeded_with_issues", "cancelled"].includes(unit.status)) continue;
      if (unit.status === "skipped") {
        result.queuedCount += 1;
        continue;
      }
      controls.updateProgress({
        currentPath: unit.sourcePath ?? unit.sourceSessionId ?? unit.workUnitId,
        heartbeatAt: new Date().toISOString(),
        stage: "transcript",
        totalWorkUnits: manifest.units.length
      });
      const adapter = adapterForRuntime(unit.runtime);
      if (!adapter) throw new Error(`No adapter for runtime ${unit.runtime}`);
      const checkpointBaseUnits = listAllImportWorkUnits(database, { manifestId: unit.manifestId })
        .filter((candidate) => candidate.workUnitId !== unit.workUnitId);
      const checkpointBase = {
        failed: checkpointBaseUnits.reduce((total, candidate) => total + candidate.failedRecords, 0),
        imported: checkpointBaseUnits.reduce((total, candidate) => total + candidate.importedRecords, 0),
        processed: checkpointBaseUnits.reduce((total, candidate) => total + candidate.processedRecords, 0)
      };
      const unitResult = await runImportWorkUnit({
        approvedSourceIds: sources.map((source) => source.sourceId),
        db: database,
        hostId: `host:${config.host}`,
        hostname: config.host,
        now: () => new Date().toISOString(),
        onCheckpoint: (checkpoint) => controls.updateProgress({
          currentPath: unit.sourcePath ?? unit.sourceSessionId ?? unit.workUnitId,
          failureCount: checkpointBase.failed + checkpoint.failed,
          heartbeatAt: new Date().toISOString(),
          importedCount: checkpointBase.imported + checkpoint.imported,
          processedCount: checkpointBase.processed + checkpoint.processed,
          stage: "transcript",
          totalWorkUnits: manifest.units.length
        }),
        onSessionImported: undefined,
        onSessionHydrated: (sessionId, options) => reconcileImportedTranscript(database, sessionId, {
          finalizeNoise: false,
          holdForRepair: options.holdForRepair
        }),
        parseTranscriptUnit: async (_fallbackPlan, cursor) => {
          return adapter.parseTranscriptUnit(transcriptPlanForWorkUnit(manifestTranscriptUnits, unit), cursor);
        },
        runtimeKind: unit.runtime,
        workUnitId: unit.workUnitId,
        indexSession: queueSessionSearchIndex
      });
      if (queueEnrichmentForImport && unitResult.failed === 0) {
        for (const sessionId of unitResult.sessionIds) {
          if (sessionImportIsCompleteOrUntracked(sessionId)) queueSessionEnrichment(sessionId);
        }
      }
      const completedUnit = getImportWorkUnit(database, unit.workUnitId);
      if (unit.sourcePath && completedUnit && ["succeeded", "succeeded_with_issues"].includes(completedUnit.status)) {
        await updateCursorAfterWorkUnit(unit);
      }
      const progressUnits = listAllImportWorkUnits(database, { manifestId: unit.manifestId });
      result.processedCount = progressUnits.reduce((total, candidate) => total + candidate.processedRecords, 0);
      result.importedCount = progressUnits.reduce((total, candidate) => total + candidate.importedRecords, 0);
      result.failureCount = progressUnits.reduce((total, candidate) => total + candidate.failedRecords, 0);
      result.discoveredCount = manifest.summary.estimatedRecords ?? result.processedCount;
      controls.updateProgress({
        completedWorkUnits: progressUnits.filter((candidate) => ["succeeded", "succeeded_with_issues"].includes(candidate.status)).length,
        currentPath: unit.sourcePath ?? unit.sourceSessionId ?? unit.workUnitId,
        failedWorkUnits: progressUnits.filter((candidate) => candidate.status === "failed").length,
        failureCount: result.failureCount,
        heartbeatAt: new Date().toISOString(),
        importedCount: result.importedCount,
        processedCount: result.processedCount,
        skippedWorkUnits: progressUnits.filter((candidate) => candidate.status === "skipped").length,
        stage: "transcript"
      });
    }

    const finalUnits = listAllImportWorkUnits(database, { importJobId: controls.importJobId });
    result.processedCount = finalUnits.reduce((total, unit) => total + unit.processedRecords, 0);
    result.discoveredCount = manifest.summary.estimatedRecords ?? result.processedCount;
    result.importedCount = finalUnits.reduce((total, unit) => total + unit.importedRecords, 0);
    result.failureCount = finalUnits.reduce((total, unit) => total + unit.failedRecords, 0);
    result.queuedCount = finalUnits.filter((unit) => ["queued", "running", "skipped"].includes(unit.status)).length;
    const failedUnits = finalUnits.filter((unit) => unit.status === "failed").length;
    const skippedUnits = finalUnits.filter((unit) => unit.status === "skipped").length;
    const remainingUnits = finalUnits.filter((unit) => ["queued", "running"].includes(unit.status)).length;
    const generatedAt = new Date().toISOString();
    const buildReport = () => buildImportCompletionReport(database, {
      failedUnits,
      generatedAt,
      importJobId: controls.importJobId,
      recordsFailed: result.failureCount,
      recordsImported: result.importedCount,
      recordsSkipped: result.queuedCount,
      runtime,
      skippedUnits,
      sourceUnitsDiscovered: finalUnits.length,
      sourceUnitsHydrated: finalUnits.filter((unit) => ["succeeded", "succeeded_with_issues"].includes(unit.status)).length,
      sourceUnitsRemaining: remainingUnits,
      status:
        result.failureCount > 0
          ? result.importedCount > 0
            ? "succeeded_with_issues"
            : "failed"
          : "succeeded",
      transcriptsImported: result.importedCount
    });
    const preliminaryReport = buildReport();
    settleImportSessionClassifications(database, {
      anomalies: preliminaryReport.anomalies,
      finalizeNoise: failedUnits === 0 && remainingUnits === 0,
      importJobId: controls.importJobId
    });
    const report = buildReport();
    if (report.status === "succeeded_with_issues") result.completionStatus = report.status;
    updateImportJob(database, controls.importJobId, {
      completionReport: report,
      summary: {
        failureGroups: listImportFailureGroups(database, controls.importJobId),
        manifest: manifest.summary
      },
      updatedAt: daemonStartedAt
    });
    return result;
  }

  function sessionImportIsCompleteOrUntracked(sessionId: string): boolean {
    const health = readSessionImportHealth(database, sessionId);
    return !health || health.status === "complete";
  }

  function runImportWorkerForSource(
    importKind: ImportJobKind,
    source: DiscoveredSource,
    controls: ImportJobControls,
    scope: ImportScopeDto = defaultTranscriptImportScope()
  ): Promise<ImportWorkResult> {
    if (importKind === "metadata") return importMetadataSources([source], controls);
    if (importKind === "transcript") return importTranscriptSourcesWithLedger([source], controls, scope);
    return Promise.resolve(emptyImportResult());
  }

  async function runImportWorkerForRuntime(
    importKind: ImportJobKind,
    runtime: RuntimeKind,
    controls: ImportJobControls,
    scope: ImportScopeDto = defaultTranscriptImportScope()
  ): Promise<ImportWorkResult> {
    const sources = latestScan?.adapters.find((adapter) => adapter.runtime === runtime)?.sources ??
      (await discoverAllSourcesAndPersist()).filter((source) => source.runtime === runtime);
    if (importKind === "metadata") return importMetadataSources(sources, controls);
    if (importKind === "transcript") return importTranscriptSourcesWithLedger(sources, controls, scope);
    return Promise.resolve(emptyImportResult());
  }

  function runImportWorkerForSources(
    importKind: ImportJobKind,
    runtime: RuntimeKind,
    sources: DiscoveredSource[],
    controls: ImportJobControls,
    scope: ImportScopeDto = defaultTranscriptImportScope(),
    queueEnrichment = true
  ): Promise<ImportWorkResult> {
    const runtimeSources = sources.filter((source) => source.runtime === runtime);
    if (importKind === "metadata") return importMetadataSources(runtimeSources, controls);
    if (importKind === "transcript") return importTranscriptSourcesWithLedger(runtimeSources, controls, scope, queueEnrichment);
    return Promise.resolve(emptyImportResult());
  }

  async function queueAdapterMetadataImports(runtime?: string): Promise<{ jobs: ImportJobDto[]; sources: number }> {
    const sources = (await discoverAllSourcesAndPersist()).filter((source) => !runtime || source.runtime === runtime);
    const jobs = sources.map((source) =>
      queueImportJob(database, { importKind: "metadata", sourceId: source.sourceId }, (controls) => importMetadataSources([source], controls))
    );
    return { jobs, sources: sources.length };
  }

  async function resumeInterruptedImports(): Promise<void> {
    for (const importJobId of interruptedImportJobIds) {
      const job = getImportJob(database, importJobId);
      if (!job) continue;
      const source = await sourceById(job.sourceId);
      if (!source) {
        const failedAt = new Date().toISOString();
        updateImportJob(database, importJobId, {
          failureCount: Math.max(1, job.failureCount),
          failureMessage: `Cannot resume import because source ${job.sourceId} is no longer discoverable.`,
          finishedAt: failedAt,
          status: "failed",
          updatedAt: failedAt
        });
        continue;
      }
      resumeImportJob(
        database,
        importJobId,
        (controls) => runImportWorkerForSource(job.importKind, source, controls, job.scope ?? defaultTranscriptImportScope())
      );
    }
  }

  if (interruptedImportJobIds.length > 0) {
    setImmediate(() => {
      void resumeInterruptedImports();
    });
  }

  function scheduleHookTranscriptCatchup(event: NormalizedEvent): Promise<void> | undefined {
    const transcriptPath = stringFromPayload(event.payload, ["transcriptPath", "transcript_path"]);
    const key = transcriptPath ?? event.eventId;
    if (!config.hookTranscriptCatchupEnabled) {
      if (transcriptPath && !disabledHookTranscriptCatchupDiagnostics.has(key)) {
        disabledHookTranscriptCatchupDiagnostics.add(key);
        if (disabledHookTranscriptCatchupDiagnostics.size > 100) disabledHookTranscriptCatchupDiagnostics.clear();
        recordRuntimeDiagnostic({
          details: {
            eventId: event.eventId,
            sourceSessionId: event.sessionId,
            transcriptPath
          },
          kind: "hook_transcript_catchup_disabled",
          message: "Live hook included a transcriptPath, but hook transcript catch-up is disabled.",
          severity: "warning"
        });
      }
      return;
    }
    const previousForKey = hookTranscriptCatchups.get(key) ?? Promise.resolve();
    const next = hookTranscriptCatchupQueue
      .catch(() => undefined)
      .then(() => previousForKey.catch(() => undefined))
      .then(
        () =>
          new Promise<void>((resolve) => {
            setImmediate(resolve);
          })
      )
      .then(() => importHookTranscriptIfApproved(event))
      .finally(() => {
        if (hookTranscriptCatchups.get(key) === next) hookTranscriptCatchups.delete(key);
      });
    hookTranscriptCatchups.set(key, next);
    hookTranscriptCatchupQueue = next.catch(() => undefined);
    next.catch(() => {
      // importHookTranscriptIfApproved records diagnostics; this prevents unhandled rejections.
    });
    return next;
  }

  async function importHookTranscriptIfApproved(event: NormalizedEvent): Promise<void> {
    try {
      const source = await transcriptSourceFromHookEvent(event, config.codexHomeDir);
      if (!source || !sourcePolicyExplicitlyEnabled(database, "transcript_import", source.sourceId)) return;
      if (!source?.path || sourceIsExcluded(database, { sourceId: source.sourceId, sourcePath: source.path })) return;
      const result = await importTranscriptSources([source], undefined, {
        maxRecordsPerSource: HOOK_TRANSCRIPT_CATCHUP_RECORD_LIMIT,
        queueEnrichment: shouldQueueHookTranscriptEnrichment(event)
      });
      if (result.limited) {
        const timer = setTimeout(() => scheduleHookTranscriptCatchup(event), HOOK_TRANSCRIPT_CATCHUP_REQUEUE_MS);
        timer.unref?.();
      }
    } catch (error) {
      state.diagnostics.push({
        code: "invalid_payload",
        details: error instanceof Error ? error.message : String(error),
        message: "Live hook transcript catch-up failed; live hook ingestion was kept.",
        receivedAt: new Date().toISOString()
      });
    }
  }

  function shouldDeferLiveEnrichmentToHookTranscript(event: NormalizedEvent): boolean {
    const sourceId = transcriptSourceIdFromHookEvent(event, config.codexHomeDir);
    return Boolean(config.hookTranscriptCatchupEnabled && sourceId && sourcePolicyExplicitlyEnabled(database, "transcript_import", sourceId));
  }

  function shouldQueueHookTranscriptEnrichment(event: NormalizedEvent): boolean {
    return event.type === "session.completed";
  }

  async function catchUpSessionTranscriptIfApproved(canonicalSessionIdValue: string): Promise<void> {
    const events = hookTranscriptCatchupEventsForSession(canonicalSessionIdValue);
    if (events.length === 0) return;
    const scheduled = events
      .map((event) => scheduleHookTranscriptCatchup(event))
      .filter((promise): promise is Promise<void> => Boolean(promise));
    if (scheduled.length === 0) return;

    await Promise.race([Promise.allSettled(scheduled).then(() => undefined), unrefDelay(VISIBLE_TRANSCRIPT_CATCHUP_BUDGET_MS)]);
  }

  function queueSessionEnrichmentAfterTranscriptCatchup(canonicalSessionIdValue: string): void {
    setImmediate(() => {
      void (async () => {
        await catchUpSessionTranscriptIfApproved(canonicalSessionIdValue);
        queueSessionEnrichment(canonicalSessionIdValue);
      })();
    });
  }

  function dossierWithManualEnrichmentState(dossier: SessionDossierDto, sessionId: string): SessionDossierDto {
    const job = manualDossierEnrichmentJobs.get(sessionId);
    if (!job) return dossier;
    return {
      ...dossier,
      enrichment: {
        ...dossier.enrichment,
        failureCode: job.failureCode ?? dossier.enrichment.failureCode,
        failureMessage: job.failureMessage ?? dossier.enrichment.failureMessage,
        generatedAt: job.generatedAt ?? dossier.enrichment.generatedAt,
        model: job.model ?? dossier.enrichment.model,
        provider: job.provider ?? dossier.enrichment.provider,
        status: job.status
      }
    };
  }

  async function runManualDossierEnrichment(sessionId: string): Promise<void> {
    try {
      await catchUpSessionTranscriptIfApproved(sessionId);
      const record = await enrichment.enrich(sessionId);
      queueSessionSearchIndex(sessionId);
      manualDossierEnrichmentJobs.set(sessionId, {
        completedAt: new Date().toISOString(),
        generatedAt: record.generatedAt,
        model: record.model,
        provider: record.provider,
        requestedAt: manualDossierEnrichmentJobs.get(sessionId)?.requestedAt ?? new Date().toISOString(),
        status: "current"
      });
    } catch (error) {
      const failed = error instanceof EnrichmentFailedError ? error : undefined;
      manualDossierEnrichmentJobs.set(sessionId, {
        completedAt: new Date().toISOString(),
        failureCode: failed?.status,
        failureMessage: failed?.failureMessage ?? (error instanceof Error ? error.message : String(error)),
        model: failed?.model,
        provider: failed?.provider,
        requestedAt: manualDossierEnrichmentJobs.get(sessionId)?.requestedAt ?? new Date().toISOString(),
        status: "failed"
      });
      recordRuntimeDiagnostic({
        details: failed
          ? {
              failureCode: failed.status,
              failureMessage: failed.failureMessage,
              model: failed.model,
              provider: failed.provider,
              sessionId,
              status: failed.status
            }
          : { error, sessionId },
        kind: "manual_dossier_enrichment_failed",
        message: `Manual Dossier enrichment failed for ${sessionId}`,
        severity: "warning"
      });
    }

    const cleanupTimer = setTimeout(() => {
      const job = manualDossierEnrichmentJobs.get(sessionId);
      if (job?.status !== "enriching") manualDossierEnrichmentJobs.delete(sessionId);
    }, 120_000);
    cleanupTimer.unref?.();
  }

  function hookTranscriptCatchupEventsForSession(canonicalSessionIdValue: string): NormalizedEvent[] {
    if (!config.hookTranscriptCatchupEnabled) return [];
    const row = database
      .prepare("SELECT source_session_id AS sourceSessionId FROM sessions WHERE session_id = ? AND deleted_at IS NULL")
      .get(canonicalSessionIdValue) as { sourceSessionId: string } | undefined;
    const sourceSessionId = row?.sourceSessionId?.trim();
    if (!sourceSessionId) return [];
    return [...liveHookSources.values()].flatMap((source) =>
      recentHookEventsWithTranscriptPathsForSessions(database, source.sourceId, new Set([sourceSessionId]), 1).filter((event) => {
        const sourceId = transcriptSourceIdFromHookEvent(event, config.codexHomeDir);
        return Boolean(sourceId && sourcePolicyExplicitlyEnabled(database, "transcript_import", sourceId)) &&
          needsHookTranscriptCatchup(canonicalSessionIdValue, event);
      })
    );
  }

  function needsHookTranscriptCatchup(canonicalSessionIdValue: string, event: NormalizedEvent): boolean {
    const eventAt = Date.parse(event.occurredAt);
    if (!Number.isFinite(eventAt)) return true;
    const row = database
      .prepare(
        `SELECT
          MAX(observed_at) AS latestObservedAt,
          SUM(CASE WHEN role = 'user' AND trim(text_redacted) NOT IN ('', 'Codex hook event', 'Runtime signal', 'Tool call', 'Unknown') THEN 1 ELSE 0 END) AS userMessages,
          SUM(CASE WHEN role = 'assistant' AND trim(text_redacted) NOT IN ('', 'Codex hook event', 'Runtime signal', 'Tool call', 'Unknown') THEN 1 ELSE 0 END) AS assistantMessages
        FROM messages
        WHERE session_id = ?
          AND role IN ('user', 'assistant')`
      )
      .get(canonicalSessionIdValue) as { assistantMessages: number | null; latestObservedAt: string | null; userMessages: number | null };
    const latestObservedAt = row.latestObservedAt ? Date.parse(row.latestObservedAt) : Number.NaN;
    return !row.userMessages || !row.assistantMessages || !Number.isFinite(latestObservedAt) || latestObservedAt < eventAt;
  }

  function defaultTranscriptImportScope(): ImportScopeDto {
    return { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 };
  }

  function importScopeFromBody(body: Record<string, unknown>): ImportScopeDto {
    const candidate = objectRecord(body.importScope);
    const mode = typeof candidate.mode === "string" ? candidate.mode : undefined;
    const normalizedMode = mode === "metadata_all" || mode === "transcript_full" || mode === "enrichment_missing" ? mode : "transcript_recent";
    if (normalizedMode === "transcript_full") {
      return { includeChangedSinceCursor: true, mode: "transcript_full" };
    }
    return {
      days: typeof candidate.days === "number" && candidate.days > 0 ? candidate.days : 30,
      includeChangedSinceCursor: candidate.includeChangedSinceCursor !== false,
      mode: normalizedMode,
      unitLimit: typeof candidate.unitLimit === "number" && candidate.unitLimit >= 0 ? candidate.unitLimit : 500
    };
  }

  function readCursorsForSources(sources: DiscoveredSource[]): Map<string, IngestCursor> {
    const cursors = new Map<string, IngestCursor>();
    for (const source of sources) {
      const cursor = source.path ? readCursor(database, source.sourceId, source.path) : readCursor(database, source.sourceId);
      if (!cursor) continue;
      cursors.set(source.sourceId, cursor);
      if (source.path) cursors.set(source.path, cursor);
    }
    return cursors;
  }

  async function updateCursorAfterWorkUnit(unit: { sourceId: string; sourcePath?: string }): Promise<void> {
    if (!unit.sourcePath) return;
    const info = await stat(unit.sourcePath);
    upsertCursor(database, {
      byteOffset: info.size,
      contentFingerprint: `${info.size}:${Math.trunc(info.mtimeMs)}`,
      modifiedAt: info.mtime.toISOString(),
      sourceId: unit.sourceId,
      sourcePath: unit.sourcePath
    });
  }

  async function clearRawSourceCopies(): Promise<{ removedRecords: number; touchedExternalState: false }> {
    const result = await store.deleteRecords(isRawSourceStoreRecord);
    const hook = clearLiveRawJournals();
    const observer = observerRawJournal.clearStoreRecords();
    return { removedRecords: result.removedRecords + hook.removedRecords + observer.removedRecords, touchedExternalState: false };
  }

  async function clearLiveStateForScope(
    scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>,
    sourceSessionIds: Set<string>
  ): Promise<{ removedRecords: number; touchedExternalState: false }> {
    const result = await store.deleteRecords((record) => storeRecordMatchesDeleteScope(record, scope, sourceSessionIds));
    deleteRawEventsForStoreRecordIds(result.removedRecordIds);
    const retainedEvents = state.events.filter((event) => !eventMatchesDeleteScope(event, scope, sourceSessionIds));
    state.events.length = 0;
    state.events.push(...retainedEvents);
    rebuildCompletedLiveSessionIdsFromState();
    const retainedGitSnapshots = gitSnapshots.filter((snapshot) => !sourceSessionIds.has(snapshot.sessionId));
    gitSnapshots.length = 0;
    gitSnapshots.push(...retainedGitSnapshots);
    gitSnapshotSignatures.clear();
    terminalGitSnapshotSessionIds.clear();
    for (const gitSnapshot of gitSnapshots) {
      gitSnapshotSignatures.set(gitSnapshot.sessionId, gitSnapshotSignature(gitSnapshot));
      if (isTerminalGitSnapshot(gitSnapshot)) terminalGitSnapshotSessionIds.add(gitSnapshot.sessionId);
    }
    return { removedRecords: result.removedRecords, touchedExternalState: false };
  }

  function sourceSessionIdsForScope(
    scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>
  ): Set<string> {
    if (scope.kind === "session") {
      return new Set(
        (
          database
            .prepare("SELECT source_session_id FROM sessions WHERE session_id = ? OR source_session_id = ?")
            .all(scope.sessionId, scope.sessionId) as Array<{ source_session_id: string }>
        ).map((row) => row.source_session_id)
      );
    }
    if (scope.kind === "project") {
      return new Set(
        (
          database
            .prepare("SELECT source_session_id FROM sessions WHERE project_label = ?")
            .all(scope.project) as Array<{ source_session_id: string }>
        ).map((row) => row.source_session_id)
      );
    }
    if (scope.kind === "runtime") {
      return new Set(
        (
          database
            .prepare(
              `SELECT sessions.source_session_id AS source_session_id
              FROM sessions
              JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
              WHERE runtimes.runtime_id = ? OR runtimes.runtime_kind = ?`
            )
            .all(scope.runtime, scope.runtime) as Array<{ source_session_id: string }>
        ).map((row) => row.source_session_id)
      );
    }
    return new Set(
      (
        database
          .prepare(
            `SELECT sessions.source_session_id AS source_session_id
            FROM sessions
            JOIN hosts ON hosts.host_id = sessions.host_id
            WHERE hosts.host_id = ? OR hosts.hostname = ?`
          )
          .all(scope.host, scope.host) as Array<{ source_session_id: string }>
      ).map((row) => row.source_session_id)
    );
  }

  function deleteRawEventsForStoreRecordIds(recordIds: string[]): void {
    if (recordIds.length === 0) return;
    const placeholders = recordIds.map(() => "?").join(", ");
    database.prepare(`DELETE FROM raw_events WHERE source_record_key IN (${placeholders})`).run(...recordIds);
  }

  const server = createServer((request, response) => {
    const startedAt = Date.now();
    const requestPathname = pathnameForRequest(request, config);
    response.on("finish", () => {
      recordRequestDiagnostic({
        elapsedMs: Date.now() - startedAt,
        method: request.method,
        pathname: requestPathname,
        statusCode: response.statusCode
      });
    });
    void handleDaemonRequest(request, response).catch((error: unknown) => {
      recordRuntimeDiagnostic({
        details: {
          error,
          method: request.method,
          pathname: requestPathname
        },
        kind: "http_request_error",
        message: `Unhandled daemon request error for ${request.method ?? "GET"} ${requestPathname}`,
        severity: "error"
      });
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      sendJson(request, response, config.allowedOrigins, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });
  server.on("listening", () => {
    const address = server.address();
    if (typeof address === "object" && address?.port) config.port = address.port;
    void publishInstanceManifest().catch((error) => {
      recordRuntimeDiagnostic({
        details: { error, instanceManifestPath },
        kind: "instance_manifest_publish_failed",
        message: "Daemon failed to publish its instance manifest.",
        severity: "error"
      });
    });
  });

  function instanceIdentity(): MastheadInstanceManifest {
    return {
      schemaVersion: 1,
      instanceId: daemonInstanceId,
      baseUrl: `http://${config.host}:${boundPort(server, config.port)}`,
      databaseId,
      buildSha,
      pid: process.pid,
      instanceDir: instancePaths.instanceDir,
      updatedAt: new Date().toISOString()
    };
  }

  async function publishInstanceManifest(): Promise<MastheadInstanceManifest> {
    if (instanceManifestPublishPromise) return instanceManifestPublishPromise;
    instanceManifestPublishPromise = (async () => {
      instanceManifestGuard = await acquireMastheadInstanceManifestGuard({
        instanceDir: instancePaths.instanceDir,
        instanceId: daemonInstanceId,
        pid: process.pid,
        startedAt: daemonStartedAt
      });
      try {
        const manifest = instanceIdentity();
        await writeMastheadInstanceManifestAtomic(instanceManifestPath, manifest);
        instanceManifestPublished = true;
        return manifest;
      } catch (error) {
        await instanceManifestGuard.release();
        instanceManifestGuard = undefined;
        throw error;
      }
    })();
    return instanceManifestPublishPromise;
  }

  function guidedIdentity(): GuidedAuthoringExpectedIdentity {
    return identityFromManifest(instanceIdentity(), instanceManifestPath);
  }

  async function handleDaemonRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url || "/", `http://${config.host}:${config.port}`);

    if (request.method === "OPTIONS") {
      sendJson(request, response, config.allowedOrigins, 204, undefined);
      return;
    }

    if (!isTrustedWriteOrigin(request, config.allowedOrigins)) {
      sendJson(request, response, config.allowedOrigins, 403, { ok: false, error: "origin not allowed" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      if (!instanceManifestPublished) {
        try {
          await publishInstanceManifest();
        } catch {
          sendJson(request, response, config.allowedOrigins, 503, { ok: false, error: "instance_manifest_not_ready" });
          return;
        }
      }

      const health = buildMastheadHealth(
        config,
        database,
        {
          daemonInstanceId,
          pid: process.pid,
          baseUrl: () => `http://${config.host}:${boundPort(server, config.port)}`,
          instanceDir: instancePaths.instanceDir,
          instanceManifest: instanceManifestPath,
          authoringCommand,
          startedAt: daemonStartedAt,
          port: () => boundPort(server, config.port)
        },
        {
          events: state.events.length,
          diagnostics: state.diagnostics.length,
          gitSnapshots: gitSnapshots.length,
          sessions: liveSessionCount(state.events),
          sources: 0
        }
      );
      sendJson(request, response, config.allowedOrigins, 200, {
        ...health,

        events: health.live.events,
        diagnostics: health.live.diagnostics,
        gitSnapshots: health.live.gitSnapshots,
        storePath: config.storePath,
        databasePath: config.databasePath,
        projectionUrl: `http://${config.host}:${config.port}/projection`,
        ingestUrl: `http://${config.host}:${config.port}/ingest`,
        allowedOrigins: config.allowedOrigins,
        data: {
          ...health.data,
          legacyMigration: {
            copiedSqlite: legacySqliteMigration.copied,
            legacyPath: legacySqliteMigration.legacyPath,
            reason: legacySqliteMigration.reason
          }
        },
        boardHeadlines: boardHeadlineEnricher.status()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/diagnostics/runtime") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        diagnostics: runtimeDiagnosticsSnapshot(),
        importQueue: getImportQueueState(),
        activeImports: listImportJobPage(database, {
          limit: 10,
          status: "active"
        })
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/fixture") {
      try {
        const fixture = await readFile(config.fixturePath, "utf8");
        sendJson(request, response, config.allowedOrigins, 200, JSON.parse(fixture));
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        events: state.events,
        gitSnapshots,
        diagnostics: state.diagnostics,
        gitRefreshMs: config.gitRefreshMs
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sources") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        sources: getSourceStatuses(database)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sources/setup") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        setup: buildSourcesSetup()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sources/advanced") {
      sendJson(request, response, config.allowedOrigins, 200, {
        advanced: buildSourcesSetup().advanced,
        ok: true
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sources/connectors") {
      try {
        const snapshot = await listHarnessConnectors(database, config);
        sendJson(request, response, config.allowedOrigins, 200, { ok: true, ...snapshot });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/connectors/discover") {
      try {
        const snapshot = await discoverHarnessConnectors(database, config);
        sendJson(request, response, config.allowedOrigins, 202, { ok: true, ...snapshot });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/connectors/discover-history") {
      try {
        const [snapshot, scan] = await Promise.all([
          discoverHarnessConnectors(database, config),
          scanSourcesAndPersist()
        ]);
        const discovered = withHistoryDiscovery(snapshot, scan.adapters);
        sendJson(request, response, config.allowedOrigins, 202, { ok: true, ...discovered });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    const harnessConnectorActionMatch = url.pathname.match(
      /^\/sources\/connectors\/([^/]+)\/(enable|test|uninstall|confirm-activation)$/
    );
    if (request.method === "POST" && harnessConnectorActionMatch?.[1] && harnessConnectorActionMatch[2]) {
      const runtime = decodeURIComponent(harnessConnectorActionMatch[1]);
      const action = harnessConnectorActionMatch[2];
      if (!isLiveConnectorRuntime(runtime)) {
        sendJson(request, response, config.allowedOrigins, 404, {
          ok: false,
          error: "live connector runtime not found"
        });
        return;
      }

      try {
        if (action === "enable") {
          await installRuntimeHooks(database, config, runtime);
        } else if (action === "test") {
          await testRuntimeHooks(database, config, runtime);
        } else if (action === "uninstall") {
          await uninstallRuntimeHooks(database, config, runtime);
        } else if (action === "confirm-activation") {
          if (runtime === "codex") {
            await setConnectorActivation(dirname(config.databasePath), runtime, {
              required: "trust_hooks",
              message: "Trust Masthead hooks in Codex, then start or restart a Codex session. Masthead marks this connection Ready after it observes a real live event."
            });
          } else {
            await clearConnectorActivation(dirname(config.databasePath), runtime);
          }
        }

        const snapshot = await listHarnessConnectors(database, config);
        sendJson(request, response, config.allowedOrigins, 202, { ok: true, ...snapshot });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/adapters") {
      const includeLocations = url.searchParams.get("includeLocations") !== "false";
      const adapters = getAdapterStatuses(database).map((adapter) =>
        includeLocations
          ? adapter
          : {
              ...adapter,
              sourceLocations: []
            }
      );
      sendJson(request, response, config.allowedOrigins, 200, {
        adapters,
        ok: true
      });
      return;
    }

    const adapterSourcesMatch = url.pathname.match(/^\/adapters\/([^/]+)\/sources$/);
    if (request.method === "GET" && adapterSourcesMatch) {
      const runtime = decodeURIComponent(adapterSourcesMatch[1] ?? "");
      const limit = parseBoundedInteger(url.searchParams.get("limit"), 100, 1, 500);
      const offset = parseBoundedInteger(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
      if (!isRuntimeKind(runtime)) {
        sendJson(request, response, config.allowedOrigins, 400, { ok: false, error: "invalid_adapter" });
        return;
      }
      if (!limit.ok) {
        sendJson(request, response, config.allowedOrigins, 400, { ok: false, error: "invalid_limit" });
        return;
      }
      if (!offset.ok) {
        sendJson(request, response, config.allowedOrigins, 400, { ok: false, error: "invalid_offset" });
        return;
      }
      const sources = getSourceStatuses(database).filter((source) => source.runtime === runtime);
      sendJson(request, response, config.allowedOrigins, 200, {
        limit: limit.value,
        offset: offset.value,
        ok: true,
        sources: sources.slice(offset.value, offset.value + limit.value),
        total: sources.length
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/discover") {
      const sources = await discoverAllSourcesAndPersist();
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        sources: getSourceStatuses(database, sources)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/scan") {
      const scan = await scanSourcesAndPersist();
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        scan
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sources/scan/latest") {
      const scan = latestScan ?? cachedSourceScanResult();
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        scan
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/setup/scan") {
      const scan = await scanSourcesAndPersist();
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        scan: scanResultToOnboardingScan(scan),
        setup: buildAndPersistSourcesSetup()
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/import/preview") {
      try {
        const scan = latestScan ?? (await scanSourcesAndPersist());
        const body = objectRecord(await optionalJsonBody(request));
        const runtimes = setupRuntimesFromBody(body, scan);
        const scope = importScopeFromBody(body);
        const generatedAt = new Date().toISOString();
        const previews = [];
        for (const runtime of runtimes) {
          const adapterScan = scan.adapters.find((adapter) => adapter.runtime === runtime);
          const sources = sourcesForBodySelection(body, adapterScan?.sources ?? []);
          const transcriptFiles = (await Promise.all(sources.map((source) => transcriptSources(source)))).flat();
          const transcriptUnits = await planTranscriptImportUnits(transcriptFiles);
          const summary = await buildImportManifestPlan({
            cursors: readCursorsForSources(transcriptFiles),
            generatedAt,
            importJobId: `preview:${runtime}:${generatedAt}`,
            importKind: "transcript",
            runtime,
            scope,
            sourceId: sources[0]?.sourceId,
            sources: transcriptFiles,
            transcriptUnits
          });
          summary.summary.estimatedRecords = adapterScan && adapterScan.discoveredSessions > 0 ? adapterScan.discoveredSessions : undefined;
          previews.push({ runtime, summary: summary.summary });
        }
        sendJson(request, response, config.allowedOrigins, 200, {
          ok: true,
          previews
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/setup/run") {
      try {
        const scan = latestScan ?? (await scanSourcesAndPersist());
        const body = objectRecord(await optionalJsonBody(request));
        const runtimes = setupRuntimesFromBody(body, scan);
        const importScope = importScopeFromBody(body);
        const result = connectSelectedSources(
          database,
          scan,
          {
            importMetadata: body.importMetadata !== false,
            importScope,
            queueEnrichment: body.queueEnrichment === true,
            runtimes,
            sourceIds: sourceIdsFromBody(body)
          },
          async (kind, runtime, sources, controls) => {
            return runImportWorkerForSources(kind, runtime, sources, controls, importScope, body.queueEnrichment === true);
          }
        );
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          jobs: result.jobs,
          queued: result.jobs.length,
          setup: buildAndPersistSourcesSetup(),
          skipped: result.skipped
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/sync") {
      try {
        const body = objectRecord(await optionalJsonBody(request));
        const runtime = stringRecordValue(body, "runtime");
        if (runtime && !isRuntimeKind(runtime)) throw new Error(`Unsupported adapter runtime: ${runtime}`);
        const metadata = await queueAdapterMetadataImports(runtime);
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          jobs: metadata.jobs,
          metadataJobs: metadata.jobs,
          queued: metadata.jobs.length,
          setup: buildAndPersistSourcesSetup(),
          skipped: 0,
          sources: metadata.sources,
          transcriptJobs: []
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/repair") {
      await optionalJsonBody(request);
      sendJson(request, response, config.allowedOrigins, 202, {
        message: "No automated source repair actions are implemented yet.",
        ok: true,
        repairs: [],
        setup: buildAndPersistSourcesSetup()
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/live/state") {
      try {
        const body = objectRecord(await optionalJsonBody(request, LIVE_STATE_BODY_LIMIT_BYTES));
        const runtime = typeof body.runtime === "string" && isRuntimeKind(body.runtime) ? body.runtime : undefined;
        if (liveStateCaptureDisabled(runtime)) {
          sendJson(request, response, config.allowedOrigins, 202, { ok: true, status: "disabled" });
          return;
        }
        const report = normalizeLiveStateReport(body);
        const result = upsertLiveStateReport(database, report);
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          status: result.status,
          report: result.report,
          ...(result.status === "ignored_stale" ? { previous: result.previous } : {})
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          status: "malformed",
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/live/state") {
      const runtime = runtimeFromQuery(url.searchParams.get("runtime"));
      const sourceSessionId = url.searchParams.get("sourceSessionId") ?? undefined;
      const reports = latestLiveStateReports(database, {
        runtime,
        sourceSessionIds: sourceSessionId ? new Set([sourceSessionId]) : undefined,
        canonicalSessionIds: url.searchParams.get("canonicalSessionId") ? new Set([url.searchParams.get("canonicalSessionId") as string]) : undefined,
        freshOnly: url.searchParams.get("freshOnly") === "1" || url.searchParams.get("freshOnly") === "true",
        limit: boundedLiveStateLimit(url.searchParams.get("limit"))
      });
      sendJson(request, response, config.allowedOrigins, 200, { ok: true, reports });
      return;
    }

    if (request.method === "GET" && url.pathname === "/projection") {
      const selectedSessionId = url.searchParams.get("selectedSessionId") || url.searchParams.get("expandedSessionId") || undefined;
      const refreshIntervalMs = parseBoardRefreshIntervalMs(url.searchParams.get("refreshIntervalMs"));
      const headlineStatus = boardHeadlineEnricher.status();
      const headlineMode = headlineStatus.enabled && headlineStatus.configured ? "llm" : "offline";
      const projectionSessionIds = latestProjectionSessionIds(state.events, selectedSessionId);
      const projectionEvents = state.events.filter((event) => event.sessionId && projectionSessionIds.has(event.sessionId));
      const projectionGitSnapshots = gitSnapshots.filter((snapshot) => projectionSessionIds.has(snapshot.sessionId));
      const liveStateReports = liveStateReportsByProjectionSession(database, projectionSessionIds);
      const projectionNow = new Date();
      const blockers = deriveLiveBlockers(projectionEvents, {
        now: projectionNow,
        maxAgeMs: approvalBlockerTtlMsForRefresh(refreshIntervalMs)
      });
      const sessionHeadlineViews = currentBoardHeadlineFrames(
        database,
        [...projectionSessionIds].map((sourceSessionId) => ({
          sessionId: canonicalSessionIdForSource(sourceSessionId, liveRuntimeForSourceSessionId(sourceSessionId)),
          sourceSessionId
        }))
      );
      const liveEnvelope = projectLiveEvents(projectionEvents, projectionGitSnapshots, {
        selectedSessionId,
        sessionEnrichments: liveProjectionEnrichments(database, projectionSessionIds),
        sessionHeadlineViews,
        sessionTranscriptFacts: liveProjectionTranscriptFacts(database, projectionSessionIds),
        liveStateReports,
        blockers,
        headlineMode,
        diagnostics: state.diagnostics.length,
        refreshIntervalMs,
        generatedAt: projectionNow.toISOString()
      });
      liveEnvelope.events = state.events.length;
      liveEnvelope.gitSnapshots = gitSnapshots.length;
      liveEnvelope.projection = await boardHeadlineEnricher.enrichProjection(liveEnvelope.projection, { refreshIntervalMs });
      liveEnvelope.projection = attachCanonicalCardIds(liveEnvelope.projection, {
        hostId: `host:${config.host}`,
        runtimeKind: defaultLiveRuntime
      });
      liveEnvelope.projection = withSessionUsageSummaries(database, liveEnvelope.projection);
      sendJson(request, response, config.allowedOrigins, 200, liveEnvelope);
      return;
    }

    if (request.method === "POST" && url.pathname === "/enrichment/rebuild") {
      try {
        const body = objectRecord(await optionalJsonBody(request));
        const result = await rebuildEnrichments(body);
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          ...result
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/logbook/summary") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        artifactSummary: getLogbookArtifactSummary(database),
        summary: getLogbookSummary(database)
      });
      return;
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/logbook/artifacts" || url.pathname === "/logbook/search")
    ) {
      const kindParam = url.searchParams.get("kind") ?? undefined;
      const kind =
        kindParam === "session_dossier" ||
        kindParam === "runbook" ||
        kindParam === "adr" ||
        kindParam === "incident_timeline"
          ? kindParam
          : undefined;
      const result = searchLogbookArtifacts(database, {
        dateFrom: url.searchParams.get("dateFrom") ?? undefined,
        dateTo: url.searchParams.get("dateTo") ?? undefined,
        kind,
        limit: Number.parseInt(url.searchParams.get("limit") || "50", 10),
        offset: Number.parseInt(url.searchParams.get("offset") || "0", 10),
        project: url.searchParams.get("project") ?? undefined,
        q: url.searchParams.get("q") ?? undefined
      });
      sendJson(request, response, config.allowedOrigins, 200, { ok: true, ...result });
      return;
    }

    const logbookArtifactMatch = url.pathname.match(/^\/logbook\/artifacts\/([^/]+)$/);
    if (request.method === "GET" && logbookArtifactMatch) {
      const artifactId = decodeURIComponent(logbookArtifactMatch[1] ?? "");
      const artifact = getLogbookArtifactDetail(database, artifactId);
      if (!artifact) {
        sendJson(request, response, config.allowedOrigins, 404, { error: "artifact_not_found", ok: false });
        return;
      }
      sendJson(request, response, config.allowedOrigins, 200, { artifact, ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/usage/summary") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        usage: getUsageStats(database, usageWindowFromUrl(url))
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mcp/status") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        status: getMcpStatus(database, config.databasePath, config.dataDirectory)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mcp/launch-config") {
      const launchConfig = getMcpLaunchConfig(config.databasePath, config.dataDirectory);
      sendJson(request, response, config.allowedOrigins, 200, {
        launchConfig,
        ok: true,
        validation: await validateMcpLaunchConfig(launchConfig, config.databasePath)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/mcp/launch-config/validate") {
      try {
        const fallback = getMcpLaunchConfig(config.databasePath, config.dataDirectory);
        const launchConfig = coerceMcpLaunchConfig(await optionalJsonBody(request), fallback);
        sendJson(request, response, config.allowedOrigins, 200, {
          launchConfig,
          ok: true,
          validation: await validateMcpLaunchConfig(launchConfig, config.databasePath)
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          error: error instanceof Error ? error.message : String(error),
          ok: false
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/mcp/test-connection") {
      try {
        const fallback = getMcpLaunchConfig(config.databasePath, config.dataDirectory);
        const launchConfig = coerceMcpLaunchConfig(await optionalJsonBody(request), fallback);
        sendJson(request, response, config.allowedOrigins, 200, {
          ok: true,
          result: await testMcpConnection(launchConfig, config.databasePath)
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          error: error instanceof Error ? error.message : String(error),
          ok: false
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/mcp/tools") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        tools: listMcpTools()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mcp/audit") {
      sendJson(request, response, config.allowedOrigins, 200, {
        audit: listMcpAuditRows(database, Number.parseInt(url.searchParams.get("limit") || "50", 10)),
        ok: true
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/settings") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        settings: await getSettingsState(database, config)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/settings/llm-provider") {
      try {
        const body = objectRecord(await optionalJsonBody(request));
        updateLlmProviderSettings(database, config, body);
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          settings: await getSettingsState(database, config)
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/settings/llm-provider/models") {
      try {
        const body = objectRecord(await optionalJsonBody(request));
        sendJson(request, response, config.allowedOrigins, 200, {
          models: await listLlmProviderModels(database, config, body),
          ok: true
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/settings/hooks") {
      sendJson(request, response, config.allowedOrigins, 200, {
        hooks: await getLiveHookSettings(database, config),
        ok: true
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/knowledge-flow/summary") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        summary: getKnowledgeFlowSummary(database)
      });
      return;
    }

    if (isWorkbenchAuthoringPath(url.pathname)) {
      let body: unknown;
      if (request.method === "POST") {
        try {
          body = await optionalJsonBody(
            request,
            getWorkbenchAuthoringBodyLimit(url.pathname, DEFAULT_BODY_LIMIT_BYTES)
          );
        } catch (error) {
          const result = authoringInvalidJsonResult(error);
          sendJson(request, response, config.allowedOrigins, result.status, result.body);
          return;
        }
      }
      const result = await routeWorkbenchAuthoringRequest(
        {
          authoringCommand,
          identity: guidedIdentity(),
          db: database
        },
        { body, headers: request.headers, method: request.method ?? "GET", url }
      );
      if (result) {
        sendJson(request, response, config.allowedOrigins, result.status, result.body);
        return;
      }
    }

    if (request.method === "GET" && url.pathname === "/workbench/sessions") {
      const limit = readWorkbenchLimit(url.searchParams.get("limit"));
      const offset = readWorkbenchOffset(url.searchParams.get("offset"));
      const scope = url.searchParams.get("scope") ?? "default";
      if (scope !== "default") {
        sendJson(request, response, config.allowedOrigins, 400, { ok: false, error: `unsupported Workbench scope: ${scope}` });
        return;
      }
      const total = countWorkbenchQueue(database);
      const states = listWorkbenchQueue(database, { limit, offset });
      const body: WorkbenchSessionsResponse = {
        ok: true,
        generatedAt: new Date().toISOString(),
        limit,
        offset,
        total,
        scope: "default",
        sessions: workbenchQueueSessionDtos(database, states)
      };
      sendJson(request, response, config.allowedOrigins, 200, body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/workbench/activity") {
      const limit = readWorkbenchLimit(url.searchParams.get("limit"));
      const sessionId = url.searchParams.get("sessionId") ?? undefined;
      const body: WorkbenchActivityResponse = {
        ok: true,
        generatedAt: new Date().toISOString(),
        limit,
        activity: listWorkbenchActivity(database, { limit, sessionId }).map(workbenchActivityDto)
      };
      sendJson(request, response, config.allowedOrigins, 200, body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/workbench/not-added-summary") {
      sendJson(request, response, config.allowedOrigins, 200, workbenchNotAddedSummary(database));
      return;
    }

    if (request.method === "GET" && url.pathname === "/workbench/import-health-summary") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        ...summarizeCurrentSessionImportHealth(database)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/workbench/not-added") {
      if (url.searchParams.get("includeDetails") !== "true") {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: "explicit includeDetails=true is required for Not Added inspection"
        });
        return;
      }
      const limit = readWorkbenchLimit(url.searchParams.get("limit"));
      sendJson(request, response, config.allowedOrigins, 200, workbenchNotAddedDetails(database, limit));
      return;
    }

    if (request.method === "POST" && url.pathname === "/workbench/enroll-missing") {
      const body = objectRecord(await optionalJsonBody(request));
      const actor = {
        kind: "user" as const,
        id: typeof body.actorId === "string" && body.actorId.trim() ? body.actorId.trim() : "workbench_ui"
      };
      const limit =
        typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : undefined;
      const result = reconcileMissingImportedWorkbenchSessions(database, { actor, limit });
      const responseBody: WorkbenchEnrollMissingResponse = {
        ok: true,
        enrolled: result.enrolled,
        heldForImportRepair: result.heldForImportRepair,
        skippedExisting: result.skippedExisting,
        enrolledSessionIds: result.enrolledSessionIds,
        limit: result.limit,
        generatedAt: new Date().toISOString()
      };
      sendJson(request, response, config.allowedOrigins, 200, responseBody);
      return;
    }

    const workbenchClaimMatch = url.pathname.match(/^\/workbench\/sessions\/([^/]+)\/claim$/);
    if (request.method === "POST" && workbenchClaimMatch?.[1]) {
      const sessionId = decodeURIComponent(workbenchClaimMatch[1]);
      const body = objectRecord(await optionalJsonBody(request));
      const claimedBy = typeof body.claimedBy === "string" && body.claimedBy.trim() ? body.claimedBy.trim() : "workbench_ui";
      const ttlSecondsRaw = body.ttlSeconds;
      const ttlSeconds =
        typeof ttlSecondsRaw === "number" && Number.isFinite(ttlSecondsRaw) && ttlSecondsRaw > 0
          ? Math.floor(ttlSecondsRaw)
          : 900;
      const result = claimWorkbenchSessions(database, {
        claimedBy,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        sessionIds: [sessionId]
      });
      sendJson(request, response, config.allowedOrigins, 200, { ok: true, ...result });
      return;
    }

    const workbenchReleaseMatch = url.pathname.match(/^\/workbench\/claims\/([^/]+)\/release$/);
    if (request.method === "POST" && workbenchReleaseMatch?.[1]) {
      const claimId = decodeURIComponent(workbenchReleaseMatch[1]);
      const body = objectRecord(await optionalJsonBody(request));
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "released";
      const claim = releaseWorkbenchClaim(database, { claimId, reason });
      if (!claim) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, code: "claim_not_found", claimId });
        return;
      }
      sendJson(request, response, config.allowedOrigins, 200, { ok: true, claim });
      return;
    }

    const workbenchQualityMatch = url.pathname.match(/^\/workbench\/sessions\/([^/]+)\/quality$/);
    if (request.method === "POST" && workbenchQualityMatch?.[1]) {
      const sessionId = decodeURIComponent(workbenchQualityMatch[1]);
      const body = objectRecord(await optionalJsonBody(request));
      const actor = {
        kind: "user" as const,
        id: typeof body.actorId === "string" && body.actorId.trim() ? body.actorId.trim() : "workbench_ui"
      };
      try {
        if (body.mode === "precheck") {
          const precheck = runCaptureQualityPrecheck(database, sessionId);
          const currentState = readWorkbenchSessionState(database, sessionId);
          if (
            currentState?.publicationStatus === "not_added_to_logbook" &&
            currentState.qualityDecisionSource === "user"
          ) {
            sendJson(request, response, config.allowedOrigins, 200, {
              ok: precheck.disposition !== "suppress",
              precheck,
              state: currentState
            });
            return;
          }
          const result =
            precheck.disposition === "review"
              ? markWorkbenchQualityForReview(database, {
                  actor,
                  evidenceRevision: authoringEvidenceRevision(database, [sessionId]),
                  sessionId
                })
              : markWorkbenchQuality(database, {
                  actor,
                  evidenceRevision: authoringEvidenceRevision(database, [sessionId]),
                  qualityDecisionSource: "automatic",
                  reason: precheck.reason,
                  sessionId,
                  status: precheck.disposition === "keep" ? "passed" : "failed",
                  suppressionCategory: precheck.disposition === "suppress" ? "confirmed_noise" : undefined
                });
          sendJson(request, response, config.allowedOrigins, 200, {
            ok: precheck.disposition !== "suppress",
            activity: result.activity,
            precheck,
            state: result.state
          });
          return;
        }

        const status = body.status;
        if (status !== "passed" && status !== "failed") {
          sendJson(request, response, config.allowedOrigins, 400, {
            ok: false,
            code: "invalid_quality_request",
            error: 'body must include status "passed"|"failed" or mode "precheck"'
          });
          return;
        }
        const reason = typeof body.reason === "string" ? body.reason : undefined;
        const result = markWorkbenchQuality(database, { actor, reason, sessionId, status });
        sendJson(request, response, config.allowedOrigins, 200, { ok: true, ...result });
        return;
      } catch (error) {
        if (error instanceof Error && error.message === "cannot_fail_quality_on_published_session") {
          sendJson(request, response, config.allowedOrigins, 409, {
            ok: false,
            code: "cannot_fail_quality_on_published_session",
            error: error.message,
            sessionId
          });
          return;
        }
        throw error;
      }
    }

    const workbenchTranscriptMatch = url.pathname.match(/^\/workbench\/sessions\/([^/]+)\/(check-transcript|import-transcript-preview|import-transcript)$/);
    if (request.method === "POST" && workbenchTranscriptMatch?.[1] && workbenchTranscriptMatch[2]) {
      const sessionId = decodeURIComponent(workbenchTranscriptMatch[1]);
      const action = workbenchTranscriptMatch[2];
      const body = action === "check-transcript" ? {} : objectRecord(await optionalJsonBody(request));
      const sourceId = typeof body.sourceId === "string" ? body.sourceId : undefined;
      const actor = { kind: "agent" as const, id: "workbench_api" };
      if (action === "check-transcript") {
        const result = checkWorkbenchTranscript(database, { actor, sessionId });
        sendJson(request, response, config.allowedOrigins, result.ok ? 200 : 409, result);
        return;
      }
      if (action === "import-transcript-preview") {
        const result = previewWorkbenchTranscriptImport(database, { actor, sessionId, sourceId });
        sendJson(request, response, config.allowedOrigins, result.ok ? 200 : 409, result);
        return;
      }
      const result = createWorkbenchTranscriptImport(database, { actor, sessionId, sourceId });
      if (!result.ok) {
        sendJson(request, response, config.allowedOrigins, 409, result);
        return;
      }
      const source = (await discoverAllSourcesAndPersist()).find((candidate) => candidate.sourceId === result.sourceId);
      if (!source) {
        sendJson(request, response, config.allowedOrigins, 409, { ok: false, code: "source_required", sessionId, sourceId: result.sourceId });
        return;
      }
      const job = queueImportJob(database, { importKind: "transcript", sourceId: source.sourceId }, (controls) =>
        importTranscriptSourcesWithLedger([source], controls, defaultTranscriptImportScope())
      );
      recordWorkbenchActivity(database, {
        actor,
        details: { importJobId: job.importJobId, sourceId: source.sourceId },
        eventType: "transcript_import_queued",
        sessionId,
        summary: "Transcript import queued"
      });
      sendJson(request, response, config.allowedOrigins, 202, { ...result, importJob: job });
      return;
    }

    if (request.method === "GET" && url.pathname === "/workbench/missing-sessions") {
      const limit = readWorkbenchLimit(url.searchParams.get("limit"));
      const sessions: WorkbenchMissingSessionDto[] = queueWorkbenchSessions(database, {
        kind: "session_enrichment",
        limit,
        scope: "missing"
      }).map((session) => ({
        enrichmentStatus: mapWorkbenchMissingSessionStatus(session.status),
        lastActivityAt: session.lastActivityAt,
        lifecycle: session.lifecycle,
        project: session.project,
        runtime: session.runtime,
        sessionId: session.sessionId,
        title: session.title
      }));
      const body: WorkbenchMissingSessionsResponse = {
        ok: true,
        generatedAt: new Date().toISOString(),
        limit,
        sessions
      };
      sendJson(request, response, config.allowedOrigins, 200, body);
      return;
    }


    const runtimeHookSettingsMatch = url.pathname.match(/^\/settings\/hooks\/([^/]+)(?:\/(install|uninstall|test))?$/);
    if (runtimeHookSettingsMatch) {
      const runtime = decodeURIComponent(runtimeHookSettingsMatch[1] ?? "");
      const action = runtimeHookSettingsMatch[2];
      if (!isLiveConnectorRuntime(runtime)) {
        sendJson(request, response, config.allowedOrigins, 404, {
          ok: false,
          error: "live connector runtime not found"
        });
        return;
      }

      if (!action && request.method === "GET") {
        sendJson(request, response, config.allowedOrigins, 200, {
          hooks: await getRuntimeHookSettings(database, config, runtime),
          ok: true
        });
        return;
      }

      if (request.method === "POST" && action === "install") {
        try {
          sendJson(request, response, config.allowedOrigins, 202, {
            hooks: await installRuntimeHooks(database, config, runtime),
            ok: true
          });
        } catch (error) {
          sendJson(request, response, config.allowedOrigins, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }

      if (request.method === "POST" && action === "uninstall") {
        try {
          sendJson(request, response, config.allowedOrigins, 202, {
            hooks: await uninstallRuntimeHooks(database, config, runtime),
            ok: true
          });
        } catch (error) {
          sendJson(request, response, config.allowedOrigins, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }

      if (request.method === "POST" && action === "test") {
        sendJson(request, response, config.allowedOrigins, 202, {
          hooks: await testRuntimeHooks(database, config, runtime),
          ok: true
        });
        return;
      }
    }

    if (request.method === "GET" && url.pathname === "/sessions") {
      const result = querySessions(database, sessionQueryFromUrl(url));
      sendJson(request, response, config.allowedOrigins, 200, { ok: true, ...result });
      return;
    }

    const sessionExcerptsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/excerpts$/);
    if (request.method === "GET" && sessionExcerptsMatch?.[1]) {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        excerpts: getSessionExcerpts(database, decodeURIComponent(sessionExcerptsMatch[1]), {
          limit: Number.parseInt(url.searchParams.get("limit") || "8", 10),
          query: url.searchParams.get("q") ?? undefined
        })
      });
      return;
    }

    const sessionDossierMatch = url.pathname.match(/^\/sessions\/([^/]+)\/dossier$/);
    if (request.method === "GET" && sessionDossierMatch?.[1]) {
      const sessionId = decodeURIComponent(sessionDossierMatch[1]);
      if (!workbenchSessionIsPublished(database, sessionId)) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "session not found" });
        return;
      }
      const dossier = getSessionDossier(database, sessionId);
      sendJson(
        request,
        response,
        config.allowedOrigins,
        dossier ? 200 : 404,
        dossier ? { ok: true, dossier: dossierWithManualEnrichmentState(dossier, sessionId) } : { ok: false, error: "session not found" }
      );
      return;
    }

    const sessionDossierEnrichMatch = url.pathname.match(/^\/sessions\/([^/]+)\/dossier\/enrich$/);
    if (request.method === "POST" && sessionDossierEnrichMatch?.[1]) {
      request.resume();
      const sessionId = decodeURIComponent(sessionDossierEnrichMatch[1]);
      if (!sessionExists(database, sessionId)) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "session not found" });
        return;
      }

      const activeJob = manualDossierEnrichmentJobs.get(sessionId);
      if (activeJob?.status === "enriching") {
        sendJson(request, response, config.allowedOrigins, 202, { ok: true, enrichment: activeJob });
        return;
      }

      const job: SessionDossierManualEnrichmentJob = {
        requestedAt: new Date().toISOString(),
        status: "enriching"
      };
      manualDossierEnrichmentJobs.set(sessionId, job);
      setImmediate(() => {
        void runManualDossierEnrichment(sessionId);
      });
      sendJson(request, response, config.allowedOrigins, 202, { ok: true, enrichment: job });
      return;
    }

    const sessionTranscriptMatch = url.pathname.match(/^\/sessions\/([^/]+)\/transcript$/);
    if (request.method === "GET" && sessionTranscriptMatch?.[1]) {
      const sessionId = decodeURIComponent(sessionTranscriptMatch[1]);
      if (!workbenchSessionIsPublished(database, sessionId)) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "session not found" });
        return;
      }
      await catchUpSessionTranscriptIfApproved(sessionId);
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        ...getSessionTranscript(database, {
          cursor: url.searchParams.get("cursor") ?? undefined,
          kind: transcriptKindFromUrl(url),
          limit: Number.parseInt(url.searchParams.get("limit") || "100", 10),
          q: url.searchParams.get("q") ?? undefined,
          sessionId
        })
      });
      return;
    }

    const sessionLiveExplainMatch = url.pathname.match(/^\/sessions\/([^/]+)\/live-explain$/);
    if (request.method === "GET" && sessionLiveExplainMatch?.[1]) {
      const sessionId = decodeURIComponent(sessionLiveExplainMatch[1]);
      const explain = liveExplainForSession(database, state.events, sessionId);
      sendJson(
        request,
        response,
        config.allowedOrigins,
        explain ? 200 : 404,
        explain ?? { ok: false, error: "session not found" }
      );
      return;
    }

    const sessionDetailMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (request.method === "GET" && sessionDetailMatch?.[1]) {
      const session = getSessionDetail(database, decodeURIComponent(sessionDetailMatch[1]));
      sendJson(
        request,
        response,
        config.allowedOrigins,
        session ? 200 : 404,
        session ? { ok: true, session } : { ok: false, error: "session not found" }
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/projects") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        projects: listProjects(database)
      });
      return;
    }

    if ((request.method === "POST" || request.method === "GET") && url.pathname === "/refresh") {
      refreshVolatileStateFromRawRecords();
      const refreshed = await refreshKnownGitSnapshotsSingleFlight();
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        refreshed,
        gitSnapshots: gitSnapshots.length,
        events: state.events.length
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/imports") {
      const limit = parseBoundedInteger(url.searchParams.get("limit"), 50, 1, 200);
      const offset = parseBoundedInteger(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
      const adapterId = url.searchParams.get("adapterId");
      const status = url.searchParams.get("status");
      if (!limit.ok) {
        sendJson(request, response, config.allowedOrigins, 400, { ok: false, error: "invalid_limit" });
        return;
      }
      if (!offset.ok) {
        sendJson(request, response, config.allowedOrigins, 400, { ok: false, error: "invalid_offset" });
        return;
      }
      if (adapterId && !(ALL_RUNTIME_KINDS as readonly string[]).includes(adapterId)) {
        sendJson(request, response, config.allowedOrigins, 400, { ok: false, error: "invalid_adapter" });
        return;
      }
      if (status && !isImportJobListStatus(status)) {
        sendJson(request, response, config.allowedOrigins, 400, { ok: false, error: "invalid_status" });
        return;
      }
      const page = listImportJobPage(database, {
        adapterId: adapterId ? (adapterId as RuntimeKind) : undefined,
        limit: limit.value,
        offset: offset.value,
        sourceId: url.searchParams.get("sourceId") ?? undefined,
        status: status ? (status as ImportJobListStatus) : undefined
      });
      sendJson(request, response, config.allowedOrigins, 200, {
        ...page,
        jobs: page.jobs,
        ok: true,
        imports: page.jobs
      });
      return;
    }

    if (request.method === "POST" && (url.pathname === "/imports/repair/preview" || url.pathname === "/imports/repair/apply")) {
      try {
        const body = JSON.parse(await readBody(request)) as { importJobIds?: unknown; planHash?: unknown; databasePath?: unknown; db?: unknown };
        if (body.databasePath !== undefined || body.db !== undefined) throw new Error("database path is not accepted");
        if (!Array.isArray(body.importJobIds) || !body.importJobIds.every((value) => typeof value === "string")) {
          throw new Error("importJobIds must be an array of strings");
        }
        const viability = await repairSourceMappings(body.importJobIds);
        if (url.pathname.endsWith("/preview")) {
          const preview = previewImportRepair(database, { importJobIds: body.importJobIds, sourceMappings: viability.mappings });
          sendJson(request, response, config.allowedOrigins, 200, { ok: true, preview });
          return;
        }
        if (typeof body.planHash !== "string" || !/^[a-f0-9]{64}$/.test(body.planHash)) throw new Error("valid planHash is required");
        const staged = new Map<string, { plan: ImportRepairJobPlan; source: DiscoveredSource }>();
        const receipt = applyImportRepair(database, {
          importJobIds: body.importJobIds,
          planHash: body.planHash,
          sourceMappings: viability.mappings,
          stageReimports: (jobPlans) => jobPlans.map((plan, index) => {
            const source = viability.discoveredBySourceId.get(plan.originalSourceId)!;
            const updatedAt = new Date(Date.now() + index).toISOString();
            database.prepare(`INSERT INTO ingest_sources(source_id, adapter, source_kind, source_path, endpoint, schema_version,
                runtime_version, confidence, discovered_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(source_id) DO UPDATE SET
                adapter = excluded.adapter,
                source_kind = excluded.source_kind,
                source_path = excluded.source_path,
                endpoint = excluded.endpoint,
                schema_version = excluded.schema_version,
                runtime_version = excluded.runtime_version,
                confidence = excluded.confidence,
                last_seen_at = excluded.last_seen_at`)
              .run(source.sourceId, source.runtime, source.sourceKind, source.path ?? null, source.endpoint ?? null,
                source.schemaVersion ?? null, source.runtimeVersion ?? null, source.confidence, updatedAt, updatedAt);
            const job = createImportJob(database, { importKind: plan.importKind, sourceId: plan.correctedSourceId!, updatedAt });
            updateImportJob(database, job.importJobId, { scope: plan.scope, updatedAt });
            staged.set(job.importJobId, { plan, source });
            return job.importJobId;
          })
        });
        const jobs: ImportJobDto[] = [];
        for (const importJobId of receipt.reimportJobIds) {
          const spec = staged.get(importJobId)!;
          jobs.push(resumeImportJob(database, importJobId, (controls) =>
            runImportWorkerForSource(spec.plan.importKind, spec.source, controls, spec.plan.scope ?? defaultTranscriptImportScope())
          ));
        }
        sendJson(request, response, config.allowedOrigins, 202, {
          jobs,
          ok: true,
          receipt,
          reimportJobIds: receipt.reimportJobIds
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const conflict = message.includes("repair plan changed") || message.includes("published artifacts block repair");
        sendJson(request, response, config.allowedOrigins, conflict ? 409 : 400, { ok: false, error: message });
      }
      return;
    }

    const importUnitsMatch = url.pathname.match(/^\/imports\/([^/]+)\/units$/);
    const importReportMatch = url.pathname.match(/^\/imports\/([^/]+)\/report$/);
    const importMatch = url.pathname.match(/^\/imports\/([^/]+)(?:\/(cancel|retry))?$/);
    const encodedImportJobId = importUnitsMatch?.[1] ?? importReportMatch?.[1] ?? importMatch?.[1];
    const decodedImportJobId = encodedImportJobId ? decodeRouteSegment(encodedImportJobId) : undefined;
    if (decodedImportJobId && !decodedImportJobId.ok) {
      sendJson(request, response, config.allowedOrigins, 400, { ok: false, error: "invalid_import_id" });
      return;
    }
    const importJobId = decodedImportJobId?.value;

    if (request.method === "GET" && importUnitsMatch?.[1]) {
      const limit = parseBoundedInteger(url.searchParams.get("limit"), 100, 1, 500);
      const offset = parseBoundedInteger(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
      const status = url.searchParams.get("status");
      if (!limit.ok || !offset.ok) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: "invalid_pagination"
        });
        return;
      }
      const units = listImportWorkUnits(database, {
        importJobId: importJobId!,
        limit: limit.value,
        offset: offset.value,
        status: isImportWorkUnitStatus(status) ? status : undefined
      });
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        limit: limit.value,
        offset: offset.value,
        units
      });
      return;
    }

    if (request.method === "GET" && importReportMatch?.[1]) {
      const job = getImportJob(database, importJobId!);
      sendJson(
        request,
        response,
        config.allowedOrigins,
        job ? 200 : 404,
        job ? { ok: true, report: job.completionReport } : { ok: false, error: "import not found" }
      );
      return;
    }

    if (request.method === "GET" && importMatch?.[1] && !importMatch[2]) {
      const job = getImportJob(database, importJobId!);
      sendJson(request, response, config.allowedOrigins, job ? 200 : 404, job ? { ok: true, job } : { ok: false, error: "import not found" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/imports") {
      try {
        const body = JSON.parse(await readBody(request)) as { sourceId?: string; kind?: string };
        if (!body.sourceId || !isImportJobKind(body.kind)) throw new Error("sourceId and kind are required");
        const source = await sourceById(body.sourceId);
        if (!source) throw new Error(`Unknown source: ${body.sourceId}`);
        if (body.kind === "transcript" && !sourcePolicyExplicitlyEnabled(database, "transcript_import", source.sourceId)) {
          sendJson(request, response, config.allowedOrigins, 409, {
            ok: false,
            error: "Transcript import requires source-scoped Workbench approval."
          });
          return;
        }
        const job = queueImportJob(database, { importKind: body.kind, sourceId: source.sourceId }, (controls) =>
          runImportWorkerForSource(body.kind as ImportJobKind, source, controls)
        );
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          importJobId: job.importJobId,
          job
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && importMatch?.[1] && importMatch[2] === "cancel") {
      try {
        const job = cancelImportJob(database, importJobId!);
        sendJson(request, response, config.allowedOrigins, 202, { ok: true, job });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 404, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && importMatch?.[1] && importMatch[2] === "retry") {
      const existing = getImportJob(database, importJobId!);
      if (!existing) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "import not found" });
        return;
      }
      const source = await sourceById(existing.sourceId);
      if (!source) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "source not found" });
        return;
      }
      const job = resumeImportJob(
        database,
        existing.importJobId,
        (controls) => runImportWorkerForSource(existing.importKind, source, controls, existing.scope ?? defaultTranscriptImportScope())
      );
      sendJson(request, response, config.allowedOrigins, 202, { ok: true, importJobId: job.importJobId, job });
      return;
    }

    const sourcePolicyMatch = url.pathname.match(/^\/sources\/([^/]+)\/policies$/);
    if (request.method === "PUT" && sourcePolicyMatch?.[1]) {
      try {
        const sourceId = decodeURIComponent(sourcePolicyMatch[1]);
        const body = JSON.parse(await readBody(request)) as { policyKind?: string; enabled?: unknown; reason?: string };
        if (!isSourcePolicyKind(body.policyKind) || typeof body.enabled !== "boolean") throw new Error("policyKind and enabled are required");
        setSourcePolicy(database, {
          decidedAt: new Date().toISOString(),
          enabled: body.enabled,
          policyKind: body.policyKind,
          reason: body.reason,
          sourceId
        });
        sendJson(request, response, config.allowedOrigins, 202, { ok: true });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/connect") {
      try {
        const body = JSON.parse(await readBody(request)) as ConnectSourcesRequest;
        const scan = latestScan ?? (await scanSourcesAndPersist());
        const result = connectSelectedSources(database, scan, body, async (kind, runtime, sources, controls) => {
          return runImportWorkerForSources(
            kind,
            runtime,
            sources,
            controls,
            body.importScope ?? defaultTranscriptImportScope(),
            body.queueEnrichment === true
          );
        });
        recordRuntimeDiagnostic({
          details: {
            importMetadata: body.importMetadata,
            queueEnrichment: body.queueEnrichment,
            queued: result.jobs.length,
            runtimes: body.runtimes,
            scanId: scan.scanId,
            skipped: result.skipped
          },
          kind: "sources_connect_queued",
          message: `Sources connect queued ${result.jobs.length} import jobs`,
          severity: result.jobs.length > 100 ? "warning" : "info"
        });
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          jobs: result.jobs,
          queued: result.jobs.length,
          skipped: result.skipped
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/review-dispositions") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        dispositions: listReviewDispositions(database)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/review-dispositions") {
      try {
        const disposition = JSON.parse(await readBody(request));
        assertReviewDisposition(disposition);
        upsertReviewDisposition(database, disposition);
        sendJson(request, response, config.allowedOrigins, 202, { ok: true, disposition });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/data/revisions") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        ...getDataRevisions(database)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/data/summary") {
      let scope: DeleteMastheadDataScope;
      try {
        scope = deleteScopeFromUrl(url);
        const requestedDatabaseId = url.searchParams.get("databaseId");
        if (requestedDatabaseId) assertDatabaseIdMatches(requestedDatabaseId, database, config);
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        summary: getDataSummary(database, scope)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/data/export") {
      try {
        const parsed = objectRecord(await optionalJsonBody(request));
        assertDatabaseIdMatches(stringRecordValue(parsed, "databaseId"), database, config);
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        export: exportSessionGraph(database)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/data/delete") {
      try {
        const parsed = objectRecord(await optionalJsonBody(request));
        assertDatabaseIdMatches(stringRecordValue(parsed, "databaseId"), database, config);
        const scope = deleteScopeFromBody(parsed);
        const { legacy, preview, result } = await withDeferredLiveIngestBarrierForDestructiveMutation(async () => {
          const preview = getDataSummary(database, scope);
          const sourceSessionIds =
            scope.kind === "all" || scope.kind === "raw_payloads" ? undefined : sourceSessionIdsForScope(scope);
          const result = deleteMastheadData(database, scope);
          const legacy =
            scope.kind === "all"
              ? await clearVolatileAndLegacyCompatibilityState()
              : scope.kind === "raw_payloads"
                ? await clearRawSourceCopies()
                : await clearLiveStateForScope(scope, sourceSessionIds ?? new Set());
          return { legacy, preview, result };
        });
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          preview,
          result,
          legacy,
          summary: getDataSummary(database),
          events: state.events.length,
          gitSnapshots: gitSnapshots.length
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, isDeleteScopeClientError(error) ? 400 : 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/data/retention/default") {
      try {
        const parsed = objectRecord(await optionalJsonBody(request));
        assertDatabaseIdMatches(stringRecordValue(parsed, "databaseId"), database, config);
        const { legacy, preview, result } = await withDeferredLiveIngestBarrierForDestructiveMutation(async () => {
          const preview = getDataSummary(database);
          const result = applyDefaultRetention(database);
          const legacy = await clearRawSourceCopies();
          return { legacy, preview, result };
        });
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          legacy,
          preview,
          result,
          summary: getDataSummary(database)
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, isDeleteScopeClientError(error) ? 400 : 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/retention") {
      try {
        const parsed = objectRecord(await optionalJsonBody(request));
        assertDatabaseIdMatches(stringRecordValue(parsed, "databaseId"), database, config);
        const policy = validateRetentionPolicy(parsed.policy ?? parsed);
        const result = await withDeferredLiveIngestBarrierForDestructiveMutation(async () => {
          const legacy = await store.pruneLocalData(policy);
          const hook = pruneLiveRawJournals(policy);
          const observer = observerRawJournal.pruneStoreRecords(policy);
          const result = {
            removedRecords: legacy.removedRecords + hook.removedRecords + observer.removedRecords,
            removedRecordIds: [...legacy.removedRecordIds, ...hook.removedRecordIds, ...observer.removedRecordIds],
            removedByType: {
              attention_item:
                (legacy.removedByType.attention_item ?? 0) + (hook.removedByType.attention_item ?? 0) + (observer.removedByType.attention_item ?? 0),
              conflict_card:
                (legacy.removedByType.conflict_card ?? 0) + (hook.removedByType.conflict_card ?? 0) + (observer.removedByType.conflict_card ?? 0),
              event: (legacy.removedByType.event ?? 0) + (hook.removedByType.event ?? 0) + (observer.removedByType.event ?? 0),
              git_snapshot:
                (legacy.removedByType.git_snapshot ?? 0) + (hook.removedByType.git_snapshot ?? 0) + (observer.removedByType.git_snapshot ?? 0),
              review_disposition:
                (legacy.removedByType.review_disposition ?? 0) +
                (hook.removedByType.review_disposition ?? 0) +
                (observer.removedByType.review_disposition ?? 0)
            },
            retainedRecords: legacy.retainedRecords + hook.retainedRecords + observer.retainedRecords,
            touchedExternalState: false
          };
          refreshVolatileStateFromRawRecords();
          return result;
        });
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          result,
          events: state.events.length,
          gitSnapshots: gitSnapshots.length
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/clear") {
      try {
        const parsed = objectRecord(await optionalJsonBody(request));
        assertDatabaseIdMatches(stringRecordValue(parsed, "databaseId"), database, config);
        const { canonical, result } = await withDeferredLiveIngestBarrierForDestructiveMutation(async () => {
          const result = await clearVolatileAndLegacyCompatibilityState();
          const canonical = deleteAllMastheadData(database);
          return { canonical, result };
        });
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          result,
          canonical,
          events: state.events.length,
          gitSnapshots: gitSnapshots.length
        });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    const adapterImportMatch = url.pathname.match(/^\/adapters\/([^/]+)\/(import-metadata|sync)$/);
    if (request.method === "POST" && adapterImportMatch?.[1] && adapterImportMatch[2]) {
      const runtime = decodeURIComponent(adapterImportMatch[1]);
      if (!isRuntimeKind(runtime) || !adapterForRuntime(runtime)) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: `Unsupported adapter runtime: ${runtime}` });
        return;
      }
      const action = adapterImportMatch[2];
      if (action === "import-metadata") {
        const queued = await queueAdapterMetadataImports(runtime);
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          imported: 0,
          jobs: queued.jobs,
          queued: queued.jobs.length,
          sources: queued.sources
        });
        return;
      }
      const metadata = await queueAdapterMetadataImports(runtime);
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        imported: 0,
        jobs: metadata.jobs,
        metadataJobs: metadata.jobs,
        queued: metadata.jobs.length,
        skipped: 0,
        sources: metadata.sources,
        transcriptJobs: []
      });
      return;
    }


    if (request.method === "POST" && url.pathname === "/sources/exclusions") {
      try {
        const body = JSON.parse(await readBody(request)) as {
          exclusionKind?: "source" | "project" | "path";
          pattern?: string;
          reason?: string;
        };
        if (!body.exclusionKind || !body.pattern) throw new Error("exclusionKind and pattern are required");
        addSourceExclusion(database, {
          createdAt: new Date().toISOString(),
          exclusionKind: body.exclusionKind,
          pattern: body.pattern,
          reason: body.reason ?? "Excluded from transcript ingestion."
        });
        sendJson(request, response, config.allowedOrigins, 202, { ok: true });
      } catch (error) {
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }


    if (request.method === "POST" && url.pathname === "/ingest") {
      const requestDestructiveMutationEpoch = destructiveMutationEpoch;
      const body = await readBody(request, INGEST_BODY_LIMIT_BYTES);
      const receivedAt = new Date().toISOString();
      const runtime = liveRuntimeFromIngestRequest(url, request);
      if (!runtime) {
        const diagnostic: LiveHookDiagnostic = {
          code: "unsupported_runtime",
          message: "Unsupported live hook runtime.",
          receivedAt
        };
        state.diagnostics.push(diagnostic);
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          status: "malformed",
          diagnostic,
          events: state.events.length
        });
        return;
      }
      const adapterRecord = adapterRecordFromLiveHook(body, receivedAt, runtime);
      const event = adapterRecord.normalized.value as NormalizedEvent | undefined;
      const liveStateReportInput = liveStateInputFromRawHook(body, { receivedAt, runtime });

      if (requestDestructiveMutationEpoch !== destructiveMutationEpoch) {
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          status: "stale",
          event,
          gitSnapshots: gitSnapshots.length,
          events: state.events.length
        });
        return;
      }
      if (!event) {
        const diagnostic = toLiveHookDiagnostic(adapterRecord.diagnostics[0], receivedAt);
        state.diagnostics.push(diagnostic);
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          status: "malformed",
          diagnostic,
          events: state.events.length
        });
        return;
      }
      recordLiveHookRuntimeDiagnostics(event);
      if (isLiveIngestValidationRequest(url)) {
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          status: "accepted",
          validationOnly: true,
          event,
          gitSnapshots: gitSnapshots.length,
          events: state.events.length
        });
        return;
      }
      if (destructiveDeferredLiveIngestBarrier) await waitForDeferredLiveIngestDestructiveBarrier();
      if (requestDestructiveMutationEpoch !== destructiveMutationEpoch) {
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          status: "stale",
          event,
          gitSnapshots: gitSnapshots.length,
          events: state.events.length
        });
        return;
      }
      const result = ingestNormalizedEvent(event, state);

      if (result.status === "accepted") {
        if (eventLiveProcessingMode(result.event) === "deferred") {
          removeEventFromLiveProjectionState(state, result.event);
          persistHookLiveStateReport(database, liveStateReportInput);
          deferredLiveIngestQueue.enqueue(result.event);
        } else {
          scheduleImmediateLiveIngestPersistence(result.event, liveStateReportInput);
        }
      }

      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        status: result.status,
        event: result.event,
        gitSnapshots: gitSnapshots.length,
        events: state.events.length
      });
      return;
    }

    sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "not found" });
  }

  const gitRefreshTimer =
    config.gitRefreshMs > 0
      ? setInterval(() => {
          void refreshKnownGitSnapshotsSingleFlight();
        }, config.gitRefreshMs).unref()
      : undefined;

  return {
    server,
    database,
    startBackgroundHydration,
    waitForBackgroundHydration: () => hydrationPromise,
    close: () => {
      if (closePromise) return closePromise;
      closed = true;
      queuedEnrichmentSessionIds.clear();
      enrichmentQueueScheduled = false;
      queuedSearchIndexSessionIds.clear();
      searchIndexQueueScheduled = false;
      closePromise = (async () => {
        let instanceManifestPublicationError: unknown;
        try {
          await instanceManifestPublishPromise;
        } catch (error) {
          instanceManifestPublicationError = error;
          recordRuntimeDiagnostic({
            details: { error, instanceManifestPath },
            kind: "instance_manifest_publication_failed",
            message: "Daemon instance manifest publication failed before shutdown.",
            severity: "warning"
          });
        }
        await hydrationPromise;
        if (gitRefreshTimer) clearInterval(gitRefreshTimer);
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        await removeOwnedMastheadInstanceManifest(instanceManifestPath, daemonInstanceId).catch((error) => {
          recordRuntimeDiagnostic({
            details: { error, instanceManifestPath },
            kind: "instance_manifest_cleanup_failed",
            message: "Daemon could not remove its owned instance manifest.",
            severity: "warning"
          });
        });
        await instanceManifestGuard?.release().catch((error) => {
          recordRuntimeDiagnostic({
            details: { error, guardPath: instanceManifestGuard?.guardPath },
            kind: "instance_manifest_guard_release_failed",
            message: "Daemon could not release its instance manifest writer guard.",
            severity: "warning"
          });
        });
        instanceManifestGuard = undefined;
        let gitRefreshError: unknown;
        try {
          await (gitRefreshPromise ?? activeGitRefreshWorkPromise);
        } catch (error) {
          gitRefreshError = error;
        }
        let deferredQueueError: unknown;
        try {
          await immediateLiveIngestPersistence;
          await deferredLiveIngestQueue.close();
        } catch (error) {
          deferredQueueError = error;
        } finally {
          try {
            checkpointMastheadDatabase(database);
          } catch (error) {
            console.error("[masthead] WAL checkpoint failed during shutdown", error);
          } finally {
            closeDatabase(database);
            try {
              await legacyDataDirectoryGuard?.release();
            } finally {
              await writerLock.release();
            }
          }
        }
        if (instanceManifestPublicationError) throw instanceManifestPublicationError;
        if (gitRefreshError) throw gitRefreshError;
        if (deferredQueueError) throw deferredQueueError;
      })();
      return closePromise;
    },
    instanceIdentity,
    publishInstanceManifest
  };
  } catch (error) {
    database.close();
    throw error;
  }
  } catch (error) {
    try {
      await legacyDataDirectoryGuard?.release();
    } finally {
      await writerLock.release();
    }
    throw error;
  }
}

function metadataMatchesWhenAvailable(stored: string | null, discovered: string | undefined): boolean {
  return !stored || !discovered || stored === discovered;
}

function closeDatabase(database: MastheadDatabase): void {
  try {
    database.close();
  } catch (error) {
    if (!isErrno(error, "ERR_INVALID_STATE")) throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function pathnameForRequest(request: IncomingMessage, config: DaemonConfig): string {
  try {
    return new URL(request.url || "/", `http://${config.host}:${config.port}`).pathname;
  } catch {
    return request.url || "/";
  }
}

function boundPort(server: Server, fallback: number): number {
  const address = server.address();
  return typeof address === "object" && address ? address.port : fallback;
}

async function backupDatabaseBeforeMigration(databasePath: string): Promise<void> {
  try {
    const info = await stat(databasePath);
    if (!info.isFile() || info.size === 0) return;
  } catch {
    return;
  }

  await createVerifiedMigrationBackupInsideDaemonStartup(databasePath);
}


function readBody(request: IncomingMessage, limitBytes = DEFAULT_BODY_LIMIT_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      body = "";
      reject(error);
    };
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > limitBytes) {
        rejectOnce(clientError(`Request body exceeds ${limitBytes} bytes.`));
        request.resume();
        return;
      }
      body += chunk;
    });
    request.once("error", (error) => rejectOnce(error));
    request.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(body);
    });

    const contentLength = request.headers["content-length"];
    if (typeof contentLength === "string" && Number(contentLength) > limitBytes) {
      rejectOnce(clientError(`Request body exceeds ${limitBytes} bytes.`));
      request.resume();
    }
  });
}

async function optionalJsonBody(request: IncomingMessage, limitBytes = DEFAULT_BODY_LIMIT_BYTES): Promise<unknown> {
  const body = (await readBody(request, limitBytes)).trim();
  return body ? JSON.parse(body) : undefined;
}

function selectEnrichmentRebuildSessionIds(
  db: MastheadDatabase,
  input: Record<string, unknown>,
  limit: number
): string[] {
  const scope = typeof input.scope === "string" ? input.scope : input.recent ? "recent" : "recent";
  const baseSelect = `SELECT sessions.session_id AS sessionId
    FROM sessions
    JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id`;
  const orderLimit = "AND sessions.deleted_at IS NULL ORDER BY COALESCE(sessions.last_activity_at, sessions.updated_at, sessions.created_at, '') DESC LIMIT ?";
  if (scope === "all" || scope === "recent") {
    return (
      db.prepare(`${baseSelect} WHERE 1 = 1 ${orderLimit}`).all(limit) as Array<{ sessionId: string }>
    ).map((row) => row.sessionId);
  }
  if (scope === "sessionIds") {
    const raw = input.sessionIds;
    if (!Array.isArray(raw)) throw new Error("missing_sessionIds");
    const requested = raw
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim())
      .slice(0, limit);
    if (requested.length === 0) return [];
    const placeholders = requested.map(() => "?").join(", ");
    return (
      db
        .prepare(
          `${baseSelect} WHERE sessions.session_id IN (${placeholders}) AND sessions.deleted_at IS NULL ORDER BY COALESCE(sessions.last_activity_at, sessions.updated_at, sessions.created_at, '') DESC LIMIT ?`
        )
        .all(...requested, limit) as Array<{ sessionId: string }>
    ).map((row) => row.sessionId);
  }
  if (scope === "session") {
    const sessionId = stringInput(input.sessionId, "sessionId");
    return (
      db.prepare(`${baseSelect} WHERE (sessions.session_id = ? OR sessions.source_session_id = ?) ${orderLimit}`).all(sessionId, sessionId, limit) as Array<{
        sessionId: string;
      }>
    ).map((row) => row.sessionId);
  }
  if (scope === "project") {
    const project = stringInput(input.project, "project");
    return (
      db.prepare(`${baseSelect} WHERE sessions.project_label = ? ${orderLimit}`).all(project, limit) as Array<{ sessionId: string }>
    ).map((row) => row.sessionId);
  }
  if (scope === "runtime") {
    const runtime = stringInput(input.runtime, "runtime");
    return (
      db
        .prepare(`${baseSelect} WHERE (runtimes.runtime_id = ? OR runtimes.runtime_kind = ?) ${orderLimit}`)
        .all(runtime, runtime, limit) as Array<{ sessionId: string }>
    ).map((row) => row.sessionId);
  }
  throw new Error("invalid_scope");
}

function stringInput(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new Error(`missing_${name}`);
}

const rawSourceRecordTypes: Array<StoreRecord["recordType"]> = ["event", "git_snapshot", "attention_item", "conflict_card"];

const CANONICAL_LIVE_REPLAY_LIMIT = 1_000;
const LIVE_PROJECTION_SESSION_LIMIT = 24;

function canonicalLiveEvents(database: MastheadDatabase): NormalizedEvent[] {
  return canonicalStoreRecords(database, liveIngestSourceIds(), CANONICAL_LIVE_REPLAY_LIMIT)
    .filter((record): record is Extract<StoreRecord, { recordType: "event" }> => record.recordType === "event")
    .map((record) => record.value);
}

function liveIngestSourceIds(): string[] {
  return LIVE_INGEST_RUNTIMES.map((runtime) => liveHookSourceForRuntime(runtime).sourceId);
}

function canonicalGitSnapshots(database: MastheadDatabase): GitSnapshot[] {
  return canonicalStoreRecords(database, ["masthead-git-observer"], CANONICAL_LIVE_REPLAY_LIMIT)
    .filter((record): record is Extract<StoreRecord, { recordType: "git_snapshot" }> => record.recordType === "git_snapshot")
    .map((record) => record.value);
}

export function canonicalStoreRecords(database: MastheadDatabase, sourceIds: string[], limit = LIVE_BOARD_RAW_RECORD_LIMIT): StoreRecord[] {
  if (sourceIds.length === 0) return [];
  const boundedLimit = Math.max(1, Math.min(limit, CANONICAL_LIVE_REPLAY_LIMIT));
  const query = database.prepare(
    `SELECT payload_json
    FROM raw_events
    WHERE source_id = ?
    ORDER BY observed_at DESC, raw_event_id DESC
    LIMIT ?`
  );
  const records = [...new Set(sourceIds)].flatMap((sourceId) =>
    (query.all(sourceId, boundedLimit) as Array<{ payload_json: string }>)
      .map((row) => parseStoreRecord(row.payload_json))
      .filter((record): record is StoreRecord => Boolean(record))
  );
  const newest = records.sort(compareStoreRecordsDescending).slice(0, boundedLimit);
  return newest.sort(compareStoreRecordsAscending);
}

function compareStoreRecordsAscending(left: StoreRecord, right: StoreRecord): number {
  return left.observedAt.localeCompare(right.observedAt) || left.recordId.localeCompare(right.recordId);
}

function compareStoreRecordsDescending(left: StoreRecord, right: StoreRecord): number {
  return compareStoreRecordsAscending(right, left);
}

function parseStoreRecord(payloadJson: string): StoreRecord | undefined {
  try {
    const parsed = JSON.parse(payloadJson) as Partial<StoreRecord>;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (
      parsed.recordType === "event" ||
      parsed.recordType === "git_snapshot" ||
      parsed.recordType === "attention_item" ||
      parsed.recordType === "conflict_card" ||
      parsed.recordType === "review_disposition"
    ) {
      return parsed as StoreRecord;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function latestProjectionSessionIds(events: NormalizedEvent[], selectedSessionId: string | undefined): Set<string> {
  const sessionIds = new Set<string>();
  if (selectedSessionId) sessionIds.add(selectedSessionId);
  for (let index = events.length - 1; index >= 0 && sessionIds.size < LIVE_PROJECTION_SESSION_LIMIT; index -= 1) {
    const sessionId = events[index]?.sessionId;
    if (sessionId) sessionIds.add(sessionId);
  }
  return sessionIds;
}

function liveStateReportsByProjectionSession(db: MastheadDatabase, projectionSessionIds: Set<string>): Map<string, LiveStateReport> {
  const reports = latestLiveStateReports(db, {
    sourceSessionIds: projectionSessionIds,
    canonicalSessionIds: projectionSessionIds,
    freshOnly: true,
    limit: projectionSessionIds.size || 100
  });
  const bySession = new Map<string, LiveStateReport>();
  for (const report of reports) {
    if (report.sourceSessionId && !bySession.has(report.sourceSessionId)) bySession.set(report.sourceSessionId, report);
    if (report.canonicalSessionId && !bySession.has(report.canonicalSessionId)) bySession.set(report.canonicalSessionId, report);
  }
  return bySession;
}

function liveStateInputFromRawHook(
  rawBody: string,
  options: { receivedAt: string; runtime: RuntimeKind }
): ReturnType<typeof liveStateReportFromHookPayload> {
  try {
    return liveStateReportFromHookPayload(JSON.parse(rawBody), options);
  } catch {
    return undefined;
  }
}

function persistHookLiveStateReport(db: MastheadDatabase, input: ReturnType<typeof liveStateReportFromHookPayload>): void {
  if (!input || liveStateCaptureDisabled(input.runtime)) return;
  try {
    upsertLiveStateReport(db, normalizeLiveStateReport(input));
  } catch {
    // Live state is an opportunistic companion to event ingest; hook capture must fail open.
  }
}

function liveExplainForSession(db: MastheadDatabase, events: NormalizedEvent[], requestedSessionId: string): Record<string, unknown> | undefined {
  const dbSession = db
    .prepare(
      `SELECT sessions.session_id AS sessionId, sessions.source_session_id AS sourceSessionId, runtimes.runtime_kind AS runtime
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE sessions.session_id = ? OR sessions.source_session_id = ?
      LIMIT 1`
    )
    .get(requestedSessionId, requestedSessionId) as { runtime: RuntimeKind; sessionId: string; sourceSessionId: string } | undefined;
  const sourceSessionId = dbSession?.sourceSessionId ?? requestedSessionId;
  const runtime = dbSession?.runtime ?? liveRuntimeForEvents(events, sourceSessionId);
  const sessionEvents = events.filter((event) => event.sessionId === sourceSessionId || event.sessionId === dbSession?.sessionId);
  if (!runtime && sessionEvents.length === 0) return undefined;

  const latestLiveState = latestLiveStateForSession(db, {
    runtime,
    sourceSessionId,
    canonicalSessionId: dbSession?.sessionId,
    freshOnly: true
  });
  const blockers = deriveLiveBlockers(sessionEvents).get(sourceSessionId) ?? [];
  const derived = deriveSessions(sessionEvents);
  const session =
    derived.find((candidate) => candidate.sessionId === sourceSessionId || candidate.sessionId === dbSession?.sessionId) ??
    derived[0];
  if (!session) {
    if (!latestLiveState) return undefined;
    return {
      ok: true,
      sessionId: requestedSessionId,
      sourceSessionId,
      runtime,
      displayState: latestLiveState.state,
      semanticState: latestLiveState.state,
      selectedAuthority: "live_state",
      latestLiveState,
      unresolvedBlockers: blockers
    };
  }
  const latestEvent = sessionEvents.toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1);
  const effective = selectEffectiveLiveState({
    session,
    latestLiveState,
    unresolvedBlockers: blockers,
    latestEvent,
    now: new Date()
  });

  return {
    ok: true,
    sessionId: requestedSessionId,
    sourceSessionId,
    runtime,
    displayState: effective.displayState,
    semanticState: effective.semanticState,
    selectedAuthority: effective.authority === "blocker" ? "unresolved_blocker" : effective.authority,
    latestLiveState,
    latestEvent,
    unresolvedBlockers: blockers,
    fallbackReason: effective.reason,
    stalenessMs: latestLiveState ? Math.max(0, Date.now() - Date.parse(latestLiveState.observedAt)) : undefined
  };
}

function liveRuntimeForEvents(events: NormalizedEvent[], sourceSessionId: string): RuntimeKind | undefined {
  const event = events
    .filter((candidate) => candidate.sessionId === sourceSessionId)
    .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .find((candidate) => isRuntimeKind(candidate.payload.runtime) || isRuntimeKind(candidate.source.adapter));
  if (!event) return undefined;
  if (isRuntimeKind(event.payload.runtime)) return event.payload.runtime;
  return isRuntimeKind(event.source.adapter) ? event.source.adapter : undefined;
}

function runtimeFromQuery(value: string | null): RuntimeKind | undefined {
  return isRuntimeKind(value) ? value : undefined;
}

function liveStateCaptureDisabled(runtime: RuntimeKind | undefined): boolean {
  if (process.env.MASTHEAD_LIVE_CAPTURE === "0") return true;
  if (!runtime) return false;
  const runtimeKey = runtime.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return process.env[`MASTHEAD_LIVE_CAPTURE_${runtimeKey}`] === "0";
}

function boundedLiveStateLimit(value: string | null): number {
  const parsed = Number.parseInt(value || "100", 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(parsed, 500));
}

function parseBoardRefreshIntervalMs(value: string | null): number {
  const intervalMs = Number(value);
  if (!Number.isFinite(intervalMs)) return 10_000;
  return Math.max(5_000, Math.min(60_000, intervalMs));
}

function unrefDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function afterResponse(response: ServerResponse, task: () => void): void {
  response.once("finish", () => {
    const timer = setTimeout(task, RESPONSE_BACKGROUND_GRACE_MS);
    timer.unref?.();
  });
}

function liveSessionCount(events: NormalizedEvent[]): number {
  return new Set(events.map((event) => event.sessionId).filter((sessionId): sessionId is string => Boolean(sessionId))).size;
}

function boardHeadlineProviderConfig(database: MastheadDatabase, config: DaemonConfig): BoardHeadlineProviderConfig {
  const effective = effectiveLlmProvider(database, config);
  const supportedApiStyle = effective.apiStyle === "responses" || effective.apiStyle === "chat_completions";
  const enabled = effective.remoteEnrichmentEnabled && effective.configured;
  const unsupportedReason = enabled && !supportedApiStyle ? `${effective.label} does not support live Board headline rewriting yet.` : undefined;
  const apiStyle: BoardHeadlineProviderConfig["apiStyle"] = supportedApiStyle
    ? (effective.apiStyle as BoardHeadlineProviderConfig["apiStyle"])
    : "responses";

  return {
    enabled,
    configured: enabled && supportedApiStyle,
    provider: effective.id,
    providerLabel: effective.label,
    apiKey: effective.apiKey,
    apiKeyRequired: effective.apiKeyRequired,
    apiStyle,
    baseUrl: effective.baseUrl,
    model: effective.model,
    unsupportedReason
  };
}

function isRawSourceStoreRecord(record: StoreRecord): boolean {
  return rawSourceRecordTypes.includes(record.recordType);
}

function storeRecordMatchesDeleteScope(
  record: StoreRecord,
  scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>,
  sourceSessionIds: Set<string>
): boolean {
  if (record.recordType === "event") return eventMatchesDeleteScope(record.value, scope, sourceSessionIds);
  if (record.recordType === "git_snapshot") return sourceSessionIds.has(record.value.sessionId);
  if (scope.kind === "session") return record.recordId.includes(scope.sessionId);
  return false;
}

function eventMatchesDeleteScope(
  event: NormalizedEvent,
  scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>,
  sourceSessionIds: Set<string>
): boolean {
  if (event.sessionId && sourceSessionIds.has(event.sessionId)) return true;
  if (scope.kind === "session") return event.sessionId === scope.sessionId;
  if (scope.kind === "project") return stringPayload(event, "project") === scope.project;
  if (scope.kind === "runtime") return event.source.adapter === scope.runtime;
  return false;
}

function stringPayload(event: NormalizedEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isLiveIngestValidationRequest(url: URL): boolean {
  const value = url.searchParams.get("validate") ?? url.searchParams.get("dryRun");
  return value === "1" || value === "true";
}

function toLiveHookDiagnostic(diagnostic: AdapterDiagnostic | undefined, receivedAt: string): LiveHookDiagnostic {
  const code =
    diagnostic?.code === "malformed_json" || diagnostic?.code === "unsupported_runtime"
      ? diagnostic.code
      : "invalid_payload";
  return {
    code,
    details: diagnostic?.details,
    message: diagnostic?.message ?? "Live hook adapter could not normalize the payload.",
    receivedAt
  };
}

function recordLiveHookRuntimeDiagnostics(event: NormalizedEvent): void {
  const diagnostics = Array.isArray(event.payload.runtimeDiagnostics) ? event.payload.runtimeDiagnostics.filter(isRecord) : [];
  for (const diagnostic of diagnostics) {
    const code = typeof diagnostic.code === "string" ? diagnostic.code : "runtime_mismatch";
    recordRuntimeDiagnostic({
      details: {
        diagnostic,
        eventId: event.eventId,
        sessionId: event.sessionId,
        sourceRuntime: event.source.adapter
      },
      kind: "live_hook_runtime_mismatch",
      message: `Live hook reported ${code} for ${event.source.adapter}.`,
      severity: "warning"
    });
  }
}

async function transcriptSources(source: DiscoveredSource): Promise<DiscoveredSource[]> {
  if (!source.path) return [];
  const sourcePath = source.path;
  const info = await stat(sourcePath);
  if (!info.isDirectory()) return [source];
  const files = await jsonlFiles(sourcePath);
  return files.map((file) => ({
    ...source,
    path: file,
    runtimeVersion: "file",
    schemaVersion: source.schemaVersion,
    sourceId: `${source.sourceId}:${relative(sourcePath, file).replaceAll("\\", "/")}`
  }));
}

async function transcriptSourceFromHookEvent(event: NormalizedEvent, homeDir: string): Promise<DiscoveredSource | undefined> {
  const transcriptPath = hookTranscriptPath(event);
  const sourceId = transcriptSourceIdFromHookEvent(event, homeDir);
  if (!transcriptPath || !sourceId || !isRuntimeKind(event.source.adapter)) return undefined;
  const runtime = event.source.adapter;
  return {
    confidence: "authoritative",
    path: transcriptPath,
    runtime,
    runtimeVersion: "file",
    schemaVersion: `${runtime}-transcript-jsonl`,
    sourceId,
    sourceKind: "jsonl"
  };
}

function transcriptSourceIdFromHookEvent(event: NormalizedEvent, homeDir: string): string | undefined {
  const transcriptPath = hookTranscriptPath(event);
  if (!transcriptPath || !transcriptPath.endsWith(".jsonl") || !isAbsolute(transcriptPath)) return undefined;
  if (!isRuntimeKind(event.source.adapter)) return undefined;
  const runtime = event.source.adapter;
  const relativePath = relative(homeDir, transcriptPath).replaceAll("\\", "/");
  const sourcePathId = relativePath && !relativePath.startsWith("../") && relativePath !== ".." && !isAbsolute(relativePath)
    ? relativePath
    : transcriptPath.replaceAll("\\", "/");
  return `${runtime}-hook-transcript:${sourcePathId}`;
}

function hookTranscriptPath(event: NormalizedEvent): string | undefined {
  return stringFromPayload(event.payload, ["transcriptPath", "transcript_path"]);
}

function stringFromPayload(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await jsonlFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files.toSorted();
}

type TranscriptCursorContext = {
  sourceSessionId?: string;
  cwd?: string;
  model?: string;
};

function cursorContextFromCursor(cursor: IngestCursor | undefined): TranscriptCursorContext {
  return {
    cwd: cursor?.cwd,
    model: cursor?.model,
    sourceSessionId: cursor?.sourceSessionId
  };
}

function cursorContextFromRecord(record: { normalized: { value: unknown } }, fallback: TranscriptCursorContext): TranscriptCursorContext {
  const value = objectRecord(record.normalized.value);
  return {
    cwd: stringRecordValue(value, "cwd") ?? fallback.cwd,
    model: stringRecordValue(value, "model") ?? stringRecordValue(value, "modelName") ?? fallback.model,
    sourceSessionId:
      stringRecordValue(value, "sessionId") ??
      stringRecordValue(value, "session_id") ??
      stringRecordValue(value, "conversationId") ??
      stringRecordValue(value, "conversation_id") ??
      fallback.sourceSessionId
  };
}

function withSessionUsageSummaries(db: MastheadDatabase, projection: LiveBoardProjection): LiveBoardProjection {
  const sessionIds = [
    ...projection.cards.flatMap(usageSummaryLookupIds),
    ...usageSummaryLookupIds(projection.expandedSession),
    ...usageSummaryLookupIds(projection.selectedSession)
  ];
  const usageSummaries = getSessionUsageSummaries(db, sessionIds);
  if (usageSummaries.size === 0) return projection;

  const withUsage = <T extends SessionCardView | undefined>(session: T): T => {
    if (!session) return session;
    const summary =
      (session.canonicalSessionId ? usageSummaries.get(session.canonicalSessionId) : undefined) ??
      usageSummaries.get(session.sessionId) ??
      (session.sourceSessionId ? usageSummaries.get(session.sourceSessionId) : undefined);
    if (!summary) return session;

    return {
      ...session,
      ...(summary.totalTokens !== undefined ? { totalTokens: summary.totalTokens } : {}),
      // DB model/provider rows are the same canonical source that powers usage/logbook views, so they override stale hook metadata.
      ...(summary.model ? { model: summary.model } : {}),
      ...(summary.provider ? { provider: summary.provider } : {})
    };
  };

  return {
    ...projection,
    cards: projection.cards.map((card) => withUsage(card)),
    expandedSession: withUsage(projection.expandedSession),
    selectedSession: withUsage(projection.selectedSession)
  };
}


function usageSummaryLookupIds(session: Pick<SessionCardView, "canonicalSessionId" | "sessionId" | "sourceSessionId"> | undefined): string[] {
  if (!session) return [];
  return [session.canonicalSessionId, session.sessionId, session.sourceSessionId].filter((sessionId): sessionId is string =>
    Boolean(sessionId)
  );
}

function attachCanonicalCardIds(
  projection: LiveBoardProjection,
  context: { hostId: string; runtimeKind: string; runtimeVersion?: string }
): LiveBoardProjection {
  const withIdentity = <T extends SessionCardView | undefined>(session: T): T => {
    if (!session) return session;
    const runtimeKind = session.runtime ?? context.runtimeKind;
    const runtimeVersion = runtimeKind === context.runtimeKind ? context.runtimeVersion : undefined;
    const runtimeId = runtimeIdFor(runtimeKind, runtimeVersion);
    const sourceSessionId = session.sourceSessionId ?? session.sessionId;
    return {
      ...session,
      canonicalSessionId: session.canonicalSessionId ?? canonicalSessionId(context.hostId, runtimeId, sourceSessionId),
      hostId: session.hostId ?? context.hostId,
      runtime: runtimeKind,
      sourceSessionId
    };
  };

  return {
    ...projection,
    cards: projection.cards.map((card) => withIdentity(card)),
    expandedSession: withIdentity(projection.expandedSession),
    selectedSession: withIdentity(projection.selectedSession)
  };
}

function sessionQueryFromUrl(url: URL): SessionQuery {
  return {
    cursor: url.searchParams.get("cursor") ?? undefined,
    dateFrom: url.searchParams.get("dateFrom") ?? undefined,
    dateTo: url.searchParams.get("dateTo") ?? undefined,
    file: url.searchParams.get("file") ?? undefined,
    host: url.searchParams.get("host") ?? undefined,
    lifecycle: url.searchParams.get("lifecycle") ?? undefined,
    limit: Number.parseInt(url.searchParams.get("limit") || "50", 10),
    model: searchParamValues(url, "model"),
    offset: Number.parseInt(url.searchParams.get("offset") || "0", 10),
    project: searchParamValues(url, "project"),
    query: url.searchParams.get("q") ?? "",
    runtime: searchParamValues(url, "runtime"),
    sort: logbookSortFromUrl(url.searchParams.get("sort")),
    state: url.searchParams.get("state") ?? undefined
  };
}

function searchParamValues(url: URL, key: string): string | string[] | undefined {
  const values = url.searchParams.getAll(key).filter(Boolean);
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

function logbookSortFromUrl(value: string | null): SessionQuery["sort"] {
  if (
    value === "recent" ||
    value === "oldest" ||
    value === "duration_desc" ||
    value === "files_desc" ||
    value === "tools_desc" ||
    value === "errors_desc" ||
    value === "project"
  ) {
    return value;
  }
  return undefined;
}

function transcriptKindFromUrl(url: URL): SessionTranscriptKindFilter {
  const value = url.searchParams.get("kind");
  if (
    value === "user" ||
    value === "assistant" ||
    value === "tools" ||
    value === "checkpoints" ||
    value === "files" ||
    value === "signals"
  ) {
    return value;
  }
  return "all";
}

function usageWindowFromUrl(url: URL): UsageWindow {
  const value = url.searchParams.get("window");
  if (value === "24h" || value === "7d" || value === "30d" || value === "all") return value;
  return "today";
}

function assertReviewDisposition(value: unknown): asserts value is ReviewDisposition {
  if (typeof value !== "object" || value === null) throw new Error("Review disposition must be an object.");
  const record = value as Record<string, unknown>;
  if (typeof record.dispositionId !== "string" || !record.dispositionId.trim()) {
    throw new Error("dispositionId is required.");
  }
  if (typeof record.subjectId !== "string" || !record.subjectId.trim()) {
    throw new Error("subjectId is required.");
  }
  if (!["session", "attention_item", "conflict_card"].includes(String(record.subjectType))) {
    throw new Error("subjectType is invalid.");
  }
  if (!["reviewed", "expected", "dismissed", "snoozed", "false_positive"].includes(String(record.status))) {
    throw new Error("status is invalid.");
  }
  if (typeof record.recordedAt !== "string" || Number.isNaN(Date.parse(record.recordedAt))) {
    throw new Error("recordedAt must be an ISO timestamp.");
  }
  const now = Date.now();
  if (Date.parse(record.recordedAt) > now + 60_000) {
    throw new Error("recordedAt cannot be in the future.");
  }
  if (record.status === "snoozed") {
    if (typeof record.snoozedUntil !== "string" || Number.isNaN(Date.parse(record.snoozedUntil))) {
      throw new Error("snoozedUntil must be an ISO timestamp when status is snoozed.");
    }
    if (Date.parse(record.snoozedUntil) > now + 1000 * 60 * 60 * 24 * 30) {
      throw new Error("snoozedUntil cannot be more than 30 days in the future.");
    }
  }
}

function deleteScopeFromBody(value: unknown): DeleteMastheadDataScope {
  const body = objectRecord(value);
  const scope = objectRecord(body.scope ?? body);
  const kind = typeof scope.kind === "string" ? scope.kind : undefined;
  if (!kind) throw clientError("delete scope is required");

  if (kind === "all") return { kind };
  if (kind === "raw_payloads" || kind === "raw_payloads_only") return { kind: "raw_payloads" };
  if (kind === "session") return { kind, sessionId: requiredString(scope.sessionId, "sessionId") };
  if (kind === "project") return { kind, project: requiredString(scope.project, "project") };
  if (kind === "runtime") return { kind, runtime: requiredString(scope.runtime, "runtime") };
  if (kind === "host") return { kind, host: requiredString(scope.host ?? scope.hostId, "host") };
  throw clientError(`Unsupported delete scope: ${kind}`);
}

function deleteScopeFromUrl(url: URL): DeleteMastheadDataScope {
  const kind = url.searchParams.get("kind") ?? "all";
  if (kind === "all") return { kind };
  if (kind === "raw_payloads" || kind === "raw_payloads_only") return { kind: "raw_payloads" };
  if (kind === "session") return { kind, sessionId: requiredString(url.searchParams.get("sessionId"), "sessionId") };
  if (kind === "project") return { kind, project: requiredString(url.searchParams.get("project"), "project") };
  if (kind === "runtime") return { kind, runtime: requiredString(url.searchParams.get("runtime"), "runtime") };
  if (kind === "host") return { kind, host: requiredString(url.searchParams.get("host") ?? url.searchParams.get("hostId"), "host") };
  throw clientError(`Unsupported delete scope: ${kind}`);
}

function assertDatabaseIdMatches(value: string | null | undefined, database: MastheadDatabase, config: DaemonConfig): void {
  if (!value) throw clientError("databaseId is required.");
  const currentDatabaseId = settingsRuntimeIdentity(config, database).data.databaseId;
  if (value !== currentDatabaseId) {
    throw clientError("Masthead database changed. Refresh settings before deleting data.");
  }
}

function isTrustedWriteOrigin(request: IncomingMessage, allowedOrigins: string[]): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  return typeof origin === "string" && allowedOrigins.includes(origin);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringRecordValue(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw clientError(`${name} is required`);
  return value;
}

function sessionExists(db: MastheadDatabase, sessionId: string): boolean {
  const row = db.prepare("SELECT 1 AS found FROM sessions WHERE session_id = ? AND deleted_at IS NULL LIMIT 1").get(sessionId) as
    | { found: number }
    | undefined;
  return row?.found === 1;
}

function clientError(message: string): Error {
  const error = new Error(message);
  error.name = "ClientInputError";
  return error;
}

function isDeleteScopeClientError(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && error.name === "ClientInputError");
}

function isImportJobKind(value: unknown): value is ImportJobKind {
  return value === "metadata" || value === "transcript" || value === "enrichment";
}

function isImportJobListStatus(value: unknown): value is ImportJobListStatus {
  return value === "active" ||
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "succeeded_with_issues" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "cancelling";
}

function isImportWorkUnitStatus(value: unknown): value is ImportWorkUnitStatus {
  return value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "succeeded_with_issues" ||
    value === "failed" ||
    value === "skipped" ||
    value === "cancelled";
}

function parseBoundedInteger(
  value: string | null,
  defaultValue: number,
  min: number,
  max: number
): { ok: true; value: number } | { ok: false } {
  if (value === null || value === "") return { ok: true, value: defaultValue };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return { ok: false };
  return { ok: true, value: parsed };
}

function readWorkbenchLimit(raw: string | null): number {
  const parsed = raw ? Number(raw) : 100;
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(Math.trunc(parsed), 500));
}

function readWorkbenchOffset(raw: string | null): number {
  const parsed = raw ? Number(raw) : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

type WorkbenchSessionMetadataRow = {
  sessionId: string;
  title: string | null;
  project: string | null;
  runtime: string;
  lifecycle: string;
  lastActivityAt: string;
};

type WorkbenchNotAddedSummaryRow = {
  reason: string | null;
  count: number;
};

type WorkbenchNotAddedDetailRow = WorkbenchSessionMetadataRow & {
  reason: string | null;
};

function workbenchQueueSessionDtos(database: MastheadDatabase, states: WorkbenchSessionStateRecord[]): WorkbenchQueueSessionDto[] {
  const metadata = workbenchSessionMetadata(database, states.map((state) => state.sessionId));
  return states.flatMap((state) => {
    const session = metadata.get(state.sessionId);
    if (!session) return [];
    return [
      {
        activeClaim: state.activeClaim
          ? {
              claimId: state.activeClaim.claimId,
              claimedBy: state.activeClaim.claimedBy,
              expiresAt: state.activeClaim.expiresAt
            }
          : undefined,
        adrStatus: state.adrStatus,
        bugFixTraceStatus: state.runbookStatus,
        incidentTimelineStatus: state.incidentTimelineStatus,
        lastActivityAt: session.lastActivityAt,
        latestActivity: listWorkbenchActivity(database, { limit: 1, sessionId: state.sessionId }).map(workbenchActivityDto)[0],
        lifecycle: session.lifecycle,
        nextAction: state.nextAction,
        project: session.project ?? undefined,
        publicationStatus: state.publicationStatus === "published" ? "published" : "publish_path",
        qualityStatus: state.qualityStatus,
        resolutionStatus: state.resolutionStatus,
        runbookStatus: state.runbookStatus,
        runtime: session.runtime,
        sessionDossierStatus: state.sessionDossierStatus,
        sessionEnrichmentStatus: state.sessionEnrichmentStatus,
        sessionId: state.sessionId,
        sessionPackageStatus: state.sessionPackageStatus,
        title: session.title ?? state.sessionId,
        transcriptStatus: state.transcriptStatus
      }
    ];
  });
}

function workbenchActivityDto(activity: WorkbenchActivityRecord): WorkbenchActivityDto {
  return {
    activityId: activity.activityId,
    actorId: activity.actorId,
    actorKind: activity.actorKind,
    details: activity.details,
    eventAt: activity.eventAt,
    eventType: activity.eventType,
    sessionId: activity.sessionId,
    summary: activity.summary
  };
}

function workbenchNotAddedSummary(database: MastheadDatabase): WorkbenchNotAddedSummaryDto {
  const rows = database
    .prepare(
      `SELECT non_publication_reason AS reason, COUNT(*) AS count
      FROM workbench_session_state
      JOIN sessions ON sessions.session_id = workbench_session_state.session_id
      WHERE workbench_session_state.publication_status = 'not_added_to_logbook'
        AND sessions.deleted_at IS NULL
      GROUP BY non_publication_reason
      ORDER BY count DESC, lower(COALESCE(non_publication_reason, 'unknown'))`
    )
    .all() as WorkbenchNotAddedSummaryRow[];
  return {
    ok: true,
    reasons: rows.map((row) => ({ count: row.count, reason: row.reason ?? "unknown" })),
    total: rows.reduce((total, row) => total + row.count, 0)
  };
}

function workbenchNotAddedDetails(database: MastheadDatabase, limit: number): WorkbenchNotAddedResponse {
  const rows = database
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        COALESCE(sessions.title, sessions.objective, sessions.source_session_id) AS title,
        sessions.project_label AS project,
        runtimes.runtime_kind AS runtime,
        sessions.lifecycle AS lifecycle,
        sessions.last_activity_at AS lastActivityAt,
        workbench_session_state.non_publication_reason AS reason
      FROM workbench_session_state
      JOIN sessions ON sessions.session_id = workbench_session_state.session_id
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE workbench_session_state.publication_status = 'not_added_to_logbook'
        AND sessions.deleted_at IS NULL
      ORDER BY COALESCE(workbench_session_state.last_activity_at, sessions.last_activity_at, workbench_session_state.updated_at) DESC,
        sessions.session_id DESC
      LIMIT ?`
    )
    .all(limit) as WorkbenchNotAddedDetailRow[];
  const total = workbenchNotAddedSummary(database).total;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    limit,
    sessions: rows.map(workbenchNotAddedSessionDto),
    total
  };
}

function workbenchNotAddedSessionDto(row: WorkbenchNotAddedDetailRow): WorkbenchNotAddedSessionDto {
  return {
    lastActivityAt: row.lastActivityAt,
    lifecycle: row.lifecycle,
    project: row.project ?? undefined,
    reason: row.reason ?? "unknown",
    runtime: row.runtime,
    sessionId: row.sessionId,
    title: row.title ?? row.sessionId
  };
}

function workbenchSessionMetadata(database: MastheadDatabase, sessionIds: string[]): Map<string, WorkbenchSessionMetadataRow> {
  if (sessionIds.length === 0) return new Map();
  const rows = database
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        COALESCE(sessions.title, sessions.objective, sessions.source_session_id) AS title,
        sessions.project_label AS project,
        runtimes.runtime_kind AS runtime,
        sessions.lifecycle AS lifecycle,
        sessions.last_activity_at AS lastActivityAt
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE sessions.session_id IN (${sessionIds.map(() => "?").join(", ")})
        AND sessions.deleted_at IS NULL`
    )
    .all(...sessionIds) as WorkbenchSessionMetadataRow[];
  return new Map(rows.map((row) => [row.sessionId, row]));
}

function mapWorkbenchMissingSessionStatus(status: "current" | "stale" | "failed" | "disabled" | "missing"): WorkbenchMissingSessionDto["enrichmentStatus"] {
  if (status === "stale" || status === "failed") return status;
  return "missing";
}

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return typeof value === "string" && (ALL_RUNTIME_KINDS as readonly string[]).includes(value);
}

function decodeRouteSegment(value: string): { ok: true; value: string } | { ok: false } {
  try {
    return { ok: true, value: decodeURIComponent(value) };
  } catch (error) {
    if (error instanceof URIError) return { ok: false };
    throw error;
  }
}

function liveRuntimeFromIngestRequest(url: URL, request: IncomingMessage): RuntimeKind | undefined {
  const header = request.headers["x-masthead-runtime"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const requested = url.searchParams.get("runtime") ?? headerValue;
  if (!isRuntimeKind(requested)) return undefined;
  return (LIVE_INGEST_RUNTIMES as readonly string[]).includes(requested) ? requested : undefined;
}

function rawEventSourceFromDiscoveredSource(source: DiscoveredSource): RawEventSource {
  return {
    adapter: source.runtime,
    confidence: source.confidence,
    endpoint: source.endpoint,
    runtimeVersion: source.runtimeVersion,
    schemaVersion: source.schemaVersion,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    sourcePath: source.path
  };
}

function setupRuntimesFromBody(body: Record<string, unknown>, scan: SourceScanResult): RuntimeKind[] {
  const requested = Array.isArray(body.runtimes) ? body.runtimes.filter((runtime): runtime is RuntimeKind => isRuntimeKind(runtime)) : [];
  if (requested.length > 0) return requested.filter((runtime) => Boolean(adapterForRuntime(runtime)));
  const sourceIds = sourceIdsFromBody(body);
  if (sourceIds.length > 0) {
    const selectedSourceIds = new Set(sourceIds);
    return scan.adapters
      .filter((adapter) => adapterForRuntime(adapter.runtime) && adapter.sources.some((source) => selectedSourceIds.has(source.sourceId)))
      .map((adapter) => adapter.runtime);
  }
  return scan.adapters.filter((adapter) => adapter.sources.length > 0 && adapterForRuntime(adapter.runtime)).map((adapter) => adapter.runtime);
}

function sourceIdsFromBody(body: Record<string, unknown>): string[] {
  return Array.isArray(body.sourceIds) ? body.sourceIds.filter((sourceId): sourceId is string => typeof sourceId === "string" && sourceId.trim().length > 0) : [];
}

function sourcesForBodySelection(body: Record<string, unknown>, sources: DiscoveredSource[]): DiscoveredSource[] {
  const sourceIds = sourceIdsFromBody(body);
  if (sourceIds.length === 0) return sources;
  const selectedSourceIds = new Set(sourceIds);
  return sources.filter((source) => selectedSourceIds.has(source.sourceId));
}

function isSourcePolicyKind(value: unknown): value is SourcePolicyKind {
  return value === "metadata_import" || value === "transcript_import" || value === "mcp_access" || value === "enrichment";
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: string[],
  status: number,
  body: unknown
): void {
  const origin = request.headers.origin;
  const allowedOrigin = typeof origin === "string" && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  response.writeHead(status, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": allowedOrigin,
    "vary": "origin",
    "content-type": "application/json"
  });
  response.end(body === undefined ? "" : JSON.stringify(body, null, 2));
}
