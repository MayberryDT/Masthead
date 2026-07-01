import { useCallback, useEffect, useState } from "react";
import type { SessionDossierDto } from "../../shared/sessionDossier";
import {
  getSessionDossier,
  getSessionTranscript,
  type SessionTranscriptKindFilter,
  type SessionTranscriptResult
} from "../daemonClient";

type UseBoardSessionDetailControllerOptions = {
  activeProjectionUrl: string;
  open: boolean;
  sessionId?: string;
  showDemoData: boolean;
};

export function useBoardSessionDetailController({
  activeProjectionUrl,
  open,
  sessionId,
  showDemoData
}: UseBoardSessionDetailControllerOptions) {
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

  useEffect(() => {
    const timeout = window.setTimeout(() => setTranscriptDebouncedQuery(transcriptQuery), 200);
    return () => window.clearTimeout(timeout);
  }, [transcriptQuery]);

  useEffect(() => {
    if (!open || showDemoData || !sessionId) {
      setDossier(undefined);
      setDossierError(undefined);
      setDossierLoading(false);
      return;
    }

    const controller = new AbortController();
    setDossierLoading(true);
    setDossierError(undefined);
    void getSessionDossier(sessionId, activeProjectionUrl, { signal: controller.signal })
      .then((nextDossier) => {
        setDossier(nextDossier);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setDossier(undefined);
          setDossierError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDossierLoading(false);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, dossierRetryKey, open, sessionId, showDemoData]);

  useEffect(() => {
    if (!open || showDemoData || !sessionId) {
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
      sessionId,
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
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setTranscript(undefined);
          setTranscriptError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setTranscriptLoading(false);
      });
    return () => controller.abort();
  }, [activeProjectionUrl, open, sessionId, showDemoData, transcriptDebouncedQuery, transcriptFilter, transcriptRetryKey]);

  const loadMoreTranscript = useCallback(async () => {
    if (!sessionId || !transcript?.nextCursor || transcriptLoading) return;
    setTranscriptLoading(true);
    setTranscriptError(undefined);
    try {
      const next = await getSessionTranscript(
        sessionId,
        {
          cursor: transcript.nextCursor,
          kind: transcriptFilter,
          limit: 100,
          q: transcriptDebouncedQuery
        },
        activeProjectionUrl
      );
      setTranscript((current) => (current ? { ...next, items: [...current.items, ...next.items] } : next));
    } catch (error) {
      setTranscriptError(error instanceof Error ? error.message : String(error));
    } finally {
      setTranscriptLoading(false);
    }
  }, [activeProjectionUrl, sessionId, transcript, transcriptDebouncedQuery, transcriptFilter, transcriptLoading]);

  const retryDossier = useCallback(() => setDossierRetryKey((current) => current + 1), []);
  const retryTranscript = useCallback(() => setTranscriptRetryKey((current) => current + 1), []);

  return {
    dossier,
    dossierError,
    dossierLoading,
    loadMoreTranscript,
    retryDossier,
    retryTranscript,
    setTranscriptFilter,
    setTranscriptQuery,
    transcript,
    transcriptError,
    transcriptFilter,
    transcriptLoading,
    transcriptQuery
  };
}
