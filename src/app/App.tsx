import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import fixture from "../../fixtures/v0/replay-three-sessions-board.json";
import { buildHistoryRecords } from "../core/historyRecords";
import {
  applyReviewDispositions,
  createReviewDisposition,
  isReviewSafeAction
} from "../core/reviewDispositions";
import type { ReviewDisposition } from "../core/store";
import type { FixtureReplay, GitSnapshot, LiveBoardProjection, NormalizedEvent, SafeAction, SessionDetailView } from "../core/types";
import { AttentionQueue } from "../ui/AttentionQueue";
import { AppShell } from "../ui/AppShell";
import { HistoryPanel, type LogbookFilterState, type LogbookLoadState } from "../ui/HistoryPanel";
import { ObservabilityRightRail } from "../ui/ObservabilityRightRail";
import { ObservabilitySidebar, type AppSurface } from "../ui/ObservabilitySidebar";
import { buildObservabilityDemoBoard, observabilitySessionTotal } from "../ui/observabilityDemoBoard";
import { OperationsPanel, type DeletionScopeKind } from "../ui/OperationsPanel";
import { SessionBoard } from "../ui/SessionBoard";
import { SessionDetailModal } from "../ui/SessionDetailModal";
import { SessionLibraryDetail } from "../ui/SessionLibraryDetail";
import { SourcesPanel } from "../ui/SourcesPanel";
import { Toolbar } from "../ui/Toolbar";
import type { CollapsibleSearchHandle } from "../ui/primitives/CollapsibleSearch";
import { filterAttentionItemsForCards, filterCards, mainScanCards, summarizeMainScanCards, type BoardFilter } from "../ui/filterBoard";
import {
  activityWindowMs,
  type ActivityWindow,
  type CardDensity,
  type HarnessFilter,
  type LifecycleFilter,
  type SortMode
} from "../ui/toolbarOptions";
import {
  defaultFixtureMode,

  isLiveEventsEnvelope,
  isLiveProjectionEnvelope,
  normalizeLiveBoardProjection,
} from "./liveProjectionClient";
import { startLiveConnector } from "./connectorClient";
import { useMastheadConnection } from "./connection/useMastheadConnection";
import { ConnectionRecoveryPanel } from "../ui/ConnectionRecoveryPanel";
import {
  addSourceExclusion,
  applyDefaultRetention as applyDefaultDataRetention,
  approveAdapterTranscripts,
  cancelImport,
  deleteMastheadData as deleteCanonicalMastheadData,
  exportMastheadData,
  getDataSummary,
  getLogbookSummary,
  getLogbookSession,
  getLogbookSessionExcerpts,
  importAdapterMetadata,
  importAdapterTranscripts,
  listProjects,
  listAdapters,
  listImports,
  listReviewDispositions,
  listSources,
  retryImport,
  saveReviewDisposition,
  searchLogbook,
  syncAdapter,
  type LogbookExcerpt,
  type AdapterStatus,
  type ImportJob,
  type LogbookSearchResult,
  type LogbookSessionDetail,
  type LogbookSort,
  type LogbookSummary,
  type SourceStatus,
  type DataSummary,
  type DeleteMastheadDataScope
} from "./daemonClient";
import { exportedRecordCount, exportLocalData } from "./nativeStoreClient";
import { AgentAccessSurface } from "./surfaces/AgentAccessSurface";
import { LogbookSurface } from "./surfaces/LogbookSurface";
import { NowSurface } from "./surfaces/NowSurface";
import { SettingsSurface } from "./surfaces/SettingsSurface";
import { SourcesSurface } from "./surfaces/SourcesSurface";
import { APP_VERSION_LABEL } from "./version";
import type { ConnectionState } from "../ui/ConnectionStatus";

type ConnectorActionState =
  | { state: "idle"; message?: string }
  | { state: "starting"; message?: string }
  | { state: "started"; message?: string }
  | { state: "unsupported"; message?: string }
  | { state: "error"; message?: string };

type CardLayoutSnapshot = Map<string, DOMRect>;

const replay = fixture as FixtureReplay;
const startsInFixtureMode = defaultFixtureMode();

const emptyLiveBoard: LiveBoardProjection = {
  summary: {
    active: 0,
    needsAttention: 0,
    conflicts: 0,
    completed: 0,
    running: 0,
    needsAction: 0,
    idle: 0
  },
  lanes: [
    { laneId: "running", title: "Running", count: 0, sessionIds: [] },
    { laneId: "idle", title: "Idle", count: 0, sessionIds: [] },
    { laneId: "needs_action", title: "Needs action", count: 0, sessionIds: [] },
    { laneId: "history", title: "History", count: 0, sessionIds: [] }
  ],
  cards: [],
  attentionQueue: [],
  conflicts: []
};


