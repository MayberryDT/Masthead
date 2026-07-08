import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getWorkbenchActivity,
  getWorkbenchNotAddedSessions,
  getWorkbenchNotAddedSummary,
  getWorkbenchSessions,
  postWorkbenchCheckTranscript,
  postWorkbenchClaim,
  postWorkbenchImportTranscript,
  postWorkbenchPublish,
  postWorkbenchQuality,
  postWorkbenchReleaseClaim
} from "../daemonClient";
import type {
  WorkbenchActivityDto,
  WorkbenchNotAddedSessionDto,
  WorkbenchNotAddedSummaryDto,
  WorkbenchQueueSessionDto
} from "../../shared/workbench";
import { buildWorkbenchHandoff } from "../../ui/workbench/workbenchHandoff";

const TRANSCRIPT_PERMISSION_ERROR =
  "Transcript import needs source permission for this session's source. Grant it under Sources, then retry Import.";

type UseWorkbenchControllerOptions = {
  activeProjectionUrl: string;
  active: boolean;
  refreshKey: number;
  isLive: boolean;
};

export type WorkbenchActionKind =
  | "check_transcript"
  | "import_transcript"
  | "quality_pass"
  | "quality_fail"
  | "quality_precheck"
  | "publish"
  | "claim"
  | "release"
  | "copy_agent_prompt";

export type UseWorkbenchControllerResult = {
  actionBusy: boolean;
  actionError?: string;
  activity: WorkbenchActivityDto[];
  canRun: (kind: WorkbenchActionKind) => boolean;
  clearSelection: () => void;
  error?: string;
  handoffText: string;
  lastActionSummary?: string;
  loadNotAdded: () => void;
  loading: boolean;
  notAddedOpen: boolean;
  notAddedSessions: WorkbenchNotAddedSessionDto[];
  notAddedSummary?: WorkbenchNotAddedSummaryDto;
  retry: () => void;
  runAction: (kind: WorkbenchActionKind) => Promise<void>;
  selectAllVisible: () => void;
  selectedSessionIds: Set<string>;
  sessions: WorkbenchQueueSessionDto[];
  setNotAddedOpen: (open: boolean) => void;
  toggleSession: (sessionId: string) => void;
};

export function useWorkbenchController({
  activeProjectionUrl,
  active,
  refreshKey,
  isLive
}: UseWorkbenchControllerOptions): UseWorkbenchControllerResult {
  const [sessions, setSessions] = useState<WorkbenchQueueSessionDto[]>([]);
  const [activity, setActivity] = useState<WorkbenchActivityDto[]>([]);
  const [notAddedSummary, setNotAddedSummary] = useState<WorkbenchNotAddedSummaryDto>();
  const [notAddedSessions, setNotAddedSessions] = useState<WorkbenchNotAddedSessionDto[]>([]);
  const [notAddedOpen, setNotAddedOpenState] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState(() => new Set<string>());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [lastActionSummary, setLastActionSummary] = useState<string>();

  const load = useCallback(async (options: { signal?: AbortSignal } = {}) => {
    setLoading(true);
    setError(undefined);
    try {
      const [response, activityResponse, notAdded] = await Promise.all([
        getWorkbenchSessions(activeProjectionUrl, { limit: 50, signal: options.signal }),
        getWorkbenchActivity(activeProjectionUrl, { limit: 30, signal: options.signal }),
        getWorkbenchNotAddedSummary(activeProjectionUrl, { signal: options.signal })
      ]);
      setSessions(response.sessions);
      setActivity(activityResponse.activity);
      setNotAddedSummary(notAdded);
      setSelectedSessionIds((current) => {
        const visibleIds = new Set(response.sessions.map((session) => session.sessionId));
        return new Set(Array.from(current).filter((sessionId) => visibleIds.has(sessionId)));
      });
    } catch (loadError) {
      if (!options.signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (!options.signal?.aborted) setLoading(false);
    }
  }, [activeProjectionUrl]);

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
    if (!active || !isLive) return;
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [active, isLive, load, refreshKey]);

  const selectedSessions = useMemo(
    () => sessions.filter((session) => selectedSessionIds.has(session.sessionId)),
    [selectedSessionIds, sessions]
  );

  const handoffText = useMemo(
    () => buildWorkbenchHandoff({ sessions: selectedSessions }),
    [selectedSessions]
  );

  const canRun = useCallback(
    (kind: WorkbenchActionKind): boolean => {
      if (!isLive || actionBusy) return false;
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
        case "claim":
          return selectedSessions.some((session) => !session.activeClaim);
        case "release":
          return selectedSessions.some((session) => Boolean(session.activeClaim));
        case "copy_agent_prompt":
          return handoffText.trim().length > 0;
        default:
          return false;
      }
    },
    [actionBusy, handoffText, isLive, selectedSessions]
  );

  const runAction = useCallback(
    async (kind: WorkbenchActionKind) => {
      if (!canRun(kind)) return;

      if (kind === "copy_agent_prompt") {
        setActionError(undefined);
        setLastActionSummary("Agent prompt ready to copy");
        return;
      }

      setActionBusy(true);
      setActionError(undefined);
      try {
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
      } catch (runError) {
        setActionError(formatActionError(runError));
      } finally {
        setActionBusy(false);
      }
    },
    [activeProjectionUrl, canRun, load, selectedSessionIds, sessions]
  );

  const retry = useCallback(() => {
    if (!active || !isLive) return;
    void load();
  }, [active, isLive, load]);

  const toggleSession = useCallback((sessionId: string) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedSessionIds(new Set(sessions.map((session) => session.sessionId)));
  }, [sessions]);

  const clearSelection = useCallback(() => {
    setSelectedSessionIds(new Set());
  }, []);

  return {
    actionBusy,
    actionError,
    activity,
    canRun,
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
    retry,
    runAction,
    selectAllVisible,
    selectedSessionIds,
    sessions,
    setNotAddedOpen,
    toggleSession
  };
}

function formatActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("transcript_permission_required")) {
    return TRANSCRIPT_PERMISSION_ERROR;
  }
  return message;
}
