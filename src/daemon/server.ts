import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AdapterMaturity } from "../adapters/capabilities.ts";
import { adapterRecordFromCodexHook, codexHookSource } from "../adapters/codex/hookAdapter.ts";
import { adapterForRuntime } from "../adapters/registry.ts";
import { createDeterministicEnrichmentProvider } from "../enrichment/deterministicProvider.ts";
import { createEnrichmentCoordinator, EnrichmentFailedError } from "../enrichment/enrichmentCoordinator.ts";
import { RUNTIME_KINDS, type AdapterDiagnostic, type RuntimeKind } from "../adapters/types.ts";
import type { DiscoveredSource } from "../adapters/types.ts";
import { createIngestionState, ingestNormalizedEvent } from "../core/ingestion.ts";
import { acquireDatabaseWriterLock, type DatabaseWriterLock } from "../core/daemonOwnership.ts";
import { projectLiveEvents } from "../core/liveProjection.ts";
import { createBoardHeadlineEnricher, type BoardHeadlineAppliedEvent } from "../core/boardHeadlineEnricher.ts";
import { createFileBackedStore, type StoreRecord } from "../core/store.ts";
import type { ReviewDisposition } from "../core/store.ts";
import type { CodexHookDiagnostic } from "../core/codexAdapter.ts";
import type { GitSnapshot, LiveBoardProjection, NormalizedEvent, SessionCardView } from "../core/types.ts";
import type { DaemonConfig } from "./config.ts";
import {
  applyDefaultRetention,
  deleteAllMastheadData,
  deleteMastheadData,
  exportSessionGraph,
  getDataSummary,
  type DeleteMastheadDataScope
} from "./db/dataLifecycleRepository.ts";
import {
  getImportJob,
  listImportJobPage,
  listImportJobs,
  updateImportJob,
  type ImportJobKind,
  type ImportJobListStatus
} from "./db/importJobRepository.ts";
import { listImportFailureGroups, listImportWorkUnits } from "./db/importLedgerRepository.ts";
import { listMcpAuditRows } from "./db/mcpQueryRepository.ts";
import { liveProjectionEnrichments } from "./db/enrichmentViewRepository.ts";
import { liveProjectionTranscriptFacts } from "./db/liveTranscriptFactsRepository.ts";
import { upsertFileEffectsFromGitSnapshot } from "./db/gitSnapshotEffectsRepository.ts";
import { createRawEventRepository } from "./db/rawEventRepository.ts";
import { getSessionDossier } from "./db/sessionDossierRepository.ts";
import { getSessionTranscript, type SessionTranscriptKindFilter } from "./db/sessionTranscriptRepository.ts";
import { currentBoardHeadlineFrames, upsertBoardHeadlineFrame } from "./db/boardHeadlineFrameRepository.ts";
import { listReviewDispositions, upsertReviewDisposition } from "./db/reviewDispositionRepository.ts";
import { readCursor, upsertCursor } from "./db/cursorRepository.ts";
import { indexCanonicalSessionSearch, searchSessions } from "./db/searchRepository.ts";
import { getLogbookSummary } from "./db/logbookSummaryRepository.ts";
import { getSessionDetail, getSessionExcerpts, listProjects, querySessions, type SessionQuery } from "./db/sessionQueryRepository.ts";
import { getOrCreateDatabaseIdentity, hasPendingMigrations, migrateDatabase } from "./db/schema.ts";
import { canonicalSessionId, createSessionRepository, ingestAdapterRecord, runtimeIdFor } from "./db/sessionRepository.ts";
import { saveSourceScanRun, saveSourceSetupState } from "./db/sourceSetupRepository.ts";
import { getSessionTokenTotals, getUsageStats, type UsageWindow } from "./db/usageStatsRepository.ts";
import {
  checkpointMastheadDatabase,
  openMastheadDatabase,
  quickCheckMastheadDatabase,
  type MastheadDatabase
} from "./db/sqlite.ts";
import { legacyCandidatesFromDirectory, maybeCopyLegacySqliteBeforeOpen } from "./legacyDataMigration.ts";
import { migrateLegacyJournalOnce } from "./legacyJournalMigration.ts";
import { addSourceExclusion, approveTranscriptImport, sourceIsExcluded, transcriptImportApproved } from "./db/sourceRepository.ts";
import { setSourcePolicy, type SourcePolicyKind } from "./db/sourcePolicyRepository.ts";
import {
  cancelImportJob,
  getImportQueueState,
  markInterruptedImportJobs,
  queueImportJob,
  type ImportJobControls,
  type ImportWorkResult
} from "./import/importCoordinator.ts";
import { buildImportCompletionReport } from "./import/importCompletionReport.ts";
import { buildImportManifestPlan, createManifestForJob } from "./import/importManifestService.ts";
import { getRuntimePolicy, setRuntimePolicy } from "./import/runtimePolicyRepository.ts";
import { countImportedRecord, emptyImportResult } from "./import/importWorker.ts";
import { runImportWorkUnit } from "./import/importWorkUnitRunner.ts";
import { getAdapterStatuses, getSourceStatuses } from "./import/sourceStatusService.ts";
import { recordRequestDiagnostic, recordRuntimeDiagnostic, runtimeDiagnosticsSnapshot } from "./diagnostics.ts";
import { discoverSourceSnapshot, type SourceDiscoverySnapshot } from "./sources/sourceDiscoveryService.ts";
import { scanLocalSources, type SourceScanResult } from "./sources/sourceScanService.ts";
import { connectSelectedSources, type ConnectSourcesRequest } from "./sources/sourceConnectService.ts";
import { buildSourcesSetupState, scanResultToOnboardingScan } from "./sources/sourceSetupService.ts";
import type { ImportScopeDto, ImportWorkUnitStatus } from "../shared/sourceImport.ts";
import { collectGitSnapshot, gitSnapshotSignature } from "./gitSnapshots.ts";
import { buildMastheadHealth } from "./healthService.ts";
import { recentHookEventsWithTranscriptPaths, recentHookEventsWithTranscriptPathsForSessions } from "./hookTranscriptRecovery.ts";
import { coerceMcpLaunchConfig, getMcpLaunchConfig, getMcpStatus, listMcpTools, testMcpConnection, validateMcpLaunchConfig } from "./mcpStatusService.ts";
import { createSettingsBackedEnrichmentProvider, listLlmProviderModels, updateLlmProviderSettings } from "./llmSettings.ts";
import {
  getCodexHookSettings,
  getSettingsState,
  installCodexHooks,
  settingsRuntimeIdentity,
  testCodexHooks,
  uninstallCodexHooks
} from "./settingsService.ts";

export type MastheadDaemon = {
  server: Server;
  database: MastheadDatabase;
  startBackgroundHydration: () => void;
  waitForBackgroundHydration: () => Promise<void>;
  close: () => Promise<void>;
};

