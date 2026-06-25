import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { adapterRecordFromCodexHook, codexHookSource } from "../adapters/codex/hookAdapter.ts";
import { discoverCodexSources } from "../adapters/codex/discovery.ts";
import { importCodexMetadata } from "../adapters/codex/metadataImport.ts";
import { parseCodexTranscript } from "../adapters/codex/transcriptParser.ts";
import { createEnrichmentCoordinator } from "../enrichment/enrichmentCoordinator.ts";
import { createOpenAIEnrichmentProvider } from "../enrichment/openAIProvider.ts";
import type { AdapterDiagnostic } from "../adapters/types.ts";
import type { DiscoveredSource } from "../adapters/types.ts";
import { createIngestionState, ingestNormalizedEvent } from "../core/ingestion.ts";
import { acquireDatabaseWriterLock, type DatabaseWriterLock } from "../core/daemonOwnership.ts";
import { projectLiveEvents } from "../core/liveProjection.ts";
import { createOpenAISessionCopyEnricher } from "../core/openaiSessionCopy.ts";
import { createFileBackedStore, type StoreRecord } from "../core/store.ts";
import type { ReviewDisposition } from "../core/store.ts";
import type { CodexHookDiagnostic } from "../core/codexAdapter.ts";
import type { GitSnapshot, NormalizedEvent } from "../core/types.ts";
import type { DaemonConfig } from "./config.ts";
import {
  applyDefaultRetention,
  deleteAllMastheadData,
  deleteMastheadData,
  exportSessionGraph,
  getDataSummary,
  type DeleteMastheadDataScope
} from "./db/dataLifecycleRepository.ts";
import { getImportJob, listImportJobs, type ImportJobKind } from "./db/importJobRepository.ts";
import { listMcpAuditRows } from "./db/mcpQueryRepository.ts";
import { liveProjectionEnrichments } from "./db/enrichmentViewRepository.ts";
import { createRawEventRepository } from "./db/rawEventRepository.ts";
import { listReviewDispositions, upsertReviewDisposition } from "./db/reviewDispositionRepository.ts";
import { readCursor, upsertCursor } from "./db/cursorRepository.ts";
import { indexCanonicalSessionSearch, searchSessions } from "./db/searchRepository.ts";
import { getLogbookSummary } from "./db/logbookSummaryRepository.ts";
import { getSessionDetail, getSessionExcerpts, listProjects, querySessions, type SessionQuery } from "./db/sessionQueryRepository.ts";
import { hasPendingMigrations, migrateDatabase } from "./db/schema.ts";
import { createSessionRepository, ingestAdapterRecord } from "./db/sessionRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "./db/sqlite.ts";
import {
  legacyCandidatesFromDirectory,
  legacyDataMigrationCompleted,
  markLegacyDataMigrationCompleted,
  maybeCopyLegacySqliteBeforeOpen
} from "./legacyDataMigration.ts";
import { addSourceExclusion, approveTranscriptImport, sourceIsExcluded, transcriptImportApproved } from "./db/sourceRepository.ts";
import { setSourcePolicy, type SourcePolicyKind } from "./db/sourcePolicyRepository.ts";
import { cancelImportJob, queueImportJob, type ImportJobControls, type ImportWorkResult } from "./import/importCoordinator.ts";
import { countImportedRecord, emptyImportResult } from "./import/importWorker.ts";
import { getAdapterStatuses, getSourceStatuses } from "./import/sourceStatusService.ts";
import { discoverSourceSnapshot, type SourceDiscoverySnapshot } from "./sources/sourceDiscoveryService.ts";
import { collectGitSnapshot, gitSnapshotSignature } from "./gitSnapshots.ts";
import { buildMastheadHealth } from "./healthService.ts";
import { getMcpStatus, listMcpTools } from "./mcpStatusService.ts";
import {
  getCodexHookSettings,
  getSettingsState,
  installCodexHooks,
  testCodexHooks,
  uninstallCodexHooks
} from "./settingsService.ts";

export type MastheadDaemon = {
  server: Server;
  database: MastheadDatabase;
  startBackgroundHydration: () => void;
  close: () => Promise<void>;
};

