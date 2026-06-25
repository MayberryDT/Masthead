import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { adapterRecordFromCodexHook, codexHookSource } from "../adapters/codex/hookAdapter.ts";
import { discoverCodexSources } from "../adapters/codex/discovery.ts";
import { importCodexMetadata } from "../adapters/codex/metadataImport.ts";
import { parseCodexTranscript } from "../adapters/codex/transcriptParser.ts";
import type { AdapterDiagnostic } from "../adapters/types.ts";
import type { DiscoveredSource } from "../adapters/types.ts";
import { createIngestionState, ingestNormalizedEvent } from "../core/ingestion.ts";
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
import { getImportJob, listImportJobs, updateImportJob, type ImportJobKind } from "./db/importJobRepository.ts";
import { createRawEventRepository } from "./db/rawEventRepository.ts";
import { listReviewDispositions, upsertReviewDisposition } from "./db/reviewDispositionRepository.ts";
import { readCursor, upsertCursor } from "./db/cursorRepository.ts";
import { indexCanonicalSessionSearch, searchSessions } from "./db/searchRepository.ts";
import { getSessionDetail, getSessionExcerpts, listProjects, querySessions, type SessionQuery } from "./db/sessionQueryRepository.ts";
import { migrateDatabase } from "./db/schema.ts";
import { createSessionRepository, ingestAdapterRecord } from "./db/sessionRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "./db/sqlite.ts";
import { addSourceExclusion, approveTranscriptImport, sourceIsExcluded, transcriptImportApproved } from "./db/sourceRepository.ts";
import { setSourcePolicy, type SourcePolicyKind } from "./db/sourcePolicyRepository.ts";
import { runImportJob, type ImportWorkResult } from "./import/importCoordinator.ts";
import { countImportedRecord, emptyImportResult } from "./import/importWorker.ts";
import { getSourceStatuses } from "./import/sourceStatusService.ts";
import { collectGitSnapshot, gitSnapshotSignature } from "./gitSnapshots.ts";

export type MastheadDaemon = {
  server: Server;
  database: MastheadDatabase;
  startBackgroundHydration: () => void;
  close: () => Promise<void>;
};

