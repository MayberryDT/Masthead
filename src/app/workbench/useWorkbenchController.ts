import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getWorkbenchAuthoringCapabilities,
  getWorkbenchArtifactCandidates,
  getWorkbenchActivity,
  getWorkbenchNotAddedSessions,
  getWorkbenchNotAddedSummary,
  getWorkbenchSessions,
  postWorkbenchCheckTranscript,
  postWorkbenchClaim,
  postWorkbenchEnrollMissing,
  postWorkbenchImportTranscript,
  postWorkbenchPublish,
  postWorkbenchPublishCanonicalDossiers,
  postWorkbenchQuality,
  postWorkbenchReleaseClaim
} from "../daemonClient";
import type {
  WorkbenchActivityDto,
  WorkbenchNotAddedSessionDto,
  WorkbenchNotAddedSummaryDto,
  WorkbenchQueueSessionDto
} from "../../shared/workbench";
import type {
  WorkbenchArtifactCandidateDto,
  WorkbenchAuthoringCapabilitiesDto
} from "../../shared/workbenchAuthoring";
import { buildWorkbenchHandoff } from "../../ui/workbench/workbenchHandoff";

const TRANSCRIPT_PERMISSION_ERROR =
  "Transcript import needs source permission for this session's source. Grant it under Sources, then retry Import.";

/** Page size for the package-path table. Large libraries paginate; never load thousands at once. */
export const WORKBENCH_PAGE_SIZE = 100;
const WORKBENCH_CANDIDATE_PAGE_SIZE = 100;
const WORKBENCH_CANDIDATE_MAX_PAGES_PER_STATUS = 5;

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
  | "publish"
  | "publish_canonical_dossiers"
  | "claim"
  | "release"
  | "author_candidate";

