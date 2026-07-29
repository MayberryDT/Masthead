import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createGuidedAuthoringRequest,
  getIncompleteWorkbenchAuthoringRequest,
  getWorkbenchAuthoringCapabilities,
  getWorkbenchActivity,
  getWorkbenchNotAddedSessions,
  getWorkbenchNotAddedSummary,
  getWorkbenchQualityReviewSessions,
  getWorkbenchQualityReviewSummary,
  getWorkbenchSessions,
  postWorkbenchCheckTranscript,
  postWorkbenchClaim,
  postWorkbenchEnrollMissing,
  postWorkbenchImportTranscript,
  postWorkbenchQuality,
  postWorkbenchReleaseClaim
} from "../daemonClient";
import type {
  WorkbenchActivityDto,
  WorkbenchNotAddedSessionDto,
  WorkbenchNotAddedSummaryDto,
  WorkbenchQualityReviewSessionDto,
  WorkbenchQualityReviewSummaryDto,
  WorkbenchQueueSessionDto,
  WorkbenchSessionsResponse
} from "../../shared/workbench";
import type {
  WorkbenchAuthoringV5CapabilitiesDto,
  WorkbenchAuthoringV5IncompleteRequestSummaryDto
} from "../../shared/workbenchAuthoringV5";
import { guidedAuthoringIdentityFromCapabilities } from "../../shared/guidedAuthoring";
import { buildWorkbenchHandoff } from "../../ui/workbench/workbenchHandoff";
import { formatSelectAllSummary } from "../../ui/workbench/workbenchSelectionHonesty";
import { useMastheadDataRevisions } from "../useMastheadDataRevisions";

const TRANSCRIPT_PERMISSION_ERROR =
  "Transcript import needs source permission for this session's source. Grant it under Sources, then retry Import.";

/** Page size for the package-path table. Large libraries paginate; never load thousands at once. */
export const WORKBENCH_PAGE_SIZE = 100;

type UseWorkbenchControllerOptions = {
  activeProjectionUrl: string;
  active: boolean;
  refreshKey: number;
  isLive: boolean;
  onLibraryChanged?: () => void;
};

export type WorkbenchActionKind =
  | "enroll_missing"
  | "check_transcript"
  | "import_transcript"
  | "quality_pass"
  | "quality_fail"
  | "quality_precheck"
  | "claim"
  | "release"
  | "copy_agent_prompt";

export type UseWorkbenchControllerResult = {
  actionBusy: boolean;
  actionError?: string;
  activity: WorkbenchActivityDto[];
  agentPromptExcludedCount: number;
  agentPromptSessionCount: number;
  /** Most recent incomplete (open/active) V5 authoring campaign, if any. */
  campaignRequest: WorkbenchAuthoringV5IncompleteRequestSummaryDto | null;
  canRun: (kind: WorkbenchActionKind) => boolean;
  clearActionFeedback: () => void;
  clearSelection: () => void;
  copyAgentPrompt: () => Promise<string>;
  error?: string;
  lastActionSummary?: string;
  loadNotAdded: () => void;
  loadQualityReview: () => void;
  loading: boolean;
  notAddedOpen: boolean;
  notAddedSessions: WorkbenchNotAddedSessionDto[];
  notAddedSummary?: WorkbenchNotAddedSummaryDto;
  page: number;
  pageSize: number;
  qualityReviewOpen: boolean;
  qualityReviewSessions: WorkbenchQualityReviewSessionDto[];
  qualityReviewSummary?: WorkbenchQualityReviewSummaryDto;
  /** Selected package-path sessions that still need a quality disposition (review / unchecked). */
  qualityReviewSelectedCount: number;
  retry: () => void;
  runAction: (kind: WorkbenchActionKind) => Promise<void>;
  selectAll: () => Promise<void>;
  selectPage: () => void;
  /** Select every session currently loaded in the Quality review panel list. */
  selectQualityReviewVisible: () => void;
  selectedSessionIds: Set<string>;
  sessions: WorkbenchQueueSessionDto[];
  setNotAddedOpen: (open: boolean) => void;
  setQualityReviewOpen: (open: boolean) => void;
  setPage: (page: number) => void;
  total: number;
  toggleSession: (sessionId: string) => void;
};

