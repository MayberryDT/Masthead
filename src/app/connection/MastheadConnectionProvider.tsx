import { createContext, type ReactNode, useMemo } from "react";
import { defaultLiveProjectionUrl } from "../liveProjectionClient.ts";
import { MastheadApiClient } from "../api/MastheadApiClient.ts";

export type MastheadConnectionContextValue = {
  api: MastheadApiClient;
  projectionUrl: string;
};

export const MastheadConnectionContext = createContext<MastheadConnectionContextValue | undefined>(undefined);

export function MastheadConnectionProvider({
  children,
  projectionUrl = defaultLiveProjectionUrl()
}: {
  children: ReactNode;
  projectionUrl?: string;
}) {
  const value = useMemo(
    () => ({
      api: new MastheadApiClient(projectionUrl),
      projectionUrl
    }),
    [projectionUrl]
  );

  return <MastheadConnectionContext.Provider value={value}>{children}</MastheadConnectionContext.Provider>;
}
