import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogbookFilterState, LogbookLoadState } from "../../ui/HistoryPanel";
import type { AppSurface } from "../../ui/ObservabilitySidebar";
import {
  getLogbookArtifact,
  getSessionTranscript,
  listProjects,
  resolveMastheadPagesSelection,
  searchLogbook,
  type AdapterStatus,
  type LogbookSearchResult,
  type LogbookSort,
  type SessionTranscriptKindFilter
} from "../daemonClient";
import { logbookPageSearchFilters, readCachedLogbookPage, writeCachedLogbookPage, type LogbookPageCacheRequest } from "../logbookPageCache";
import { CANONICAL_SESSION_DOSSIER_SCHEMA, isPublishedSessionDossierV1, toLogbookInspectorArtifact, type LogbookInspectorArtifact } from "./logbookInspectorModel";
import {
  MASTHEAD_PAGES_BATCH_CAP,
  toggleSelectedId,
  type MastheadPagesSelectionScope
} from "./mastheadPagesSelection";
import { useMastheadDataRevisions } from "../useMastheadDataRevisions";

const LOGBOOK_PAGE_SIZE = 50;

export type MastheadPagesBatchReviewHandle = {
  open: boolean;
  artifactIds: string[];
};

type UseLogbookControllerInput = {
  activeProjectionUrl: string;
  activeSurface: AppSurface;
  adapters: AdapterStatus[];
  databaseId?: string;
  externalRefreshKey: number;
  isLive: boolean;
  resolveSelection?: typeof resolveMastheadPagesSelection;
};

