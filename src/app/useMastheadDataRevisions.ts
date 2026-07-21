import { useEffect, useState } from "react";
import { getDataRevisions, type MastheadDataRevisions } from "./daemonClient";

const POLL_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

type UseMastheadDataRevisionsInput = {
  active: boolean;
  activeProjectionUrl: string;
  isLive: boolean;
};

export function useMastheadDataRevisions({
  active,
  activeProjectionUrl,
  isLive
}: UseMastheadDataRevisionsInput): MastheadDataRevisions {
  const [revisions, setRevisions] = useState<MastheadDataRevisions>({ logbook: 0, workbench: 0 });

  useEffect(() => {
    if (!active || !isLive) return;
    let stopped = false;
    let timeoutId: number | undefined;
    let controller: AbortController | undefined;
    let failureCount = 0;

    const schedule = (delay: number) => {
      if (stopped || document.visibilityState === "hidden") return;
      timeoutId = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const next = await getDataRevisions(activeProjectionUrl, { signal: requestController.signal });
        if (stopped || requestController.signal.aborted) return;
        failureCount = 0;
        setRevisions((current) =>
          current.logbook === next.logbook && current.workbench === next.workbench ? current : next
        );
        schedule(POLL_INTERVAL_MS);
      } catch {
        if (stopped || requestController.signal.aborted) return;
        failureCount += 1;
        schedule(Math.min(POLL_INTERVAL_MS * 2 ** (failureCount - 1), MAX_BACKOFF_MS));
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        controller?.abort();
      } else {
        void poll();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState !== "hidden") void poll();
    return () => {
      stopped = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, activeProjectionUrl, isLive]);

  return revisions;
}
