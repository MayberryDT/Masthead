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
  connectTo: (url: string) => Promise<void>;
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
  const skipNextEffectProbeBaseUrlRef = useRef<string | null>(null);
  const api = useMemo(() => new MastheadApiClient(baseUrl), [baseUrl]);

  const probeBaseUrl = useCallback(async (targetBaseUrl: string) => {
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    const isCurrentRequest = () => refreshRequestIdRef.current === requestId;
    const targetApi = new MastheadApiClient(targetBaseUrl);
    const startedAt = performance.now();
    setState({ state: "probing", baseUrl: targetBaseUrl });
    try {
      const health = await targetApi.getHealth();
      if (!isCurrentRequest()) return;
      if (health.runtime?.writable === false) {
        logConnectionProbe({
          baseUrl: targetBaseUrl,
          elapsedMs: elapsedMs(startedAt),
          state: "read_only"
        });
        setState({ state: "read_only", baseUrl: targetBaseUrl, health, writable: false });
        return;
      }
      logConnectionProbe({
        baseUrl: targetBaseUrl,
        elapsedMs: elapsedMs(startedAt),
        state: "ready"
      });
      setState({ state: "ready", baseUrl: targetBaseUrl, health, writable: true });
    } catch (error) {
      if (!isCurrentRequest()) return;
      if (error instanceof MastheadApiError && error.kind === "incompatible") {
        logConnectionProbe({
          baseUrl: targetBaseUrl,
          elapsedMs: elapsedMs(startedAt),
          error: error.message,
          state: "incompatible",
          status: error.status,
          url: error.url
        });
        setState({ state: "incompatible", baseUrl: targetBaseUrl, error: error.message });
      } else {
        logConnectionProbe({
          baseUrl: targetBaseUrl,
          elapsedMs: elapsedMs(startedAt),
          error: error instanceof Error ? error.message : String(error),
          state: "offline",
          status: error instanceof MastheadApiError ? error.status : undefined,
          url: error instanceof MastheadApiError ? error.url : undefined
        });
        setState({
          state: "offline",
          baseUrl: targetBaseUrl,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    await probeBaseUrl(baseUrl);
  }, [baseUrl, probeBaseUrl]);

  const setBaseUrl = useCallback(
    (url: string) => {
      const nextBaseUrl = normalizeDaemonBaseUrl(url);
      skipNextEffectProbeBaseUrlRef.current = null;
      setBaseUrlState(nextBaseUrl);
      if (nextBaseUrl === baseUrl) {
        void probeBaseUrl(nextBaseUrl);
      }
    },
    [baseUrl, probeBaseUrl]
  );

  const connectTo = useCallback(
    async (url: string) => {
      const nextBaseUrl = normalizeDaemonBaseUrl(url);
      skipNextEffectProbeBaseUrlRef.current = nextBaseUrl === baseUrl ? null : nextBaseUrl;
      setBaseUrlState(nextBaseUrl);
      await probeBaseUrl(nextBaseUrl);
    },
    [baseUrl, probeBaseUrl]
  );

  useEffect(() => {
    if (skipNextEffectProbeBaseUrlRef.current === baseUrl) {
      skipNextEffectProbeBaseUrlRef.current = null;
      return;
    }
    void refresh();
  }, [baseUrl, refresh]);

  const value = useMemo(
    () => ({
      api,
      baseUrl,
      connectTo,
      refresh,
      setBaseUrl,
      state,
      writable: state.state === "ready" && state.writable
    }),
    [api, baseUrl, connectTo, refresh, setBaseUrl, state]
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
