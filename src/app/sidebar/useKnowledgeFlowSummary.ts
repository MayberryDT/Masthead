import { useEffect, useState } from "react";
import type { KnowledgeFlowSummaryDto } from "../../shared/knowledgeFlow";
import { getKnowledgeFlowSummary } from "../daemonClient";

type UseKnowledgeFlowSummaryOptions = {
  activeProjectionUrl: string;
  isLive: boolean;
  refreshKey: number;
};

const UNAVAILABLE_MESSAGE = "Knowledge flow summary unavailable";

export type UseKnowledgeFlowSummaryResult = {
  summary?: KnowledgeFlowSummaryDto;
  loading: boolean;
  error?: string;
};

export function useKnowledgeFlowSummary({
  activeProjectionUrl,
  isLive,
  refreshKey
}: UseKnowledgeFlowSummaryOptions): UseKnowledgeFlowSummaryResult {
  const [summary, setSummary] = useState<KnowledgeFlowSummaryDto>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(() => (isLive ? undefined : UNAVAILABLE_MESSAGE));

  useEffect(() => {
    if (!isLive) {
      setSummary(undefined);
      setLoading(false);
      setError(UNAVAILABLE_MESSAGE);
      return;
    }

    const controller = new AbortController();
    let requestId = 0;

    const load = async (showLoading: boolean) => {
      const currentRequestId = requestId + 1;
      requestId = currentRequestId;
      if (showLoading) {
        setSummary(undefined);
        setLoading(true);
        setError(undefined);
      }
      try {
        const nextSummary = await getKnowledgeFlowSummary(activeProjectionUrl, { signal: controller.signal });
        if (controller.signal.aborted || currentRequestId !== requestId) return;
        setSummary(nextSummary);
        setError(undefined);
      } catch (loadError) {
        if (controller.signal.aborted || currentRequestId !== requestId) return;
        setSummary(undefined);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!controller.signal.aborted && currentRequestId === requestId) setLoading(false);
      }
    };

    void load(true);
    const interval = window.setInterval(() => void load(false), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [activeProjectionUrl, isLive, refreshKey]);

  return isLive ? { summary, loading, error } : { summary: undefined, loading: false, error: UNAVAILABLE_MESSAGE };
}
