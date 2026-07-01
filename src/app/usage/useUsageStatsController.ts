import { useCallback, useEffect, useState } from "react";
import { getUsageStats, type UsageStatsDto, type UsageWindow } from "../daemonClient";

type UseUsageStatsControllerOptions = {
  activeProjectionUrl: string;
  active: boolean;
  refreshKey: number;
  isLive: boolean;
};

export function useUsageStatsController({
  activeProjectionUrl,
  active,
  refreshKey,
  isLive
}: UseUsageStatsControllerOptions) {
  const [usageWindow, setWindow] = useState<UsageWindow>("today");
  const [stats, setStats] = useState<UsageStatsDto>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [sidebarStats, setSidebarStats] = useState<UsageStatsDto>();
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [sidebarError, setSidebarError] = useState<string>();

  const loadSidebarStats = useCallback(async (options: { signal?: AbortSignal } = {}) => {
    setSidebarLoading(true);
    setSidebarError(undefined);
    try {
      const nextStats = await getUsageStats(activeProjectionUrl, { window: "today", signal: options.signal });
      setSidebarStats(nextStats);
      if (usageWindow === "today") setStats(nextStats);
    } catch (loadError) {
      if (!options.signal?.aborted) {
        setSidebarError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (!options.signal?.aborted) setSidebarLoading(false);
    }
  }, [activeProjectionUrl, usageWindow]);

  const loadStats = useCallback(async (selectedWindow: UsageWindow = usageWindow, options: { signal?: AbortSignal } = {}) => {
    setLoading(true);
    setError(undefined);
    try {
      const nextStats = await getUsageStats(activeProjectionUrl, { window: selectedWindow, signal: options.signal });
      setStats(nextStats);
      if (selectedWindow === "today") {
        setSidebarStats(nextStats);
        setSidebarError(undefined);
      }
    } catch (loadError) {
      if (!options.signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (!options.signal?.aborted) setLoading(false);
    }
  }, [activeProjectionUrl, usageWindow]);

  useEffect(() => {
    if (!isLive) return;
    const controller = new AbortController();
    void loadSidebarStats({ signal: controller.signal });
    const interval = window.setInterval(() => {
      void loadSidebarStats();
    }, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [isLive, loadSidebarStats, refreshKey]);

  useEffect(() => {
    if (!active || !isLive) return;
    const controller = new AbortController();
    void loadStats(usageWindow, { signal: controller.signal });
    return () => controller.abort();
  }, [active, isLive, loadStats, refreshKey, usageWindow]);

  const retry = useCallback(() => {
    void loadStats(usageWindow);
  }, [loadStats, usageWindow]);

  return {
    error,
    loading,
    retry,
    setWindow,
    sidebarError,
    sidebarLoading,
    sidebarStats,
    stats,
    window: usageWindow
  };
}