export function useWorkbenchController({
  activeProjectionUrl,
  active,
  refreshKey,
  isLive,
  onLibraryChanged
}: UseWorkbenchControllerOptions): UseWorkbenchControllerResult {
  const [sessions, setSessions] = useState<WorkbenchQueueSessionDto[]>([]);
  const [activity, setActivity] = useState<WorkbenchActivityDto[]>([]);
  const [notAddedSummary, setNotAddedSummary] = useState<WorkbenchNotAddedSummaryDto>();
  const [notAddedSessions, setNotAddedSessions] = useState<WorkbenchNotAddedSessionDto[]>([]);
  const [qualityReviewSummary, setQualityReviewSummary] = useState<WorkbenchQualityReviewSummaryDto>();
  const [qualityReviewSessions, setQualityReviewSessions] = useState<WorkbenchQualityReviewSessionDto[]>([]);
  const [authoringCapabilities, setAuthoringCapabilities] = useState<WorkbenchAuthoringV5CapabilitiesDto>();
  const [campaignRequest, setCampaignRequest] = useState<WorkbenchAuthoringV5IncompleteRequestSummaryDto | null>(null);
  const [notAddedOpen, setNotAddedOpenState] = useState(false);
  const [qualityReviewOpen, setQualityReviewOpenState] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState(() => new Set<string>());
  const [selectedCompileReadySessionIds, setSelectedCompileReadySessionIds] = useState(() => new Set<string>());
  const [selectedQualityReviewSessionIds, setSelectedQualityReviewSessionIds] = useState(() => new Set<string>());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [lastActionSummary, setLastActionSummary] = useState<string>();
  const [page, setPageState] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = WORKBENCH_PAGE_SIZE;
  const loadRequestId = useRef(0);
  const campaignLoadRequestId = useRef(0);
  const copyRequestInFlightRef = useRef<Promise<string> | null>(null);
  const copyCreationRef = useRef<{ fingerprint: string; token: string } | undefined>(undefined);
  const selectedSessionIdsRef = useRef(selectedSessionIds);
  selectedSessionIdsRef.current = selectedSessionIds;
  const { workbench: workbenchRevision } = useMastheadDataRevisions({
    active,
    activeProjectionUrl,
    isLive
  });

  const loadCampaignRequest = useCallback(async (options: { signal?: AbortSignal } = {}) => {
    const requestId = ++campaignLoadRequestId.current;
    try {
      const response = await getIncompleteWorkbenchAuthoringRequest(activeProjectionUrl, {
        signal: options.signal
      });
      if (options.signal?.aborted || requestId !== campaignLoadRequestId.current) return;
      setCampaignRequest(response.request ?? null);
    } catch {
      // Campaign summary is status-strip only; keep any previous value and never block queue rendering.
    }
  }, [activeProjectionUrl]);

  const load = useCallback(async (options: { signal?: AbortSignal; page?: number } = {}) => {
    const requestId = ++loadRequestId.current;
    const pageIndex = options.page ?? page;
    setLoading(true);
    setError(undefined);
    setAuthoringCapabilities(undefined);
    try {
      const capabilitiesPromise = getWorkbenchAuthoringCapabilities(activeProjectionUrl, {
        signal: options.signal
      }).catch(() => undefined);
      // Campaign status strip: fail-soft so queue still renders if summary is unavailable.
      void loadCampaignRequest({ signal: options.signal });
      const [response, activityResponse, notAdded, qualityReview, capabilities] = await Promise.all([
        getWorkbenchSessions(activeProjectionUrl, {
          limit: pageSize,
          offset: pageIndex * pageSize,
          signal: options.signal
        }),
        getWorkbenchActivity(activeProjectionUrl, { limit: 30, signal: options.signal }),
        getWorkbenchNotAddedSummary(activeProjectionUrl, { signal: options.signal }),
        getWorkbenchQualityReviewSummary(activeProjectionUrl, { signal: options.signal }),
        capabilitiesPromise
      ]);
      if (options.signal?.aborted || requestId !== loadRequestId.current) return;
      const selectedAtLoad = new Set(selectedSessionIdsRef.current);
      const selection = await resolveCurrentSelection(
        activeProjectionUrl,
        selectedAtLoad,
        response,
        options.signal
      );
      if (options.signal?.aborted || requestId !== loadRequestId.current) return;
      setSessions(response.sessions);
      setTotal(typeof response.total === "number" ? response.total : response.sessions.length);
      setActivity(activityResponse.activity);
      setNotAddedSummary(notAdded);
      setQualityReviewSummary(qualityReview);
      setAuthoringCapabilities(capabilities);
      setSelectedSessionIds(selection.present);
      setSelectedCompileReadySessionIds(selection.compileReady);
      setSelectedQualityReviewSessionIds(selection.qualityReview);
    } catch (loadError) {
      if (!options.signal?.aborted && requestId === loadRequestId.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (!options.signal?.aborted && requestId === loadRequestId.current) setLoading(false);
    }
  }, [activeProjectionUrl, loadCampaignRequest, page, pageSize]);

  const setPage = useCallback(
    (nextPage: number) => {
      const safe = Math.max(0, Math.trunc(nextPage));
      setPageState(safe);
      void load({ page: safe });
    },
    [load]
  );

  const clearActionFeedback = useCallback(() => {
    setActionError(undefined);
    setLastActionSummary(undefined);
  }, []);

  const loadNotAdded = useCallback(async () => {
    try {
      const response = await getWorkbenchNotAddedSessions(activeProjectionUrl, { limit: 50 });
      setNotAddedSessions(response.sessions);
    } catch (loadError) {
      setActionError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [activeProjectionUrl]);

  const loadQualityReview = useCallback(async () => {
    try {
      const response = await getWorkbenchQualityReviewSessions(activeProjectionUrl, { limit: 50 });
      setQualityReviewSessions(response.sessions);
    } catch (loadError) {
      setActionError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [activeProjectionUrl]);

  const setNotAddedOpen = useCallback(
    (open: boolean) => {
      setNotAddedOpenState(open);
      if (open) void loadNotAdded();
    },
    [loadNotAdded]
  );

  const setQualityReviewOpen = useCallback(
    (open: boolean) => {
      setQualityReviewOpenState(open);
      if (open) void loadQualityReview();
    },
    [loadQualityReview]
  );

  useEffect(() => {
    if (!active || !isLive) {
      loadRequestId.current += 1;
      campaignLoadRequestId.current += 1;
      setAuthoringCapabilities(undefined);
      setCampaignRequest(null);
      return;
    }
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [active, isLive, load, refreshKey, workbenchRevision]);

  // Immediate selection for UI enablement / counts (must feel instant on checkbox click).
  const selectedSessions = useMemo(
    () => sessions.filter((session) => selectedSessionIds.has(session.sessionId)),
    [selectedSessionIds, sessions]
  );

  const agentPromptSessionIds = useMemo(
    () => Array.from(selectedSessionIds).filter((sessionId) => selectedCompileReadySessionIds.has(sessionId)),
    [selectedCompileReadySessionIds, selectedSessionIds]
  );
  const agentPromptSessionCount = agentPromptSessionIds.length;
  const agentPromptExcludedCount = selectedSessionIds.size - agentPromptSessionCount;
  const qualityReviewSelectedIds = useMemo(
    () => Array.from(selectedSessionIds).filter((sessionId) => selectedQualityReviewSessionIds.has(sessionId)),
    [selectedQualityReviewSessionIds, selectedSessionIds]
  );
  const qualityReviewSelectedCount = qualityReviewSelectedIds.length;
  const copyAgentPrompt = useCallback((): Promise<string> => {
    if (copyRequestInFlightRef.current) return copyRequestInFlightRef.current;
    if (!isLive || actionBusy || !authoringCapabilities || agentPromptSessionIds.length === 0) {
      return Promise.reject(new Error("Guided authoring is unavailable for this selection"));
    }

    const capabilities = authoringCapabilities;
    const sessionIds = [...agentPromptSessionIds];
    const creationFingerprint = JSON.stringify({
      databaseId: capabilities.databaseId,
      buildSha: capabilities.buildSha,
      instanceId: capabilities.instanceId,
      sessionIds
    });
    if (copyCreationRef.current?.fingerprint !== creationFingerprint) {
      copyCreationRef.current = { fingerprint: creationFingerprint, token: globalThis.crypto.randomUUID() };
    }
    const creationToken = copyCreationRef.current.token;
    const operation = (async () => {
      setActionBusy(true);
      setActionError(undefined);
      try {
        const request = await createGuidedAuthoringRequest(activeProjectionUrl, {
          buildSha: capabilities.buildSha,
          databaseId: capabilities.databaseId,
          expectedIdentity: guidedAuthoringIdentityFromCapabilities(capabilities),
          creationToken,
          sessionIds
        });
        if (copyCreationRef.current?.token === creationToken) copyCreationRef.current = undefined;
        // New campaign should appear on the status strip without waiting for the next queue poll.
        void loadCampaignRequest();
        return buildWorkbenchHandoff({ capabilities, request });
      } catch (copyError) {
        setActionError(formatActionError(copyError));
        throw copyError;
      } finally {
        setActionBusy(false);
      }
    })();
    copyRequestInFlightRef.current = operation;
    void operation.finally(() => {
      if (copyRequestInFlightRef.current === operation) copyRequestInFlightRef.current = null;
    }).catch(() => undefined);
    return operation;
  }, [actionBusy, activeProjectionUrl, agentPromptSessionIds, authoringCapabilities, isLive, loadCampaignRequest]);

  const canRun = useCallback(
    (kind: WorkbenchActionKind): boolean => {
      if (!isLive || actionBusy) return false;
      if (kind === "enroll_missing") return true;
      if (kind === "copy_agent_prompt") {
        return Boolean(authoringCapabilities) && agentPromptSessionCount > 0;
      }
      // Quality disposition tracks review IDs across pages / Quality review panel (not only current page).
      if (kind === "quality_pass" || kind === "quality_fail" || kind === "quality_precheck") {
        return qualityReviewSelectedCount > 0;
      }
      if (selectedSessions.length === 0) return false;

      switch (kind) {
        case "check_transcript":
          return selectedSessions.some(
            (session) =>
              session.nextAction === "check_transcript" ||
              session.transcriptStatus === "unchecked" ||
              session.transcriptStatus === "missing" ||
              session.transcriptStatus === "available"
          );
        case "import_transcript":
          return selectedSessions.some(
            (session) =>
              session.nextAction === "import_transcript" ||
              session.transcriptStatus === "missing" ||
              session.transcriptStatus === "permission_needed" ||
              session.transcriptStatus === "available"
          );
        case "claim":
          return selectedSessions.some((session) => !session.activeClaim);
        case "release":
          return selectedSessions.some((session) => Boolean(session.activeClaim));
        default:
          return false;
      }
    },
    [
      actionBusy,
      agentPromptSessionCount,
      authoringCapabilities,
      isLive,
      qualityReviewSelectedCount,
      selectedSessions
    ]
  );

  const runAction = useCallback(
    async (kind: WorkbenchActionKind) => {
      if (!canRun(kind)) return;

      if (kind === "copy_agent_prompt") {
        setActionError(undefined);
        const copiedLabel = `Agent prompt copied for ${agentPromptSessionCount} ready session${
          agentPromptSessionCount === 1 ? "" : "s"
        }`;
        setLastActionSummary(
          agentPromptExcludedCount === 0
            ? copiedLabel
            : `${copiedLabel}; ${agentPromptExcludedCount} selected session${
              agentPromptExcludedCount === 1 ? " needs" : "s need"
            } review and ${agentPromptExcludedCount === 1 ? "was" : "were"} left out`
        );
        return;
      }

      setActionBusy(true);
      setActionError(undefined);
      try {
        if (kind === "enroll_missing") {
          const result = await postWorkbenchEnrollMissing(activeProjectionUrl, { limit: 500 });
          setLastActionSummary(
            result.enrolled === 0
              ? "No missing sessions to enroll"
              : `Enrolled ${result.enrolled} session${result.enrolled === 1 ? "" : "s"}`
          );
          await load();
          onLibraryChanged?.();
          return;
        }

        const ids = Array.from(selectedSessionIds);
        let acted = 0;

        if (kind === "check_transcript") {
          for (const sessionId of ids) {
            await postWorkbenchCheckTranscript(activeProjectionUrl, sessionId);
            acted += 1;
          }
          setLastActionSummary(`Checked transcript for ${acted} session${acted === 1 ? "" : "s"}`);
        } else if (kind === "import_transcript") {
          for (const sessionId of ids) {
            await postWorkbenchImportTranscript(activeProjectionUrl, sessionId);
            acted += 1;
          }
          setLastActionSummary(`Imported transcript for ${acted} session${acted === 1 ? "" : "s"}`);
        } else if (kind === "quality_pass" || kind === "quality_fail" || kind === "quality_precheck") {
          // Bulk quality disposition: only review/unchecked rows. Passed/ready sessions stay untouched.
          const reviewIds = qualityReviewSelectedIds;
          const skipped = Math.max(0, selectedSessionIds.size - reviewIds.length);
          if (reviewIds.length === 0) {
            setLastActionSummary("No selected sessions need quality review");
            return;
          }

          if (kind === "quality_pass") {
            for (const sessionId of reviewIds) {
              await postWorkbenchQuality(activeProjectionUrl, sessionId, { status: "passed" });
              acted += 1;
            }
            setLastActionSummary(formatBulkQualitySummary("accept", acted, skipped));
          } else if (kind === "quality_fail") {
            for (const sessionId of reviewIds) {
              await postWorkbenchQuality(activeProjectionUrl, sessionId, {
                status: "failed",
                reason: "operator_rejected"
              });
              acted += 1;
            }
            setLastActionSummary(formatBulkQualitySummary("fail", acted, skipped));
          } else {
            for (const sessionId of reviewIds) {
              await postWorkbenchQuality(activeProjectionUrl, sessionId, { mode: "precheck" });
              acted += 1;
            }
            setLastActionSummary(
              skipped === 0
                ? `Prechecked quality for ${acted} review session${acted === 1 ? "" : "s"}`
                : `Prechecked quality for ${acted} review session${acted === 1 ? "" : "s"}; ${skipped} ready/passed left unchanged`
            );
          }
        } else if (kind === "claim") {
          for (const sessionId of ids) {
            await postWorkbenchClaim(activeProjectionUrl, sessionId, {
              claimedBy: "workbench_ui",
              ttlSeconds: 900
            });
            acted += 1;
          }
          setLastActionSummary(`Claimed ${acted} session${acted === 1 ? "" : "s"}`);
        } else if (kind === "release") {
          const claimIds = sessions
            .filter((session) => selectedSessionIds.has(session.sessionId) && session.activeClaim?.claimId)
            .map((session) => session.activeClaim!.claimId);
          for (const claimId of claimIds) {
            await postWorkbenchReleaseClaim(activeProjectionUrl, claimId, { reason: "operator_release" });
            acted += 1;
          }
          setLastActionSummary(`Released ${acted} claim${acted === 1 ? "" : "s"}`);
        }

        await load();
        if (
          qualityReviewOpen &&
          (kind === "quality_pass" || kind === "quality_fail" || kind === "quality_precheck")
        ) {
          await loadQualityReview();
        }
        onLibraryChanged?.();
      } catch (runError) {
        setActionError(formatActionError(runError));
      } finally {
        setActionBusy(false);
      }
    },
    [
      activeProjectionUrl,
      agentPromptExcludedCount,
      agentPromptSessionCount,
      canRun,
      load,
      loadQualityReview,
      onLibraryChanged,
      qualityReviewOpen,
      qualityReviewSelectedIds,
      selectedSessionIds,
      sessions
    ]
  );

  const retry = useCallback(() => {
    if (!active || !isLive) return;
    void load();
  }, [active, isLive, load]);

  const toggleSession = useCallback((sessionId: string) => {
    const selecting = !selectedSessionIds.has(sessionId);
    const target = sessions.find((session) => session.sessionId === sessionId);
    // Quality review panel rows are always review holds; they may not be on the current queue page.
    const inQualityReviewPanel = qualityReviewSessions.some((session) => session.sessionId === sessionId);
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (selecting) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
    setSelectedCompileReadySessionIds((compileReady) => {
      const next = new Set(compileReady);
      if (selecting && target && isCompileReadySession(target)) {
        next.add(sessionId);
      } else if (!selecting) {
        next.delete(sessionId);
      }
      return next;
    });
    setSelectedQualityReviewSessionIds((qualityReview) => {
      const next = new Set(qualityReview);
      if (selecting && ((target && isQualityReviewSession(target)) || inQualityReviewPanel)) {
        next.add(sessionId);
      } else if (!selecting) {
        next.delete(sessionId);
      }
      return next;
    });
  }, [qualityReviewSessions, selectedSessionIds, sessions]);

  const selectPage = useCallback(() => {
    setSelectedSessionIds((current) => new Set([...current, ...sessions.map((session) => session.sessionId)]));
    setSelectedCompileReadySessionIds((current) => new Set([
      ...current,
      ...sessions.filter(isCompileReadySession).map((session) => session.sessionId)
    ]));
    setSelectedQualityReviewSessionIds((current) => new Set([
      ...current,
      ...sessions.filter(isQualityReviewSession).map((session) => session.sessionId)
    ]));
  }, [sessions]);

  const selectQualityReviewVisible = useCallback(() => {
    const ids = qualityReviewSessions.map((session) => session.sessionId);
    if (ids.length === 0) return;
    setSelectedSessionIds((current) => new Set([...current, ...ids]));
    setSelectedQualityReviewSessionIds((current) => new Set([...current, ...ids]));
  }, [qualityReviewSessions]);

  const selectAll = useCallback(async () => {
    if (!isLive || actionBusy) return;
    setActionBusy(true);
    setActionError(undefined);
    try {
      const ids = new Set<string>();
      const compileReadyIds = new Set<string>();
      const qualityReviewIds = new Set<string>();
      let offset = 0;
      let queueTotal = Number.POSITIVE_INFINITY;
      const limit = 500;
      while (offset < queueTotal) {
        const response = await getWorkbenchSessions(activeProjectionUrl, { limit, offset });
        queueTotal = typeof response.total === "number" ? response.total : response.sessions.length;
        for (const session of response.sessions) {
          ids.add(session.sessionId);
          if (isCompileReadySession(session)) compileReadyIds.add(session.sessionId);
          if (isQualityReviewSession(session)) qualityReviewIds.add(session.sessionId);
        }
        if (response.sessions.length === 0) break;
        offset += response.sessions.length;
        if (ids.size >= queueTotal) break;
      }
      setSelectedSessionIds(ids);
      setSelectedCompileReadySessionIds(compileReadyIds);
      setSelectedQualityReviewSessionIds(qualityReviewIds);
      setLastActionSummary(formatSelectAllSummary(ids.size));
    } catch (selectError) {
      setActionError(formatActionError(selectError));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, activeProjectionUrl, isLive]);

  const clearSelection = useCallback(() => {
    setSelectedSessionIds(new Set());
    setSelectedCompileReadySessionIds(new Set());
    setSelectedQualityReviewSessionIds(new Set());
  }, []);

  return {
    actionBusy,
    actionError,
    activity,
    agentPromptExcludedCount,
    agentPromptSessionCount,
    campaignRequest,
    canRun,
    clearActionFeedback,
    clearSelection,
    copyAgentPrompt,
    error,
    lastActionSummary,
    loadNotAdded: () => {
      void loadNotAdded();
    },
    loadQualityReview: () => {
      void loadQualityReview();
    },
    loading,
    notAddedOpen,
    notAddedSessions,
    notAddedSummary,
    page,
    pageSize,
    qualityReviewOpen,
    qualityReviewSessions,
    qualityReviewSummary,
    qualityReviewSelectedCount,
    retry,
    runAction,
    selectAll,
    selectPage,
    selectQualityReviewVisible,
    selectedSessionIds,
    sessions,
    setNotAddedOpen,
    setQualityReviewOpen,
    setPage,
    total,
    toggleSession
  };
}

function isCompileReadySession(session: WorkbenchQueueSessionDto): boolean {
  return session.compileReady;
}

/** Sessions still awaiting operator/automatic quality disposition on the package path. */
export function isQualityReviewSession(session: Pick<WorkbenchQueueSessionDto, "nextAction" | "qualityStatus">): boolean {
  return session.nextAction === "review_quality" || session.qualityStatus === "unchecked";
}

function formatBulkQualitySummary(
  disposition: "accept" | "fail",
  acted: number,
  skipped: number
): string {
  if (disposition === "accept") {
    const base = `Accepted quality for ${acted} review session${acted === 1 ? "" : "s"} (compile-ready for enrichment)`;
    return skipped === 0
      ? base
      : `${base}; ${skipped} ready/passed session${skipped === 1 ? "" : "s"} left unchanged`;
  }
  const base = `Failed quality for ${acted} review session${acted === 1 ? "" : "s"} → Not Added (operator rejected)`;
  return skipped === 0
    ? base
    : `${base}; ${skipped} ready/passed session${skipped === 1 ? "" : "s"} left unchanged`;
}

async function resolveCurrentSelection(
  activeProjectionUrl: string,
  selectedSessionIds: Set<string>,
  visibleResponse: WorkbenchSessionsResponse,
  signal?: AbortSignal
): Promise<{ compileReady: Set<string>; present: Set<string>; qualityReview: Set<string> }> {
  const unresolved = new Set(selectedSessionIds);
  const compileReady = new Set<string>();
  const qualityReview = new Set<string>();
  collectSelectionAttributes(visibleResponse.sessions, unresolved, compileReady, qualityReview);
  if (unresolved.size === 0 || visibleResponse.offset === 0 && visibleResponse.sessions.length >= visibleResponse.total) {
    return {
      compileReady,
      present: new Set([...selectedSessionIds].filter((sessionId) => !unresolved.has(sessionId))),
      qualityReview
    };
  }

  const limit = 500;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (unresolved.size > 0 && offset < total) {
    const response = await getWorkbenchSessions(activeProjectionUrl, { limit, offset, signal });
    collectSelectionAttributes(response.sessions, unresolved, compileReady, qualityReview);
    total = typeof response.total === "number" ? response.total : response.sessions.length;
    if (response.sessions.length === 0) break;
    offset += response.sessions.length;
  }
  return {
    compileReady,
    present: new Set([...selectedSessionIds].filter((sessionId) => !unresolved.has(sessionId))),
    qualityReview
  };
}

function collectSelectionAttributes(
  sessions: WorkbenchQueueSessionDto[],
  unresolved: Set<string>,
  compileReady: Set<string>,
  qualityReview: Set<string>
): void {
  for (const session of sessions) {
    if (!unresolved.delete(session.sessionId)) continue;
    if (isCompileReadySession(session)) compileReady.add(session.sessionId);
    if (isQualityReviewSession(session)) qualityReview.add(session.sessionId);
  }
}

function formatActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("transcript_permission_required")) {
    return TRANSCRIPT_PERMISSION_ERROR;
  }
  if (/enroll missing failed:\s*404/i.test(message) || /not found/i.test(message) && /enroll/i.test(message)) {
    return "Enroll is unavailable until the Masthead daemon is restarted with the latest build.";
  }
  return message;
}
