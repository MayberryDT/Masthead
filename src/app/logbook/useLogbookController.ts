import { useEffect, useMemo, useRef, useState } from "react";
import type { LogbookFilterState, LogbookLoadState } from "../../ui/HistoryPanel";
import type { AppSurface } from "../../ui/ObservabilitySidebar";
import { getLogbookArtifact, getSessionTranscript, listProjects, searchLogbook, type AdapterStatus, type LogbookSearchResult, type LogbookSort } from "../daemonClient";
import { logbookPageSearchFilters, readCachedLogbookPage, writeCachedLogbookPage, type LogbookPageCacheRequest } from "../logbookPageCache";
import { CANONICAL_SESSION_DOSSIER_SCHEMA, isPublishedSessionDossierV1, toLogbookInspectorArtifact, type LogbookInspectorArtifact } from "./logbookInspectorModel";
import { useMastheadDataRevisions } from "../useMastheadDataRevisions";

const LOGBOOK_PAGE_SIZE = 50;

type UseLogbookControllerInput = {
  activeProjectionUrl: string;
  activeSurface: AppSurface;
  adapters: AdapterStatus[];
  externalRefreshKey: number;
  isLive: boolean;
};

export function useLogbookController({ activeProjectionUrl, activeSurface, adapters: _adapters, externalRefreshKey, isLive }: UseLogbookControllerInput) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LogbookSearchResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [retryKey, setRetryKey] = useState(0);
  const [sort, setSort] = useState<LogbookSort>("recent");
  const [pageIndex, setPageIndex] = useState(0);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [filters, setFilters] = useState<LogbookFilterState>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [selectedArtifact, setSelectedArtifact] = useState<LogbookInspectorArtifact>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const pageCacheRef = useRef(new Map<string, LogbookSearchResult>());
  const effectiveRetryKey = retryKey + externalRefreshKey;
  const { logbook: logbookRevision } = useMastheadDataRevisions({
    active: activeSurface === "logbook",
    activeProjectionUrl,
    isLive
  });

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
      projects: projectOptions
    }),
    [projectOptions]
  );

  const pageRequest = useMemo<LogbookPageCacheRequest>(
    () => ({
      baseUrl: activeProjectionUrl,
      filters,
      logbookRevision,
      pageIndex,
      pageSize: LOGBOOK_PAGE_SIZE,
      query,
      retryKey: effectiveRetryKey,
      sort
    }),
    [activeProjectionUrl, effectiveRetryKey, filters, logbookRevision, pageIndex, query, sort]
  );

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
        setSelectedSessionId((current) =>
          current && !nextResult.sessions.some((session) => session.sessionId === current) ? undefined : current
        );
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
    void listProjects(activeProjectionUrl, { signal: controller.signal })
      .then((projects) => {
        if (controller.signal.aborted) return;
        setProjectOptions(projects.map((project) => project.project));
      })
      .catch((metadataError: unknown) => {
        if (!controller.signal.aborted) console.error("[masthead] Logbook metadata failed", metadataError);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, activeSurface, effectiveRetryKey]);

  useEffect(() => {
    if (activeSurface !== "logbook" || !selectedSessionId) {
      setSelectedArtifact(undefined);
      setDetailError(undefined);
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    // Clear previous body immediately so the inspector never shows stale content under a new selection.
    setSelectedArtifact(undefined);
    setDetailError(undefined);
    setDetailLoading(true);
    void getLogbookArtifact(selectedSessionId, activeProjectionUrl, {
      signal: controller.signal
    })
      .then(async (detail) => {
        if (controller.signal.aborted) return;
        const artifact = toLogbookInspectorArtifact(detail);
        const shouldLoadTranscript =
          artifact.kind === "session_dossier" &&
          artifact.schemaVersion === CANONICAL_SESSION_DOSSIER_SCHEMA &&
          isPublishedSessionDossierV1(artifact.body) &&
          artifact.provenanceSessionIds.length === 1;
        setSelectedArtifact(shouldLoadTranscript ? { ...artifact, provenanceTranscriptLoading: true } : artifact);
        setDetailError(undefined);
        if (!shouldLoadTranscript) {
          return;
        }

        try {
          const provenanceTranscript = await loadProvenanceTranscript(artifact.provenanceSessionIds[0], activeProjectionUrl, controller.signal);
          if (controller.signal.aborted) return;
          setSelectedArtifact({ ...artifact, provenanceTranscript, provenanceTranscriptLoading: false });
        } catch (transcriptError: unknown) {
          if (controller.signal.aborted) return;
          console.error("[masthead] Logbook provenance transcript failed", transcriptError);
          setSelectedArtifact({
            ...artifact,
            provenanceTranscriptLoading: false,
            provenanceTranscriptError: "Could not load transcript evidence"
          });
        }
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          console.error("[masthead] Logbook artifact detail failed", loadError);
          setSelectedArtifact(undefined);
          setDetailError("Could not load artifact");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, activeSurface, selectedSessionId]);

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

  return {
    changeFilters,
    changePage,
    changeQuery,
    changeSort,
    closeSession: () => setSelectedSessionId(undefined),
    detailError,
    detailLoading,
    filterOptions,
    filters,
    loadState,
    pageIndex,
    pageSize: LOGBOOK_PAGE_SIZE,
    query,
    refreshError: result ? error : undefined,
    retry: () => setRetryKey((current) => current + 1),
    selectSession: setSelectedSessionId,
    selectedArtifact,
    selectedSessionId,
    sort
  };
}

async function loadProvenanceTranscript(sessionId: string, baseUrl: string, signal: AbortSignal) {
  let cursor: string | undefined;
  let result: Awaited<ReturnType<typeof getSessionTranscript>> | undefined;
  const items: Awaited<ReturnType<typeof getSessionTranscript>>["items"] = [];
  const seenCursors = new Set<string>();

  do {
    const page = await getSessionTranscript(sessionId, { cursor, limit: 200 }, baseUrl, { signal });
    if (!result) result = page;
    items.push(...page.items);
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      cursor = undefined;
    } else {
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  } while (cursor && !signal.aborted);

  if (!result) throw new Error("Transcript pagination returned no result");
  return { ...result, items, nextCursor: undefined };
}
