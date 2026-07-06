import { useEffect, useMemo, useRef, useState } from "react";
import type { LogbookFilterState, LogbookLoadState } from "../../ui/HistoryPanel";
import type { AppSurface } from "../../ui/ObservabilitySidebar";
import type { SessionDossierDto } from "../../shared/sessionDossier";
import {
  enrichSessionDossier,
  rebuildEnrichments,
  getLogbookSummary,
  getLogbookSession,
  getLogbookSessionExcerpts,
  getSessionDossier,
  getSessionTranscript,
  listProjects,
  searchLogbook,
  type AdapterStatus,
  type LogbookExcerpt,
  type LogbookSearchResult,
  type LogbookSessionDetail,
  type LogbookSort,
  type LogbookSummary,
  type SessionTranscriptKindFilter,
  type SessionTranscriptResult
} from "../daemonClient";
import { pollDossierEnrichment } from "../sessionDossierEnrichmentPolling";
import {
  logbookPageSearchFilters,
  readCachedLogbookPage,
  writeCachedLogbookPage,
  type LogbookPageCacheRequest
} from "../logbookPageCache";

const LOGBOOK_PAGE_SIZE = 50;

type LogbookBulkDepth = "summary" | "full";
type LogbookBulkTargetKind = "explicit" | "page" | "filtered";

type LogbookBulkTarget = {
  kind: LogbookBulkTargetKind;
  sessionIds: string[];
  total: number;
  capped?: boolean;
};

type UseLogbookControllerInput = {
  activeProjectionUrl: string;
  activeSurface: AppSurface;
  adapters: AdapterStatus[];
  externalRefreshKey: number;
  isLive: boolean;
};