export type UseWorkbenchControllerResult = {
  actionBusy: boolean;
  actionError?: string;
  activity: WorkbenchActivityDto[];
  candidateError?: string;
  candidateLoading: boolean;
  candidates: WorkbenchArtifactCandidateDto[];
  canRun: (kind: WorkbenchActionKind) => boolean;
  clearActionFeedback: () => void;
  clearSelection: () => void;
  error?: string;
  handoffText: string;
  lastActionSummary?: string;
  loadNotAdded: () => void;
  loading: boolean;
  notAddedOpen: boolean;
  notAddedSessions: WorkbenchNotAddedSessionDto[];
  notAddedSummary?: WorkbenchNotAddedSummaryDto;
  page: number;
  pageSize: number;
  retry: () => void;
  retryCandidates: () => Promise<void>;
  runAction: (kind: WorkbenchActionKind) => Promise<void>;
  selectAll: () => Promise<void>;
  selectPage: () => void;
  selectedSessionIds: Set<string>;
  selectedCandidate?: WorkbenchArtifactCandidateDto;
  selectedCandidateId?: string;
  selectCandidate: (candidateId: string) => void;
  sessions: WorkbenchQueueSessionDto[];
  setNotAddedOpen: (open: boolean) => void;
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
  const [authoringCapabilities, setAuthoringCapabilities] = useState<WorkbenchAuthoringCapabilitiesDto>();
  const [candidates, setCandidates] = useState<WorkbenchArtifactCandidateDto[]>([]);
  const [candidateError, setCandidateError] = useState<string>();
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const [notAddedOpen, setNotAddedOpenState] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState(() => new Set<string>());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [lastActionSummary, setLastActionSummary] = useState<string>();
  const [page, setPageState] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = WORKBENCH_PAGE_SIZE;
  const loadRequestId = useRef(0);
  const candidateLoadRequestId = useRef(0);

  const loadCandidates = useCallback(async (options: { signal?: AbortSignal } = {}) => {
    const requestId = ++candidateLoadRequestId.current;
    setCandidateLoading(true);
    setCandidateError(undefined);
    try {
      const nextCandidates = await loadActionableCandidatePages(activeProjectionUrl, options.signal);
      if (options.signal?.aborted || requestId !== candidateLoadRequestId.current) return;
      setCandidates(nextCandidates);
      setSelectedCandidateId((current) => {
        if (current && nextCandidates.some((candidate) => candidate.candidateId === current)) return current;
        return nextCandidates[0]?.candidateId;
      });
    } catch (loadError) {
      if (!options.signal?.aborted && requestId === candidateLoadRequestId.current) {
        setCandidateError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (!options.signal?.aborted && requestId === candidateLoadRequestId.current) setCandidateLoading(false);
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
      void loadCandidates({ signal: options.signal });
      const [response, activityResponse, notAdded, capabilities] = await Promise.all([
        getWorkbenchSessions(activeProjectionUrl, {
          limit: pageSize,
          offset: pageIndex * pageSize,
          signal: options.signal
        }),
        getWorkbenchActivity(activeProjectionUrl, { limit: 30, signal: options.signal }),
        getWorkbenchNotAddedSummary(activeProjectionUrl, { signal: options.signal }),
        capabilitiesPromise
      ]);
      if (options.signal?.aborted || requestId !== loadRequestId.current) return;
      setSessions(response.sessions);
      setTotal(typeof response.total === "number" ? response.total : response.sessions.length);
      setActivity(activityResponse.activity);
      setNotAddedSummary(notAdded);
      setAuthoringCapabilities(capabilities);
      setSelectedSessionIds((current) => {
        const visibleIds = new Set(response.sessions.map((session) => session.sessionId));
        return new Set(Array.from(current).filter((sessionId) => visibleIds.has(sessionId)));
      });
    } catch (loadError) {
      if (!options.signal?.aborted && requestId === loadRequestId.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (!options.signal?.aborted && requestId === loadRequestId.current) setLoading(false);
    }
  }, [activeProjectionUrl, loadCandidates, page, pageSize]);

  const setPage = useCallback(
    (nextPage: number) => {
      const safe = Math.max(0, Math.trunc(nextPage));
      setPageState(safe);
      setSelectedSessionIds(new Set());
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

  const setNotAddedOpen = useCallback(
    (open: boolean) => {
      setNotAddedOpenState(open);
      if (open) void loadNotAdded();
    },
    [loadNotAdded]
  );

  useEffect(() => {
    if (!active || !isLive) {
      loadRequestId.current += 1;
      candidateLoadRequestId.current += 1;
      setAuthoringCapabilities(undefined);
      setCandidates([]);
      setCandidateError(undefined);
      setCandidateLoading(false);
      setSelectedCandidateId(undefined);
      return;
    }
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [active, isLive, load, refreshKey]);

  // Immediate selection for UI enablement / counts (must feel instant on checkbox click).
  const selectedSessions = useMemo(
    () => sessions.filter((session) => selectedSessionIds.has(session.sessionId)),
    [selectedSessionIds, sessions]
  );

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.candidateId === selectedCandidateId),
    [candidates, selectedCandidateId]
  );

  const handoffText = useMemo(
    () =>
      authoringCapabilities && selectedCandidate
        ? buildWorkbenchHandoff({
            authoringCommand: authoringCapabilities.command,
            candidate: selectedCandidate,
            databaseId: authoringCapabilities.databaseId
          })
        : "",
    [authoringCapabilities, selectedCandidate]
  );

  const canRun = useCallback(
    (kind: WorkbenchActionKind): boolean => {
      if (!isLive || actionBusy) return false;
      if (kind === "enroll_missing") return true;
      if (kind === "author_candidate") {
        return Boolean(authoringCapabilities) && Boolean(selectedCandidate && isActionableCandidate(selectedCandidate));
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
        case "quality_pass":
        case "quality_fail":
        case "quality_precheck":
          return selectedSessions.some(
            (session) => session.qualityStatus === "unchecked" || session.nextAction === "review_quality"
          );
        case "publish":
          return selectedSessions.some((session) => session.nextAction === "publish");
        case "publish_canonical_dossiers":
          return selectedSessions.some((session) => session.sessionDossierStatus !== "satisfied");
        case "claim":
          return selectedSessions.some((session) => !session.activeClaim);
        case "release":
          return selectedSessions.some((session) => Boolean(session.activeClaim));
        default:
          return false;
      }
    },
    [actionBusy, authoringCapabilities, isLive, selectedCandidate, selectedSessions]
  );

  const runAction = useCallback(
    async (kind: WorkbenchActionKind) => {
      if (!canRun(kind)) return;

      if (kind === "author_candidate") {
        setActionError(undefined);
        setLastActionSummary("Candidate prompt ready to copy");
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

        if (kind === "publish_canonical_dossiers") {
          const result = await postWorkbenchPublishCanonicalDossiers(activeProjectionUrl, {
            actorId: "workbench_ui",
            sessionIds: ids
          });
          acted = result.receipt.sessionIds.length;
          setLastActionSummary(`Published ${acted} canonical dossier${acted === 1 ? "" : "s"}`);
        } else if (kind === "check_transcript") {
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
        } else if (kind === "quality_pass") {
          for (const sessionId of ids) {
            await postWorkbenchQuality(activeProjectionUrl, sessionId, { status: "passed" });
            acted += 1;
          }
          setLastActionSummary(`Accepted quality for ${acted} session${acted === 1 ? "" : "s"}`);
        } else if (kind === "quality_fail") {
          for (const sessionId of ids) {
            await postWorkbenchQuality(activeProjectionUrl, sessionId, {
              status: "failed",
              reason: "operator_rejected"
            });
            acted += 1;
          }
          setLastActionSummary(`Failed quality for ${acted} session${acted === 1 ? "" : "s"}`);
        } else if (kind === "quality_precheck") {
          for (const sessionId of ids) {
            await postWorkbenchQuality(activeProjectionUrl, sessionId, { mode: "precheck" });
            acted += 1;
          }
          setLastActionSummary(`Prechecked quality for ${acted} session${acted === 1 ? "" : "s"}`);
        } else if (kind === "publish") {
          for (const sessionId of ids) {
            await postWorkbenchPublish(activeProjectionUrl, sessionId);
            acted += 1;
          }
          setLastActionSummary(`Published ${acted} session${acted === 1 ? "" : "s"}`);
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
        onLibraryChanged?.();
      } catch (runError) {
        setActionError(formatActionError(runError));
      } finally {
        setActionBusy(false);
      }
    },
    [activeProjectionUrl, canRun, load, onLibraryChanged, selectedSessionIds, sessions]
  );

  const retry = useCallback(() => {
    if (!active || !isLive) return;
    void load();
  }, [active, isLive, load]);

  const retryCandidates = useCallback(async () => {
    if (!active || !isLive) return;
    await loadCandidates();
  }, [active, isLive, loadCandidates]);

  const toggleSession = useCallback((sessionId: string) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const selectPage = useCallback(() => {
    setSelectedSessionIds(new Set(sessions.map((session) => session.sessionId)));
  }, [sessions]);

  const selectAll = useCallback(async () => {
    if (!isLive || actionBusy) return;
    setActionBusy(true);
    setActionError(undefined);
    try {
      const ids = new Set<string>();
      let offset = 0;
      let queueTotal = Number.POSITIVE_INFINITY;
      const limit = 500;
      while (offset < queueTotal) {
        const response = await getWorkbenchSessions(activeProjectionUrl, { limit, offset });
        queueTotal = typeof response.total === "number" ? response.total : response.sessions.length;
        for (const session of response.sessions) ids.add(session.sessionId);
        if (response.sessions.length === 0) break;
        offset += response.sessions.length;
        if (ids.size >= queueTotal) break;
      }
      setSelectedSessionIds(ids);
      setLastActionSummary(
        ids.size === 0 ? "No package-path sessions to select" : `Selected all ${ids.size} package-path sessions`
      );
    } catch (selectError) {
      setActionError(formatActionError(selectError));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, activeProjectionUrl, isLive]);

  const clearSelection = useCallback(() => {
    setSelectedSessionIds(new Set());
  }, []);

  const selectCandidate = useCallback((candidateId: string) => {
    setSelectedCandidateId(candidateId);
  }, []);

  return {
    actionBusy,
    actionError,
    activity,
    candidateError,
    candidateLoading,
    candidates,
    canRun,
    clearActionFeedback,
    clearSelection,
    error,
    handoffText,
    lastActionSummary,
    loadNotAdded: () => {
      void loadNotAdded();
    },
    loading,
    notAddedOpen,
    notAddedSessions,
    notAddedSummary,
    page,
    pageSize,
    retry,
    retryCandidates,
    runAction,
    selectAll,
    selectPage,
    selectedSessionIds,
    selectCandidate,
    selectedCandidate,
    selectedCandidateId,
    sessions,
    setNotAddedOpen,
    setPage,
    total,
    toggleSession
  };
}

function isActionableCandidate(candidate: WorkbenchArtifactCandidateDto): boolean {
  return candidate.status === "pending" || candidate.status === "claimed";
}

async function loadActionableCandidatePages(
  activeProjectionUrl: string,
  signal?: AbortSignal
): Promise<WorkbenchArtifactCandidateDto[]> {
  const pages = await Promise.all(
    (["pending", "claimed"] as const).map(async (status) => {
      const candidates: WorkbenchArtifactCandidateDto[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      for (let pageIndex = 0; pageIndex < WORKBENCH_CANDIDATE_MAX_PAGES_PER_STATUS; pageIndex += 1) {
        const page = await getWorkbenchArtifactCandidates(activeProjectionUrl, {
          ...(cursor ? { cursor } : {}),
          limit: WORKBENCH_CANDIDATE_PAGE_SIZE,
          signal,
          status
        });
        candidates.push(...page.candidates.filter((candidate) => candidate.status === status));
        const nextCursor = page.nextCursor?.trim();
        if (!nextCursor || seenCursors.has(nextCursor)) break;
        if (pageIndex === WORKBENCH_CANDIDATE_MAX_PAGES_PER_STATUS - 1) {
          throw new Error(
            `Artifact candidate safety limit reached for ${status}; more than ${WORKBENCH_CANDIDATE_PAGE_SIZE * WORKBENCH_CANDIDATE_MAX_PAGES_PER_STATUS} actionable candidates are available.`
          );
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
      return candidates;
    })
  );
  const deduplicated = new Map<string, WorkbenchArtifactCandidateDto>();
  for (const candidate of pages.flat()) deduplicated.set(candidate.candidateId, candidate);
  return Array.from(deduplicated.values());
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
