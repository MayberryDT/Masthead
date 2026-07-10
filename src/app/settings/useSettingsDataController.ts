import { useCallback, useEffect, useState } from "react";
import type { ReviewDisposition } from "../../core/store";
import type { DeletionScopeKind, LocalDataStatus } from "../../ui/OperationsPanel";
import type { MastheadConnectionState } from "../connection/MastheadConnectionProvider";
import {
  applyDefaultRetention,
  deleteMastheadData,
  exportMastheadData,
  getDataSummary,
  getSettingsState,
  listReviewDispositions,
  updateLlmProviderSettings,
  type DataSummary,
  type DeleteMastheadDataScope,
  type SettingsStateDto,
  type UpdateLlmProviderSettingsInput
} from "../daemonClient";
import { exportedRecordCount, exportLocalData as exportNativeLocalData } from "../nativeStoreClient";

type UseSettingsDataControllerOptions = {
  activeProjectionUrl: string;
  connectionState: MastheadConnectionState;
  isLive: boolean;
  onCanonicalDataDeleted: () => void;
  onReviewDispositionsChanged: (dispositions: ReviewDisposition[]) => void;
  writable: boolean;
};

export function useSettingsDataController({
  activeProjectionUrl,
  connectionState,
  isLive,
  onCanonicalDataDeleted,
  onReviewDispositionsChanged,
  writable
}: UseSettingsDataControllerOptions) {
  const [localDataStatus, setLocalDataStatus] = useState<LocalDataStatus>({ action: "none", state: "idle" });
  const [dataSummary, setDataSummary] = useState<DataSummary>();
  const [deletionScopeKind, setDeletionScopeKind] = useState<DeletionScopeKind>("project");
  const [deletionScopeTarget, setDeletionScopeTarget] = useState("");
  const [pendingDeletionScope, setPendingDeletionScope] = useState<DeleteMastheadDataScope>();
  const [pendingDeletionDatabaseId, setPendingDeletionDatabaseId] = useState<string>();
  const [settingsState, setSettingsState] = useState<SettingsStateDto>();
  const [settingsError, setSettingsError] = useState<string>();
  const [settingsLoadState, setSettingsLoadState] = useState<"loading" | "ready" | "error">("loading");
  const activeDatabaseId = databaseIdFromConnection(connectionState);
  const writeBlockedMessage =
    "This Masthead connection is read-only. Start the local writable collector before changing settings or deleting data.";

  const loadSettingsState = useCallback(async (signal?: AbortSignal) => {
    setSettingsLoadState("loading");
    try {
      const settings = await getSettingsState(activeProjectionUrl, { signal });
      if (signal?.aborted) return;
      setSettingsState(settings);
      setSettingsError(undefined);
      setSettingsLoadState("ready");
    } catch (error) {
      if (signal?.aborted) return;
      setSettingsError(error instanceof Error ? error.message : String(error));
      setSettingsLoadState("error");
    }
  }, [activeProjectionUrl]);

  useEffect(() => {
    if (!isLive) return;
    const controller = new AbortController();
    void loadSettingsState(controller.signal);
    return () => controller.abort();
  }, [isLive, loadSettingsState]);

  const saveLlmProviderSettings = useCallback(async (input: UpdateLlmProviderSettingsInput) => {
    if (!writable) throw new Error(writeBlockedMessage);
    const nextSettings = await updateLlmProviderSettings(input, activeProjectionUrl);
    setSettingsState(nextSettings);
    setSettingsError(undefined);
    setSettingsLoadState("ready");
  }, [activeProjectionUrl, writable, writeBlockedMessage]);

  useEffect(() => {
    let cancelled = false;

    const hydrateLocalData = async () => {
      try {
        const dispositions = await listReviewDispositions(activeProjectionUrl).catch(() => []);
        if (!cancelled) {
          onReviewDispositionsChanged(dispositions);
        }
      } catch (error) {
        if (!cancelled) {
          setLocalDataStatus({
            action: "none",
            state: "error",
            message: `Local history unavailable: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      }
    };

    void hydrateLocalData();
    return () => {
      cancelled = true;
    };
  }, [activeProjectionUrl, onReviewDispositionsChanged]);

  const resetPendingDeletion = useCallback(() => {
    setPendingDeletionScope(undefined);
    setPendingDeletionDatabaseId(undefined);
  }, []);

  const cancelLocalDataAction = useCallback(() => {
    setLocalDataStatus({ action: "none", state: "idle" });
    resetPendingDeletion();
  }, [resetPendingDeletion]);

  const changeDeletionScopeKind = useCallback((kind: DeletionScopeKind) => {
    setDeletionScopeKind(kind);
    setPendingDeletionScope(undefined);
    setPendingDeletionDatabaseId(undefined);
  }, []);

  const changeDeletionScopeTarget = useCallback((target: string) => {
    setDeletionScopeTarget(target);
    setPendingDeletionScope(undefined);
    setPendingDeletionDatabaseId(undefined);
  }, []);

  const handleExportLocalData = useCallback(async () => {
    setLocalDataStatus({ action: "export", state: "busy", message: "Preparing local export..." });
    try {
      const canonicalExport = isLive ? await exportMastheadData(activeProjectionUrl, { databaseId: activeDatabaseId }) : undefined;
      const exported = canonicalExport ? JSON.stringify(canonicalExport, null, 2) : await exportNativeLocalData();
      const count = canonicalExport ? exportedSessionCount(canonicalExport) : exportedRecordCount(exported);
      downloadTextFile(`masthead-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, exported);
      setLocalDataStatus({
        action: "export",
        state: "exported",
        message: count === undefined ? "Local export prepared." : `Exported ${count} Masthead records.`
      });
    } catch (error) {
      setLocalDataStatus({
        action: "export",
        state: "error",
        message: `Export failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }, [activeDatabaseId, activeProjectionUrl, isLive]);

  const loadDataDeletionPreview = useCallback(async (scope?: DeleteMastheadDataScope, databaseId = activeDatabaseId): Promise<DataSummary> => {
    const summary = await getDataSummary(activeProjectionUrl, scope, { databaseId });
    setDataSummary(summary);
    return summary;
  }, [activeDatabaseId, activeProjectionUrl]);

  const handleRequestDeleteLocalData = useCallback(async () => {
    if (!writable) {
      setLocalDataStatus({ action: "delete_all", state: "error", message: writeBlockedMessage });
      return;
    }
    setLocalDataStatus({ action: "delete_all", state: "busy", message: "Preparing delete-all preview..." });
    try {
      const summary = await loadDataDeletionPreview(undefined, activeDatabaseId);
      setPendingDeletionDatabaseId(activeDatabaseId);
      setLocalDataStatus({
        action: "delete_all",
        state: "confirm_delete",
        message: `Confirm delete all Masthead data: ${formatCount(summary.sessions)} sessions, ${formatCount(
          summary.rawEvents
        )} raw source copies, ${formatCount(summary.enrichments)} enrichments, and ${formatCount(
          summary.auditRows
        )} MCP audit rows. Original source harness files remain untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        action: "delete_all",
        state: "error",
        message: `Delete preview failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }, [activeDatabaseId, loadDataDeletionPreview, writable, writeBlockedMessage]);

  const handleRequestPruneLocalData = useCallback(async () => {
    if (!writable) {
      setLocalDataStatus({ action: "raw_copies", state: "error", message: writeBlockedMessage });
      return;
    }
    setLocalDataStatus({ action: "raw_copies", state: "busy", message: "Preparing raw source copy preview..." });
    try {
      const summary = await loadDataDeletionPreview(undefined, activeDatabaseId);
      setPendingDeletionDatabaseId(activeDatabaseId);
      setLocalDataStatus({
        action: "raw_copies",
        state: "confirm_prune",
        message: `Confirm deletion of ${formatCount(
          summary.rawEvents
        )} raw source copies. Normalized session metadata, summaries, and search records stay available.`
      });
    } catch (error) {
      setLocalDataStatus({
        action: "raw_copies",
        state: "error",
        message: `Raw source copy preview failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }, [activeDatabaseId, loadDataDeletionPreview, writable, writeBlockedMessage]);

  const handleConfirmPruneLocalData = useCallback(async () => {
    if (!writable) {
      setLocalDataStatus({ action: "raw_copies", state: "error", message: writeBlockedMessage });
      return;
    }
    setLocalDataStatus({ action: "raw_copies", state: "busy", message: "Deleting raw source copies..." });
    try {
      const response = await applyDefaultRetention(activeProjectionUrl, { databaseId: pendingDeletionDatabaseId ?? activeDatabaseId });
      const dispositions = await listReviewDispositions(activeProjectionUrl);
      onReviewDispositionsChanged(dispositions);
      setDataSummary(response.summary);
      setPendingDeletionDatabaseId(undefined);
      setLocalDataStatus({
        action: "raw_copies",
        state: "pruned",
        message: `Deleted ${formatCount(
          response.result.rawEvents ?? 0
        )} raw source copies. Normalized sessions, summaries, and search records kept. Original source harness files untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        action: "raw_copies",
        state: "error",
        message: `Retention failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }, [
    activeDatabaseId,
    activeProjectionUrl,
    onReviewDispositionsChanged,
    pendingDeletionDatabaseId,
    writable,
    writeBlockedMessage
  ]);

  const selectedDeletionScope = useCallback((): DeleteMastheadDataScope | undefined => {
    const target = deletionScopeTarget.trim();
    if (!target) return undefined;
    if (deletionScopeKind === "session") return { kind: "session", sessionId: target };
    if (deletionScopeKind === "runtime") return { kind: "runtime", runtime: target };
    if (deletionScopeKind === "host") return { kind: "host", host: target };
    return { kind: "project", project: target };
  }, [deletionScopeKind, deletionScopeTarget]);

  const handleRequestScopedDelete = useCallback(async () => {
    if (!writable) {
      setLocalDataStatus({ action: "scoped_delete", state: "error", message: writeBlockedMessage });
      return;
    }
    const scope = selectedDeletionScope();
    if (!scope) {
      setLocalDataStatus({ action: "scoped_delete", state: "error", message: "Choose a deletion scope and target before deleting records." });
      return;
    }
    setLocalDataStatus({ action: "scoped_delete", state: "busy", message: "Preparing scoped deletion preview..." });
    try {
      const summary = await loadDataDeletionPreview(scope, activeDatabaseId);
      setPendingDeletionScope(scope);
      setPendingDeletionDatabaseId(activeDatabaseId);
      setLocalDataStatus({
        action: "scoped_delete",
        state: "confirm_scoped_delete",
        message: `Confirm scoped deletion for ${scopeLabel(scope)}: ${formatCount(
          summary.sessions
        )} sessions, ${formatCount(summary.messages)} searchable messages, and ${formatCount(
          summary.enrichments
        )} enrichments. Original source harness files are untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        action: "scoped_delete",
        state: "error",
        message: `Scoped delete preview failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }, [activeDatabaseId, loadDataDeletionPreview, selectedDeletionScope, writable, writeBlockedMessage]);

  const handleConfirmScopedDelete = useCallback(async () => {
    if (!writable) {
      setLocalDataStatus({ action: "scoped_delete", state: "error", message: writeBlockedMessage });
      return;
    }
    const scope = pendingDeletionScope ?? selectedDeletionScope();
    if (!scope) {
      setLocalDataStatus({ action: "scoped_delete", state: "error", message: "Choose a deletion scope and target before deleting records." });
      return;
    }
    setLocalDataStatus({ action: "scoped_delete", state: "busy", message: `Deleting Masthead records for ${scopeLabel(scope)}...` });
    try {
      const response = await deleteMastheadData(scope, activeProjectionUrl, { databaseId: pendingDeletionDatabaseId ?? activeDatabaseId });
      setDataSummary(response.summary);
      setPendingDeletionScope(undefined);
      setPendingDeletionDatabaseId(undefined);
      setLocalDataStatus({
        action: "scoped_delete",
        state: "deleted",
        message: `Deleted ${formatCount(response.result.sessions ?? 0)} sessions for ${scopeLabel(
          scope
        )}. Original source harness files remain untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        action: "scoped_delete",
        state: "error",
        message: `Scoped delete failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }, [
    activeDatabaseId,
    activeProjectionUrl,
    pendingDeletionDatabaseId,
    pendingDeletionScope,
    selectedDeletionScope,
    writable,
    writeBlockedMessage
  ]);

  const handleConfirmDeleteLocalData = useCallback(async () => {
    if (!writable) {
      setLocalDataStatus({ action: "delete_all", state: "error", message: writeBlockedMessage });
      return;
    }
    setLocalDataStatus({ action: "delete_all", state: "busy", message: "Deleting canonical Masthead data..." });
    try {
      const response = await deleteMastheadData({ kind: "all" }, activeProjectionUrl, {
        databaseId: pendingDeletionDatabaseId ?? activeDatabaseId
      });
      onReviewDispositionsChanged([]);
      setDataSummary(response.summary);
      onCanonicalDataDeleted();
      setPendingDeletionDatabaseId(undefined);
      setLocalDataStatus({
        action: "delete_all",
        state: "deleted",
        message: `Deleted ${formatCount(response.result.sessions ?? 0)} sessions, ${formatCount(
          response.result.rawEvents ?? 0
        )} raw source copies, ${formatCount(response.result.enrichments ?? 0)} enrichments, and ${formatCount(
          response.result.auditRows ?? 0
        )} MCP audit rows. Original source harness files remain untouched.`
      });
    } catch (error) {
      setLocalDataStatus({
        action: "delete_all",
        state: "error",
        message: `Delete failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }, [
    activeDatabaseId,
    activeProjectionUrl,
    onCanonicalDataDeleted,
    onReviewDispositionsChanged,
    pendingDeletionDatabaseId,
    writable,
    writeBlockedMessage
  ]);

  return {
    cancelLocalDataAction,
    changeDeletionScopeKind,
    changeDeletionScopeTarget,
    confirmDeleteLocalData: handleConfirmDeleteLocalData,
    confirmPruneLocalData: handleConfirmPruneLocalData,
    confirmScopedDelete: handleConfirmScopedDelete,
    dataSummary,
    deletionScopeKind,
    deletionScopeTarget,
    exportLocalData: handleExportLocalData,
    localDataStatus,
    requestDeleteLocalData: handleRequestDeleteLocalData,
    requestPruneLocalData: handleRequestPruneLocalData,
    requestScopedDelete: handleRequestScopedDelete,
    loadSettingsState,
    saveLlmProviderSettings,
    settingsError,
    settingsLoadState,
    settingsState
  };
}

function databaseIdFromConnection(connectionState: MastheadConnectionState): string | undefined {
  return connectionState.state === "ready" || connectionState.state === "read_only" ? connectionState.health.data?.databaseId : undefined;
}

function exportedSessionCount(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("sessions" in value)) return undefined;
  const sessions = value.sessions;
  return Array.isArray(sessions) ? sessions.length : undefined;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function scopeLabel(scope: DeleteMastheadDataScope): string {
  if (scope.kind === "session") return `session ${scope.sessionId}`;
  if (scope.kind === "runtime") return `runtime ${scope.runtime}`;
  if (scope.kind === "host") return `host ${scope.host}`;
  if (scope.kind === "project") return `project ${scope.project}`;
  if (scope.kind === "raw_payloads") return "raw source copies";
  return "all Masthead data";
}

function downloadTextFile(filename: string, contents: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
