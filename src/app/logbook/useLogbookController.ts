import { useEffect, useMemo, useRef, useState } from "react";
import type { LogbookFilterState, LogbookLoadState } from "../../ui/HistoryPanel";
import type { AppSurface } from "../../ui/ObservabilitySidebar";
import type { SessionDossierDto } from "../../shared/sessionDossier";
import {
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
import {
  logbookPageSearchFilters,
  readCachedLogbookPage,
  writeCachedLogbookPage,
  type LogbookPageCacheRequest
} from "../logbookPageCache";

const LOGBOOK_PAGE_SIZE = 50;

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
  const [selectedSession, setSelectedSession] = useState<LogbookSessionDetail>();
  const [excerpts, setExcerpts] = useState<LogbookExcerpt[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dossierRetryKey, setDossierRetryKey] = useState(0);
  const [dossier, setDossier] = useState<SessionDossierDto>();
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<string>();
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

  return {
    changeFilters,
    changePage,
    changeQuery,
    changeSort,
    closeSession: () => setSelectedSessionId(undefined),
    detailLoading,
    dossier,
    dossierError,
    dossierLoading,
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
