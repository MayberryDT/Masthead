import { createContext, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultLiveProjectionUrl, eventsRequestUrl, normalizeDaemonBaseUrl, projectionRequestUrl } from "../liveProjectionClient";

export type MastheadHealthDto = {
  ok: true;
  product: "masthead";
  apiVersion: 1;
  runtime?: {
    mode?: string;
    writable?: boolean;
  };
  data?: {
    databaseId?: string;
    databasePath?: string;
    migrationState?: string;
  };
  capabilities?: string[];
};

export type MastheadConnectionState =
  | { state: "probing"; baseUrl: string }
  | { state: "ready"; baseUrl: string; health: MastheadHealthDto; writable: true }
  | { state: "read_only"; baseUrl: string; health: MastheadHealthDto; writable: false }
  | { state: "incompatible"; baseUrl: string; error: string }
  | { state: "offline"; baseUrl: string; error: string };

export type MastheadApiClient = {
  baseUrl: string;
  healthUrl: () => string;
  projectionUrl: (selectedSessionId?: string | null) => string;
  getHealth: (signal?: AbortSignal) => Promise<MastheadHealthDto>;
  getLiveProjection: (selectedSessionId?: string | null, signal?: AbortSignal) => Promise<unknown>;
  getLiveEvents: (signal?: AbortSignal) => Promise<unknown>;
};

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
  const api = useMemo(() => createMastheadApiClient(baseUrl), [baseUrl]);

  const setBaseUrl = useCallback((url: string) => {
    setBaseUrlState(normalizeDaemonBaseUrl(url));
  }, []);

  const refresh = useCallback(async () => {
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    const isCurrentRequest = () => refreshRequestIdRef.current === requestId;
    setState({ state: "probing", baseUrl });
    try {
      const health = await api.getHealth();
      if (!isCurrentRequest()) return;
      if (health.runtime?.writable === false) {
        setState({ state: "read_only", baseUrl, health, writable: false });
        return;
      }
      setState({ state: "ready", baseUrl, health, writable: true });
    } catch (error) {
      if (!isCurrentRequest()) return;
      if (error instanceof MastheadConnectionError && error.kind === "incompatible") {
        setState({ state: "incompatible", baseUrl, error: error.message });
      } else {
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

export type MastheadConnectionErrorKind = "incompatible" | "offline" | "malformed";

export class MastheadConnectionError extends Error {
  readonly kind: MastheadConnectionErrorKind;

  constructor(kind: MastheadConnectionErrorKind, message: string) {
    super(message);
    this.name = "MastheadConnectionError";
    this.kind = kind;
  }
}

export function createMastheadApiClient(baseUrl: string): MastheadApiClient {
  const normalizedBaseUrl = normalizeDaemonBaseUrl(baseUrl);
  return {
    baseUrl: normalizedBaseUrl,
    healthUrl: () => `${normalizedBaseUrl}/health`,
    projectionUrl: (selectedSessionId?: string | null) => projectionRequestUrl(normalizedBaseUrl, selectedSessionId),
    getHealth: async (signal?: AbortSignal) => {
      const response = await fetch(`${normalizedBaseUrl}/health`, { headers: { accept: "application/json" }, signal });
      if (!response.ok) {
        throw new MastheadConnectionError("offline", `${normalizedBaseUrl}/health returned ${response.status}`);
      }
      const value: unknown = await response.json();
      return classifyMastheadHealth(value);
    },
    getLiveProjection: async (selectedSessionId?: string | null, signal?: AbortSignal) => {
      await fetchJson(`${normalizedBaseUrl}/health`, signal).then(classifyMastheadHealth);
      return fetchJson(projectionRequestUrl(normalizedBaseUrl, selectedSessionId), signal);
    },
    getLiveEvents: async (signal?: AbortSignal) => {
      await fetchJson(`${normalizedBaseUrl}/health`, signal).then(classifyMastheadHealth);
      return fetchJson(eventsRequestUrl(normalizedBaseUrl), signal);
    }
  };
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!response.ok) {
    throw new MastheadConnectionError("offline", `${url} returned ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

export function classifyMastheadHealth(value: unknown): MastheadHealthDto {
  if (typeof value !== "object" || value === null) {
    throw new MastheadConnectionError("malformed", "Masthead health response was not an object.");
  }
  const health = value as Record<string, unknown>;
  if (health.ok !== true || health.product !== "masthead" || health.apiVersion !== 1) {
    throw new MastheadConnectionError("incompatible", "Masthead daemon is not compatible with this UI build.");
  }
  const runtime = objectRecord(health.runtime);
  const data = objectRecord(health.data);
  if (data?.migrationState === "failed") {
    throw new MastheadConnectionError("incompatible", "Masthead data migration failed.");
  }

  return {
    ok: true,
    product: "masthead",
    apiVersion: 1,
    runtime: runtime
      ? {
          mode: typeof runtime.mode === "string" ? runtime.mode : undefined,
          writable:
            health.readOnly === true ? false : typeof runtime.writable === "boolean" ? runtime.writable : undefined
        }
      : undefined,
    data: data
      ? {
          databaseId: typeof data.databaseId === "string" ? data.databaseId : undefined,
          databasePath: typeof data.databasePath === "string" ? data.databasePath : undefined,
          migrationState: typeof data.migrationState === "string" ? data.migrationState : undefined
        }
      : undefined,
    capabilities: Array.isArray(health.capabilities) ? health.capabilities.filter((capability): capability is string => typeof capability === "string") : undefined
  };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}
