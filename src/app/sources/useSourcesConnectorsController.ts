import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmHarnessConnectorActivation,
  discoverHarnessConnectors,
  enableHarnessConnector,
  listHarnessConnectors,
  testHarnessConnector,
  uninstallHarnessConnector,
  type HarnessConnectorsSnapshotDto
} from "../daemonClient";
import { readOnboardingDismissed, writeOnboardingDismissed } from "../onboardingPreference";

export type UseSourcesConnectorsControllerOptions = {
  readOnly?: boolean;
  /** When true (default), load connectors on mount and when the projection URL changes. */
  autoLoad?: boolean;
};

export type UseSourcesConnectorsControllerResult = {
  snapshot?: HarnessConnectorsSnapshotDto;
  busy: boolean;
  status?: string;
  selectedRuntime?: string;
  onboardingOpen: boolean;
  setSelectedRuntime: (runtime: string | undefined) => void;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  skipOnboarding: () => void;
  load: () => Promise<void>;
  discover: () => Promise<void>;
  enable: (runtime: string) => Promise<void>;
  enableAllDetected: () => Promise<void>;
  test: (runtime: string) => Promise<void>;
  uninstall: (runtime: string) => Promise<void>;
  confirmActivation: (runtime: string) => Promise<void>;
};

function shouldOpenFirstRunOnboarding(snapshot: HarnessConnectorsSnapshotDto): boolean {
  return snapshot.summary.ready === 0 && snapshot.connectors.some((connector) => connector.presence === "found");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeRefresh(snapshot: HarnessConnectorsSnapshotDto): string {
  const found = snapshot.connectors.filter((connector) => connector.presence === "found").length;
  const { ready, needsAction, notFound } = snapshot.summary;
  return `Refreshed connections: ${found} found · ${ready} ready · ${needsAction} need action · ${notFound} not found.`;
}

export function useSourcesConnectorsController(
  activeProjectionUrl: string,
  options?: UseSourcesConnectorsControllerOptions
): UseSourcesConnectorsControllerResult {
  const readOnly = options?.readOnly ?? false;
  const autoLoad = options?.autoLoad ?? true;

  const [snapshot, setSnapshot] = useState<HarnessConnectorsSnapshotDto>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [selectedRuntime, setSelectedRuntime] = useState<string | undefined>();
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => readOnboardingDismissed());
  const [manualOnboardingOpen, setManualOnboardingOpen] = useState(false);
  const [autoOnboardingEligible, setAutoOnboardingEligible] = useState(false);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const loadGenerationRef = useRef(0);

  const applySnapshot = useCallback((next: HarnessConnectorsSnapshotDto) => {
    setSnapshot(next);
    snapshotRef.current = next;
    if (!readOnboardingDismissed() && shouldOpenFirstRunOnboarding(next)) {
      setAutoOnboardingEligible(true);
    } else if (next.summary.ready > 0) {
      setAutoOnboardingEligible(false);
    }
  }, []);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setBusy(true);
    try {
      const next = await listHarnessConnectors(activeProjectionUrl);
      if (generation !== loadGenerationRef.current) return;
      applySnapshot(next);
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      setStatus(`Failed to load connectors: ${errorMessage(error)}`);
    } finally {
      if (generation === loadGenerationRef.current) setBusy(false);
    }
  }, [activeProjectionUrl, applySnapshot]);

  useEffect(() => {
    if (!autoLoad) return;
    void load();
  }, [autoLoad, load]);

  const guardWritable = useCallback((): boolean => {
    if (!readOnly) return true;
    setStatus("Sources are read-only on this connection.");
    return false;
  }, [readOnly]);

  const discover = useCallback(async () => {
    // Refresh = re-check harness presence + live connection status only (no history import).
    setBusy(true);
    setStatus("Refreshing connections…");
    try {
      const next = await discoverHarnessConnectors(activeProjectionUrl);
      applySnapshot(next);
      setStatus(summarizeRefresh(next));
    } catch (error) {
      setStatus(`Refresh failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, applySnapshot]);

  const enable = useCallback(
    async (runtime: string) => {
      if (!guardWritable()) return;
      setBusy(true);
      setStatus(`Enabling ${runtime}...`);
      try {
        const next = await enableHarnessConnector(runtime, activeProjectionUrl);
        applySnapshot(next);
        const connector = next.connectors.find((row) => row.runtime === runtime);
        if (connector?.live === "ready") {
          setStatus(`${connector.label} is ready.`);
        } else if (connector?.live === "needs_action") {
          setStatus(
            `${connector.label} installed — ${connector.actionMessage ?? "host activation still required."}`
          );
        } else if (connector?.live === "error") {
          setStatus(`${connector.label} enable failed: ${connector.actionMessage ?? "unknown error."}`);
        } else {
          setStatus(`Enabled ${runtime}.`);
        }
      } catch (error) {
        setStatus(`Enable ${runtime} failed: ${errorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [activeProjectionUrl, applySnapshot, guardWritable]
  );

  const enableAllDetected = useCallback(async () => {
    if (!guardWritable()) return;
    const current = snapshotRef.current;
    if (!current) {
      setStatus("Load connectors before enabling.");
      return;
    }
    const targets = current.connectors.filter(
      (connector) => connector.presence === "found" && connector.live !== "ready"
    );
    if (targets.length === 0) {
      setStatus("No detected harnesses need enabling.");
      return;
    }

    setBusy(true);
    setStatus(`Enabling ${targets.length} detected harness${targets.length === 1 ? "" : "es"}...`);
    try {
      let next = current;
      for (const target of targets) {
        next = await enableHarnessConnector(target.runtime, activeProjectionUrl);
        applySnapshot(next);
      }
      const ready = next.summary.ready;
      const needsAction = next.summary.needsAction;
      setStatus(`Enable all complete: ${ready} ready · ${needsAction} need action.`);
    } catch (error) {
      setStatus(`Enable all failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, applySnapshot, guardWritable]);

  const test = useCallback(
    async (runtime: string) => {
      if (!guardWritable()) return;
      setBusy(true);
      setStatus(`Testing ${runtime}...`);
      try {
        const next = await testHarnessConnector(runtime, activeProjectionUrl);
        applySnapshot(next);
        const connector = next.connectors.find((row) => row.runtime === runtime);
        const lastTest = connector?.lastTest;
        if (lastTest?.status === "passed") {
          setStatus(`${connector?.label ?? runtime} test passed.`);
        } else if (lastTest?.status === "failed") {
          setStatus(`${connector?.label ?? runtime} test failed: ${lastTest.message}`);
        } else {
          setStatus(`Test requested for ${runtime}.`);
        }
      } catch (error) {
        setStatus(`Test ${runtime} failed: ${errorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [activeProjectionUrl, applySnapshot, guardWritable]
  );

  const uninstall = useCallback(
    async (runtime: string) => {
      if (!guardWritable()) return;
      setBusy(true);
      setStatus(`Uninstalling ${runtime}...`);
      try {
        const next = await uninstallHarnessConnector(runtime, activeProjectionUrl);
        applySnapshot(next);
        const connector = next.connectors.find((row) => row.runtime === runtime);
        setStatus(`Uninstalled ${connector?.label ?? runtime}.`);
      } catch (error) {
        setStatus(`Uninstall ${runtime} failed: ${errorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [activeProjectionUrl, applySnapshot, guardWritable]
  );

  const confirmActivation = useCallback(
    async (runtime: string) => {
      if (!guardWritable()) return;
      setBusy(true);
      setStatus(`Confirming activation for ${runtime}...`);
      try {
        const next = await confirmHarnessConnectorActivation(runtime, activeProjectionUrl);
        applySnapshot(next);
        const connector = next.connectors.find((row) => row.runtime === runtime);
        if (connector?.live === "ready") {
          setStatus(`${connector.label} activation confirmed — ready.`);
        } else {
          setStatus(
            `${connector?.label ?? runtime}: ${connector?.actionMessage ?? "activation still pending."}`
          );
        }
      } catch (error) {
        setStatus(`Confirm activation for ${runtime} failed: ${errorMessage(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [activeProjectionUrl, applySnapshot, guardWritable]
  );

  const openOnboarding = useCallback(() => {
    setOnboardingDismissed(false);
    writeOnboardingDismissed(false);
    setManualOnboardingOpen(true);
  }, []);

  const closeOnboarding = useCallback(() => {
    setManualOnboardingOpen(false);
    setOnboardingDismissed(true);
    setAutoOnboardingEligible(false);
    writeOnboardingDismissed(true);
  }, []);

  const skipOnboarding = useCallback(() => {
    setManualOnboardingOpen(false);
    setOnboardingDismissed(true);
    setAutoOnboardingEligible(false);
    writeOnboardingDismissed(true);
  }, []);

  const onboardingOpen =
    manualOnboardingOpen || (!readOnly && !onboardingDismissed && autoOnboardingEligible);

  return {
    snapshot,
    busy,
    status,
    selectedRuntime,
    onboardingOpen,
    setSelectedRuntime,
    openOnboarding,
    closeOnboarding,
    skipOnboarding,
    load,
    discover,
    enable,
    enableAllDetected,
    test,
    uninstall,
    confirmActivation
  };
}