export function useLogbookController({
  activeProjectionUrl,
  activeSurface,
  adapters: _adapters,
  databaseId,
  externalRefreshKey,
  isLive,
  resolveSelection = resolveMastheadPagesSelection
}: UseLogbookControllerInput) {
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
  const [transcriptFilter, setTranscriptFilter] = useState<SessionTranscriptKindFilter>("all");
  /** Bound to the Logbook row id so a stale provenance session cannot load after selection changes. */
  const [provenanceTranscriptTarget, setProvenanceTranscriptTarget] = useState<{ artifactId: string; sessionId: string }>();
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [selectionScope, setSelectionScope] = useState<MastheadPagesSelectionScope>("none");
  const [batchReview, setBatchReview] = useState<MastheadPagesBatchReviewHandle | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string>();
  const pageCacheRef = useRef(new Map<string, LogbookSearchResult>());
  const selectionRequestRef = useRef(0);
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
      databaseId,
      filters,
      logbookRevision,
      pageIndex,
      pageSize: LOGBOOK_PAGE_SIZE,
      query,
      retryKey: effectiveRetryKey,
      sort
    }),
    [activeProjectionUrl, databaseId, effectiveRetryKey, filters, logbookRevision, pageIndex, query, sort]
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
        // Keep selectedSessionId even when the open artifact is not on this page.
        // Inspector stays bound until X (closeSession) or an explicit other-artifact select.
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
    setTranscriptFilter("all");
  }, [selectedSessionId]);

  useEffect(() => {
    if (activeSurface !== "logbook" || !selectedSessionId) {
      setSelectedArtifact(undefined);
      setProvenanceTranscriptTarget(undefined);
      setDetailError(undefined);
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    const artifactId = selectedSessionId;
    // Clear previous body immediately so the inspector never shows stale content under a new selection.
    setSelectedArtifact(undefined);
    setProvenanceTranscriptTarget(undefined);
    setDetailError(undefined);
    setDetailLoading(true);
    void getLogbookArtifact(artifactId, activeProjectionUrl, {
      signal: controller.signal
    })
      .then((detail) => {
        if (controller.signal.aborted) return;
        const artifact = toLogbookInspectorArtifact(detail);
        const shouldLoadTranscript =
          artifact.kind === "session_dossier" &&
          artifact.schemaVersion === CANONICAL_SESSION_DOSSIER_SCHEMA &&
          isPublishedSessionDossierV1(artifact.body) &&
          artifact.provenanceSessionIds.length === 1;
        setSelectedArtifact(shouldLoadTranscript ? { ...artifact, provenanceTranscriptLoading: true } : artifact);
        setProvenanceTranscriptTarget(
          shouldLoadTranscript
            ? { artifactId, sessionId: artifact.provenanceSessionIds[0]! }
            : undefined
        );
        setDetailError(undefined);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          console.error("[masthead] Logbook artifact detail failed", loadError);
          setSelectedArtifact(undefined);
          setProvenanceTranscriptTarget(undefined);
          setDetailError("Could not load Page");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, activeSurface, selectedSessionId]);

  useEffect(() => {
    if (
      activeSurface !== "logbook" ||
      !selectedSessionId ||
      !provenanceTranscriptTarget ||
      provenanceTranscriptTarget.artifactId !== selectedSessionId
    ) {
      return;
    }
    const controller = new AbortController();
    const provenanceSessionId = provenanceTranscriptTarget.sessionId;
    setSelectedArtifact((current) =>
      current
        ? {
            ...current,
            provenanceTranscript: undefined,
            provenanceTranscriptError: undefined,
            provenanceTranscriptLoading: true
          }
        : current
    );
    void loadProvenanceTranscript(provenanceSessionId, activeProjectionUrl, controller.signal, transcriptFilter)
      .then((provenanceTranscript) => {
        if (controller.signal.aborted) return;
        setSelectedArtifact((current) =>
          current
            ? {
                ...current,
                provenanceTranscript,
                provenanceTranscriptError: undefined,
                provenanceTranscriptLoading: false
              }
            : current
        );
      })
      .catch((transcriptError: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[masthead] Logbook provenance transcript failed", transcriptError);
        setSelectedArtifact((current) =>
          current
            ? {
                ...current,
                provenanceTranscript: undefined,
                provenanceTranscriptError: "Could not load transcript evidence",
                provenanceTranscriptLoading: false
              }
            : current
        );
      });
    return () => controller.abort();
  }, [activeProjectionUrl, activeSurface, provenanceTranscriptTarget, selectedSessionId, transcriptFilter]);

  const changeQuery = (nextQuery: string) => {
    selectionRequestRef.current += 1;
    setSelectionBusy(false);
    setQuery(nextQuery);
    setSelectionScope((current) => current === "filtered" ? "manual" : current);
    setSelectionError(undefined);
    setPageIndex(0);
    setResult(undefined);
    setError(undefined);
    setSelectedSessionId(undefined);
  };

  const changeFilters = (nextFilters: LogbookFilterState) => {
    selectionRequestRef.current += 1;
    setSelectionBusy(false);
    setFilters(nextFilters);
    setSelectionScope((current) => current === "filtered" ? "manual" : current);
    setSelectionError(undefined);
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
    // Page-only navigation must not clear selection; keep the open dossier/inspector
    // even when the selected artifact is not on the new page.
  };

  const changeSort = (nextSort: LogbookSort) => {
    selectionRequestRef.current += 1;
    setSelectionBusy(false);
    setSort(nextSort);
    setSelectionScope((current) => current === "filtered" ? "manual" : current);
    setSelectionError(undefined);
    setPageIndex(0);
    setResult(undefined);
    setSelectedSessionId(undefined);
  };

  const setArtifactSelected = useCallback((artifactId: string, selected: boolean) => {
    selectionRequestRef.current += 1;
    setSelectionBusy(false);
    const nextIds = toggleSelectedId(selectedArtifactIds, artifactId, selected, MASTHEAD_PAGES_BATCH_CAP);
    setSelectedArtifactIds(nextIds);
    setSelectionScope(nextIds.length > 0 ? "manual" : "none");
    setSelectionError(undefined);
  }, [selectedArtifactIds]);

  const selectAllFilteredPages = useCallback(async (selected: boolean) => {
    const requestId = ++selectionRequestRef.current;
    setSelectionError(undefined);
    setBatchReview(null);
    if (!selected) {
      setSelectionBusy(false);
      setSelectedArtifactIds([]);
      setSelectionScope("none");
      return;
    }

    const kindFilters = Array.isArray(filters.kind)
      ? filters.kind
      : typeof filters.kind === "string"
        ? [filters.kind]
        : [];
    if (kindFilters.length > 0 && !kindFilters.includes("session_dossier")) {
      setSelectedArtifactIds([]);
      setSelectionScope("none");
      return;
    }

    setSelectionBusy(true);
    try {
      const projectFilter = Array.isArray(filters.project)
        ? filters.project[0]
        : typeof filters.project === "string"
          ? filters.project
          : undefined;
      const resolved = await resolveSelection(
        {
          q: query || undefined,
          project: projectFilter,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          limit: MASTHEAD_PAGES_BATCH_CAP
        },
        activeProjectionUrl
      );
      if (selectionRequestRef.current !== requestId) return;
      if (resolved.status === "incomplete") {
        setSelectedArtifactIds([]);
        setSelectionScope("none");
        setSelectionError(
          resolved.reason === "eligibility_backfill_incomplete"
            ? "Filtered Pages are still being indexed. Try again in a moment."
            : resolved.retryable
              ? "Could not select filtered Pages. Try again."
              : "One or more filtered Pages must be repaired before they can be selected."
        );
        return;
      }
      const ids = resolved.artifactIds.slice(0, MASTHEAD_PAGES_BATCH_CAP);
      setSelectedArtifactIds(ids);
      setSelectionScope(ids.length > 0 ? "filtered" : "none");
    } catch {
      if (selectionRequestRef.current !== requestId) return;
      setSelectedArtifactIds([]);
      setSelectionScope("none");
      setSelectionError("Could not select filtered Pages. Try again.");
    } finally {
      if (selectionRequestRef.current === requestId) setSelectionBusy(false);
    }
  }, [activeProjectionUrl, filters.dateFrom, filters.dateTo, filters.kind, filters.project, query, resolveSelection]);

  const openBatchReview = useCallback(() => {
    if (selectedArtifactIds.length === 0) return;
    setBatchReview({ open: true, artifactIds: [...selectedArtifactIds] });
  }, [selectedArtifactIds]);

  const closeBatchReview = useCallback(() => {
    setBatchReview(null);
  }, []);

  useEffect(() => {
    selectionRequestRef.current += 1;
    setSelectionBusy(false);
    setSelectedArtifactIds([]);
    setSelectionScope("none");
    setSelectionError(undefined);
    setBatchReview(null);
  }, [activeProjectionUrl]);

  useEffect(() => {
    if (activeSurface === "logbook") return;
    selectionRequestRef.current += 1;
    setSelectedArtifactIds([]);
    setSelectionScope("none");
    setSelectionError(undefined);
    setSelectionBusy(false);
    setBatchReview(null);
  }, [activeSurface]);

  return {
    batchReview,
    changeFilters,
    changePage,
    changeQuery,
    changeSort,
    changeTranscriptFilter: setTranscriptFilter,
    closeBatchReview,
    closeSession: () => setSelectedSessionId(undefined),
    detailError,
    detailLoading,
    filterOptions,
    filters,
    loadState,
    openBatchReview,
    allFilteredSelected: selectionScope === "filtered" && selectedArtifactIds.length > 0,
    pageIndex,
    pageSize: LOGBOOK_PAGE_SIZE,
    query,
    refreshError: result ? error : undefined,
    retry: () => setRetryKey((current) => current + 1),
    selectSession: setSelectedSessionId,
    selectedArtifact,
    selectedArtifactIds,
    selectedSessionId,
    selectionBusy,
    selectionError,
    selectionScope,
    selectAllFilteredPages,
    setArtifactSelected,
    sort,
    transcriptFilter
  };
}

async function loadProvenanceTranscript(
  sessionId: string,
  baseUrl: string,
  signal: AbortSignal,
  kind: SessionTranscriptKindFilter = "all"
) {
  let cursor: string | undefined;
  let result: Awaited<ReturnType<typeof getSessionTranscript>> | undefined;
  const items: Awaited<ReturnType<typeof getSessionTranscript>>["items"] = [];
  const seenCursors = new Set<string>();

  do {
    const page = await getSessionTranscript(sessionId, { cursor, kind, limit: 200 }, baseUrl, { signal });
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
