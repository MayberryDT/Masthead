import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  prefersReducedMotion,
  readStoredMotionDisabled,
  readStoredSessionEndedNotificationsEnabled,
  writeStoredMotionDisabled,
  writeStoredSessionEndedNotificationsEnabled
} from "../ui/motionPreference";
import { emitSessionTransitionNotifications } from "./liveSessionEndedNotifications";
import { readOnboardingDismissed } from "./onboardingPreference";
import {
  applyIdlePresentationToProjection,
  markIdleDoneSeen,
  type IdlePresentationTrack
} from "./sessionIdlePresentation";
import {
  SessionBoard
} from "../ui/SessionBoard";
import { SessionDetailModal } from "../ui/SessionDetailModal";
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
import { isDesktopBridgeAvailable } from "./desktopBridge";
import { useMastheadConnection } from "./connection/useMastheadConnection";
import { MastheadApiClient } from "./api/MastheadApiClient";
import { ConnectionRecoveryPanel, type CollectorStartupLogEntry, type ConnectorActionView } from "../ui/ConnectionRecoveryPanel";
import { saveReviewDisposition } from "./daemonClient";
import { LogbookSurface } from "./surfaces/LogbookSurface";
import { NowSurface } from "./surfaces/NowSurface";
import { SettingsSurface } from "./surfaces/SettingsSurface";
import { SourcesSurface } from "./surfaces/SourcesSurface";
import { WorkbenchSurface } from "./surfaces/WorkbenchSurface";
import { WorkbenchPanel } from "../ui/workbench/WorkbenchPanel";
import { APP_VERSION_LABEL } from "./version";
import type { ConnectionState } from "../ui/ConnectionStatus";
import { useBoardSessionDetailController } from "./board/useBoardSessionDetailController";
import { useLogbookController } from "./logbook/useLogbookController";
import { useSettingsDataController } from "./settings/useSettingsDataController";
import { useSourcesController } from "./sources/useSourcesController";
import { useSourcesConnectorsController } from "./sources/useSourcesConnectorsController";
import { useKnowledgeFlowSummary } from "./sidebar/useKnowledgeFlowSummary";
import { useWorkbenchController } from "./workbench/useWorkbenchController";
import { clearUnsupportedLocationHash } from "./locationHash";

type ConnectorActionState = ConnectorActionView;
type LiveProjectionLoadResult = "loaded" | "superseded" | "failed";