export async function createMastheadDaemon(config: DaemonConfig): Promise<MastheadDaemon> {
  await mkdir(dirname(config.storePath), { recursive: true });
  const writerLock = await acquireDatabaseWriterLock(config.dataDirectory ?? dirname(config.databasePath));

  try {
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
      if (hasPendingMigrations(database)) {
        await backupDatabaseBeforeMigration(config.databasePath);
      }
      migrateDatabase(database);

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
    const existingRecords = store.readAll();
    const legacyNdjsonRecords = legacyEventStore?.readAll() ?? [];
    const legacyNdjsonMigrationKey = "legacy-events-ndjson-v1";
    const shouldHydrateLegacyNdjson =
      !legacySqliteMigration.copied &&
      legacyNdjsonRecords.length > 0 &&
      !legacyDataMigrationCompleted(database, legacyNdjsonMigrationKey);
    const state = createIngestionState(canonicalLiveEvents(database));
    const gitSnapshots = canonicalGitSnapshots(database);
    const gitSnapshotSignatures = new Map(gitSnapshots.map((snapshot) => [snapshot.sessionId, gitSnapshotSignature(snapshot)]));
    const sessionCopyEnricher = createOpenAISessionCopyEnricher({
      enabled: config.llmCopyEnabled,
      apiKey: config.openaiApiKey,
      model: config.openaiModel
    });
    const enrichment = createEnrichmentCoordinator(
      database,
      createOpenAIEnrichmentProvider({
        apiKey: config.openaiApiKey,
        enabled: config.llmCopyEnabled,
        model: config.openaiModel
      })
    );
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
    for (const sessionId of sessionIds) {
      try {
        await enrichment.ensureCurrent(sessionId);
        indexCanonicalSessionSearch(database, sessionId);
      } catch (error) {
        console.error("[masthead] session enrichment failed", { sessionId, error });
      }
    }
    if (queuedEnrichmentSessionIds.size > 0 && !enrichmentQueueScheduled) {
      enrichmentQueueScheduled = true;
      queueMicrotask(() => {
        void flushEnrichmentQueue();
      });
    }
  }

  async function appendStoreRecord(record: StoreRecord, journal = hookRawJournal): Promise<void> {
    journal.appendStoreRecord(record);
    await store.append(record);
  }

  let closed = false;
  let closePromise: Promise<void> | undefined;
  let hydrationStarted = false;
  let hydrationPromise: Promise<void> = Promise.resolve();

  function startBackgroundHydration(): void {
    if (hydrationStarted) return;
    hydrationStarted = true;
    hydrationPromise = (async () => {
      await hydrateDatabaseFromStoreRecords(existingRecords);
      if (shouldHydrateLegacyNdjson) {
        const missingLegacyRecords = missingStoreRecords(legacyNdjsonRecords);
        if (missingLegacyRecords.length > 0) {
          await hydrateDatabaseFromStoreRecords(missingLegacyRecords, { skipHydratedCheck: true });
        }
        markLegacyDataMigrationCompleted(database, legacyNdjsonMigrationKey, {
          source: legacyNdjsonCandidate?.path,
          importedRecords: missingLegacyRecords.length,
          totalRecords: legacyNdjsonRecords.length
        });
      }
    })().catch((error: unknown) => {
      console.error("[masthead] background journal hydration failed", error);
    });
  }

  async function hydrateDatabaseFromStoreRecords(
    records: StoreRecord[],
    options: { skipHydratedCheck?: boolean } = {}
  ): Promise<void> {
    if (records.length === 0) return;
    if (!options.skipHydratedCheck && legacyJournalHydrated(records)) {
      indexExistingCanonicalSessions();
      return;
    }

    const batchSize = 100;
    for (let index = 0; index < records.length && !closed; index += batchSize) {
      const batch = records.slice(index, index + batchSize);
      const touchedSessionIds = new Set<string>();
      database.exec("BEGIN IMMEDIATE;");
      try {
        for (const record of batch) {
          if (record.recordType === "event") {
            hookRawJournal.appendStoreRecord(record);
            const sessionId = sessions.upsertLiveEvent(record.value);
            if (sessionId) {
              indexCanonicalSessionSearch(database, sessionId);
              touchedSessionIds.add(sessionId);
            }
            continue;
          }
          observerRawJournal.appendStoreRecord(record);
        }
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
      queueSessionEnrichments(touchedSessionIds);
      await yieldToEventLoop();
    }
    indexExistingCanonicalSessions();
    rebuildLiveStateFromCanonical();
  }

  function legacyJournalHydrated(records: StoreRecord[]): boolean {
    const count = (database.prepare("SELECT COUNT(*) AS count FROM raw_events").get() as { count: number }).count;
    return count >= records.length;
  }

  function missingStoreRecords(records: StoreRecord[]): StoreRecord[] {
    if (records.length === 0) return [];
    const existing = new Set(
      (
        database.prepare("SELECT source_record_key AS sourceRecordKey FROM raw_events").all() as Array<{
          sourceRecordKey: string;
        }>
      ).map((row) => row.sourceRecordKey)
    );
    return records.filter((record) => !existing.has(record.recordId));
  }

  function indexExistingCanonicalSessions(): void {
    const sessionRows = database
      .prepare(
        `SELECT sessions.session_id AS sessionId
        FROM sessions
        LEFT JOIN session_search ON session_search.session_id = sessions.session_id
        WHERE session_search.session_id IS NULL`
      )
      .all() as Array<{ sessionId: string }>;
    if (sessionRows.length === 0) return;
    database.exec("BEGIN IMMEDIATE;");
    try {
      for (const row of sessionRows) {
        indexCanonicalSessionSearch(database, row.sessionId);
      }
      database.exec("COMMIT;");
      queueSessionEnrichments(sessionRows.map((row) => row.sessionId));
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
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
    await appendStoreRecord(
      {
        recordId: `git_snapshot:${gitSnapshot.snapshotId}`,
        recordType: "git_snapshot",
        observedAt: gitSnapshot.observedAt,
        value: gitSnapshot
      },
      observerRawJournal
    );
    return true;
  }

  async function clearInMemoryAndLegacyStore(): Promise<{ removedRecords: number; touchedExternalState: boolean }> {
    const result = await store.clearLocalData();
    state.events.length = 0;
    gitSnapshots.length = 0;
    gitSnapshotSignatures.clear();
    return result;
  }

  async function refreshKnownGitSnapshots(): Promise<number> {
    const eventsBySession = new Map(
      state.events.toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => [event.sessionId, event])
    );

    let refreshed = 0;
    for (const event of eventsBySession.values()) {
      if (!event?.sessionId || event.type === "session.completed") continue;
      const gitSnapshot = await collectGitSnapshot(event);
      if (!gitSnapshot) continue;
      if (await appendGitSnapshotIfChanged(gitSnapshot)) refreshed += 1;
    }
    return refreshed;
  }

  async function discoverSourceSnapshotAndPersist(): Promise<SourceDiscoverySnapshot> {
    const snapshot = await discoverSourceSnapshot({ codexHomeDir: config.codexHomeDir, now: new Date().toISOString(), exclusions: [] });
    getSourceStatuses(database, snapshot.sources);
    return snapshot;
  }

  async function discoverCodexSourcesAndPersist(): Promise<DiscoveredSource[]> {
    const sources = await discoverCodexSources({ homeDir: config.codexHomeDir, now: new Date().toISOString(), exclusions: [] });
    getSourceStatuses(database, sources);
    return sources;
  }

  async function importMetadataSources(sources: DiscoveredSource[], controls?: ImportJobControls): Promise<ImportWorkResult> {
    const result = emptyImportResult();
    for (const source of sources) {
      controls?.throwIfCancelled();
      controls?.updateProgress({ currentPath: source.path ?? source.sourceId });
      for await (const record of importCodexMetadata(source)) {
        controls?.throwIfCancelled();
        const { sessionId } = ingestAdapterRecord(database, record, {
          hostId: `host:${config.host}`,
          hostname: config.host,
          runtimeKind: "codex",
          runtimeVersion: record.source.runtimeVersion
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
      }
    }
    return result;
  }

  async function importTranscriptSources(sources: DiscoveredSource[], controls?: ImportJobControls): Promise<ImportWorkResult> {
    const result = emptyImportResult();
    for (const source of sources) {
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
        for await (const record of parseCodexTranscript(transcriptSource, cursor)) {
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
            runtimeKind: "codex",
            runtimeVersion: record.source.runtimeVersion
          });
          if (sessionId) {
            indexCanonicalSessionSearch(database, sessionId);
            queueSessionEnrichment(sessionId);
            latestOffset = nextOffset;
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

  function runImportWorkerForSource(importKind: ImportJobKind, source: DiscoveredSource, controls: ImportJobControls): Promise<ImportWorkResult> {
    if (importKind === "metadata") return importMetadataSources([source], controls);
    if (importKind === "transcript") return importTranscriptSources([source], controls);
    return Promise.resolve(emptyImportResult());
  }

  async function queueCodexMetadataImports(): Promise<{ jobs: ReturnType<typeof queueImportJob>[]; sources: number }> {
    const sources = await discoverCodexSourcesAndPersist();
    const jobs = sources.map((source) =>
      queueImportJob(database, { importKind: "metadata", sourceId: source.sourceId }, (controls) => importMetadataSources([source], controls))
    );
    return { jobs, sources: sources.length };
  }

  async function queueCodexTranscriptImports(): Promise<{ jobs: ReturnType<typeof queueImportJob>[]; sources: number }> {
    if (!transcriptImportApproved(database)) {
      throw clientError("Transcript import requires persisted source review approval.");
    }
    const sources = await discoverCodexSourcesAndPersist();
    const jobs = sources.map((source) =>
      queueImportJob(database, { importKind: "transcript", sourceId: source.sourceId }, (controls) => importTranscriptSources([source], controls))
    );
    return { jobs, sources: sources.length };
  }

  function approveCodexTranscriptImports(): void {
    approveTranscriptImport(database, {
      approvedAt: new Date().toISOString(),
      reason: "Source exclusions reviewed before transcript ingestion."
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

  const server = createServer(async (request, response) => {
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
          gitSnapshots: gitSnapshots.length
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
          dataDirectory: dirname(config.databasePath),
          databasePath: config.databasePath,
          legacyMigration: {
            copiedSqlite: legacySqliteMigration.copied,
            legacyPath: legacySqliteMigration.legacyPath,
            reason: legacySqliteMigration.reason
          }
        },
        llmCopy: sessionCopyEnricher.status()
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
      const sources = await discoverCodexSourcesAndPersist();
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        sources: getSourceStatuses(database, sources)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/adapters") {
      const snapshot = await discoverSourceSnapshotAndPersist();
      sendJson(request, response, config.allowedOrigins, 200, {
        adapters: getAdapterStatuses(database, snapshot),
        ok: true
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/discover") {
      const sources = await discoverCodexSourcesAndPersist();
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        sources: getSourceStatuses(database, sources)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/projection") {
      const liveEnvelope = projectLiveEvents(state.events, gitSnapshots, {
        selectedSessionId: url.searchParams.get("selectedSessionId") || url.searchParams.get("expandedSessionId") || undefined,
        sessionEnrichments: liveProjectionEnrichments(database),
        diagnostics: state.diagnostics.length
      });
      liveEnvelope.projection = await sessionCopyEnricher.enrichProjection(liveEnvelope.projection);
      sessions.replaceBoardProjection(liveEnvelope.projection, liveEnvelope.generatedAt);
      sendJson(request, response, config.allowedOrigins, 200, liveEnvelope);
      return;
    }

    if (request.method === "GET" && url.pathname === "/logbook/summary") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        summary: getLogbookSummary(database)
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
      sendJson(request, response, config.allowedOrigins, 202, {
        hooks: await testCodexHooks(database, config),
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
      const refreshed = await refreshKnownGitSnapshots();
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        refreshed,
        gitSnapshots: gitSnapshots.length,
        events: state.events.length
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/imports") {
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        imports: listImportJobs(database)
      });
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
        const sources = await discoverCodexSourcesAndPersist();
        const source = sources.find((candidate) => candidate.sourceId === body.sourceId);
        if (!source) throw new Error(`Unknown source: ${body.sourceId}`);
        if (body.kind === "transcript" && !transcriptImportApproved(database)) {
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
      const sources = await discoverCodexSourcesAndPersist();
      const source = sources.find((candidate) => candidate.sourceId === existing.sourceId);
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
        const scope = deleteScopeFromBody(body ? JSON.parse(body) : {});
        const preview = getDataSummary(database, scope);
        const sourceSessionIds =
          scope.kind === "all" || scope.kind === "raw_payloads" ? undefined : sourceSessionIdsForScope(scope);
        const result = deleteMastheadData(database, scope);
        const legacy =
          scope.kind === "all"
            ? await clearInMemoryAndLegacyStore()
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
        sendJson(request, response, config.allowedOrigins, 500, {
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
        const result = await store.pruneLocalData(policy);
        hookRawJournal.pruneStoreRecords(policy);
        observerRawJournal.pruneStoreRecords(policy);
        state.events.length = 0;
        state.events.push(...store.readEvents());
        gitSnapshots.length = 0;
        gitSnapshots.push(...store.readGitSnapshots());
        gitSnapshotSignatures.clear();
        for (const gitSnapshot of gitSnapshots) {
          gitSnapshotSignatures.set(gitSnapshot.sessionId, gitSnapshotSignature(gitSnapshot));
        }
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
        const canonical = deleteAllMastheadData(database);
        const result = await clearInMemoryAndLegacyStore();
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
      if (runtime !== "codex") {
        sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: `Unsupported adapter runtime: ${runtime}` });
        return;
      }
      const action = adapterImportMatch[2];
      if (action === "approve-transcripts") {
        approveCodexTranscriptImports();
        sendJson(request, response, config.allowedOrigins, 202, { ok: true });
        return;
      }
      if (action === "import-metadata") {
        const queued = await queueCodexMetadataImports();
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
        if (!transcriptImportApproved(database)) {
          sendJson(request, response, config.allowedOrigins, 409, {
            ok: false,
            error: "Transcript import requires persisted source review approval."
          });
          return;
        }
        const queued = await queueCodexTranscriptImports();
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
      const metadata = await queueCodexMetadataImports();
      const transcriptsApproved = transcriptImportApproved(database);
      const transcripts = transcriptsApproved ? await queueCodexTranscriptImports() : { jobs: [], sources: 0 };
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
      const queued = await queueCodexMetadataImports();
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
      approveCodexTranscriptImports();
      sendJson(request, response, config.allowedOrigins, 202, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sources/codex/import-transcripts") {
      if (!transcriptImportApproved(database)) {
        sendJson(request, response, config.allowedOrigins, 409, {
          ok: false,
          error: "Transcript import requires persisted source review approval."
        });
        return;
      }
      const queued = await queueCodexTranscriptImports();
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
        await appendStoreRecord({
          recordId: `event:${result.event.eventId}`,
          recordType: "event",
          observedAt: result.event.occurredAt,
          value: result.event
        });
        const sessionId = sessions.upsertLiveEvent(result.event);
        if (sessionId) {
          indexCanonicalSessionSearch(database, sessionId);
          queueSessionEnrichment(sessionId);
        }
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
  });

  const gitRefreshTimer =
    config.gitRefreshMs > 0
      ? setInterval(() => {
          void refreshKnownGitSnapshots();
        }, config.gitRefreshMs).unref()
      : undefined;
  const sourceReconcileTimer = setInterval(() => {
    if (closed) return;
    void discoverCodexSourcesAndPersist().catch((error: unknown) => {
      console.error("[masthead] source reconciliation failed", error);
    });
  }, 60_000).unref();
  queueMicrotask(() => {
    if (closed) return;
    void discoverCodexSourcesAndPersist().catch((error: unknown) => {
      console.error("[masthead] source reconciliation failed", error);
    });
  });

  return {
    server,
    database,
    startBackgroundHydration,
    close: () => {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await hydrationPromise;
        await new Promise<void>((resolve) => {
        if (gitRefreshTimer) clearInterval(gitRefreshTimer);
        clearInterval(sourceReconcileTimer);
        server.close(() => {
          closeDatabase(database);
          void writerLock.release().finally(resolve);
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

const rawSourceRetentionPolicy = {
  keepLatest: 0,
  keepUnresolvedAttention: false,
  recordTypes: ["event", "git_snapshot", "attention_item", "conflict_card"] as Array<StoreRecord["recordType"]>
};

function canonicalLiveEvents(database: MastheadDatabase): NormalizedEvent[] {
  return canonicalStoreRecords(database, [codexHookSource.sourceId])
    .filter((record): record is Extract<StoreRecord, { recordType: "event" }> => record.recordType === "event")
    .map((record) => record.value);
}

function canonicalGitSnapshots(database: MastheadDatabase): GitSnapshot[] {
  return canonicalStoreRecords(database, ["masthead-git-observer"])
    .filter((record): record is Extract<StoreRecord, { recordType: "git_snapshot" }> => record.recordType === "git_snapshot")
    .map((record) => record.value);
}

function canonicalStoreRecords(database: MastheadDatabase, sourceIds: string[]): StoreRecord[] {
  if (sourceIds.length === 0) return [];
  const placeholders = sourceIds.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT payload_json
      FROM raw_events
      WHERE source_id IN (${placeholders})
      ORDER BY observed_at ASC, raw_event_id ASC`
    )
    .all(...sourceIds) as Array<{ payload_json: string }>;
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
  const info = await stat(source.path);
  if (!info.isDirectory()) return [source];
  const files = await jsonlFiles(source.path);
  return files.map((file) => ({
    ...source,
    path: file,
    runtimeVersion: "file",
    sourceId: `${source.sourceId}:${file.slice(source.path?.length ?? 0)}`
  }));
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

function sessionQueryFromUrl(url: URL): SessionQuery {
  return {
    cursor: url.searchParams.get("cursor") ?? undefined,
    dateFrom: url.searchParams.get("dateFrom") ?? undefined,
    dateTo: url.searchParams.get("dateTo") ?? undefined,
    file: url.searchParams.get("file") ?? undefined,
    host: url.searchParams.get("host") ?? undefined,
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
