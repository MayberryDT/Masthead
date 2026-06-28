import { createContext, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MastheadHealthDto } from "../../shared/protocol";
import { MastheadApiClient } from "../api/MastheadApiClient";
import { MastheadApiError } from "../api/MastheadApiError";
import { defaultLiveProjectionUrl, normalizeDaemonBaseUrl } from "../liveProjectionClient";

export type MastheadConnectionState =
  | { state: "probing"; baseUrl: string }
  | { state: "ready"; baseUrl: string; health: MastheadHealthDto; writable: true }
  | { state: "read_only"; baseUrl: string; health: MastheadHealthDto; writable: false }
  | { state: "incompatible"; baseUrl: string; error: string }
  | { state: "offline"; baseUrl: string; error: string };

export type MastheadConnectionContextValue = {
  api: MastheadApiClient;
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  refresh: () => Promise<void>;
  state: MastheadConnectionState;
  writable: boolean;
};

export const MastheadConnectionContext = createContext<MastheadConnectionContextValue | undefined>(undefined);

export function MastheadConnectionProvider({
  children,
  initialUrl = defaultLiveProjectionUrl()
}: {
  children: ReactNode;
  initialUrl?: string;
}) {
  const [baseUrl, setBaseUrlState] = useState(() => normalizeDaemonBaseUrl(initialUrl));
  const [state, setState] = useState<MastheadConnectionState>({ state: "probing", baseUrl });
  const refreshRequestIdRef = useRef(0);
  const api = useMemo(() => new MastheadApiClient(baseUrl), [baseUrl]);

  const setBaseUrl = useCallback((url: string) => {
    setBaseUrlState(normalizeDaemonBaseUrl(url));
  }, []);

  const refresh = useCallback(async () => {
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    const isCurrentRequest = () => refreshRequestIdRef.current === requestId;
    const startedAt = performance.now();
    setState({ state: "probing", baseUrl });
    try {
      const health = await api.getHealth();
      if (!isCurrentRequest()) return;
      if (health.runtime?.writable === false) {
        logConnectionProbe({
          baseUrl,
          elapsedMs: elapsedMs(startedAt),
          state: "read_only"
        });
        setState({ state: "read_only", baseUrl, health, writable: false });
        return;
      }
      logConnectionProbe({
        baseUrl,
        elapsedMs: elapsedMs(startedAt),
        state: "ready"
      });
      setState({ state: "ready", baseUrl, health, writable: true });
    } catch (error) {
      if (!isCurrentRequest()) return;
      if (error instanceof MastheadApiError && error.kind === "incompatible") {
        logConnectionProbe({
          baseUrl,
          elapsedMs: elapsedMs(startedAt),
          error: error.message,
          state: "incompatible",
          status: error.status,
          url: error.url
        });
        setState({ state: "incompatible", baseUrl, error: error.message });
      } else {
        logConnectionProbe({
          baseUrl,
          elapsedMs: elapsedMs(startedAt),
          error: error instanceof Error ? error.message : String(error),
          state: "offline",
          status: error instanceof MastheadApiError ? error.status : undefined,
          url: error instanceof MastheadApiError ? error.url : undefined
        });
        setState({ state: "offline", baseUrl, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }, [api, baseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      api,
      baseUrl,
      refresh,
      setBaseUrl,
      state,
      writable: state.state === "ready" && state.writable
    }),
    [api, baseUrl, refresh, setBaseUrl, state]
  );

  return <MastheadConnectionContext.Provider value={value}>{children}</MastheadConnectionContext.Provider>;
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function logConnectionProbe(event: {
  baseUrl: string;
  elapsedMs: number;
  error?: string;
  state: MastheadConnectionState["state"];
  status?: number;
  url?: string;
}): void {
  if (!import.meta.env.DEV && import.meta.env.VITE_MASTHEAD_CONNECTION_DEBUG !== "1") return;
  console.info("[masthead] connection probe", event);
}
