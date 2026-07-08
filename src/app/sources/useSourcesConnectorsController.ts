import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  /** Toolbar status next to Refresh only. */
  refreshStatus?: string;
  /** Per-connection action status shown on the card footer (Enable/Test/etc.). */
  cardActionStatus: Record<string, string>;
  /** Runtime currently running an action (if any). */
  actionRuntime?: string;
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
  return `Refreshed: ${found} found · ${ready} ready · ${needsAction} need action · ${notFound} not found.`;
}

function setCardStatus(
  setter: Dispatch<SetStateAction<Record<string, string>>>,
  runtime: string,
  message: string
): void {
  setter((prev) => ({ ...prev, [runtime]: message }));
}

export function useSourcesConnectorsController(
  activeProjectionUrl: string,
  options?: UseSourcesConnectorsControllerOptions
): UseSourcesConnectorsControllerResult {
  const readOnly = options?.readOnly ?? false;
  const autoLoad = options?.autoLoad ?? true;

  const [snapshot, setSnapshot] = useState<HarnessConnectorsSnapshotDto>();
  const [busy, setBusy] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string>();
  const [cardActionStatus, setCardActionStatus] = useState<Record<string, string>>({});
  const [actionRuntime, setActionRuntime] = useState<string | undefined>();
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
      setRefreshStatus(`Failed to load connections: ${errorMessage(error)}`);
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
    setRefreshStatus("Sources are read-only on this connection.");
    return false;
  }, [readOnly]);

  const discover = useCallback(async () => {
    setBusy(true);
    setActionRuntime(undefined);
    setRefreshStatus("Refreshing connections…");
    try {
      const next = await discoverHarnessConnectors(activeProjectionUrl);
      applySnapshot(next);
      setRefreshStatus(summarizeRefresh(next));
    } catch (error) {
      setRefreshStatus(`Refresh failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, applySnapshot]);

  const enable = useCallback(
    async (runtime: string) => {
      if (!guardWritable()) return;
      setBusy(true);
      setActionRuntime(runtime);
      setCardStatus(setCardActionStatus, runtime, "Enabling…");
      try {
        const next = await enableHarnessConnector(runtime, activeProjectionUrl);
        applySnapshot(next);
        const connector = next.connectors.find((row) => row.runtime === runtime);
        if (connector?.presence === "not_found") {
          setCardStatus(
            setCardActionStatus,
            runtime,
            connector.live === "ready" || connector.live === "needs_action"
              ? "Wired, but harness not found on this machine."
              : "Harness not found on this machine."
          );
        } else if (connector?.live === "ready") {
          setCardStatus(setCardActionStatus, runtime, "Enabled — ready.");
        } else if (connector?.live === "needs_action") {
          setCardStatus(
            setCardActionStatus,
            runtime,
            connector.actionMessage ?? "Installed — host activation still required."
          );
        } else if (connector?.live === "error") {
          setCardStatus(setCardActionStatus, runtime, connector.actionMessage ?? "Enable failed.");
        } else {
          setCardStatus(setCardActionStatus, runtime, "Not installed.");
        }
      } catch (error) {
        setCardStatus(setCardActionStatus, runtime, `Enable failed: ${errorMessage(error)}`);
      } finally {
        setActionRuntime(undefined);
        setBusy(false);
      }
    },
    [activeProjectionUrl, applySnapshot, guardWritable]
  );

  const enableAllDetected = useCallback(async () => {
    if (!guardWritable()) return;
    const current = snapshotRef.current;
    if (!current) {
      setRefreshStatus("Load connections before enabling.");
      return;
    }
    const targets = current.connectors.filter(
      (connector) => connector.presence === "found" && connector.live !== "ready"
    );
    if (targets.length === 0) {
      setRefreshStatus("No found harnesses need enabling.");
      return;
    }

    setBusy(true);
    setActionRuntime(undefined);
    setRefreshStatus(`Enabling ${targets.length} found harness${targets.length === 1 ? "" : "es"}…`);
    try {
      let next = current;
      for (const target of targets) {
        setActionRuntime(target.runtime);
        setCardStatus(setCardActionStatus, target.runtime, "Enabling…");
        next = await enableHarnessConnector(target.runtime, activeProjectionUrl);
        applySnapshot(next);
        const connector = next.connectors.find((row) => row.runtime === target.runtime);
        if (connector?.live === "ready") {
          setCardStatus(setCardActionStatus, target.runtime, "Enabled — ready.");
        } else if (connector?.live === "needs_action") {
          setCardStatus(
            setCardActionStatus,
            target.runtime,
            connector.actionMessage ?? "Host activation still required."
          );
        } else {
          setCardStatus(setCardActionStatus, target.runtime, "Enable finished.");
        }
      }
      setRefreshStatus(`Enable all complete: ${next.summary.ready} ready · ${next.summary.needsAction} need action.`);
    } catch (error) {
      setRefreshStatus(`Enable all failed: ${errorMessage(error)}`);
    } finally {
      setActionRuntime(undefined);
      setBusy(false);
    }
  }, [activeProjectionUrl, applySnapshot, guardWritable]);

  const test = useCallback(
    async (runtime: string) => {
      if (!guardWritable()) return;
      setBusy(true);
      setActionRuntime(runtime);
      setCardStatus(setCardActionStatus, runtime, "Testing…");
      try {
        const next = await testHarnessConnector(runtime, activeProjectionUrl);
        applySnapshot(next);
        const connector = next.connectors.find((row) => row.runtime === runtime);
        const lastTest = connector?.lastTest;
        if (lastTest?.status === "passed") {
          setCardStatus(setCardActionStatus, runtime, `Test passed — ${lastTest.message}`);
        } else if (lastTest?.status === "failed") {
          setCardStatus(setCardActionStatus, runtime, `Test failed — ${lastTest.message}`);
        } else {
          setCardStatus(setCardActionStatus, runtime, "Test finished with no result payload.");
        }
      } catch (error) {
        setCardStatus(setCardActionStatus, runtime, `Test failed: ${errorMessage(error)}`);
      } finally {
        setActionRuntime(undefined);
        setBusy(false);
      }
    },
    [activeProjectionUrl, applySnapshot, guardWritable]
  );

  const uninstall = useCallback(
    async (runtime: string) => {
      if (!guardWritable()) return;
      setBusy(true);
      setActionRuntime(runtime);
      setCardStatus(setCardActionStatus, runtime, "Uninstalling…");
      try {
        const next = await uninstallHarnessConnector(runtime, activeProjectionUrl);
        applySnapshot(next);
        setCardStatus(setCardActionStatus, runtime, "Uninstalled.");
      } catch (error) {
        setCardStatus(setCardActionStatus, runtime, `Uninstall failed: ${errorMessage(error)}`);
      } finally {
        setActionRuntime(undefined);
        setBusy(false);
      }
    },
    [activeProjectionUrl, applySnapshot, guardWritable]
  );

  const confirmActivation = useCallback(
    async (runtime: string) => {
      if (!guardWritable()) return;
      setBusy(true);
      setActionRuntime(runtime);
      setCardStatus(setCardActionStatus, runtime, "Confirming…");
      try {
        const next = await confirmHarnessConnectorActivation(runtime, activeProjectionUrl);
        applySnapshot(next);
        const connector = next.connectors.find((row) => row.runtime === runtime);
        if (connector?.live === "ready") {
          setCardStatus(setCardActionStatus, runtime, "Activation confirmed — ready.");
        } else {
          setCardStatus(
            setCardActionStatus,
            runtime,
            connector?.actionMessage ?? "Activation still pending."
          );
        }
      } catch (error) {
        setCardStatus(setCardActionStatus, runtime, `Confirm failed: ${errorMessage(error)}`);
      } finally {
        setActionRuntime(undefined);
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
    refreshStatus,
    cardActionStatus,
    actionRuntime,
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