export function App() {
  const [activeSurface, setActiveSurface] = useState<AppSurface>("now");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent_activity");
  const [activityWindow, setActivityWindow] = useState<ActivityWindow>("24h");
  const [refreshRateMs, setRefreshRateMs] = useState(10_000);
  const [density, setDensity] = useState<CardDensity>("comfortable");
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [liveProjection, setLiveProjection] = useState<LiveBoardProjection>();
  const [liveConnection, setLiveConnection] = useState<ConnectionState>({ state: "connecting" });
  const [liveEvents, setLiveEvents] = useState<NormalizedEvent[]>();
  const [liveGitSnapshots, setLiveGitSnapshots] = useState<GitSnapshot[]>();
  const [connectorAction, setConnectorAction] = useState<ConnectorActionState>({ state: "idle" });
  const connection = useMastheadConnection();
  const activeProjectionUrl = connection.baseUrl;
  const [showDemoData, setShowDemoData] = useState(startsInFixtureMode);
  const [reviewDispositions, setReviewDispositions] = useState<ReviewDisposition[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [adapters, setAdapters] = useState<AdapterStatus[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [sourcesStatus, setSourcesStatus] = useState<string>();
  const [logbookResult, setLogbookResult] = useState<LogbookSearchResult>();
  const [logbookSummary, setLogbookSummary] = useState<LogbookSummary>();
  const [logbookLoading, setLogbookLoading] = useState(false);
  const [logbookError, setLogbookError] = useState<string>();
  const [logbookRetryKey, setLogbookRetryKey] = useState(0);
  const [logbookSort, setLogbookSort] = useState<LogbookSort>("recent");
  const [logbookProjectOptions, setLogbookProjectOptions] = useState<string[]>([]);
  const [logbookFilters, setLogbookFilters] = useState<LogbookFilterState>({});
  const [selectedLogbookSessionId, setSelectedLogbookSessionId] = useState<string>();
  const [selectedLogbookSession, setSelectedLogbookSession] = useState<LogbookSessionDetail>();
  const [selectedLogbookExcerpts, setSelectedLogbookExcerpts] = useState<LogbookExcerpt[]>([]);
  const [logbookDetailLoading, setLogbookDetailLoading] = useState(false);
  const [sessionActionStatus, setSessionActionStatus] = useState<{ sessionId: string; message: string }>();
  const [localDataStatus, setLocalDataStatus] = useState<{
    state:
      | "idle"
      | "confirm_delete"
      | "confirm_prune"
      | "confirm_scoped_delete"
      | "busy"
      | "exported"
      | "deleted"
      | "pruned"
      | "error";
    message?: string;
  }>({ state: "idle" });
  const [dataSummary, setDataSummary] = useState<DataSummary>();
  const [deletionScopeKind, setDeletionScopeKind] = useState<DeletionScopeKind>("project");
  const [deletionScopeTarget, setDeletionScopeTarget] = useState("");
  const [pendingDeletionScope, setPendingDeletionScope] = useState<DeleteMastheadDataScope>();
  const [pendingDeletionDatabaseId, setPendingDeletionDatabaseId] = useState<string>();
  const searchInputRef = useRef<CollapsibleSearchHandle | null>(null);
  const liveRequestIdRef = useRef(0);
  const fixtureBoard = useMemo(() => buildObservabilityDemoBoard(selectedSessionId), [selectedSessionId]);
  const baseBoard = showDemoData ? fixtureBoard : liveProjection ?? emptyLiveBoard;
  const board = useMemo(() => applyReviewDispositions(baseBoard, reviewDispositions), [baseBoard, reviewDispositions]);
  const selectedActivityWindowMs = useMemo(() => activityWindowMs(activityWindow), [activityWindow]);
  const historyRecords = useMemo(
    () =>
      buildHistoryRecords({
        events: showDemoData ? replay.events : liveEvents ?? [],
        gitSnapshots: showDemoData ? replay.gitSnapshots : liveGitSnapshots ?? [],
        attentionItems: baseBoard.attentionQueue,
        conflicts: baseBoard.conflicts,
        reviewDispositions,
        storedRecords: []
      }),
    [baseBoard.attentionQueue, baseBoard.conflicts, liveEvents, liveGitSnapshots, reviewDispositions, showDemoData]
  );
  const scanCards = useMemo(
    () => mainScanCards(board.cards, { activityWindowMs: selectedActivityWindowMs }),
    [board.cards, selectedActivityWindowMs]
  );
  const filteredCards = useMemo(
    () =>
      filterCards(scanCards, {
        query,
        filter,
        harness: harnessFilter,
        lifecycle: lifecycleFilter,
        sort: sortMode
      }),
    [filter, harnessFilter, lifecycleFilter, query, scanCards, sortMode]
  );
  const visibleSummary = useMemo(() => summarizeMainScanCards(filteredCards), [filteredCards]);
  const hasActiveToolbarFilters =
    Boolean(query) ||
    filter !== "all" ||
    harnessFilter !== "all" ||
    lifecycleFilter !== "all" ||
    activityWindow !== "24h";
  const logbookLoadState = useMemo<LogbookLoadState>(() => {
    if (logbookResult) {
      return {
        state: "ready",
        sessions: logbookResult.sessions,
        total: logbookResult.total,
        nextCursor: logbookResult.nextCursor
      };
    }
    if (logbookError) return { state: "error", message: logbookError };
    return { state: "loading" };
  }, [logbookError, logbookResult]);
  const logbookFilterOptions = useMemo(
    () => ({
      models: Array.from(new Set(logbookSummary?.models.map((item) => item.model).filter(Boolean) ?? [])),
      projects: logbookProjectOptions,
      runtimes: Array.from(
        new Set([
          ...(logbookSummary?.runtimes.map((item) => item.runtime).filter(Boolean) ?? []),
          ...adapters.map((adapter) => adapter.runtime).filter(Boolean)
        ])
      )
    }),
    [adapters, logbookProjectOptions, logbookSummary]
  );
  const filteredAttentionItems = useMemo(
    () => filterAttentionItemsForCards(board.attentionQueue, filteredCards),
    [board.attentionQueue, filteredCards]
  );
  const filteredSelectedSession =
    board.selectedSession && filteredCards.some((card) => card.sessionId === board.selectedSession?.sessionId)
      ? board.selectedSession
      : undefined;
  const effectiveLiveConnection = useMemo<ConnectionState>(() => {
    if (connection.state.state === "offline" || connection.state.state === "incompatible") {
      return { state: "offline", error: "error" in connection.state ? connection.state.error : "Masthead daemon unavailable" };
    }
    if (connection.state.state === "probing") return { state: "connecting" };
    return liveConnection;
  }, [connection.state, liveConnection]);
  const activeDatabaseId =
    connection.state.state === "ready" || connection.state.state === "read_only" ? connection.state.health.data?.databaseId : undefined;
  const writeBlockedMessage =
    "This Masthead connection is read-only. Start the local writable collector before changing settings or deleting data.";
  const toggleDensity = useCallback(() => {
    const updateDensity = () => setDensity((current) => (current === "compact" ? "comfortable" : "compact"));

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      updateDensity();
      return;
    }

    const previousLayout = captureCardLayout();
    flushSync(updateDensity);
    animateCardLayoutFrom(previousLayout);
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateLocalData = async () => {
      try {
        const dispositions = await listReviewDispositions(activeProjectionUrl).catch(() => []);
        if (!cancelled) {
          setReviewDispositions(dispositions);
        }
      } catch (error) {
        if (!cancelled) {
          setLocalDataStatus({
            state: "error",
            message: `Local history unavailable: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      }
    };

    void hydrateLocalData();
    return () => {
      cancelled = true;
    };
  }, [activeProjectionUrl]);

  const loadLiveProjection = useCallback(async () => {
    const requestId = liveRequestIdRef.current + 1;
    liveRequestIdRef.current = requestId;
    const selectedLiveSessionId = selectedSessionId ?? undefined;
    const isCurrentRequest = () => liveRequestIdRef.current === requestId;

    const mastheadApi = connection.api;
    try {
      const body = await mastheadApi.getLiveProjection(selectedLiveSessionId);
      if (!isLiveProjectionEnvelope(body)) throw new Error("projection response did not match live envelope");
      const eventsBody = await mastheadApi.getLiveEvents().catch(() => undefined);
      if (!isCurrentRequest()) return false;
      setLiveProjection(normalizeLiveBoardProjection(body.projection, selectedSessionId));
      setShowDemoData(false);
      setConnectorAction((current) =>
        current.state === "starting" || current.state === "started" ? { state: "started", message: "Collector connected." } : current
      );
      setLiveConnection({
        state: "live",
        events: body.events,
        gitSnapshots: body.gitSnapshots,
        diagnostics: body.diagnostics,
        generatedAt: body.generatedAt
      });
      if (isLiveEventsEnvelope(eventsBody)) {
        setLiveEvents(eventsBody.events);
        setLiveGitSnapshots(eventsBody.gitSnapshots);
      }
      return true;
    } catch (error) {
      if (!isCurrentRequest()) return false;
      setLiveProjection(undefined);
      setLiveEvents(undefined);
      setLiveGitSnapshots(undefined);
      setLiveConnection({
        state: "offline",
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }, [activeProjectionUrl, selectedSessionId]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    const pollLiveProjection = async () => {
      await loadLiveProjection();
      if (!cancelled) timeoutId = window.setTimeout(pollLiveProjection, refreshRateMs);
    };

    void pollLiveProjection();
    return () => {
      cancelled = true;
      liveRequestIdRef.current += 1;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [loadLiveProjection, refreshRateMs]);

  const handleOpenSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setDetailModalOpen(true);
  };

  const handleStartConnector = async () => {
    setConnectorAction({ state: "starting", message: "Starting local connector..." });
    try {
      const result = await startLiveConnector();
      if (result.ok) {
        connection.setBaseUrl(result.projectionUrl);
        setConnectorAction({
          state: "started",
          message: `${result.message} Connected to ${result.baseUrl}.`
        });
        return;
      }

      setConnectorAction({
        state: "unsupported",
        message: result.message
      });
    } catch (error) {
      setConnectorAction({
        state: "error",
        message: `Could not start connector: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const loadSourceInventory = useCallback(async (options: { showStatus?: boolean } = {}) => {
    const [adapterResult, sourceResult, importResult] = await Promise.allSettled([
      listAdapters(activeProjectionUrl),
      listSources(activeProjectionUrl),
      listImports(activeProjectionUrl)
    ]);
    if (adapterResult.status === "fulfilled") setAdapters(adapterResult.value);
    if (sourceResult.status === "fulfilled") setSources(sourceResult.value);
    if (importResult.status === "fulfilled") setImports(importResult.value);
    if (sourceResult.status === "rejected" && adapterResult.status === "rejected" && importResult.status === "rejected") {
      throw sourceResult.reason;
    }
    if (options.showStatus && sourceResult.status === "fulfilled") {
      setSourcesStatus(`${sourceResult.value.length} source${sourceResult.value.length === 1 ? "" : "s"} detected.`);
    }
    return {
      adapters: adapterResult.status === "fulfilled" ? adapterResult.value : undefined,
      imports: importResult.status === "fulfilled" ? importResult.value : undefined,
      sources: sourceResult.status === "fulfilled" ? sourceResult.value : undefined
    };
  }, [activeProjectionUrl]);

  const handleRefreshSources = useCallback(async () => {
    setSourcesBusy(true);
    try {
      await loadSourceInventory({ showStatus: true });
    } catch (error) {
      setSourcesStatus(`Source refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSourcesBusy(false);
    }
  }, [loadSourceInventory]);

  useEffect(() => {
    if (effectiveLiveConnection.state !== "live") return;
    void loadSourceInventory().catch((error: unknown) => {
      console.error("[masthead] Source inventory refresh failed", error);
    });
  }, [effectiveLiveConnection.state, loadSourceInventory]);

  useEffect(() => {
    if (activeSurface !== "sources") return;
    void handleRefreshSources();
  }, [activeSurface, handleRefreshSources]);

  useEffect(() => {
    if (activeSurface !== "logbook" || effectiveLiveConnection.state !== "live") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLogbookLoading(true);
      setLogbookError(undefined);
      void searchLogbook({ ...logbookFilters, limit: 50, q: historyQuery, sort: logbookSort }, activeProjectionUrl, { signal: controller.signal })
        .then((result) => {
          setLogbookResult(result);
          setLogbookError(undefined);
          setSelectedLogbookSessionId(undefined);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            console.error("[masthead] Logbook search failed", error);
            setLogbookError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLogbookLoading(false);
        });
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeProjectionUrl, activeSurface, effectiveLiveConnection.state, historyQuery, logbookFilters, logbookRetryKey, logbookSort]);
  useEffect(() => {
    if (activeSurface !== "logbook") return;
    const controller = new AbortController();
    void Promise.all([getLogbookSummary(activeProjectionUrl, { signal: controller.signal }), listProjects(activeProjectionUrl, { signal: controller.signal })])
      .then(([summary, projects]) => {
        setLogbookSummary(summary);
        setLogbookProjectOptions(projects.map((project) => project.project));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error("[masthead] Logbook metadata failed", error);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, activeSurface, logbookRetryKey]);

  useEffect(() => {
    if (activeSurface !== "logbook" || !selectedLogbookSessionId) {
      setSelectedLogbookSession(undefined);
      setSelectedLogbookExcerpts([]);
      return;
    }
    const controller = new AbortController();
    setLogbookDetailLoading(true);
    void Promise.all([
      getLogbookSession(selectedLogbookSessionId, activeProjectionUrl, { signal: controller.signal }),
      getLogbookSessionExcerpts(selectedLogbookSessionId, { limit: 8, q: historyQuery }, activeProjectionUrl, { signal: controller.signal })
    ])
      .then(([session, excerpts]) => {
        setSelectedLogbookSession(session);
        setSelectedLogbookExcerpts(excerpts);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error("[masthead] Logbook detail failed", error);
          setSelectedLogbookSession(undefined);
          setSelectedLogbookExcerpts([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLogbookDetailLoading(false);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, activeSurface, selectedLogbookSessionId, historyQuery]);

  const handlePollActiveImports = useCallback(async () => {
    const activeImportIds = new Set(
      imports.filter((job) => job.status === "queued" || job.status === "running").map((job) => job.importJobId)
    );
    try {
      const result = await loadSourceInventory();
      if (result.imports?.some((job) => activeImportIds.has(job.importJobId) && job.status === "succeeded")) {
        setLogbookRetryKey((current) => current + 1);
      }
    } catch (error) {
      console.error("[masthead] Active import poll failed", error);
    }
  }, [imports, loadSourceInventory]);

  const refreshSourcesAfterImportAction = async () => {
    await loadSourceInventory();
    setLogbookRetryKey((current) => current + 1);
  };

  const importActionStatus = (
    label: string,
    result: { imported?: number; importJobId?: string; job?: ImportJob; jobs?: ImportJob[]; queued?: number; sources?: number }
  ) => {
    const queued = result.queued ?? result.jobs?.length ?? (result.job || result.importJobId ? 1 : 0);
    const sourcesCount = result.sources ?? result.jobs?.length ?? (result.job || result.importJobId ? 1 : 0);
    if (queued > 0) return `${label} queued: ${queued} job${queued === 1 ? "" : "s"} across ${sourcesCount} source${sourcesCount === 1 ? "" : "s"}.`;
    if (typeof result.imported === "number") return `${label} complete: ${result.imported} records from ${sourcesCount} source${sourcesCount === 1 ? "" : "s"}.`;
    return `${label} requested.`;
  };

  const handleImportMetadata = async (runtime: string) => {
    setSourcesBusy(true);
    setSourcesStatus(`Importing ${runtime} metadata...`);
    try {
      const result = await importAdapterMetadata(runtime, activeProjectionUrl);
      setSourcesStatus(importActionStatus("Metadata import", result));
      await refreshSourcesAfterImportAction();
    } catch (error) {
      setSourcesStatus(`Metadata import failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleEnableTranscriptImport = async (runtime: string) => {
    setSourcesBusy(true);
    setSourcesStatus(`Enabling ${runtime} transcript import...`);
    try {
      await approveAdapterTranscripts(runtime, activeProjectionUrl);
      setSourcesStatus("Transcript import enabled. Review exclusions before importing raw transcripts.");
      await refreshSourcesAfterImportAction();
    } catch (error) {
      setSourcesStatus(`Transcript import approval failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleImportTranscripts = async (runtime: string) => {
    setSourcesBusy(true);
    setSourcesStatus(`Importing ${runtime} transcripts...`);
    try {
      const result = await importAdapterTranscripts(runtime, activeProjectionUrl);
      setSourcesStatus(importActionStatus("Transcript import", result));
      await refreshSourcesAfterImportAction();
    } catch (error) {
      setSourcesStatus(`Transcript import failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleSyncAdapter = async (runtime: string) => {
    setSourcesBusy(true);
    setSourcesStatus(`Syncing ${runtime} source data...`);
    try {
      const result = await syncAdapter(runtime, activeProjectionUrl);
      setSourcesStatus(importActionStatus("Sync", result));
      await refreshSourcesAfterImportAction();
    } catch (error) {
      setSourcesStatus(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleCancelImport = async (importJobId: string) => {
    setSourcesBusy(true);
    setSourcesStatus("Cancelling import job...");
    try {
      await cancelImport(importJobId, activeProjectionUrl);
      setSourcesStatus("Import job cancelled.");
      await refreshSourcesAfterImportAction();
    } catch (error) {
      setSourcesStatus(`Import cancel failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleRetryImport = async (importJobId: string) => {
    setSourcesBusy(true);
    setSourcesStatus("Retrying import job...");
    try {
      await retryImport(importJobId, activeProjectionUrl);
      setSourcesStatus("Import job retry queued.");
      await refreshSourcesAfterImportAction();
    } catch (error) {
      setSourcesStatus(`Import retry failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleExcludeSourcePath = async (path: string) => {
    setSourcesBusy(true);
    try {
      await addSourceExclusion(
        {
          exclusionKind: "path",
          pattern: path,
          reason: "Excluded from full transcript ingestion."
        },
        activeProjectionUrl
      );
      setSourcesStatus("Source exclusion saved.");
      const [nextAdapters, nextSources] = await Promise.all([listAdapters(activeProjectionUrl), listSources(activeProjectionUrl)]);
      setAdapters(nextAdapters);
      setSources(nextSources);
    } catch (error) {
      setSourcesStatus(`Source exclusion failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSourcesBusy(false);
    }
  };

  const handleExportLocalData = async () => {
    setLocalDataStatus({ state: "busy", message: "Preparing local export..." });
    try {
      const canonicalExport = effectiveLiveConnection.state === "live" ? await exportMastheadData(activeProjectionUrl) : undefined;
      const exported = canonicalExport ? JSON.stringify(canonicalExport, null, 2) : await exportLocalData();
      const count = canonicalExport ? exportedSessionCount(canonicalExport) : exportedRecordCount(exported);
      downloadTextFile(`masthead-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, exported);
      setLocalDataStatus({
        state: "exported",
        message: count === undefined ? "Local export prepared." : `Exported ${count} Masthead records.`
      });
    } catch (error) {
      setLocalDataStatus({
        state: "error",
        message: `Export failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const loadDataDeletionPreview = async (scope?: DeleteMastheadDataScope, databaseId = activeDatabaseId): Promise<DataSummary> => {
    const summary = await getDataSummary(activeProjectionUrl, scope, { databaseId });
    setDataSummary(summary);
    return summary;
  };

  const handleRequestDeleteLocalData = async () => {
    if (!connection.writable) {
      setLocalDataStatus({ state: "error", message: writeBlockedMessage });
      return;
    }
    setLocalDataStatus({ state: "busy", message: "Preparing delete-all preview..." });
    try {
      const summary = await loadDataDeletionPreview(undefined, activeDatabaseId);
      setPendingDeletionDatabaseId(activeDatabaseId);
      setLocalDataStatus({
        state: "confirm_delete",
        message: `Confirm delete all Masthead data: ${formatCount(summary.sessions)} sessions, ${formatCount(
          summary.rawEvents
        )} raw source copies, ${formatCount(summary.enrichments)} enrichments, and ${formatCount(
          summary.auditRows
        )} MCP audit rows. Original Codex/Hermes/etc. session files remain untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        state: "error",
        message: `Delete preview failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const handleRequestPruneLocalData = async () => {
    if (!connection.writable) {
      setLocalDataStatus({ state: "error", message: writeBlockedMessage });
      return;
    }
    setLocalDataStatus({ state: "busy", message: "Preparing raw source copy preview..." });
    try {
      const summary = await loadDataDeletionPreview(undefined, activeDatabaseId);
      setPendingDeletionDatabaseId(activeDatabaseId);
      setLocalDataStatus({
        state: "confirm_prune",
        message: `Confirm deletion of ${formatCount(
          summary.rawEvents
        )} raw source copies. Normalized session metadata, summaries, and search records stay available.`
      });
    } catch (error) {
      setLocalDataStatus({
        state: "error",
        message: `Raw source copy preview failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const handleConfirmPruneLocalData = async () => {
    if (!connection.writable) {
      setLocalDataStatus({ state: "error", message: writeBlockedMessage });
      return;
    }
    setLocalDataStatus({ state: "busy", message: "Deleting raw source copies..." });
    try {
      const response = await applyDefaultDataRetention(activeProjectionUrl, { databaseId: pendingDeletionDatabaseId ?? activeDatabaseId });
      const dispositions = await listReviewDispositions(activeProjectionUrl);
      setReviewDispositions(dispositions);
      setDataSummary(response.summary);
      setPendingDeletionDatabaseId(undefined);
      setLocalDataStatus({
        state: "pruned",
        message: `Deleted ${formatCount(
          response.result.rawEvents ?? 0
        )} raw source copies. Normalized sessions, summaries, and search records kept. Original harness files untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        state: "error",
        message: `Retention failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const selectedDeletionScope = (): DeleteMastheadDataScope | undefined => {
    const target = deletionScopeTarget.trim();
    if (!target) return undefined;
    if (deletionScopeKind === "session") return { kind: "session", sessionId: target };
    if (deletionScopeKind === "runtime") return { kind: "runtime", runtime: target };
    if (deletionScopeKind === "host") return { kind: "host", host: target };
    return { kind: "project", project: target };
  };

  const handleRequestScopedDelete = async () => {
    if (!connection.writable) {
      setLocalDataStatus({ state: "error", message: writeBlockedMessage });
      return;
    }
    const scope = selectedDeletionScope();
    if (!scope) {
      setLocalDataStatus({ state: "error", message: "Choose a deletion scope and target before deleting records." });
      return;
    }
    setLocalDataStatus({ state: "busy", message: "Preparing scoped deletion preview..." });
    try {
      const summary = await loadDataDeletionPreview(scope, activeDatabaseId);
      setPendingDeletionScope(scope);
      setPendingDeletionDatabaseId(activeDatabaseId);
      setLocalDataStatus({
        state: "confirm_scoped_delete",
        message: `Confirm scoped deletion for ${scopeLabel(scope)}: ${formatCount(
          summary.sessions
        )} sessions, ${formatCount(summary.messages)} searchable messages, and ${formatCount(
          summary.enrichments
        )} enrichments. Original harness files are untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        state: "error",
        message: `Scoped delete preview failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const handleConfirmScopedDelete = async () => {
    if (!connection.writable) {
      setLocalDataStatus({ state: "error", message: writeBlockedMessage });
      return;
    }
    const scope = pendingDeletionScope ?? selectedDeletionScope();
    if (!scope) {
      setLocalDataStatus({ state: "error", message: "Choose a deletion scope and target before deleting records." });
      return;
    }
    setLocalDataStatus({ state: "busy", message: `Deleting Masthead records for ${scopeLabel(scope)}...` });
    try {
      const response = await deleteCanonicalMastheadData(scope, activeProjectionUrl, { databaseId: pendingDeletionDatabaseId ?? activeDatabaseId });
      setDataSummary(response.summary);
      setPendingDeletionScope(undefined);
      setPendingDeletionDatabaseId(undefined);
      setLocalDataStatus({
        state: "deleted",
        message: `Deleted ${formatCount(response.result.sessions ?? 0)} sessions for ${scopeLabel(
          scope
        )}. Original harness files remain untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        state: "error",
        message: `Scoped delete failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const handleConfirmDeleteLocalData = async () => {
    if (!connection.writable) {
      setLocalDataStatus({ state: "error", message: writeBlockedMessage });
      return;
    }
    setLocalDataStatus({ state: "busy", message: "Deleting canonical Masthead data..." });
    try {
      const response = await deleteCanonicalMastheadData({ kind: "all" }, activeProjectionUrl, { databaseId: pendingDeletionDatabaseId ?? activeDatabaseId });
      setReviewDispositions([]);
      setDataSummary(response.summary);
      setLiveProjection(emptyLiveBoard);
      setLiveEvents([]);
      setLiveGitSnapshots([]);
      setSessionActionStatus(undefined);
      setPendingDeletionDatabaseId(undefined);
      setLocalDataStatus({
        state: "deleted",
        message: `Deleted ${formatCount(response.result.sessions ?? 0)} sessions, ${formatCount(
          response.result.rawEvents ?? 0
        )} raw source copies, ${formatCount(response.result.enrichments ?? 0)} enrichments, and ${formatCount(
          response.result.auditRows ?? 0
        )} MCP audit rows. Original Codex/Hermes/etc. session files remain untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        state: "error",
        message: `Delete failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const handleSessionAction = async (action: SafeAction, session: SessionDetailView) => {
    if (!isReviewSafeAction(action)) {
      setSessionActionStatus({
        sessionId: session.sessionId,
        message: "Open actions are read-only navigation placeholders in this prototype."
      });
      return;
    }

    const recordedAt = new Date();
    const disposition = createReviewDisposition({
      action,
      subject: { subjectId: session.sessionId, subjectType: "session" },
      recordedAt: recordedAt.toISOString(),
      snoozedUntil: action === "snooze" ? new Date(recordedAt.getTime() + 60 * 60 * 1000).toISOString() : undefined,
      reason: reasonForAction(action)
    });

    try {
      await saveReviewDisposition(disposition, activeProjectionUrl);
      setReviewDispositions((current) => [...current, disposition]);
      setSessionActionStatus({
        sessionId: session.sessionId,
        message: messageForDisposition(disposition)
      });
    } catch (error) {
      setSessionActionStatus({
        sessionId: session.sessionId,
        message: `Local disposition failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const handleLogbookQueryChange = (nextQuery: string) => {
    setHistoryQuery(nextQuery);
    setLogbookResult(undefined);
    setLogbookError(undefined);
    setSelectedLogbookSessionId(undefined);
  };

  const handleLogbookFilterChange = (nextFilters: LogbookFilterState) => {
    setLogbookFilters(nextFilters);
    setLogbookResult(undefined);
    setLogbookError(undefined);
    setSelectedLogbookSessionId(undefined);
  };

  const handleLoadMoreLogbook = async () => {
    if (!logbookResult?.nextCursor || logbookLoading) return;
    setLogbookLoading(true);
    try {
      const nextPage = await searchLogbook(
        { ...logbookFilters, cursor: logbookResult.nextCursor, limit: 50, q: historyQuery, sort: logbookSort },
        activeProjectionUrl
      );
      setLogbookResult({
        nextCursor: nextPage.nextCursor,
        sessions: [...logbookResult.sessions, ...nextPage.sessions],
        total: nextPage.total
      });
    } catch (error) {
      console.error("[masthead] Logbook pagination failed", error);
      setLogbookError(error instanceof Error ? error.message : String(error));
    } finally {
      setLogbookLoading(false);
    }
  };

  const needsRecoveryPanel = connection.state.state === "offline" || connection.state.state === "incompatible";
  const recoveryPanel = (
    <ConnectionRecoveryPanel connection={connection.state} onRetry={connection.refresh} onStart={handleStartConnector} />
  );


  const mainSurface =
    activeSurface === "sources" ? (
      <SourcesSurface>{needsRecoveryPanel ? recoveryPanel : (
        <SourcesPanel
          sources={sources}
          adapters={adapters}
          imports={imports}
          busy={sourcesBusy}
          status={sourcesStatus}
          onCancelImport={handleCancelImport}
          onEnableTranscriptImport={handleEnableTranscriptImport}
          onExcludePath={handleExcludeSourcePath}
          onImportMetadata={handleImportMetadata}
          onImportTranscripts={handleImportTranscripts}
          onPollImports={handlePollActiveImports}
          onRefresh={handleRefreshSources}
          onRetryImport={handleRetryImport}
          onSyncAdapter={handleSyncAdapter}
        />
      )}</SourcesSurface>
    ) : activeSurface === "logbook" ? (
      <LogbookSurface>
        <>
          <HistoryPanel
            records={showDemoData ? historyRecords : undefined}
            adapters={adapters}
            connectionState={connection.state.state === "offline" ? "offline" : connection.state.state === "incompatible" ? "incompatible" : effectiveLiveConnection.state === "live" ? "live" : "connecting"}
            filterOptions={logbookFilterOptions}
            filters={logbookFilters}
            imports={imports}
            importBusy={sourcesBusy}
            query={historyQuery}
            density="compact"
            loadState={needsRecoveryPanel ? { state: "ready", sessions: [], total: 0 } : showDemoData ? undefined : logbookLoadState}
            refreshError={logbookResult ? logbookError : undefined}
            selectedSessionId={selectedLogbookSessionId}
            sort={logbookSort}
            sources={sources}
            summary={logbookSummary}
            onFilterChange={handleLogbookFilterChange}
            onImportMetadata={handleImportMetadata}
            onOpenSources={() => setActiveSurface("sources")}
            onQueryChange={handleLogbookQueryChange}
            onLoadMore={handleLoadMoreLogbook}
            onRetry={() => setLogbookRetryKey((current) => current + 1)}
            onSessionSelect={setSelectedLogbookSessionId}
            onSortChange={(nextSort) => {
              setLogbookSort(nextSort);
              setLogbookResult(undefined);
              setSelectedLogbookSessionId(undefined);
            }}
          />
          {selectedLogbookSessionId ? (
            <SessionLibraryDetail
              session={selectedLogbookSession}
              excerpts={selectedLogbookExcerpts}
              loading={logbookDetailLoading}
              onClose={() => setSelectedLogbookSessionId(undefined)}
            />
          ) : null}
        </>
      </LogbookSurface>
    ) : activeSurface === "agent_access" ? (
      needsRecoveryPanel ? (
        <section className="app-surface agent-access-surface surface-panel" aria-label="Agent Access">
          {recoveryPanel}
        </section>
      ) : (
        <AgentAccessSurface />
      )
    ) : activeSurface === "settings" ? (
      <SettingsSurface>
        <OperationsPanel
            baseUrl={activeProjectionUrl}
            connection={connection.state}
            onReconnect={connection.refresh}
            onStartConnector={handleStartConnector}
            dataSummary={dataSummary}
            deletionScopeKind={deletionScopeKind}
            deletionScopeTarget={deletionScopeTarget}
            localDataStatus={localDataStatus}
            onCancelLocalDataAction={() => {
              setLocalDataStatus({ state: "idle" });
              setPendingDeletionScope(undefined);
              setPendingDeletionDatabaseId(undefined);
            }}
            onDeletionScopeKindChange={(kind) => {
              setDeletionScopeKind(kind);
              setPendingDeletionScope(undefined);
              setPendingDeletionDatabaseId(undefined);
            }}
            onDeletionScopeTargetChange={(target) => {
              setDeletionScopeTarget(target);
              setPendingDeletionScope(undefined);
              setPendingDeletionDatabaseId(undefined);
            }}
            onExportLocalData={handleExportLocalData}
            onRequestPruneLocalData={handleRequestPruneLocalData}
            onConfirmPruneLocalData={handleConfirmPruneLocalData}
            onRequestScopedDelete={handleRequestScopedDelete}
            onConfirmScopedDelete={handleConfirmScopedDelete}
            onRequestDeleteLocalData={handleRequestDeleteLocalData}
            onConfirmDeleteLocalData={handleConfirmDeleteLocalData}
            readOnly={!connection.writable}
          />
      </SettingsSurface>
    ) : (
      <NowSurface
        toolbar={
          <Toolbar
            query={query}
            filter={filter}
            resultCount={filteredCards.length}
            totalCount={scanCards.length}
            harnessFilter={harnessFilter}
            lifecycleFilter={lifecycleFilter}
            sortMode={sortMode}
            activityWindow={activityWindow}
            refreshRateMs={refreshRateMs}
            density={density}
            onQueryChange={setQuery}
            onFilterChange={setFilter}
            onHarnessFilterChange={setHarnessFilter}
            onLifecycleFilterChange={setLifecycleFilter}
            onSortModeChange={setSortMode}
            onActivityWindowChange={setActivityWindow}
            onRefreshRateChange={setRefreshRateMs}
            onDensityToggle={toggleDensity}
            searchInputRef={searchInputRef}
          />
        }
        board={
          <SessionBoard
            cards={filteredCards}
            lanes={board.lanes}
            variant="observability"
            emptyTitle={emptyBoardTitle({ showDemoData, hasActiveToolbarFilters, liveConnection: effectiveLiveConnection })}
            emptyMessage={emptyBoardMessage({ showDemoData, hasActiveToolbarFilters, liveConnection: effectiveLiveConnection })}
            onOpenSession={handleOpenSession}
            showDemoTelemetry={showDemoData}
            density={density}
          />
        }
      />
    );

  return (
    <>
      <AppShell
        sidebar={
          <ObservabilitySidebar
            version={APP_VERSION_LABEL}
            activeCount={observabilitySessionTotal(visibleSummary)}
            activeSurface={activeSurface}
            onSurfaceChange={setActiveSurface}
          />
        }
        main={mainSurface}
        rightRail={
          activeSurface === "logbook" || activeSurface === "settings" ? undefined : (
            <ObservabilityRightRail
              summary={visibleSummary}
              activeSurface={activeSurface}
              sourceCount={sources.length}
            />
          )
        }
      />

      {detailModalOpen && filteredSelectedSession ? (
        <SessionDetailModal
          session={filteredSelectedSession}
          onClose={() => setDetailModalOpen(false)}
          onAction={handleSessionAction}
          actionStatus={
            sessionActionStatus && sessionActionStatus.sessionId === filteredSelectedSession.sessionId
              ? sessionActionStatus.message
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function captureCardLayout(): CardLayoutSnapshot {
  const rects: CardLayoutSnapshot = new Map();
  document.querySelectorAll<HTMLElement>(".session-card[data-session-id]").forEach((card) => {
    const sessionId = card.dataset.sessionId;
    if (sessionId) rects.set(sessionId, card.getBoundingClientRect());
  });
  return rects;
}

function animateCardLayoutFrom(previousLayout: CardLayoutSnapshot): void {
  document.querySelectorAll<HTMLElement>(".session-card[data-session-id]").forEach((card) => {
    const sessionId = card.dataset.sessionId;
    const previousRect = sessionId ? previousLayout.get(sessionId) : undefined;
    if (!previousRect) return;

    const nextRect = card.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    const scaleX = previousRect.width / Math.max(nextRect.width, 1);
    const scaleY = previousRect.height / Math.max(nextRect.height, 1);
    const moved = Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5;
    const resized = Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;
    if (!moved && !resized) return;

    const previousTransition = card.style.transition;
    const previousTransform = card.style.transform;
    const previousTransformOrigin = card.style.transformOrigin;

    card.classList.add("is-layout-animating");
    card.style.transition = "none";
    card.style.transformOrigin = "top left";
    card.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
    void card.offsetWidth;

    window.requestAnimationFrame(() => {
      card.style.transition = "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)";
      card.style.transform = "translate(0, 0) scale(1, 1)";

      window.setTimeout(() => {
        card.style.transition = previousTransition;
        card.style.transform = previousTransform;
        card.style.transformOrigin = previousTransformOrigin;
        card.classList.remove("is-layout-animating");
      }, 320);
    });
  });
}


function emptyBoardTitle({
  showDemoData,
  hasActiveToolbarFilters,
  liveConnection
}: {
  showDemoData: boolean;
  hasActiveToolbarFilters: boolean;
  liveConnection: ConnectionState;
}): string {
  if (hasActiveToolbarFilters) return "No sessions match";
  if (showDemoData) return "No demo sessions";
  if (liveConnection.state === "live") return "No active sessions";
  if (liveConnection.state === "offline") return "No live connection";
  return "Connecting to Masthead collector";
}

function emptyBoardMessage({
  showDemoData,
  hasActiveToolbarFilters,
  liveConnection
}: {
  showDemoData: boolean;
  hasActiveToolbarFilters: boolean;
  liveConnection: ConnectionState;
}): string {
  if (hasActiveToolbarFilters) return "Adjust the toolbar filters to bring sessions back into view.";
  if (showDemoData) return "Demo replay is available only when fixture data exists.";
  if (liveConnection.state === "live") return "New activity from connected sources will appear here.";
  if (liveConnection.state === "offline") return "Use the Connector panel to start or check the local collector.";
  return "Now will switch to live sessions when the local collector responds.";
}

function exportedSessionCount(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("sessions" in value)) return undefined;
  const sessions = value.sessions;
  return Array.isArray(sessions) ? sessions.length : undefined;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function scopeLabel(scope: DeleteMastheadDataScope): string {
  if (scope.kind === "session") return `session ${scope.sessionId}`;
  if (scope.kind === "runtime") return `runtime ${scope.runtime}`;
  if (scope.kind === "host") return `host ${scope.host}`;
  if (scope.kind === "project") return `project ${scope.project}`;
  if (scope.kind === "raw_payloads") return "raw source copies";
  return "all Masthead data";
}

function reasonForAction(action: Extract<SafeAction, "snooze" | "dismiss" | "mark_reviewed" | "mark_expected">): string {
  const reasons = {
    snooze: "Snoozed from Masthead Now.",
    dismiss: "Dismissed from Masthead Now.",
    mark_reviewed: "Marked reviewed from Masthead Now.",
    mark_expected: "Marked expected from Masthead Now."
  };
  return reasons[action];
}

function messageForDisposition(disposition: ReviewDisposition): string {
  if (disposition.status === "snoozed" && disposition.snoozedUntil) {
    return `Snoozed locally until ${disposition.snoozedUntil}.`;
  }

  const labels: Record<ReviewDisposition["status"], string> = {
    reviewed: "Marked reviewed locally.",
    expected: "Marked expected locally.",
    dismissed: "Dismissed locally.",
    snoozed: "Snoozed locally.",
    false_positive: "Marked false positive locally."
  };
  return labels[disposition.status];
}

function downloadTextFile(filename: string, contents: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
