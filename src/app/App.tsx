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
import { HistoryPanel } from "../ui/HistoryPanel";
import { ObservabilitySidebar, type AppSurface } from "../ui/ObservabilitySidebar";
import { buildObservabilityDemoBoard, observabilitySessionTotal } from "../ui/observabilityDemoBoard";
import { OperationsPanel } from "../ui/OperationsPanel";
import { prefersReducedMotion, readStoredMotionDisabled, writeStoredMotionDisabled } from "../ui/motionPreference";
import {
  SESSION_CARD_LAYOUT_CLEANUP_BUFFER_MS,
  SESSION_CARD_LAYOUT_DURATION_MS,
  SESSION_CARD_LAYOUT_EASING,
  SessionBoard
} from "../ui/SessionBoard";
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

  isLiveProjectionEnvelope,
  normalizeLiveBoardProjection,
} from "./liveProjectionClient";
import { startLiveConnector } from "./connectorClient";
import { useMastheadConnection } from "./connection/useMastheadConnection";
import { ConnectionRecoveryPanel } from "../ui/ConnectionRecoveryPanel";
import { saveReviewDisposition } from "./daemonClient";
import { LogbookSurface } from "./surfaces/LogbookSurface";
import { NowSurface } from "./surfaces/NowSurface";
import { SettingsSurface } from "./surfaces/SettingsSurface";
import { SourcesSurface } from "./surfaces/SourcesSurface";
import { UsageSurface } from "./surfaces/UsageSurface";
import { UsagePanel } from "../ui/usage/UsagePanel";
import { APP_VERSION_LABEL } from "./version";
import type { ConnectionState } from "../ui/ConnectionStatus";
import { useBoardSessionDetailController } from "./board/useBoardSessionDetailController";
import { useLogbookController } from "./logbook/useLogbookController";
import { useSettingsDataController } from "./settings/useSettingsDataController";
import { useSourcesController } from "./sources/useSourcesController";
import { useUsageStatsController } from "./usage/useUsageStatsController";
import { clearUnsupportedLocationHash } from "./locationHash";

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
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("operational_priority");
  const [activityWindow, setActivityWindow] = useState<ActivityWindow>("24h");
  const [refreshRateMs, setRefreshRateMs] = useState(10_000);
  const [density, setDensity] = useState<CardDensity>("comfortable");
  const [motionDisabled, setMotionDisabled] = useState(() => readStoredMotionDisabled());
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
  const [sourceLibraryRefreshKey, setSourceLibraryRefreshKey] = useState(0);
  const isLiveConnection =
    connection.state.state !== "offline" &&
    connection.state.state !== "incompatible" &&
    connection.state.state !== "probing" &&
    liveConnection.state === "live";
  const handleSourceLibraryChanged = useCallback(() => setSourceLibraryRefreshKey((current) => current + 1), []);
  const sourcesController = useSourcesController({
    activeProjectionUrl,
    activeSurface,
    isLive: isLiveConnection,
    onLibraryChanged: handleSourceLibraryChanged
  });
  const {
    adapters,
    busy: sourcesBusy,
    cancel: handleCancelImport,
    connectSelected: handleConnectSelectedSources,
    enableTranscriptImport: handleEnableTranscriptImport,
    excludePath: handleExcludeSourcePath,
    importMetadata: handleImportMetadata,
    importPage,
    importTranscripts: handleImportTranscripts,
    imports,
    loadAdapterSources: handleLoadAdapterSources,
    pollActiveImports: handlePollActiveImports,
    refreshSources: handleRefreshSources,
    repair: handleRepairSources,
    retry: handleRetryImport,
    runSetup: handleRunSourcesSetup,
    scan: handleScanSources,
    scanSetup: handleScanSourcesSetup,
    setup: sourcesSetup,
    sources,
    status: sourcesStatus,
    syncAll: handleSyncSources,
    syncRuntime: handleSyncAdapter
  } = sourcesController;
  const logbook = useLogbookController({
    activeProjectionUrl,
    activeSurface,
    adapters,
    externalRefreshKey: sourceLibraryRefreshKey,
    isLive: isLiveConnection
  });
  const [sessionActionStatus, setSessionActionStatus] = useState<{ sessionId: string; message: string }>();
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
  const filteredAttentionItems = useMemo(
    () => filterAttentionItemsForCards(board.attentionQueue, filteredCards),
    [board.attentionQueue, filteredCards]
  );
  const filteredSelectedSession =
    board.selectedSession && filteredCards.some((card) => card.sessionId === board.selectedSession?.sessionId)
      ? board.selectedSession
      : undefined;
  const selectedBoardCanonicalSessionId = filteredSelectedSession?.canonicalSessionId;
  const boardDetail = useBoardSessionDetailController({
    activeProjectionUrl,
    open: detailModalOpen,
    sessionId: selectedBoardCanonicalSessionId,
    showDemoData
  });
  const effectiveLiveConnection = useMemo<ConnectionState>(() => {
    if (connection.state.state === "offline" || connection.state.state === "incompatible") {
      return { state: "offline", error: "error" in connection.state ? connection.state.error : "Masthead daemon unavailable" };
    }
    if (connection.state.state === "probing") return { state: "connecting" };
    return liveConnection;
  }, [connection.state, liveConnection]);
  const usage = useUsageStatsController({
    active: activeSurface === "usage",
    activeProjectionUrl,
    isLive: effectiveLiveConnection.state === "live",
    refreshKey: sourceLibraryRefreshKey
  });
  const handleReviewDispositionsChanged = useCallback((dispositions: ReviewDisposition[]) => setReviewDispositions(dispositions), []);
  const handleMotionDisabledChange = useCallback((disabled: boolean) => setMotionDisabled(disabled), []);

  useEffect(() => {
    clearUnsupportedLocationHash();
  }, []);

  useEffect(() => {
    writeStoredMotionDisabled(motionDisabled);
  }, [motionDisabled]);

  useEffect(() => {
    document.documentElement.dataset.mastheadMotion = motionDisabled ? "off" : "daily";
  }, [motionDisabled]);

  const handleCanonicalDataDeleted = useCallback(() => {
    setLiveProjection(emptyLiveBoard);
    setLiveEvents([]);
    setLiveGitSnapshots([]);
    setSessionActionStatus(undefined);
  }, []);
  const settingsData = useSettingsDataController({
    activeProjectionUrl,
    connectionState: connection.state,
    isLive: effectiveLiveConnection.state === "live",
    onCanonicalDataDeleted: handleCanonicalDataDeleted,
    onReviewDispositionsChanged: handleReviewDispositionsChanged,
    writable: connection.writable
  });

  const toggleDensity = useCallback(() => {
    const updateDensity = () => setDensity((current) => (current === "compact" ? "comfortable" : "compact"));

    if (motionDisabled || prefersReducedMotion()) {
      updateDensity();
      return;
    }

    const previousLayout = captureCardLayout();
    flushSync(updateDensity);
    animateCardLayoutFrom(previousLayout);
  }, [motionDisabled]);

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

  const loadLiveProjection = useCallback(async () => {
    const requestId = liveRequestIdRef.current + 1;
    liveRequestIdRef.current = requestId;
    const selectedLiveSessionId = selectedSessionId ?? undefined;
    const isCurrentRequest = () => liveRequestIdRef.current === requestId;

    const mastheadApi = connection.api;
    try {
      const body = await mastheadApi.getLiveProjection(selectedLiveSessionId, { refreshIntervalMs: refreshRateMs });
      if (!isLiveProjectionEnvelope(body)) throw new Error("projection response did not match live envelope");
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
  }, [activeProjectionUrl, refreshRateMs, selectedSessionId]);

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
          importTotal={importPage.total}
          setup={sourcesSetup}
          busy={sourcesBusy}
          status={sourcesStatus}
          onCancelImport={handleCancelImport}
          onConnectSelected={handleConnectSelectedSources}
          onEnableTranscriptImport={handleEnableTranscriptImport}
          onExcludePath={handleExcludeSourcePath}
          onImportMetadata={handleImportMetadata}
          onImportTranscripts={handleImportTranscripts}
          onLoadAdapterSources={handleLoadAdapterSources}
          onPollImports={handlePollActiveImports}
          onPreviewImport={sourcesController.previewImport}
          onRepairSources={handleRepairSources}
          onRefresh={handleRefreshSources}
          onRetryImport={handleRetryImport}
          onRunSetup={handleRunSourcesSetup}
          onScan={handleScanSources}
          onScanSetup={handleScanSourcesSetup}
          onSyncAdapter={handleSyncAdapter}
          onSyncSources={handleSyncSources}
        />
      )}</SourcesSurface>
    ) : activeSurface === "logbook" ? (
      <LogbookSurface>
        <>
          <HistoryPanel
            records={showDemoData ? historyRecords : undefined}
            adapters={adapters}
            connectionState={connection.state.state === "offline" ? "offline" : connection.state.state === "incompatible" ? "incompatible" : effectiveLiveConnection.state === "live" ? "live" : "connecting"}
            filterOptions={logbook.filterOptions}
            filters={logbook.filters}
            imports={imports}
            importBusy={sourcesBusy}
            pageIndex={logbook.pageIndex}
            pageSize={logbook.pageSize}
            query={logbook.query}
            density="compact"
            loadState={needsRecoveryPanel ? { state: "ready", sessions: [], total: 0 } : showDemoData ? undefined : logbook.loadState}
            refreshError={logbook.refreshError}
            selectedSessionId={logbook.selectedSessionId}
            sort={logbook.sort}
            sources={sources}
            summary={logbook.summary}
            onFilterChange={logbook.changeFilters}
            onImportMetadata={handleImportMetadata}
            onOpenSources={() => setActiveSurface("sources")}
            onQueryChange={logbook.changeQuery}
            onPageChange={logbook.changePage}
            onRetry={logbook.retry}
            onSessionSelect={logbook.selectSession}
            onSortChange={logbook.changeSort}
          />
          {logbook.selectedSessionId ? (
            <SessionLibraryDetail
              session={logbook.selectedSession}
              excerpts={logbook.excerpts}
              loading={logbook.detailLoading}
              dossier={logbook.dossier}
              dossierLoading={logbook.dossierLoading}
              dossierError={logbook.dossierError}
              onRetryDossier={logbook.retryDossier}
              transcript={logbook.transcript}
              transcriptLoading={logbook.transcriptLoading}
              transcriptError={logbook.transcriptError}
              transcriptFilter={logbook.transcriptFilter}
              transcriptQuery={logbook.transcriptQuery}
              onTranscriptFilterChange={logbook.setTranscriptFilter}
              onTranscriptQueryChange={logbook.setTranscriptQuery}
              onTranscriptLoadMore={() => void logbook.loadMoreTranscript()}
              onRetryTranscript={logbook.retryTranscript}
              onOpenSources={() => setActiveSurface("sources")}
              onClose={logbook.closeSession}
            />
          ) : null}
        </>
      </LogbookSurface>
    ) : activeSurface === "usage" ? (
      <UsageSurface>
        {needsRecoveryPanel ? (
          recoveryPanel
        ) : (
          <UsagePanel
            stats={usage.stats}
            window={usage.window}
            loading={usage.loading}
            error={usage.error}
            onWindowChange={usage.setWindow}
            onRetry={usage.retry}
          />
        )}
      </UsageSurface>
    ) : activeSurface === "settings" ? (
      <SettingsSurface>
        {needsRecoveryPanel ? (
          recoveryPanel
        ) : (
          <OperationsPanel
            baseUrl={activeProjectionUrl}
            connection={connection.state}
            onReconnect={connection.refresh}
            onStartConnector={handleStartConnector}
            dataSummary={settingsData.dataSummary}
            deletionScopeKind={settingsData.deletionScopeKind}
            deletionScopeTarget={settingsData.deletionScopeTarget}
            localDataStatus={settingsData.localDataStatus}
            motionDisabled={motionDisabled}
            onCancelLocalDataAction={settingsData.cancelLocalDataAction}
            onDeletionScopeKindChange={settingsData.changeDeletionScopeKind}
            onDeletionScopeTargetChange={settingsData.changeDeletionScopeTarget}
            onExportLocalData={settingsData.exportLocalData}
            onMotionDisabledChange={handleMotionDisabledChange}
            onRequestPruneLocalData={settingsData.requestPruneLocalData}
            onConfirmPruneLocalData={settingsData.confirmPruneLocalData}
            onRequestScopedDelete={settingsData.requestScopedDelete}
            onConfirmScopedDelete={settingsData.confirmScopedDelete}
            onRequestDeleteLocalData={settingsData.requestDeleteLocalData}
            onConfirmDeleteLocalData={settingsData.confirmDeleteLocalData}
            readOnly={!connection.writable}
          />
        )}
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
            usageStats={usage.sidebarStats}
            usageLoading={usage.sidebarLoading}
            usageError={usage.sidebarError}
            onSurfaceChange={setActiveSurface}
          />
        }
        main={mainSurface}
        motionMode={motionDisabled ? "off" : "daily"}
      />

      {detailModalOpen && filteredSelectedSession ? (
        <SessionDetailModal
          session={filteredSelectedSession}
          onClose={() => setDetailModalOpen(false)}
          onAction={handleSessionAction}
          dossier={boardDetail.dossier}
          dossierLoading={boardDetail.dossierLoading}
          dossierError={boardDetail.dossierError}
          onRetryDossier={boardDetail.retryDossier}
          transcript={boardDetail.transcript}
          transcriptLoading={boardDetail.transcriptLoading}
          transcriptError={boardDetail.transcriptError}
          transcriptFilter={boardDetail.transcriptFilter}
          transcriptQuery={boardDetail.transcriptQuery}
          onTranscriptFilterChange={boardDetail.setTranscriptFilter}
          onTranscriptQueryChange={boardDetail.setTranscriptQuery}
          onTranscriptLoadMore={() => void boardDetail.loadMoreTranscript()}
          onRetryTranscript={boardDetail.retryTranscript}
          onOpenSources={() => {
            setDetailModalOpen(false);
            setActiveSurface("sources");
          }}
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
  if (prefersReducedMotion()) return;

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
      card.style.transition = `transform ${SESSION_CARD_LAYOUT_DURATION_MS}ms ${SESSION_CARD_LAYOUT_EASING}`;
      card.style.transform = "translate(0, 0) scale(1, 1)";

      window.setTimeout(() => {
        card.style.transition = previousTransition;
        card.style.transform = previousTransform;
        card.style.transformOrigin = previousTransformOrigin;
        card.classList.remove("is-layout-animating");
      }, SESSION_CARD_LAYOUT_DURATION_MS + SESSION_CARD_LAYOUT_CLEANUP_BUFFER_MS);
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
  return "Board will switch to live sessions when the local collector responds.";
}

function reasonForAction(action: Extract<SafeAction, "snooze" | "dismiss" | "mark_reviewed" | "mark_expected">): string {
  const reasons = {
    snooze: "Snoozed from Masthead Board.",
    dismiss: "Dismissed from Masthead Board.",
    mark_reviewed: "Marked reviewed from Masthead Board.",
    mark_expected: "Marked expected from Masthead Board."
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