export async function createMastheadDaemon(config: DaemonConfig): Promise<MastheadDaemon> {
  await mkdir(dirname(config.storePath), { recursive: true });
  const store = await createFileBackedStore(config.storePath);
  const database = await openMastheadDatabase(config.databasePath);

  try {
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
    indexExistingCanonicalSessions();
    const state = createIngestionState(store.readEvents());
    const gitSnapshots = store.readGitSnapshots();
    const gitSnapshotSignatures = new Map(gitSnapshots.map((snapshot) => [snapshot.sessionId, gitSnapshotSignature(snapshot)]));
    const sessionCopyEnricher = createOpenAISessionCopyEnricher({
      enabled: config.llmCopyEnabled,
      apiKey: config.openaiApiKey,
      model: config.openaiModel
    });

  async function appendStoreRecord(record: StoreRecord, journal = hookRawJournal): Promise<void> {
    journal.appendStoreRecord(record);
    await store.append(record);
  }

  let closed = false;
  let hydrationStarted = false;
  let hydrationPromise: Promise<void> = Promise.resolve();

  function startBackgroundHydration(): void {
    if (hydrationStarted) return;
    hydrationStarted = true;
    hydrationPromise = hydrateDatabaseFromStoreRecords(existingRecords).catch((error: unknown) => {
      console.error("[masthead] background journal hydration failed", error);
    });
  }

  async function hydrateDatabaseFromStoreRecords(records: StoreRecord[]): Promise<void> {
    if (records.length === 0) return;
    if (legacyJournalHydrated(records)) {
      indexExistingCanonicalSessions();
      return;
    }

    const batchSize = 100;
    for (let index = 0; index < records.length && !closed; index += batchSize) {
      const batch = records.slice(index, index + batchSize);
      database.exec("BEGIN IMMEDIATE;");
      try {
        for (const record of batch) {
          if (record.recordType === "event") {
            hookRawJournal.appendStoreRecord(record);
            const sessionId = sessions.upsertLiveEvent(record.value);
            if (sessionId) indexCanonicalSessionSearch(database, sessionId);
            continue;
          }
          observerRawJournal.appendStoreRecord(record);
        }
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
      await yieldToEventLoop();
    }
    indexExistingCanonicalSessions();
  }

  function legacyJournalHydrated(records: StoreRecord[]): boolean {
    const count = (database.prepare("SELECT COUNT(*) AS count FROM raw_events").get() as { count: number }).count;
    return count >= records.length;
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
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }

  function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
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

  async function discoverCodexSourcesAndPersist(): Promise<DiscoveredSource[]> {
    const sources = await discoverCodexSources({ homeDir: config.codexHomeDir, now: new Date().toISOString(), exclusions: [] });
    getSourceStatuses(database, sources);
    return sources;
  }

  async function importMetadataSources(sources: DiscoveredSource[]): Promise<ImportWorkResult> {
    const result = emptyImportResult();
    for (const source of sources) {
      for await (const record of importCodexMetadata(source)) {
        const { sessionId } = ingestAdapterRecord(database, record, {
          hostId: `host:${config.host}`,
          hostname: config.host,
          runtimeKind: "codex",
          runtimeVersion: record.source.runtimeVersion
        });
        if (sessionId) indexCanonicalSessionSearch(database, sessionId);
        countImportedRecord(result, record, Boolean(sessionId));
      }
    }
    return result;
  }

  async function importTranscriptSources(sources: DiscoveredSource[]): Promise<ImportWorkResult> {
    const result = emptyImportResult();
    for (const source of sources) {
      for (const transcriptSource of await transcriptSources(source)) {
        if (!transcriptSource.path || sourceIsExcluded(database, transcriptSource.path)) {
          result.queuedCount += 1;
          continue;
        }
        const cursor = readCursor(database, transcriptSource.sourceId, transcriptSource.path);
        let latestOffset = cursor?.byteOffset ?? 0;
        for await (const record of parseCodexTranscript(transcriptSource, cursor)) {
          const nextOffset = offsetFromSourceRecordKey(record.sourceRecordKey) ?? latestOffset;
          const { sessionId } = ingestAdapterRecord(database, record, {
            cursor: {
              byteOffset: nextOffset
            },
            hostId: `host:${config.host}`,
            hostname: config.host,
            runtimeKind: "codex",
            runtimeVersion: record.source.runtimeVersion
          });
          if (sessionId) {
            indexCanonicalSessionSearch(database, sessionId);
            latestOffset = nextOffset;
          }
          countImportedRecord(result, record, Boolean(sessionId));
        }
        const info = await stat(transcriptSource.path);
        upsertCursor(database, {
          byteOffset: latestOffset,
          contentFingerprint: `${info.size}:${Math.trunc(info.mtimeMs)}`,
          modifiedAt: info.mtime.toISOString(),
          sourceId: transcriptSource.sourceId,
          sourcePath: transcriptSource.path
        });
      }
    }
    return result;
  }

  function runImportWorkerForSource(importKind: ImportJobKind, source: DiscoveredSource): Promise<ImportWorkResult> {
    if (importKind === "metadata") return importMetadataSources([source]);
    if (importKind === "transcript") return importTranscriptSources([source]);
    return Promise.resolve(emptyImportResult());
  }

  async function clearRawSourceCopies(): Promise<{ removedRecords: number; touchedExternalState: false }> {
    const result = await store.deleteRecords(isRawSourceStoreRecord);
    hookRawJournal.pruneStoreRecords(rawSourceRetentionPolicy);
    observerRawJournal.pruneStoreRecords(rawSourceRetentionPolicy);
    state.events.length = 0;
    gitSnapshots.length = 0;
    gitSnapshotSignatures.clear();
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
      sendJson(request, response, config.allowedOrigins, 200, {
        ok: true,
        events: state.events.length,
        diagnostics: state.diagnostics.length,
        gitSnapshots: gitSnapshots.length,
        storePath: config.storePath,
        databasePath: config.databasePath,
        projectionUrl: `http://${config.host}:${config.port}/projection`,
        ingestUrl: `http://${config.host}:${config.port}/ingest`,
        allowedOrigins: config.allowedOrigins,
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
        diagnostics: state.diagnostics.length
      });
      liveEnvelope.projection = await sessionCopyEnricher.enrichProjection(liveEnvelope.projection);
      sessions.replaceBoardProjection(liveEnvelope.projection, liveEnvelope.generatedAt);
      sendJson(request, response, config.allowedOrigins, 200, liveEnvelope);
      return;
    }

    if (request.method === "GET" && url.pathname === "/logbook/search") {
      const result = querySessions(database, sessionQueryFromUrl(url));
      sendJson(request, response, config.allowedOrigins, 200, { ok: true, ...result });
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
        const job = await runImportJob(database, { importKind: body.kind, sourceId: source.sourceId }, () =>
          runImportWorkerForSource(body.kind as ImportJobKind, source)
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
        const job = updateImportJob(database, importMatch[1], {
          status: "cancelled",
          updatedAt: new Date().toISOString()
        });
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
      const job = await runImportJob(database, { importKind: existing.importKind, sourceId: source.sourceId }, () =>
        runImportWorkerForSource(existing.importKind, source)
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

    if (request.method === "POST" && url.pathname === "/sources/codex/import-metadata") {
      const sources = await discoverCodexSourcesAndPersist();
      let imported = 0;
      const jobs = [];
      for (const source of sources) {
        const job = await runImportJob(database, { importKind: "metadata", sourceId: source.sourceId }, () => importMetadataSources([source]));
        imported += job.importedCount;
        jobs.push(job);
      }
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        imported,
        jobs,
        sources: sources.length
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
      approveTranscriptImport(database, {
        approvedAt: new Date().toISOString(),
        reason: "Source exclusions reviewed before transcript ingestion."
      });
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
      const sources = await discoverCodexSourcesAndPersist();
      let imported = 0;
      let skipped = 0;
      const jobs = [];
      for (const source of sources) {
        const job = await runImportJob(database, { importKind: "transcript", sourceId: source.sourceId }, () => importTranscriptSources([source]));
        imported += job.importedCount;
        skipped += job.queuedCount;
        jobs.push(job);
      }
      sendJson(request, response, config.allowedOrigins, 202, {
        ok: true,
        imported,
        jobs,
        skipped,
        sources: sources.length
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
        if (sessionId) indexCanonicalSessionSearch(database, sessionId);
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

  return {
    server,
    database,
    startBackgroundHydration,
    close: async () => {
      closed = true;
      await hydrationPromise;
      await new Promise<void>((resolve) => {
        if (gitRefreshTimer) clearInterval(gitRefreshTimer);
        server.close(() => {
          database.close();
          resolve();
        });
      });
    }
  };
  } catch (error) {
    database.close();
    throw error;
  }
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
    state: url.searchParams.get("state") ?? undefined
  };
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