export const LIVE_BOARD_RAW_RECORD_LIMIT = 500;
const HOOK_TRANSCRIPT_RECOVERY_LIMIT = 25;
const HOOK_TRANSCRIPT_CATCHUP_RECORD_LIMIT = 200;
const HOOK_TRANSCRIPT_CATCHUP_REQUEUE_MS = 250;

type TranscriptImportOptions = {
  maxRecordsPerSource?: number;
  queueEnrichment?: boolean;
};

export async function createMastheadDaemon(config: DaemonConfig): Promise<MastheadDaemon> {
  await mkdir(dirname(config.storePath), { recursive: true });
  const writerLock = await acquireDatabaseWriterLock(config.dataDirectory ?? dirname(config.databasePath));
  let hookTranscriptCatchupQueue: Promise<void> = Promise.resolve();
  const hookTranscriptCatchups = new Map<string, Promise<void>>();
  const disabledHookTranscriptCatchupDiagnostics = new Set<string>();

  try {
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
      const databaseIdentity = getOrCreateDatabaseIdentity(database);
      markInterruptedImportJobs(database);

    const hookRawJournal = createRawEventRepository(database, {
      adapter: codexHookSource.runtime,
      confidence: codexHookSource.confidence,
      endpoint: codexHookSource.endpoint,
      runtimeVersion: codexHookSource.runtimeVersion,
      schemaVersion: codexHookSource.schemaVersion,
      sourceId: codexHookSource.sourceId,
      sourceKind: codexHookSource.sourceKind
    });
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
      runtimeKind: "codex"
    });
    const canonicalRuntimeId = runtimeIdFor("codex", undefined);
    const canonicalSessionIdForSource = (sourceSessionId: string): string => canonicalSessionId(`host:${config.host}`, canonicalRuntimeId, sourceSessionId);
    const state = createIngestionState(canonicalLiveEvents(database));
    const gitSnapshots = canonicalGitSnapshots(database);
    for (const gitSnapshot of gitSnapshots) {
      upsertFileEffectsFromGitSnapshot(database, canonicalSessionIdForSource(gitSnapshot.sessionId), gitSnapshot);
    }
    const gitSnapshotSignatures = new Map(gitSnapshots.map((snapshot) => [snapshot.sessionId, gitSnapshotSignature(snapshot)]));
    const persistBoardHeadlineFrame = (event: BoardHeadlineAppliedEvent): void => {
      try {
        const sessionId = canonicalSessionIdForSource(event.sessionId);
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
    const boardHeadlineEnricher = createBoardHeadlineEnricher({
      enabled: config.liveCopyEnabled ?? config.llmCopyEnabled,
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      onFrameApplied: persistBoardHeadlineFrame,
      timeoutMs: config.liveCopyTimeoutMs
    });
    const enrichmentProvider = createSettingsBackedEnrichmentProvider(database, config);
    const enrichment = createEnrichmentCoordinator(database, enrichmentProvider);
    const queuedEnrichmentSessionIds = new Set<string>();
    let enrichmentQueueScheduled = false;
    const daemonInstanceId = randomUUID();
    const daemonStartedAt = new Date().toISOString();

  function queueSessionEnrichment(sessionId: string | undefined): void {
    if (!sessionId) return;
    queuedEnrichmentSessionIds.add(sessionId);
    if (enrichmentQueueScheduled) return;
    enrichmentQueueScheduled = true;
    queueMicrotask(() => {
      void flushEnrichmentQueue();
    });
  }

  function queueSessionEnrichments(sessionIds: Iterable<string>): void {
    for (const sessionId of sessionIds) queueSessionEnrichment(sessionId);
  }

  async function flushEnrichmentQueue(): Promise<void> {
    enrichmentQueueScheduled = false;
    const sessionIds = [...queuedEnrichmentSessionIds];
    queuedEnrichmentSessionIds.clear();
    for (let index = 0; index < sessionIds.length; index += 1) {
      const sessionId = sessionIds[index];
      if (!sessionId) continue;
      try {
        await enrichment.ensureCurrent(sessionId);
        indexCanonicalSessionSearch(database, sessionId);
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
      if ((index + 1) % 5 === 0) await yieldToEventLoop();
    }
    if (queuedEnrichmentSessionIds.size > 0 && !enrichmentQueueScheduled) {
      enrichmentQueueScheduled = true;
      queueMicrotask(() => {
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
    const sessions: Array<{ sessionId: string; status: "dry_run" | "succeeded" | "failed"; failureCode?: string; failureMessage?: string }> = [];
    if (dryRun) {
      return {
        dryRun: true,
        failed: 0,
        mode: deterministicOnly ? "deterministic" : "configured",
        requested: sessionIds.length,
        sessions: sessionIds.map((sessionId) => ({ sessionId, status: "dry_run" })),
        succeeded: 0
      };
    }
    const rebuildCoordinator = deterministicOnly ? createEnrichmentCoordinator(database, createDeterministicEnrichmentProvider()) : enrichment;
    let succeeded = 0;
    let failed = 0;
    for (const sessionId of sessionIds) {
      try {
        await rebuildCoordinator.enrich(sessionId);
        indexCanonicalSessionSearch(database, sessionId);
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
      mode: deterministicOnly ? "deterministic" : "configured",
      requested: sessionIds.length,
      sessions,
      succeeded
    };
  }

  function appendStoreRecordToRawJournal(record: StoreRecord): void {
    if (record.recordType === "event") {
      hookRawJournal.appendStoreRecord(record);
      return;
    }
    observerRawJournal.appendStoreRecord(record);
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
        upsertLiveEvent: (event) => sessions.upsertLiveEvent(event),
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
    const nextState = createIngestionState(canonicalLiveEvents(database));
    state.events.length = 0;
    state.events.push(...nextState.events);
    state.seenPayloadHashes.clear();
    for (const hash of nextState.seenPayloadHashes) state.seenPayloadHashes.add(hash);
    state.seenProviderEventIds.clear();
    for (const providerEventId of nextState.seenProviderEventIds) state.seenProviderEventIds.add(providerEventId);

    gitSnapshots.length = 0;
    gitSnapshots.push(...canonicalGitSnapshots(database));
    gitSnapshotSignatures.clear();
    for (const gitSnapshot of gitSnapshots) {
      gitSnapshotSignatures.set(gitSnapshot.sessionId, gitSnapshotSignature(gitSnapshot));
    }
  }

  async function appendGitSnapshotIfChanged(gitSnapshot: GitSnapshot): Promise<boolean> {
    const signature = gitSnapshotSignature(gitSnapshot);
    if (gitSnapshotSignatures.get(gitSnapshot.sessionId) === signature) return false;

    gitSnapshotSignatures.set(gitSnapshot.sessionId, signature);
    gitSnapshots.push(gitSnapshot);
    appendStoreRecordToRawJournal({
      recordId: `git_snapshot:${gitSnapshot.snapshotId}`,
      recordType: "git_snapshot",
      observedAt: gitSnapshot.observedAt,
      value: gitSnapshot
    });
    upsertFileEffectsFromGitSnapshot(database, canonicalSessionIdForSource(gitSnapshot.sessionId), gitSnapshot);
    return true;
  }

  async function clearVolatileAndLegacyCompatibilityState(): Promise<{ removedRecords: number; touchedExternalState: boolean }> {
    const legacy = await store.clearLocalData();
    const hook = hookRawJournal.clearStoreRecords();
    const observer = observerRawJournal.clearStoreRecords();
    state.events.length = 0;
    gitSnapshots.length = 0;
    gitSnapshotSignatures.clear();
    return {
      removedRecords: legacy.removedRecords + hook.removedRecords + observer.removedRecords,
      touchedExternalState: false
    };
  }

  function refreshVolatileStateFromRawRecords(): void {
    const records = [
      ...store.readAll(),
      ...hookRawJournal.pageStoreRecords({ limit: 500 }).records,
      ...observerRawJournal.pageStoreRecords({ limit: 500 }).records
    ];
    state.events.length = 0;
    state.events.push(...records.filter((record) => record.recordType === "event").map((record) => record.value as NormalizedEvent));
    gitSnapshots.length = 0;
    gitSnapshots.push(...records.filter((record) => record.recordType === "git_snapshot").map((record) => record.value as GitSnapshot));
    gitSnapshotSignatures.clear();
    for (const gitSnapshot of gitSnapshots) {
      gitSnapshotSignatures.set(gitSnapshot.sessionId, gitSnapshotSignature(gitSnapshot));
    }
  }

  async function refreshKnownGitSnapshots(): Promise<number> {
    let refreshed = 0;
    for (const event of latestRefreshableGitEvents()) {
      if (!event?.sessionId || event.type === "session.completed") continue;
      const gitSnapshot = await collectGitSnapshot(event, { includeDiffStats: false });
      if (!gitSnapshot) continue;
      if (await appendGitSnapshotIfChanged(gitSnapshot)) refreshed += 1;
    }
    return refreshed;
  }

  function latestRefreshableGitEvents(): NormalizedEvent[] {
    const eventsBySession = new Map<string, NormalizedEvent>();
    const eventWindow = state.events.slice(-100);
    for (let index = eventWindow.length - 1; index >= 0 && eventsBySession.size < 5; index -= 1) {
      const event = eventWindow[index];
      if (!event?.sessionId || eventsBySession.has(event.sessionId)) continue;
      if (!event.workspace?.cwd && !event.workspace?.repoRoot && !event.workspace?.worktreePath) continue;
      eventsBySession.set(event.sessionId, event);
    }
    return [...eventsBySession.values()];
  }

  let gitRefreshPromise: Promise<number> | undefined;
  function refreshKnownGitSnapshotsSingleFlight(): Promise<number> {
    gitRefreshPromise ??= refreshKnownGitSnapshots().finally(() => {
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

  function buildAndPersistSourcesSetup() {
    const setup = buildSourcesSetupState(database, { now: new Date().toISOString() });
    saveSourceSetupState(database, setup);
    return setup;
  }

  function cachedSourceScanResult(): SourceScanResult {
    const generatedAt = latestScan?.generatedAt ?? new Date().toISOString();
    return {
      adapters: getAdapterStatuses(database)
        .filter((adapter) => adapter.runtime !== "gemini_cli")
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

  async function importMetadataSources(sources: DiscoveredSource[], controls?: ImportJobControls): Promise<ImportWorkResult> {
    const result = emptyImportResult();
    for (const source of sources) {
      const adapter = adapterForRuntime(source.runtime);
      if (!adapter) continue;
      controls?.throwIfCancelled();
      controls?.updateProgress({ currentPath: source.path ?? source.sourceId });
      let recordsSinceYield = 0;
      for await (const record of adapter.backfill(source)) {
        controls?.throwIfCancelled();
        const { sessionId } = ingestAdapterRecord(database, record, {
          hostId: `host:${config.host}`,
          hostname: config.host,
          runtimeKind: source.runtime
        });
        if (sessionId) indexCanonicalSessionSearch(database, sessionId);
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
        if (recordsSinceYield >= 25) {
          recordsSinceYield = 0;
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
          controls?.throwIfCancelled();
        }
      }
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
        if (!transcriptSource.path || sourceIsExcluded(database, transcriptSource.path)) {
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
          const nextOffset = offsetFromSourceRecordKey(record.sourceRecordKey) ?? latestOffset;
          cursorContext = cursorContextFromRecord(record, cursorContext);
          const { sessionId } = ingestAdapterRecord(database, record, {
            cursor: {
              byteOffset: nextOffset,
              ...cursorContext
            },
            hostId: `host:${config.host}`,
            hostname: config.host,
            runtimeKind: source.runtime
          });
          latestOffset = nextOffset;
          if (sessionId) {
            indexCanonicalSessionSearch(database, sessionId);
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

  async function importTranscriptSourcesWithLedger(
    sources: DiscoveredSource[],
    controls: ImportJobControls,
    scope: ImportScopeDto = defaultTranscriptImportScope()
  ): Promise<ImportWorkResult> {
    const result = emptyImportResult();
    const runtime = sources[0]?.runtime ?? "codex";
    const transcriptFiles = (
      await Promise.all(sources.map((source) => transcriptSources(source)))
    ).flat().filter((source) => !source.path || !sourceIsExcluded(database, source.path));
    const cursors = readCursorsForSources(transcriptFiles);
    controls.updateProgress({
      currentPath: sources[0]?.path ?? sources[0]?.sourceId ?? runtime,
      heartbeatAt: new Date().toISOString(),
      stage: "manifest"
    });
    const manifest = await createManifestForJob(database, {
      cursors,
      generatedAt: new Date().toISOString(),
      importJobId: controls.importJobId,
      importKind: "transcript",
      runtime,
      scope,
      sourceId: sources[0]?.sourceId,
      sources: transcriptFiles
    });
    controls.updateProgress({
      stage: "transcript",
      totalWorkUnits: manifest.units.length,
      skippedWorkUnits: manifest.units.filter((unit) => unit.status === "skipped").length
    });

    for (const unit of manifest.units) {
      controls.throwIfCancelled();
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
      const unitResult = await runImportWorkUnit({
        adapterBackfill: (source) => adapter.backfill(source, source.path ? readCursor(database, source.sourceId, source.path) : undefined),
        db: database,
        hostId: `host:${config.host}`,
        hostname: config.host,
        now: () => new Date().toISOString(),
        onSessionImported: (sessionId) => queueSessionEnrichment(sessionId),
        runtimeKind: unit.runtime,
        workUnitId: unit.workUnitId
      });
      result.discoveredCount += unit.estimatedRecords ?? unitResult.processed;
      result.processedCount += unitResult.processed;
      result.importedCount += unitResult.imported;
      result.failureCount += unitResult.failed;
      if (unit.sourcePath) await updateCursorAfterWorkUnit(unit);
      controls.updateProgress({
        completedWorkUnits: listImportWorkUnits(database, { manifestId: unit.manifestId, status: "succeeded", limit: 100_000 }).length,
        currentPath: unit.sourcePath ?? unit.sourceSessionId ?? unit.workUnitId,
        failedWorkUnits: listImportWorkUnits(database, { manifestId: unit.manifestId, status: "failed", limit: 100_000 }).length,
        failureCount: result.failureCount,
        heartbeatAt: new Date().toISOString(),
        importedCount: result.importedCount,
        processedCount: result.processedCount,
        skippedWorkUnits: listImportWorkUnits(database, { manifestId: unit.manifestId, status: "skipped", limit: 100_000 }).length,
        stage: "transcript"
      });
    }

    const failedUnits = listImportWorkUnits(database, { importJobId: controls.importJobId, status: "failed", limit: 100_000 }).length;
    const skippedUnits = listImportWorkUnits(database, { importJobId: controls.importJobId, status: "skipped", limit: 100_000 }).length;
    const report = buildImportCompletionReport(database, {
      failedUnits,
      generatedAt: new Date().toISOString(),
      importJobId: controls.importJobId,
      recordsFailed: result.failureCount,
      recordsImported: result.importedCount,
      recordsSkipped: result.queuedCount,
      runtime,
      skippedUnits,
      status: result.failureCount > 0 && result.importedCount > 0 ? "succeeded_with_issues" : "succeeded",
      transcriptsImported: result.importedCount
    });
    updateImportJob(database, controls.importJobId, {
      completionReport: report,
      summary: {
        failureGroups: listImportFailureGroups(database, controls.importJobId),
        manifest: manifest.summary
      },
      updatedAt: new Date().toISOString()
    });
    return result;
  }

  function runImportWorkerForSource(importKind: ImportJobKind, source: DiscoveredSource, controls: ImportJobControls): Promise<ImportWorkResult> {
    if (importKind === "metadata") return importMetadataSources([source], controls);
    if (importKind === "transcript") return importTranscriptSourcesWithLedger([source], controls);
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

  async function queueAdapterMetadataImports(runtime?: string): Promise<{ jobs: ReturnType<typeof queueImportJob>[]; sources: number }> {
    const sources = (await discoverAllSourcesAndPersist()).filter((source) => !runtime || source.runtime === runtime);
    const jobs = sources.map((source) =>
      queueImportJob(database, { importKind: "metadata", sourceId: source.sourceId }, (controls) => importMetadataSources([source], controls))
    );
    return { jobs, sources: sources.length };
  }

  async function queueAdapterTranscriptImports(runtime?: string): Promise<{ jobs: ReturnType<typeof queueImportJob>[]; sources: number }> {
    if (runtime && isRuntimeKind(runtime) ? !transcriptImportApprovedForRuntime(runtime) : !transcriptImportApproved(database)) {
      throw clientError("Transcript import requires persisted source review approval.");
    }
    const sources = (await discoverAllSourcesAndPersist()).filter((source) => !runtime || source.runtime === runtime);
    const jobs = sources.map((source) =>
      queueImportJob(database, { importKind: "transcript", sourceId: source.sourceId }, (controls) => importTranscriptSources([source], controls))
    );
    return { jobs, sources: sources.length };
  }

  function scheduleHookTranscriptCatchup(event: NormalizedEvent): void {
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
          message: "Codex hook included a transcriptPath, but hook transcript catch-up is disabled.",
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
  }

  async function importHookTranscriptIfApproved(event: NormalizedEvent): Promise<void> {
    if (!transcriptImportApproved(database)) return;

    try {
      const source = await transcriptSourceFromHookEvent(event, config.codexHomeDir);
      if (!source?.path || sourceIsExcluded(database, source.path)) return;
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
        message: "Codex hook transcript catch-up failed; live hook ingestion was kept.",
        receivedAt: new Date().toISOString()
      });
    }
  }

  function shouldDeferLiveEnrichmentToHookTranscript(event: NormalizedEvent): boolean {
    return config.hookTranscriptCatchupEnabled && transcriptImportApproved(database) && Boolean(hookTranscriptPath(event));
  }

  function shouldQueueHookTranscriptEnrichment(event: NormalizedEvent): boolean {
    return event.type === "session.completed";
  }

  function scheduleRecentHookTranscriptCatchups(reason: "approval" | "startup"): void {
    if (!config.hookTranscriptCatchupEnabled || !transcriptImportApproved(database)) return;
    const events = recentHookEventsWithTranscriptPaths(database, codexHookSource.sourceId, HOOK_TRANSCRIPT_RECOVERY_LIMIT);
    if (events.length === 0) return;

    recordRuntimeDiagnostic({
      details: {
        limit: HOOK_TRANSCRIPT_RECOVERY_LIMIT,
        reason,
        scheduled: events.length
      },
      kind: "hook_transcript_catchup_recovery_scheduled",
      message: `Scheduled ${events.length} recent Codex hook transcript catch-up${events.length === 1 ? "" : "s"}.`,
      severity: "info"
    });

    for (const event of events) scheduleHookTranscriptCatchup(event);
  }

  function scheduleRecentHookTranscriptCatchupsForSessions(sourceSessionIds: Set<string>): void {
    if (!config.hookTranscriptCatchupEnabled || !transcriptImportApproved(database) || sourceSessionIds.size === 0) return;
    const events = recentHookEventsWithTranscriptPathsForSessions(database, codexHookSource.sourceId, sourceSessionIds, HOOK_TRANSCRIPT_RECOVERY_LIMIT);
    for (const event of events) scheduleHookTranscriptCatchup(event);
  }

  function approveTranscriptImports(runtime?: RuntimeKind): void {
    approveTranscriptImport(database, {
      approvedAt: new Date().toISOString(),
      reason: "Source exclusions reviewed before transcript ingestion."
    });
    if (runtime) {
      setRuntimePolicy(database, {
        decidedAt: new Date().toISOString(),
        enabled: true,
        policyKind: "transcript_import",
        reason: "Coding harness transcript import approved.",
        runtime
      });
    }
    if (!runtime || runtime === "codex") scheduleRecentHookTranscriptCatchups("approval");
  }

  function transcriptImportApprovedForRuntime(runtime: RuntimeKind): boolean {
    return getRuntimePolicy(database, runtime, "transcript_import") || transcriptImportApproved(database);
  }

  function defaultTranscriptImportScope(): ImportScopeDto {
    return { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 };
  }

  function importScopeFromBody(body: Record<string, unknown>): ImportScopeDto {
    const candidate = objectRecord(body.importScope);
    const mode = typeof candidate.mode === "string" ? candidate.mode : undefined;
    return {
      days: typeof candidate.days === "number" && candidate.days > 0 ? candidate.days : 30,
      includeChangedSinceCursor: candidate.includeChangedSinceCursor !== false,
      mode: mode === "metadata_all" || mode === "transcript_full" || mode === "enrichment_missing" ? mode : "transcript_recent",
      unitLimit: typeof candidate.unitLimit === "number" && candidate.unitLimit >= 0 ? candidate.unitLimit : 500
    };
  }

  function readCursorsForSources(sources: DiscoveredSource[]): Map<string, NonNullable<ReturnType<typeof readCursor>>> {
    const cursors = new Map<string, NonNullable<ReturnType<typeof readCursor>>>();
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
    hookRawJournal.pruneStoreRecords(rawSourceRetentionPolicy);
    observerRawJournal.pruneStoreRecords(rawSourceRetentionPolicy);
    return { removedRecords: result.removedRecords, touchedExternalState: false };
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
    const retainedGitSnapshots = gitSnapshots.filter((snapshot) => !sourceSessionIds.has(snapshot.sessionId));
    gitSnapshots.length = 0;
    gitSnapshots.push(...retainedGitSnapshots);
    gitSnapshotSignatures.clear();
    for (const gitSnapshot of gitSnapshots) {
      gitSnapshotSignatures.set(gitSnapshot.sessionId, gitSnapshotSignature(gitSnapshot));
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

  async function handleDaemonRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url || "/", `http://${config.host}:${config.port}`);

    if (request.method === "OPTIONS") {
      sendJson(request, response, config.allowedOrigins, 204, undefined);
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {

      const health = buildMastheadHealth(
        config,
        database,
        {
          daemonInstanceId,
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
        setup: buildAndPersistSourcesSetup()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sources/advanced") {
      sendJson(request, response, config.allowedOrigins, 200, {
        advanced: buildAndPersistSourcesSetup().advanced,
        ok: true
      });
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
          const sources = adapterScan?.sources ?? [];
          const transcriptFiles = (await Promise.all(sources.map((source) => transcriptSources(source)))).flat();
          const summary = await buildImportManifestPlan({
            cursors: readCursorsForSources(transcriptFiles),
            generatedAt,
            importJobId: `preview:${runtime}:${generatedAt}`,
            importKind: "transcript",
            runtime,
            scope,
            sourceId: sources[0]?.sourceId,
            sources: transcriptFiles
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
        const importTranscripts = body.importTranscripts === true;
        if (importTranscripts && body.transcriptApproved === true) {
          for (const runtime of runtimes) approveTranscriptImports(runtime);
        }
        if (importTranscripts && !runtimes.every((runtime) => transcriptImportApprovedForRuntime(runtime))) {
          sendJson(request, response, config.allowedOrigins, 409, {
            ok: false,
            error: "Transcript import requires explicit source review approval."
          });
          return;
        }
        const result = connectSelectedSources(
          database,
          scan,
          {
            importMetadata: body.importMetadata !== false,
            importTranscripts,
            importScope,
            queueEnrichment: body.queueEnrichment === true,
            runtimes,
            transcriptApproved: body.transcriptApproved === true
          },
          async (kind, runtime, controls) => {
            return runImportWorkerForRuntime(kind, runtime, controls, importScope);
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
        const transcriptsApproved = transcriptImportApproved(database);
        const transcripts = transcriptsApproved ? await queueAdapterTranscriptImports(runtime) : { jobs: [], sources: 0 };
        const jobs = [...metadata.jobs, ...transcripts.jobs];
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          jobs,
          metadataJobs: metadata.jobs,
          queued: jobs.length,
          setup: buildAndPersistSourcesSetup(),
          skipped: transcriptsApproved ? 0 : 1,
          sources: metadata.sources + transcripts.sources,
          transcriptJobs: transcripts.jobs
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

    if (request.method === "GET" && url.pathname === "/projection") {
      const selectedSessionId = url.searchParams.get("selectedSessionId") || url.searchParams.get("expandedSessionId") || undefined;
      const headlineMode = (config.liveCopyEnabled ?? config.llmCopyEnabled) && config.openaiApiKey?.trim() ? "llm" : "offline";
      const projectionSessionIds = latestProjectionSessionIds(state.events, selectedSessionId);
      scheduleRecentHookTranscriptCatchupsForSessions(projectionSessionIds);
      const projectionEvents = state.events.filter((event) => event.sessionId && projectionSessionIds.has(event.sessionId));
      const projectionGitSnapshots = gitSnapshots.filter((snapshot) => projectionSessionIds.has(snapshot.sessionId));
      const sessionHeadlineViews = currentBoardHeadlineFrames(
        database,
        [...projectionSessionIds].map((sourceSessionId) => ({
          sessionId: canonicalSessionIdForSource(sourceSessionId),
          sourceSessionId
        }))
      );
      const liveEnvelope = projectLiveEvents(projectionEvents, projectionGitSnapshots, {
        selectedSessionId,
        sessionEnrichments: liveProjectionEnrichments(database, projectionSessionIds),
        sessionHeadlineViews,
        sessionTranscriptFacts: liveProjectionTranscriptFacts(database, projectionSessionIds),
        headlineMode,
        diagnostics: state.diagnostics.length
      });
      liveEnvelope.events = state.events.length;
      liveEnvelope.gitSnapshots = gitSnapshots.length;
      liveEnvelope.projection = await boardHeadlineEnricher.enrichProjection(liveEnvelope.projection);
      liveEnvelope.projection = attachCanonicalCardIds(liveEnvelope.projection, {
        hostId: `host:${config.host}`,
        runtimeKind: "codex"
      });
      liveEnvelope.projection = withSessionTokenTotals(database, liveEnvelope.projection);
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
        summary: getLogbookSummary(database)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/usage/summary") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        usage: getUsageStats(database, usageWindowFromUrl(url))
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/logbook/search") {
      const result = querySessions(database, sessionQueryFromUrl(url));
      sendJson(request, response, config.allowedOrigins, 200, { ok: true, ...result });
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

    if (request.method === "GET" && url.pathname === "/settings/hooks/codex") {
      sendJson(request, response, config.allowedOrigins, 200, {
        hooks: await getCodexHookSettings(database, config),
        ok: true
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/settings/hooks/codex/install") {
      try {
        sendJson(request, response, config.allowedOrigins, 202, {
          hooks: await installCodexHooks(database, config),
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

    if (request.method === "POST" && url.pathname === "/settings/hooks/codex/uninstall") {
      try {
        sendJson(request, response, config.allowedOrigins, 202, {
          hooks: await uninstallCodexHooks(database, config),
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

    if (request.method === "POST" && url.pathname === "/settings/hooks/codex/test") {
      const hookTestEndpoint = `http://${request.headers.host ?? `${config.host}:${config.port}`}/ingest`;
      sendJson(request, response, config.allowedOrigins, 202, {
        hooks: await testCodexHooks(database, config, { endpoint: hookTestEndpoint }),
        ok: true
      });
      return;
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
      const dossier = getSessionDossier(database, decodeURIComponent(sessionDossierMatch[1]));
      sendJson(
        request,
        response,
        config.allowedOrigins,
        dossier ? 200 : 404,
        dossier ? { ok: true, dossier } : { ok: false, error: "session not found" }
      );
      return;
    }

    const sessionTranscriptMatch = url.pathname.match(/^\/sessions\/([^/]+)\/transcript$/);
    if (request.method === "GET" && sessionTranscriptMatch?.[1]) {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        ...getSessionTranscript(database, {
          cursor: url.searchParams.get("cursor") ?? undefined,
          kind: transcriptKindFromUrl(url),
          limit: Number.parseInt(url.searchParams.get("limit") || "100", 10),
          q: url.searchParams.get("q") ?? undefined,
          sessionId: decodeURIComponent(sessionTranscriptMatch[1])
        })
      });
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
      if (adapterId && !RUNTIME_KINDS.includes(adapterId as RuntimeKind)) {
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

    const importUnitsMatch = url.pathname.match(/^\/imports\/([^/]+)\/units$/);
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
        importJobId: importUnitsMatch[1],
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

    const importReportMatch = url.pathname.match(/^\/imports\/([^/]+)\/report$/);
    if (request.method === "GET" && importReportMatch?.[1]) {
      const job = getImportJob(database, importReportMatch[1]);
      sendJson(
        request,
        response,
        config.allowedOrigins,
        job ? 200 : 404,
        job ? { ok: true, report: job.completionReport } : { ok: false, error: "import not found" }
      );
      return;
    }

    const importMatch = url.pathname.match(/^\/imports\/([^/]+)(?:\/(cancel|retry))?$/);
    if (request.method === "GET" && importMatch?.[1] && !importMatch[2]) {
      const job = getImportJob(database, importMatch[1]);
      sendJson(request, response, config.allowedOrigins, job ? 200 : 404, job ? { ok: true, job } : { ok: false, error: "import not found" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/imports") {
      try {
        const body = JSON.parse(await readBody(request)) as { sourceId?: string; kind?: string };
        if (!body.sourceId || !isImportJobKind(body.kind)) throw new Error("sourceId and kind are required");
        const source = await sourceById(body.sourceId);
        if (!source) throw new Error(`Unknown source: ${body.sourceId}`);
        if (body.kind === "transcript" && !transcriptImportApprovedForRuntime(source.runtime)) {
          sendJson(request, response, config.allowedOrigins, 409, {
            ok: false,
            error: "Transcript import requires persisted source review approval."
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
        const job = cancelImportJob(database, importMatch[1]);
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
      const existing = getImportJob(database, importMatch[1]);
      if (!existing) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "import not found" });
        return;
      }
      const source = await sourceById(existing.sourceId);
      if (!source) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "source not found" });
        return;
      }
      const job = queueImportJob(database, { importKind: existing.importKind, sourceId: source.sourceId }, (controls) =>
        runImportWorkerForSource(existing.importKind, source, controls)
      );
      sendJson(request, response, config.allowedOrigins, 202, { ok: true, importJobId: job.importJobId, job });
      return;
    }

    const sourcePolicyMatch = url.pathname.match(/^\/sources\/([^/]+)\/policies$/);
    if (request.method === "PUT" && sourcePolicyMatch?.[1]) {
      try {
        const body = JSON.parse(await readBody(request)) as { policyKind?: string; enabled?: unknown; reason?: string };
        if (!isSourcePolicyKind(body.policyKind) || typeof body.enabled !== "boolean") throw new Error("policyKind and enabled are required");
        setSourcePolicy(database, {
          decidedAt: new Date().toISOString(),
          enabled: body.enabled,
          policyKind: body.policyKind,
          reason: body.reason,
          sourceId: sourcePolicyMatch[1]
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
        if (body.importTranscripts && body.transcriptApproved) {
          for (const runtime of body.runtimes) if (isRuntimeKind(runtime)) approveTranscriptImports(runtime);
        }
        if (body.importTranscripts && !body.runtimes.every((runtime) => isRuntimeKind(runtime) && transcriptImportApprovedForRuntime(runtime))) {
          sendJson(request, response, config.allowedOrigins, 409, {
            ok: false,
            error: "Transcript import requires explicit source review approval."
          });
          return;
        }
        const result = connectSelectedSources(database, scan, body, async (kind, runtime, controls) => {
          return runImportWorkerForRuntime(kind, runtime, controls, body.importScope ?? defaultTranscriptImportScope());
        });
        recordRuntimeDiagnostic({
          details: {
            importMetadata: body.importMetadata,
            importTranscripts: body.importTranscripts,
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

    if (request.method === "GET" && url.pathname === "/data/summary") {
      let scope: DeleteMastheadDataScope;
      try {
        scope = deleteScopeFromUrl(url);
        assertDatabaseIdMatches(url.searchParams.get("databaseId"), database, config);
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

    if (request.method === "GET" && url.pathname === "/data/export") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        export: exportSessionGraph(database)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/data/delete") {
      try {
        const body = await readBody(request);
        const parsed = body ? JSON.parse(body) : {};
        assertDatabaseIdMatches(stringRecordValue(objectRecord(parsed), "databaseId"), database, config);
        const scope = deleteScopeFromBody(parsed);
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
        const body = await readBody(request);
        const parsed = body ? JSON.parse(body) : {};
        assertDatabaseIdMatches(stringRecordValue(objectRecord(parsed), "databaseId"), database, config);
        const preview = getDataSummary(database);
        const result = applyDefaultRetention(database);
        const legacy = await clearRawSourceCopies();
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
        const body = await readBody(request);
        const parsed = body ? JSON.parse(body) : {};
        const policy = parsed.policy ?? parsed;
        const legacy = await store.pruneLocalData(policy);
        const hook = hookRawJournal.pruneStoreRecords(policy);
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
        const result = await clearVolatileAndLegacyCompatibilityState();
        const canonical = deleteAllMastheadData(database);
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

    const adapterImportMatch = url.pathname.match(/^\/adapters\/([^/]+)\/(import-metadata|approve-transcripts|import-transcripts|sync)$/);
    if (request.method === "POST" && adapterImportMatch?.[1] && adapterImportMatch[2]) {
      const runtime = decodeURIComponent(adapterImportMatch[1]);
      if (!isRuntimeKind(runtime) || !adapterForRuntime(runtime)) {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: `Unsupported adapter runtime: ${runtime}` });
        return;
      }
      const action = adapterImportMatch[2];
      if (action === "approve-transcripts") {
        approveTranscriptImports(runtime);
        sendJson(request, response, config.allowedOrigins, 202, { ok: true });
        return;
      }
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
      if (action === "import-transcripts") {
        if (!transcriptImportApprovedForRuntime(runtime)) {
          sendJson(request, response, config.allowedOrigins, 409, {
            ok: false,
            error: "Transcript import requires persisted source review approval."
          });
          return;
        }
        const queued = await queueAdapterTranscriptImports(runtime);
        sendJson(request, response, config.allowedOrigins, 202, {
          ok: true,
          imported: 0,
          jobs: queued.jobs,
          queued: queued.jobs.length,
          skipped: 0,
          sources: queued.sources
        });
        return;
      }
      const metadata = await queueAdapterMetadataImports(runtime);
      const transcriptsApproved = transcriptImportApprovedForRuntime(runtime);
      const transcripts = transcriptsApproved ? await queueAdapterTranscriptImports(runtime) : { jobs: [], sources: 0 };
      const jobs = [...metadata.jobs, ...transcripts.jobs];
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        imported: 0,
        jobs,
        metadataJobs: metadata.jobs,
        queued: jobs.length,
        skipped: transcriptsApproved ? 0 : 1,
        sources: metadata.sources + transcripts.sources,
        transcriptJobs: transcripts.jobs
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/codex/import-metadata") {
      const queued = await queueAdapterMetadataImports("codex");
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        imported: 0,
        jobs: queued.jobs,
        queued: queued.jobs.length,
        sources: queued.sources
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

    if (request.method === "POST" && url.pathname === "/sources/codex/approve-transcripts") {
      approveTranscriptImports("codex");
      sendJson(request, response, config.allowedOrigins, 202, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/codex/import-transcripts") {
      if (!transcriptImportApprovedForRuntime("codex")) {
        sendJson(request, response, config.allowedOrigins, 409, {
          ok: false,
          error: "Transcript import requires persisted source review approval."
        });
        return;
      }
      const queued = await queueAdapterTranscriptImports("codex");
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        imported: 0,
        jobs: queued.jobs,
        queued: queued.jobs.length,
        skipped: 0,
        sources: queued.sources
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/ingest") {
      const body = await readBody(request);
      const receivedAt = new Date().toISOString();
      const adapterRecord = adapterRecordFromCodexHook(body, receivedAt);
      const event = adapterRecord.normalized.value as NormalizedEvent | undefined;

      if (!event) {
        const diagnostic = toCodexHookDiagnostic(adapterRecord.diagnostics[0], receivedAt);
        state.diagnostics.push(diagnostic);
        sendJson(request, response, config.allowedOrigins, 400, {
          ok: false,
          status: "malformed",
          diagnostic,
          events: state.events.length
        });
        return;
      }
      const result = ingestNormalizedEvent(event, state);

      if (result.status === "accepted") {
        const sessionId = sessions.upsertLiveEvent(result.event);
        if (sessionId) {
          indexCanonicalSessionSearch(database, sessionId);
          if (!shouldDeferLiveEnrichmentToHookTranscript(result.event)) queueSessionEnrichment(sessionId);
          scheduleHookTranscriptCatchup(result.event);
        }
        appendStoreRecordToRawJournal({
          recordId: `event:${result.event.eventId}`,
          recordType: "event",
          observedAt: result.event.occurredAt,
          value: result.event
        });
        const gitSnapshot = await collectGitSnapshot(result.event);
        if (gitSnapshot) await appendGitSnapshotIfChanged(gitSnapshot);
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
  const startupHookTranscriptCatchupTimer = setTimeout(() => {
    scheduleRecentHookTranscriptCatchups("startup");
  }, 1000).unref();

  return {
    server,
    database,
    startBackgroundHydration,
    waitForBackgroundHydration: () => hydrationPromise,
    close: () => {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await hydrationPromise;
        await new Promise<void>((resolve) => {
        if (gitRefreshTimer) clearInterval(gitRefreshTimer);
        clearTimeout(startupHookTranscriptCatchupTimer);
        server.close(() => {
          try {
            checkpointMastheadDatabase(database);
          } catch (error) {
            console.error("[masthead] WAL checkpoint failed during shutdown", error);
          } finally {
            closeDatabase(database);
            void writerLock.release().finally(resolve);
          }
        });
      });
      })();
      return closePromise;
    }
  };
  } catch (error) {
    database.close();
    throw error;
  }
  } catch (error) {
    await writerLock.release();
    throw error;
  }
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

  const directory = dirname(databasePath);
  const prefix = `${basename(databasePath)}.backup-`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(databasePath, join(directory, `${prefix}${timestamp}`));

  const backups = await Promise.all(
    (await readdir(directory))
      .filter((entry) => entry.startsWith(prefix))
      .map(async (entry) => ({
        entry,
        mtimeMs: (await stat(join(directory, entry))).mtimeMs
      }))
  );
  const staleBackups = backups.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(3);
  await Promise.all(staleBackups.map((backup) => rm(join(directory, backup.entry), { force: true })));
}


function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
  });
}

async function optionalJsonBody(request: IncomingMessage): Promise<unknown> {
  const body = (await readBody(request)).trim();
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

const rawSourceRetentionPolicy = {
  keepLatest: 0,
  keepUnresolvedAttention: false,
  recordTypes: ["event", "git_snapshot", "attention_item", "conflict_card"] as Array<StoreRecord["recordType"]>
};

const CANONICAL_LIVE_REPLAY_LIMIT = 1_000;
const LIVE_PROJECTION_SESSION_LIMIT = 24;

function canonicalLiveEvents(database: MastheadDatabase): NormalizedEvent[] {
  return canonicalStoreRecords(database, [codexHookSource.sourceId], CANONICAL_LIVE_REPLAY_LIMIT)
    .filter((record): record is Extract<StoreRecord, { recordType: "event" }> => record.recordType === "event")
    .map((record) => record.value);
}

function canonicalGitSnapshots(database: MastheadDatabase): GitSnapshot[] {
  return canonicalStoreRecords(database, ["masthead-git-observer"], CANONICAL_LIVE_REPLAY_LIMIT)
    .filter((record): record is Extract<StoreRecord, { recordType: "git_snapshot" }> => record.recordType === "git_snapshot")
    .map((record) => record.value);
}

export function canonicalStoreRecords(database: MastheadDatabase, sourceIds: string[], limit = LIVE_BOARD_RAW_RECORD_LIMIT): StoreRecord[] {
  if (sourceIds.length === 0) return [];
  const placeholders = sourceIds.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT payload_json
      FROM (
        SELECT raw_event_id, observed_at, payload_json
        FROM raw_events
        WHERE source_id IN (${placeholders})
        ORDER BY observed_at DESC, raw_event_id DESC
        LIMIT ?
      )
      ORDER BY observed_at ASC, raw_event_id ASC`
    )
    .all(...sourceIds, Math.max(1, Math.min(limit, CANONICAL_LIVE_REPLAY_LIMIT))) as Array<{ payload_json: string }>;
  return rows.map((row) => parseStoreRecord(row.payload_json)).filter((record): record is StoreRecord => Boolean(record));
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

function liveSessionCount(events: NormalizedEvent[]): number {
  return new Set(events.map((event) => event.sessionId).filter((sessionId): sessionId is string => Boolean(sessionId))).size;
}

function isRawSourceStoreRecord(record: StoreRecord): boolean {
  return rawSourceRetentionPolicy.recordTypes.includes(record.recordType);
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

function toCodexHookDiagnostic(diagnostic: AdapterDiagnostic | undefined, receivedAt: string): CodexHookDiagnostic {
  return {
    code: diagnostic?.code === "malformed_json" ? "malformed_json" : "invalid_payload",
    details: diagnostic?.details,
    message: diagnostic?.message ?? "Codex hook adapter could not normalize the payload.",
    receivedAt
  };
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
    schemaVersion: source.runtime === "codex" ? "codex-transcript-jsonl" : source.schemaVersion,
    sourceId: `${source.sourceId}:${relative(sourcePath, file).replaceAll("\\", "/")}`
  }));
}

async function transcriptSourceFromHookEvent(event: NormalizedEvent, homeDir: string): Promise<DiscoveredSource | undefined> {
  const transcriptPath = hookTranscriptPath(event);
  if (!transcriptPath || !transcriptPath.endsWith(".jsonl") || !isAbsolute(transcriptPath)) return undefined;

  const codexRoot = join(homeDir, ".codex");
  const roots = [
    { id: "sessions", path: join(codexRoot, "sessions") },
    { id: "archived-sessions", path: join(codexRoot, "archived_sessions") }
  ];

  for (const root of roots) {
    const relativePath = relative(root.path, transcriptPath).replaceAll("\\", "/");
    if (!relativePath || relativePath.startsWith("../") || relativePath === ".." || isAbsolute(relativePath)) continue;
    const rootRealPath = await realpath(root.path);
    const transcriptRealPath = await realpath(transcriptPath);
    const realRelativePath = relative(rootRealPath, transcriptRealPath).replaceAll("\\", "/");
    if (!realRelativePath || realRelativePath.startsWith("../") || realRelativePath === ".." || isAbsolute(realRelativePath)) continue;
    return {
      confidence: "authoritative",
      path: transcriptPath,
      runtime: "codex",
      runtimeVersion: "file",
      schemaVersion: "codex-transcript-jsonl",
      sourceId: `codex-${root.id}:${relativePath}`,
      sourceKind: "jsonl"
    };
  }

  return undefined;
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

function offsetFromSourceRecordKey(sourceRecordKey: string): number | undefined {
  const offset = Number.parseInt(sourceRecordKey.split(":").at(-1) ?? "", 10);
  return Number.isFinite(offset) ? offset : undefined;
}

type TranscriptCursorContext = {
  sourceSessionId?: string;
  cwd?: string;
  model?: string;
};

function cursorContextFromCursor(cursor: ReturnType<typeof readCursor>): TranscriptCursorContext {
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

function withSessionTokenTotals(db: MastheadDatabase, projection: LiveBoardProjection): LiveBoardProjection {
  const sessionIds = [
    ...projection.cards.map((card) => card.sessionId),
    projection.expandedSession?.sessionId,
    projection.selectedSession?.sessionId
  ].filter((sessionId): sessionId is string => Boolean(sessionId));
  const tokenTotals = getSessionTokenTotals(db, sessionIds);
  if (tokenTotals.size === 0) return projection;

  const withTokens = <T extends SessionCardView | undefined>(session: T): T => {
    if (!session) return session;
    const totalTokens = tokenTotals.get(session.sessionId);
    if (totalTokens === undefined) return session;
    return { ...session, totalTokens };
  };

  return {
    ...projection,
    cards: projection.cards.map((card) => withTokens(card)),
    expandedSession: withTokens(projection.expandedSession),
    selectedSession: withTokens(projection.selectedSession)
  };
}

function attachCanonicalCardIds(
  projection: LiveBoardProjection,
  context: { hostId: string; runtimeKind: string; runtimeVersion?: string }
): LiveBoardProjection {
  const runtimeId = runtimeIdFor(context.runtimeKind, context.runtimeVersion);
  const withIdentity = <T extends SessionCardView | undefined>(session: T): T => {
    if (!session) return session;
    return {
      ...session,
      canonicalSessionId: session.canonicalSessionId ?? canonicalSessionId(context.hostId, runtimeId, session.sourceSessionId ?? session.sessionId),
      hostId: session.hostId ?? context.hostId,
      runtime: session.runtime ?? context.runtimeKind,
      sourceSessionId: session.sourceSessionId ?? session.sessionId
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
    model: url.searchParams.get("model") ?? undefined,
    offset: Number.parseInt(url.searchParams.get("offset") || "0", 10),
    project: url.searchParams.get("project") ?? undefined,
    query: url.searchParams.get("q") ?? "",
    runtime: url.searchParams.get("runtime") ?? undefined,
    sort: logbookSortFromUrl(url.searchParams.get("sort")),
    state: url.searchParams.get("state") ?? undefined
  };
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
}

function deleteScopeFromBody(value: unknown): DeleteMastheadDataScope {
  const body = objectRecord(value);
  const scope = objectRecord(body.scope ?? body);
  const kind = typeof scope.kind === "string" ? scope.kind : "all";

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
  if (!value) return;
  const currentDatabaseId = settingsRuntimeIdentity(config, database).data.databaseId;
  if (value !== currentDatabaseId) {
    throw clientError("Masthead database changed. Refresh settings before deleting data.");
  }
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

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return typeof value === "string" && (RUNTIME_KINDS as readonly string[]).includes(value);
}

function setupRuntimesFromBody(body: Record<string, unknown>, scan: SourceScanResult): RuntimeKind[] {
  const requested = Array.isArray(body.runtimes) ? body.runtimes.filter((runtime): runtime is RuntimeKind => isRuntimeKind(runtime)) : [];
  if (requested.length > 0) return requested.filter((runtime) => Boolean(adapterForRuntime(runtime)));
  return scan.adapters.filter((adapter) => adapter.sources.length > 0 && adapterForRuntime(adapter.runtime)).map((adapter) => adapter.runtime);
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