export function useLogbookController({
  activeProjectionUrl,
  activeSurface,
  adapters,
  externalRefreshKey,
  isLive
}: UseLogbookControllerInput) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LogbookSearchResult>();
  const [summary, setSummary] = useState<LogbookSummary>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [retryKey, setRetryKey] = useState(0);
  const [sort, setSort] = useState<LogbookSort>("recent");
  const [pageIndex, setPageIndex] = useState(0);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [filters, setFilters] = useState<LogbookFilterState>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [bulkEnrichBusy, setBulkEnrichBusy] = useState(false);
  const [bulkEnrichError, setBulkEnrichError] = useState<string>();
  const [bulkTarget, setBulkTarget] = useState<LogbookBulkTarget>({ kind: "explicit", sessionIds: [], total: 0 });
  const [bulkConfirm, setBulkConfirm] = useState<{ depth: "full"; target: LogbookBulkTarget } | undefined>();
  const [bulkStatus, setBulkStatus] = useState<string>();
  const [selectedSession, setSelectedSession] = useState<LogbookSessionDetail>();
  const [excerpts, setExcerpts] = useState<LogbookExcerpt[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dossierRetryKey, setDossierRetryKey] = useState(0);
  const [dossier, setDossier] = useState<SessionDossierDto>();
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<string>();
  const [dossierEnrichmentBusy, setDossierEnrichmentBusy] = useState(false);
  const [dossierEnrichmentError, setDossierEnrichmentError] = useState<string>();
  const dossierEnrichmentAbortRef = useRef<AbortController | null>(null);
  const [transcriptRetryKey, setTranscriptRetryKey] = useState(0);
  const [transcript, setTranscript] = useState<SessionTranscriptResult>();
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string>();
  const [transcriptFilter, setTranscriptFilter] = useState<SessionTranscriptKindFilter>("all");
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [transcriptDebouncedQuery, setTranscriptDebouncedQuery] = useState("");
  const pageCacheRef = useRef(new Map<string, LogbookSearchResult>());
  const effectiveRetryKey = retryKey + externalRefreshKey;

  const loadState = useMemo<LogbookLoadState>(() => {
    if (result) {
      return {
        state: "ready",
        sessions: result.sessions,
        total: result.total,
        nextCursor: result.nextCursor
      };
    }
    if (error) return { state: "error", message: error };
    return { state: "loading" };
  }, [error, result]);

  const filterOptions = useMemo(
    () => ({
      models: Array.from(new Set(summary?.models.map((item) => item.model).filter(Boolean) ?? [])),
      projects: projectOptions,
      runtimes: Array.from(
        new Set([
          ...(summary?.runtimes.map((item) => item.runtime).filter(Boolean) ?? []),
          ...adapters.map((adapter) => adapter.runtime).filter(Boolean)
        ])
      )
    }),
    [adapters, projectOptions, summary]
  );

  const pageRequest = useMemo<LogbookPageCacheRequest>(
    () => ({
      baseUrl: activeProjectionUrl,
      filters,
      pageIndex,
      pageSize: LOGBOOK_PAGE_SIZE,
      query,
      retryKey: effectiveRetryKey,
      sort
    }),
    [activeProjectionUrl, effectiveRetryKey, filters, pageIndex, query, sort]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => setTranscriptDebouncedQuery(transcriptQuery), 200);
    return () => window.clearTimeout(timeout);
  }, [transcriptQuery]);

  useEffect(() => {
    return () => dossierEnrichmentAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (activeSurface !== "logbook" || !isLive) return;
    const cachedResult = readCachedLogbookPage(pageCacheRef.current, pageRequest);
    if (cachedResult) {
      setResult(cachedResult);
      setError(undefined);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void searchLogbook(logbookPageSearchFilters(pageRequest), activeProjectionUrl, { signal: controller.signal })
      .then((nextResult) => {
        if (controller.signal.aborted) return;
        writeCachedLogbookPage(pageCacheRef.current, pageRequest, nextResult);
        setResult(nextResult);
        setError(undefined);
        setSelectedSessionId(undefined);
      })
      .catch((searchError: unknown) => {
        if (!controller.signal.aborted) {
          console.error("[masthead] Logbook search failed", searchError);
          setError(searchError instanceof Error ? searchError.message : String(searchError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [activeProjectionUrl, activeSurface, isLive, pageRequest]);

  useEffect(() => {
    if (activeSurface !== "logbook") return;
    const controller = new AbortController();
    void Promise.all([getLogbookSummary(activeProjectionUrl, { signal: controller.signal }), listProjects(activeProjectionUrl, { signal: controller.signal })])
      .then(([nextSummary, projects]) => {
        setSummary(nextSummary);
        setProjectOptions(projects.map((project) => project.project));
      })
      .catch((metadataError: unknown) => {
        if (!controller.signal.aborted) console.error("[masthead] Logbook metadata failed", metadataError);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, activeSurface, effectiveRetryKey]);

  useEffect(() => {
    if (activeSurface !== "logbook" || !selectedSessionId) {
      setSelectedSession(undefined);
      setExcerpts([]);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    void Promise.all([
      getLogbookSession(selectedSessionId, activeProjectionUrl, { signal: controller.signal }),
      getLogbookSessionExcerpts(selectedSessionId, { limit: 8, q: query }, activeProjectionUrl, { signal: controller.signal })
    ])
      .then(([nextSession, nextExcerpts]) => {
        setSelectedSession(nextSession);
        setExcerpts(nextExcerpts);
      })
      .catch((detailError: unknown) => {
        if (!controller.signal.aborted) {
          console.error("[masthead] Logbook detail failed", detailError);
          setSelectedSession(undefined);
          setExcerpts([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, activeSurface, selectedSessionId, query]);

  useEffect(() => {
    if (activeSurface !== "logbook" || !selectedSessionId) {
      setDossier(undefined);
      setDossierError(undefined);
      setDossierLoading(false);
      return;
    }
    const controller = new AbortController();
    setDossierLoading(true);
    setDossierError(undefined);
    void getSessionDossier(selectedSessionId, activeProjectionUrl, { signal: controller.signal })
      .then((nextDossier) => {
        setDossier(nextDossier);
      })
      .catch((dossierLoadError: unknown) => {
        if (!controller.signal.aborted) {
          setDossier(undefined);
          setDossierError(dossierLoadError instanceof Error ? dossierLoadError.message : String(dossierLoadError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDossierLoading(false);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, activeSurface, dossierRetryKey, selectedSessionId]);

  useEffect(() => {
    if (activeSurface !== "logbook" || !selectedSessionId) {
      setTranscript(undefined);
      setTranscriptError(undefined);
      setTranscriptLoading(false);
      return;
    }
    const controller = new AbortController();
    setTranscript(undefined);
    setTranscriptLoading(true);
    setTranscriptError(undefined);
    void getSessionTranscript(
      selectedSessionId,
      {
        kind: transcriptFilter,
        limit: 100,
        q: transcriptDebouncedQuery
      },
      activeProjectionUrl,
      { signal: controller.signal }
    )
      .then((nextTranscript) => {
        setTranscript(nextTranscript);
      })
      .catch((transcriptLoadError: unknown) => {
        if (!controller.signal.aborted) {
          setTranscript(undefined);
          setTranscriptError(transcriptLoadError instanceof Error ? transcriptLoadError.message : String(transcriptLoadError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setTranscriptLoading(false);
      });
    return () => controller.abort();
  }, [
    activeProjectionUrl,
    activeSurface,
    selectedSessionId,
    transcriptDebouncedQuery,
    transcriptFilter,
    transcriptRetryKey
  ]);

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setPageIndex(0);
    setResult(undefined);
    setError(undefined);
    setSelectedSessionId(undefined);
  };

  const changeFilters = (nextFilters: LogbookFilterState) => {
    setFilters(nextFilters);
    setPageIndex(0);
    setResult(undefined);
    setError(undefined);
    setSelectedSessionId(undefined);
  };

  const changePage = (nextPageIndex: number) => {
    if (nextPageIndex === pageIndex) return;
    const nextPageRequest = {
      ...pageRequest,
      pageIndex: nextPageIndex
    };
    const cachedResult = readCachedLogbookPage(pageCacheRef.current, nextPageRequest);
    setPageIndex(nextPageIndex);
    if (cachedResult) {
      setResult(cachedResult);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(undefined);
    setSelectedSessionId(undefined);
  };

  const changeSort = (nextSort: LogbookSort) => {
    setSort(nextSort);
    setPageIndex(0);
    setResult(undefined);
    setSelectedSessionId(undefined);
  };

  const loadMoreTranscript = async () => {
    if (!selectedSessionId || !transcript?.nextCursor || transcriptLoading) return;
    setTranscriptLoading(true);
    setTranscriptError(undefined);
    try {
      const next = await getSessionTranscript(
        selectedSessionId,
        {
          cursor: transcript.nextCursor,
          kind: transcriptFilter,
          limit: 100,
          q: transcriptDebouncedQuery
        },
        activeProjectionUrl
      );
      setTranscript((current) => (current ? { ...next, items: [...current.items, ...next.items] } : next));
    } catch (loadMoreError) {
      setTranscriptError(loadMoreError instanceof Error ? loadMoreError.message : String(loadMoreError));
    } finally {
      setTranscriptLoading(false);
    }
  };

  const toggleBulkSelection = (sessionId: string) => {
    setSelectedSessionIds((current) => {
      const nextIds = current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId];
      setBulkTarget({ kind: "explicit", sessionIds: nextIds, total: nextIds.length });
      setBulkConfirm(undefined);
      setBulkStatus(undefined);
      setBulkEnrichError(undefined);
      return nextIds;
    });
  };

  const clearBulkSelection = () => {
    setSelectedSessionIds([]);
    setBulkTarget({ kind: "explicit", sessionIds: [], total: 0 });
    setBulkConfirm(undefined);
    setBulkStatus(undefined);
    setBulkEnrichError(undefined);
  };

  const selectCurrentPage = () => {
    const sessionIds = result?.sessions.map((session) => session.sessionId) ?? [];
    setSelectedSessionIds(sessionIds);
    setBulkTarget({ kind: "page", sessionIds, total: sessionIds.length });
    setBulkConfirm(undefined);
    setBulkStatus(undefined);
    setBulkEnrichError(undefined);
  };

  const selectAllMatchingFilter = async () => {
    const total = result?.total ?? 0;
    const limit = Math.min(total, 500);
    if (limit <= 0) {
      clearBulkSelection();
      setBulkTarget({ kind: "filtered", sessionIds: [], total: 0 });
      return;
    }
    setBulkEnrichError(undefined);
    setBulkStatus(undefined);
    try {
      const matching = await searchLogbook(
        {
          ...filters,
          limit,
          offset: 0,
          q: query,
          sort
        },
        activeProjectionUrl
      );
      const sessionIds = matching.sessions.map((session) => session.sessionId);
      setSelectedSessionIds(sessionIds);
      setBulkTarget({ capped: matching.total > 500, kind: "filtered", sessionIds, total: sessionIds.length });
      setBulkConfirm(undefined);
    } catch (selectionError) {
      setBulkEnrichError(selectionError instanceof Error ? selectionError.message : String(selectionError));
    }
  };

  const enrichBulkTarget = async (depth: LogbookBulkDepth, target: LogbookBulkTarget) => {
    if (bulkEnrichBusy || target.sessionIds.length === 0) return;
    setBulkEnrichBusy(true);
    setBulkEnrichError(undefined);
    setBulkStatus(undefined);
    try {
      const result = await rebuildEnrichments(
        { depth, limit: target.sessionIds.length, scope: "sessionIds", sessionIds: target.sessionIds },
        activeProjectionUrl
      );
      if (result.failed > 0) {
        setBulkEnrichError(`${result.failed} of ${result.requested} enrichments failed.`);
      } else {
        setBulkStatus(`${depth === "summary" ? "Summary" : "Full enrichment"} refreshed for ${result.succeeded} sessions.`);
      }
      if (result.succeeded > 0 || result.failed === 0) setRetryKey((current) => current + 1);
    } catch (enrichmentError) {
      setBulkEnrichError(enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError));
    } finally {
      setBulkEnrichBusy(false);
    }
  };

  const bulkEnrichSummary = async () => {
    await enrichBulkTarget("summary", bulkTarget);
  };

  const bulkEnrichFull = async () => {
    if (bulkEnrichBusy || bulkTarget.sessionIds.length === 0) return;
    if (bulkTarget.total > 50) {
      setBulkEnrichError(undefined);
      setBulkStatus(undefined);
      setBulkConfirm({ depth: "full", target: bulkTarget });
      return;
    }
    await enrichBulkTarget("full", bulkTarget);
  };

  const confirmBulkEnrichFull = async () => {
    if (!bulkConfirm) return;
    const target = bulkConfirm.target;
    setBulkConfirm(undefined);
    await enrichBulkTarget(bulkConfirm.depth, target);
  };

  const cancelBulkEnrichFull = () => setBulkConfirm(undefined);

  const enrichDossier = async () => {
    if (!selectedSessionId || dossierEnrichmentBusy) return;
    dossierEnrichmentAbortRef.current?.abort();
    const controller = new AbortController();
    dossierEnrichmentAbortRef.current = controller;
    setDossierEnrichmentBusy(true);
    setDossierEnrichmentError(undefined);
    try {
      await enrichSessionDossier(selectedSessionId, activeProjectionUrl, { signal: controller.signal });
      await pollDossierEnrichment({
        baseUrl: activeProjectionUrl,
        onDossier: setDossier,
        sessionId: selectedSessionId,
        signal: controller.signal
      });
    } catch (enrichmentError) {
      if (!controller.signal.aborted) {
        setDossierEnrichmentError(enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError));
      }
    } finally {
      if (!controller.signal.aborted) setDossierEnrichmentBusy(false);
    }
  };

  return {
    changeFilters,
    changePage,
    changeQuery,
    changeSort,
    closeSession: () => setSelectedSessionId(undefined),
    detailLoading,
    dossier,
    dossierEnrichmentBusy,
    dossierEnrichmentError,
    dossierError,
    dossierLoading,
    bulkConfirmMessage: bulkConfirm ? `Full enrichment can call the configured remote provider for ${bulkConfirm.target.total} sessions. Type ENRICH to continue.` : undefined,
    bulkEnrichBusy,
    bulkEnrichError,
    bulkEnrichFull,
    bulkEnrichSummary,
    bulkStatus,
    bulkTargetCapped: bulkTarget.capped,
    bulkTargetCount: bulkTarget.total,
    bulkTargetKind: bulkTarget.kind,
    cancelBulkEnrichFull,
    clearBulkSelection,
    confirmBulkEnrichFull,
    enrichDossier,
    excerpts,
    filterOptions,
    filters,
    loadMoreTranscript,
    loadState,
    pageIndex,
    pageSize: LOGBOOK_PAGE_SIZE,
    query,
    refreshError: result ? error : undefined,
    retry: () => setRetryKey((current) => current + 1),
    retryDossier: () => setDossierRetryKey((current) => current + 1),
    retryTranscript: () => setTranscriptRetryKey((current) => current + 1),
    selectSession: setSelectedSessionId,
    selectedSession,
    selectedSessionId,
    selectedSessionIds,
    selectAllMatchingFilter,
    selectCurrentPage,
    toggleBulkSelection,
    sort,
    summary,
    transcript,
    transcriptError,
    transcriptFilter,
    transcriptLoading,
    transcriptQuery,
    setTranscriptFilter,
    setTranscriptQuery
  };
}