const STARTUP_PROJECTION_ERROR_MESSAGE = "Collector started, but live projection did not load.";

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
  const [activeSurface, setActiveSurface] = useState<AppSurface>(() => readOnboardingDismissed() ? "now" : "sources");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("operational_priority");
  const [activityWindow, setActivityWindow] = useState<ActivityWindow>("7d");
  const [refreshRateMs, setRefreshRateMs] = useState(10_000);
  const [density, setDensity] = useState<CardDensity>("comfortable");
  const [motionDisabled, setMotionDisabled] = useState(() => readStoredMotionDisabled());
  const [sessionEndedNotificationsEnabled, setSessionEndedNotificationsEnabled] = useState(() =>
    readStoredSessionEndedNotificationsEnabled()
  );
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedSessionSnapshot, setSelectedSessionSnapshot] = useState<SessionDetailView>();
  const [liveProjection, setLiveProjection] = useState<LiveBoardProjection>();
  const liveProjectionRef = useRef<LiveBoardProjection | undefined>(undefined);
  const idlePresentationTracksRef = useRef(new Map<string, IdlePresentationTrack>());
  const notifiedSessionTransitionKeysRef = useRef(new Set<string>());
  const [liveConnection, setLiveConnection] = useState<ConnectionState>({ state: "connecting" });
  const [liveEvents, setLiveEvents] = useState<NormalizedEvent[]>();
  const [liveGitSnapshots, setLiveGitSnapshots] = useState<GitSnapshot[]>();
  const [connectorAction, setConnectorAction] = useState<ConnectorActionState>({ state: "idle" });
  const [collectorStartupLog, setCollectorStartupLog] = useState<CollectorStartupLogEntry[]>([]);
  const connection = useMastheadConnection();
  const activeProjectionUrl = connection.baseUrl;
  const activeProjectionUrlRef = useRef(activeProjectionUrl);
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
    clearImportJobsFilter: handleClearImportJobsFilter,
    connectSelected: handleConnectSelectedSources,
    excludePath: handleExcludeSourcePath,
    hookActionBusy,
    hooks: sourceHooks,
    importFilterRuntime,
    importMetadata: handleImportMetadata,
    importPage,
    imports,
    lastRefreshAt: sourcesLastRefreshAt,
    loadAdapterSources: handleLoadAdapterSources,
    openImportJobsForRuntime: handleOpenImportJobsForRuntime,
    pollActiveImports: handlePollActiveImports,
    refreshSources: handleRefreshSources,
    repair: handleRepairSources,
    retry: handleRetryImport,
    runRuntimeHookAction: handleRuntimeHookAction,
    runSetup: handleRunSourcesSetup,
    scan: handleScanSources,
    scanSetup: handleScanSourcesSetup,
    setup: sourcesSetup,
    sources,
    status: sourcesStatus,
    syncAll: handleSyncSources,
    syncRuntime: handleSyncAdapter
  } = sourcesController;
  const sourcesConnectors = useSourcesConnectorsController(activeProjectionUrl, {
    readOnly: !connection.writable
  });
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
  const autoStartAttemptedRef = useRef(false);
  const collectorStartInFlightRef = useRef(false);
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
    activityWindow !== "7d";
  const filteredAttentionItems = useMemo(
    () => filterAttentionItemsForCards(board.attentionQueue, filteredCards),
    [board.attentionQueue, filteredCards]
  );
  const selectedLiveSession =
    selectedSessionId && board.selectedSession?.sessionId === selectedSessionId ? board.selectedSession : undefined;
  const modalSelectedSession =
    selectedLiveSession ??
    (selectedSessionSnapshot?.sessionId === selectedSessionId ? selectedSessionSnapshot : undefined);
  const selectedBoardCanonicalSessionId = modalSelectedSession?.canonicalSessionId;
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
  const knowledgeFlow = useKnowledgeFlowSummary({
    activeProjectionUrl,
    isLive: effectiveLiveConnection.state === "live",
    refreshKey: sourceLibraryRefreshKey
  });
  const workbench = useWorkbenchController({
    active: activeSurface === "workbench",
    activeProjectionUrl,
    isLive: effectiveLiveConnection.state === "live",
    refreshKey: sourceLibraryRefreshKey
  });
  const handleReviewDispositionsChanged = useCallback((dispositions: ReviewDisposition[]) => setReviewDispositions(dispositions), []);
  const handleMotionDisabledChange = useCallback((disabled: boolean) => setMotionDisabled(disabled), []);
  const appendCollectorStartupLog = useCallback((entry: CollectorStartupLogEntry) => {
    setCollectorStartupLog((current) => upsertCollectorStartupLogEntry(current, entry));
  }, []);

  useEffect(() => {
    clearUnsupportedLocationHash();
  }, []);

  useEffect(() => {
    activeProjectionUrlRef.current = activeProjectionUrl;
  }, [activeProjectionUrl]);

  useEffect(() => {
    writeStoredMotionDisabled(motionDisabled);
  }, [motionDisabled]);

  useEffect(() => {
    writeStoredSessionEndedNotificationsEnabled(sessionEndedNotificationsEnabled);
  }, [sessionEndedNotificationsEnabled]);

  useEffect(() => {
    document.documentElement.dataset.mastheadMotion = motionDisabled ? "off" : "daily";
  }, [motionDisabled]);

  const handleCanonicalDataDeleted = useCallback(() => {
    liveProjectionRef.current = undefined;
    notifiedSessionTransitionKeysRef.current.clear();
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
  useEffect(() => {
    if (
      sourcesConnectors.onboardingOpen &&
      effectiveLiveConnection.state === "live" &&
      connection.writable
    ) {
      setActiveSurface("sources");
    }
  }, [connection.writable, effectiveLiveConnection.state, sourcesConnectors.onboardingOpen]);

  const toggleDensity = useCallback(() => {
    setDensity((current) => (current === "compact" ? "comfortable" : "compact"));
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
    if (!detailModalOpen) {
      setSelectedSessionSnapshot(undefined);
      return;
    }
    if (selectedLiveSession) setSelectedSessionSnapshot(selectedLiveSession);
  }, [detailModalOpen, selectedLiveSession]);

  const loadLiveProjection = useCallback(async (targetUrl?: string): Promise<LiveProjectionLoadResult> => {
    const requestId = liveRequestIdRef.current + 1;
    liveRequestIdRef.current = requestId;
    const selectedLiveSessionId = selectedSessionId ?? undefined;
    const isCurrentRequest = () => liveRequestIdRef.current === requestId;

    const mastheadApi = targetUrl ? new MastheadApiClient(targetUrl) : connection.api;
    const isSupersededRequest = () => !isCurrentRequest() || mastheadApi.baseUrl !== activeProjectionUrlRef.current;
    try {
      const body = await mastheadApi.getLiveProjection(selectedLiveSessionId, { refreshIntervalMs: refreshRateMs });
      if (isSupersededRequest()) return "superseded";
      if (!isLiveProjectionEnvelope(body)) throw new Error("projection response did not match live envelope");
      const previousProjection = liveProjectionRef.current;
      const normalized = normalizeLiveBoardProjection(body.projection, selectedSessionId);
      const presented = applyIdlePresentationToProjection(normalized, idlePresentationTracksRef.current);
      liveProjectionRef.current = presented;
      setLiveProjection(presented);
      void emitSessionTransitionNotifications(previousProjection, presented, {
        enabled: sessionEndedNotificationsEnabled,
        notifiedTransitionKeys: notifiedSessionTransitionKeysRef.current
      });
      setShowDemoData(false);
      setConnectorAction((current) =>
        current.state === "idle" ? current : { state: "started", message: "Collector connected." }
      );
      setCollectorStartupLog((current) => {
        const settled = current.map((entry) => (entry.state === "running" || entry.state === "error" ? { ...entry, state: "done" as const } : entry));
        if (!settled.some((entry) => entry.id === "projection")) return settled;
        return upsertCollectorStartupLogEntry(settled, {
          id: "projection",
          label: "Live projection",
          detail: "Loaded live projection.",
          state: "done"
        });
      });
      setLiveConnection({
        state: "live",
        events: body.events,
        gitSnapshots: body.gitSnapshots,
        diagnostics: body.diagnostics,
        generatedAt: body.generatedAt
      });
      return "loaded";
    } catch (error) {
      if (isSupersededRequest()) return "superseded";
      liveProjectionRef.current = undefined;
      notifiedSessionTransitionKeysRef.current.clear();
      setLiveProjection(undefined);
      setLiveEvents(undefined);
      setLiveGitSnapshots(undefined);
      setLiveConnection({
        state: "offline",
        error: error instanceof Error ? error.message : String(error)
      });
      return "failed";
    }
  }, [activeProjectionUrl, connection.api, refreshRateMs, selectedSessionId, sessionEndedNotificationsEnabled]);

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
    setSelectedSessionSnapshot(undefined);
    setSelectedSessionId(sessionId);
    setDetailModalOpen(true);
  };

  const startCollector = useCallback(
    async ({ automatic = false }: { automatic?: boolean } = {}) => {
      if (collectorStartInFlightRef.current) return;
      collectorStartInFlightRef.current = true;
      setConnectorAction({
        state: "starting",
        message: automatic ? "Starting local collector after app launch..." : "Starting local collector..."
      });
      setCollectorStartupLog([
        {
          id: "bridge",
          label: "Desktop bridge",
          detail: "Requesting collector startup.",
          state: "running"
        }
      ]);
      let failureLogEntry: CollectorStartupLogEntry = {
        id: "bridge",
        label: "Desktop bridge",
        detail: "Collector startup failed.",
        state: "error"
      };

      try {
        const result = await startLiveConnector();
        if (result.ok) {
          appendCollectorStartupLog({
            id: "bridge",
            label: "Desktop bridge",
            detail: "Collector startup response received.",
            state: "done"
          });
          appendCollectorStartupLog({
            id: "daemon",
            label: "Daemon",
            detail: result.started ? "Started local daemon." : "Reused running daemon.",
            state: "done"
          });
          appendCollectorStartupLog({
            id: "connect",
            label: "Connection",
            detail: `Accepting ${result.projectionUrl}.`,
            state: "running"
          });
          failureLogEntry = {
            id: "connect",
            label: "Connection",
            detail: "Connection setup failed.",
            state: "error"
          };
          await connection.connectTo(result.projectionUrl);
          activeProjectionUrlRef.current = result.baseUrl;
          appendCollectorStartupLog({
            id: "connect",
            label: "Connection",
            detail: `Accepted ${result.projectionUrl}.`,
            state: "done"
          });
          setConnectorAction({
            state: "started",
            message: `${result.message} Connected to ${result.baseUrl}.`
          });
          appendCollectorStartupLog({
            id: "projection",
            label: "Live projection",
            detail: "Loading live projection.",
            state: "running"
          });
          failureLogEntry = {
            id: "projection",
            label: "Live projection",
            detail: "Live projection did not load.",
            state: "error"
          };
          const projectionLoadResult = await loadLiveProjection(result.projectionUrl);
          if (projectionLoadResult === "superseded") {
            appendCollectorStartupLog({
              id: "projection",
              label: "Live projection",
              detail: "Handed off to the refreshed connection.",
              state: "done"
            });
          } else if (projectionLoadResult === "failed") {
            appendCollectorStartupLog({
              id: "projection",
              label: "Live projection",
              detail: "Live projection did not load.",
              state: "error"
            });
            setConnectorAction({
              state: "error",
              message: STARTUP_PROJECTION_ERROR_MESSAGE
            });
          }
          return;
        }

        appendCollectorStartupLog({
          id: "bridge",
          label: "Desktop bridge",
          detail: "Collector startup is unsupported here.",
          state: "error"
        });
        setConnectorAction({
          state: "unsupported",
          message: result.message
        });
      } catch (error) {
        appendCollectorStartupLog(failureLogEntry);
        setConnectorAction({
          state: "error",
          message: `Could not start collector: ${error instanceof Error ? error.message : String(error)}`
        });
      } finally {
        collectorStartInFlightRef.current = false;
      }
    },
    [appendCollectorStartupLog, connection, loadLiveProjection]
  );

  const handleStartConnector = useCallback(() => {
    void startCollector();
  }, [startCollector]);

  useEffect(() => {
    if (showDemoData) return;
    if (!isDesktopBridgeAvailable()) return;
    if (autoStartAttemptedRef.current) return;
    if (connection.state.state !== "offline" && connection.state.state !== "incompatible") return;

    let cancelled = false;
    let secondFrame: number | undefined;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled || autoStartAttemptedRef.current) return;
        autoStartAttemptedRef.current = true;
        void startCollector({ automatic: true });
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
    };
  }, [connection.state.state, showDemoData, startCollector]);

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

  const hasActiveCollectorStartup =
    connectorAction.state === "starting" ||
    connectorAction.state === "error" ||
    connectorAction.state === "unsupported" ||
    collectorStartupLog.some((entry) => entry.state === "running" || entry.state === "error");
  const needsRecoveryPanel =
    connection.state.state === "offline" || connection.state.state === "incompatible" || hasActiveCollectorStartup;
  const recoveryPanel = (
    <ConnectionRecoveryPanel
      action={connectorAction}
      connection={connection.state}
      startupLog={collectorStartupLog}
      onRetry={connection.refresh}
      onStart={handleStartConnector}
    />
  );


  const mainSurface =
    activeSurface === "sources" ? (
      <SourcesSurface>{needsRecoveryPanel ? recoveryPanel : (
        <SourcesPanel
          sources={sources}
          adapters={adapters}
          imports={imports}
          importTotal={importPage.total}
          importFilterRuntime={importFilterRuntime}
          lastRefreshAt={sourcesLastRefreshAt}
          setup={sourcesSetup}
          busy={sourcesBusy || sourcesConnectors.busy}
          enrichment={settingsData.settingsState?.enrichment}
          hooks={sourceHooks}
          hookActionBusy={hookActionBusy}
          llm={settingsData.settingsState?.llm}
          onboardingOpen={sourcesConnectors.onboardingOpen}
          readOnly={!connection.writable}
          settingsBaseUrl={activeProjectionUrl}
          status={sourcesConnectors.refreshStatus ?? sourcesStatus}
          refreshStatus={sourcesConnectors.refreshStatus}
          cardActionStatus={sourcesConnectors.cardActionStatus}
          actionRuntime={sourcesConnectors.actionRuntime}
          connectorsSnapshot={sourcesConnectors.snapshot}
          selectedConnectorRuntime={sourcesConnectors.selectedRuntime}
          onSelectConnectorRuntime={sourcesConnectors.setSelectedRuntime}
          onDiscoverConnectors={() => sourcesConnectors.discover()}
          onEnableConnector={(runtime) => sourcesConnectors.enable(runtime)}
          onEnableAllDetectedConnectors={() => void sourcesConnectors.enableAllDetected()}
          onTestConnector={(runtime) => void sourcesConnectors.test(runtime)}
          onUninstallConnector={(runtime) => void sourcesConnectors.uninstall(runtime)}
          onConfirmConnectorActivation={(runtime) => void sourcesConnectors.confirmActivation(runtime)}
          onCancelImport={handleCancelImport}
          onClearImportJobsFilter={handleClearImportJobsFilter}
          onCloseOnboarding={() => {
            sourcesConnectors.closeOnboarding();
            setActiveSurface("workbench");
          }}
          onRuntimeHookAction={handleRuntimeHookAction}
          onConnectSelected={handleConnectSelectedSources}
          onExcludePath={handleExcludeSourcePath}
          onImportMetadata={handleImportMetadata}
          onLoadAdapterSources={handleLoadAdapterSources}
          onOpenImportJobsForRuntime={handleOpenImportJobsForRuntime}
          onOpenOnboarding={sourcesConnectors.openOnboarding}
          onPollImports={handlePollActiveImports}
          onPreviewImport={sourcesController.previewImport}
          onRepairSources={handleRepairSources}
          onRefresh={() => {
            // Sources V2: refresh only live harness connections (not history import scan).
            void sourcesConnectors.discover();
          }}
          onRetryImport={handleRetryImport}
          onRunSetup={handleRunSourcesSetup}
          onSaveLlmProvider={settingsData.saveLlmProviderSettings}
          onScan={handleScanSources}
          onScanSetup={handleScanSourcesSetup}
          onSkipOnboarding={sourcesConnectors.skipOnboarding}
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
            detailError={logbook.detailError}
            detailLoading={logbook.detailLoading}
            filterOptions={logbook.filterOptions}
            filters={logbook.filters}
            importBusy={sourcesBusy}
            pageIndex={logbook.pageIndex}
            pageSize={logbook.pageSize}
            query={logbook.query}
            density="compact"
            loadState={needsRecoveryPanel ? { state: "ready", sessions: [], total: 0 } : showDemoData ? undefined : logbook.loadState}
            refreshError={logbook.refreshError}
            selectedArtifact={logbook.selectedArtifact}
            selectedSessionId={logbook.selectedSessionId}
            sort={logbook.sort}
            sources={sources}
            onCloseDetail={logbook.closeSession}
            onFilterChange={logbook.changeFilters}
            onImportMetadata={handleImportMetadata}
            onOpenSources={() => setActiveSurface("sources")}
            onQueryChange={logbook.changeQuery}
            onPageChange={logbook.changePage}
            onRetry={logbook.retry}
            onSessionSelect={logbook.selectSession}
            onSortChange={logbook.changeSort}
          />
        </>
      </LogbookSurface>
    ) : activeSurface === "workbench" ? (
      <WorkbenchSurface>
        <WorkbenchPanel
          actionBusy={workbench.actionBusy}
          actionError={workbench.actionError}
          activity={workbench.activity}
          canRun={workbench.canRun}
          clearActionFeedback={workbench.clearActionFeedback}
          error={workbench.error}
          handoffText={workbench.handoffText}
          lastActionSummary={workbench.lastActionSummary}
          loading={workbench.loading}
          notAddedOpen={workbench.notAddedOpen}
          notAddedSessions={workbench.notAddedSessions}
          notAddedSummary={workbench.notAddedSummary}
          onClearSelection={workbench.clearSelection}
          onRetry={workbench.retry}
          onSelectAll={workbench.selectAll}
          onSelectPage={workbench.selectPage}
          onToggleSession={workbench.toggleSession}
          page={workbench.page}
          pageSize={workbench.pageSize}
          runAction={workbench.runAction}
          selectedSessionIds={workbench.selectedSessionIds}
          sessions={workbench.sessions}
          setNotAddedOpen={workbench.setNotAddedOpen}
          setPage={workbench.setPage}
          total={workbench.total}
        />
      </WorkbenchSurface>
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
            sessionEndedNotificationsEnabled={sessionEndedNotificationsEnabled}
            onSessionEndedNotificationsEnabledChange={setSessionEndedNotificationsEnabled}
            settingsError={settingsData.settingsError}
            settingsLoadState={settingsData.settingsLoadState}
            settingsState={settingsData.settingsState}
            onCancelLocalDataAction={settingsData.cancelLocalDataAction}
            onDeletionScopeKindChange={settingsData.changeDeletionScopeKind}
            onDeletionScopeTargetChange={settingsData.changeDeletionScopeTarget}
            onExportLocalData={settingsData.exportLocalData}
            onMotionDisabledChange={handleMotionDisabledChange}
            onReloadSettings={() => void settingsData.loadSettingsState()}
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
            onDoneSeen={(sessionId) => {
              markIdleDoneSeen(idlePresentationTracksRef.current, sessionId);
              setLiveProjection((current) => {
                if (!current) return current;
                const next = {
                  ...current,
                  cards: current.cards.map((card) =>
                    card.sessionId === sessionId && card.displayState === "done"
                      ? { ...card, displayState: "idle" as const, stateLabel: "Idle" }
                      : card
                  )
                };
                liveProjectionRef.current = next;
                return next;
              });
            }}
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
            knowledgeFlowSummary={knowledgeFlow.summary}
            knowledgeFlowLoading={knowledgeFlow.loading}
            knowledgeFlowError={knowledgeFlow.error}
            imports={imports}
            onSurfaceChange={setActiveSurface}
          />
        }
        main={mainSurface}
        motionMode={motionDisabled ? "off" : "daily"}
      />

      {detailModalOpen && modalSelectedSession ? (
        <SessionDetailModal
          session={modalSelectedSession}
          onClose={() => setDetailModalOpen(false)}
          onAction={handleSessionAction}
          dossier={boardDetail.dossier}
          dossierLoading={boardDetail.dossierLoading}
          dossierError={boardDetail.dossierError}
          dossierEnrichmentBusy={boardDetail.dossierEnrichmentBusy}
          dossierEnrichmentError={boardDetail.dossierEnrichmentError}
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
            sessionActionStatus && sessionActionStatus.sessionId === modalSelectedSession.sessionId
              ? sessionActionStatus.message
              : undefined
          }
        />
      ) : null}
    </>
  );
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

function upsertCollectorStartupLogEntry(
  entries: CollectorStartupLogEntry[],
  entry: CollectorStartupLogEntry
): CollectorStartupLogEntry[] {
  const existingIndex = entries.findIndex((current) => current.id === entry.id);
  if (existingIndex === -1) return [...entries, entry];

  const next = [...entries];
  next[existingIndex] = entry;
  return next;
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
