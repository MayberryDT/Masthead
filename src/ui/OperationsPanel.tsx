import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import {
  getSettingsState,
  installCodexHooks,
  testCodexHooks,
  uninstallCodexHooks,
  type DataSummary,
  type SettingsStateDto
} from "../app/daemonClient";
import type { MastheadConnectionState } from "../app/connection/MastheadConnectionProvider";
import { ConfirmDialog } from "./ConfirmDialog";
import { EnrichmentSettings } from "./settings/EnrichmentSettings";
import { DangerZone } from "./settings/DangerZone";
import { HookSettings } from "./settings/HookSettings";
import { PrivacySettings } from "./settings/PrivacySettings";
import { StorageSettings } from "./settings/StorageSettings";
import { ConnectionRecoveryPanel } from "./ConnectionRecoveryPanel";

export type DeletionScopeKind = "project" | "session" | "runtime" | "host";

export type LocalDataStatus = {
  state:
    | "idle"
    | "confirm_delete"
    | "confirm_prune"
    | "confirm_scoped_delete"
    | "busy"
    | "exported"
    | "deleted"
    | "pruned"
    | "error";
  message?: string;
};

type Props = {
  baseUrl?: string;
  dataSummary?: DataSummary;
  deletionScopeKind?: DeletionScopeKind;
  deletionScopeTarget?: string;
  localDataStatus?: LocalDataStatus;
  settingsState?: SettingsStateDto;
  readOnly?: boolean;
  connection?: MastheadConnectionState;
  onReconnect?: () => void;
  onStartConnector?: () => void;
  onCancelLocalDataAction?: () => void;
  onDeletionScopeKindChange?: (kind: DeletionScopeKind) => void;
  onDeletionScopeTargetChange?: (target: string) => void;
  onExportLocalData?: () => void;
  onRequestPruneLocalData?: () => void;
  onConfirmPruneLocalData?: () => void;
  onRequestScopedDelete?: () => void;
  onConfirmScopedDelete?: () => void;
  onRequestDeleteLocalData?: () => void;
  onConfirmDeleteLocalData?: () => void;
};

export function OperationsPanel({
  baseUrl,
  connection,
  dataSummary,
  deletionScopeKind = "project",
  deletionScopeTarget = "",
  localDataStatus = { state: "idle" },
  onCancelLocalDataAction,
  onConfirmDeleteLocalData,
  onConfirmPruneLocalData,
  onConfirmScopedDelete,
  onDeletionScopeKindChange,
  onDeletionScopeTargetChange,
  onExportLocalData,
  onReconnect,
  onRequestDeleteLocalData,
  onRequestPruneLocalData,
  onRequestScopedDelete,
  onStartConnector,
  readOnly = false,
  settingsState
}: Props) {
  const [loadedSettings, setLoadedSettings] = useState<SettingsStateDto | undefined>();
  const [settingsError, setSettingsError] = useState<string>();
  const [hookBusy, setHookBusy] = useState(false);
  const [settingsLoadState, setSettingsLoadState] = useState<"loading" | "ready" | "error">(settingsState ? "ready" : "loading");
  const effectiveSettings = settingsState ?? loadedSettings;
  const effectiveSummary = dataSummary ?? effectiveSettings?.storage.dataSummary;
  const busy = localDataStatus.state === "busy" || hookBusy;

  const loadSettings = useCallback((signal?: AbortSignal) => {
    if (settingsState) return;
    setSettingsLoadState("loading");
    void getSettingsState(baseUrl, { signal })
      .then((settings) => {
        setLoadedSettings(settings);
        setSettingsError(undefined);
        setSettingsLoadState("ready");
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setSettingsError(error instanceof Error ? error.message : String(error));
        setSettingsLoadState("error");
      });
  }, [baseUrl, settingsState]);

  useEffect(() => {
    const controller = new AbortController();
    loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);

  const runHookAction = async (action: "install" | "uninstall" | "test") => {
    if (readOnly) {
      setSettingsError("This Masthead connection is read-only. Start the local writable collector before changing hook settings.");
      return;
    }
    setHookBusy(true);
    try {
      const hooks =
        action === "install"
          ? await installCodexHooks(baseUrl)
          : action === "uninstall"
            ? await uninstallCodexHooks(baseUrl)
            : await testCodexHooks(baseUrl);
      setLoadedSettings((current) => (current ? { ...current, hooks } : current));
      setSettingsError(undefined);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      setHookBusy(false);
    }
  };

  const openDataDirectory = async () => {
    const dataDirectory = effectiveSettings?.storage.dataDirectory ?? effectiveSettings?.data.dataDirectory;
    if (!dataDirectory) return;
    try {
      await tauriInvoke("open_data_directory_command", { path: dataDirectory });
      setSettingsError(undefined);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    }
  };

  const writesDisabled = busy || readOnly;
  const showSettingsSections = Boolean(effectiveSettings) || settingsLoadState !== "error";

  return (
    <section id="settings" className="settings-panel" aria-label="Settings">
      {connection && onReconnect && onStartConnector ? (
        <ConnectionRecoveryPanel connection={connection} onRetry={onReconnect} onStart={onStartConnector} retryLabel="Reconnect" />
      ) : null}
      {settingsError ? <p className="settings-error">{settingsError}</p> : null}
      {readOnly ? (
        <p className="settings-status error">Read-only connection: destructive data changes and hook writes are disabled.</p>
      ) : null}
      {settingsLoadState === "error" && !effectiveSettings ? (
        <div className="settings-recovery" role="alert">
          <h2>Settings unavailable</h2>
          <p>{settingsError ?? "Masthead settings could not be loaded."}</p>
          <button type="button" className="app-button app-button-primary metal-control" onClick={() => loadSettings()}>
            Retry settings
          </button>
        </div>
      ) : null}

      {showSettingsSections ? (
        <div className="settings-layout">
          <HookSettings
            busy={writesDisabled}
            hooks={effectiveSettings?.hooks}
            onInstall={() => void runHookAction("install")}
            onTest={() => void runHookAction("test")}
            onUninstall={() => void runHookAction("uninstall")}
          />
          <EnrichmentSettings enrichment={effectiveSettings?.enrichment} />
          <PrivacySettings privacy={effectiveSettings?.privacy} />
          <StorageSettings
            busy={busy}
            dataSummary={effectiveSummary}
            onOpenDataDirectory={openDataDirectory}
            onExport={onExportLocalData}
            onRequestPrune={onRequestPruneLocalData}
            settings={effectiveSettings}
            writeDisabled={writesDisabled}
          />
          <DangerZone
            busy={writesDisabled}
            databaseId={effectiveSettings?.data.databaseId}
            databasePath={effectiveSettings?.data.databasePath}
            deletionScopeKind={deletionScopeKind}
            deletionScopeTarget={deletionScopeTarget}
            onDeletionScopeKindChange={onDeletionScopeKindChange}
            onDeletionScopeTargetChange={onDeletionScopeTargetChange}
            onRequestDeleteAll={onRequestDeleteLocalData}
            onRequestScopedDelete={onRequestScopedDelete}
            targets={effectiveSettings?.deletionTargets}
          />
        </div>
      ) : null}

      <ConfirmDialog
        busy={writesDisabled}
        confirmLabel="Delete raw copies"
        description={localDataStatus.message}
        onCancel={onCancelLocalDataAction}
        onConfirm={onConfirmPruneLocalData}
        open={localDataStatus.state === "confirm_prune"}
        title="Confirm raw source copy deletion"
        tone="danger"
      />
      <ConfirmDialog
        busy={writesDisabled}
        confirmLabel="Delete selected records"
        description={localDataStatus.message}
        onCancel={onCancelLocalDataAction}
        onConfirm={onConfirmScopedDelete}
        open={localDataStatus.state === "confirm_scoped_delete"}
        title="Confirm scoped deletion"
        tone="danger"
      />
      <ConfirmDialog
        busy={writesDisabled}
        confirmLabel="Delete all Masthead data"
        description={localDataStatus.message}
        onCancel={onCancelLocalDataAction}
        onConfirm={onConfirmDeleteLocalData}
        open={localDataStatus.state === "confirm_delete"}
        title="Confirm delete all Masthead data"
        tone="danger"
      />

      {localDataStatus.message && !localDataStatus.state.startsWith("confirm") ? (
        <p className={`settings-status ${localDataStatus.state === "error" ? "error" : ""}`}>{localDataStatus.message}</p>
      ) : null}
    </section>
  );
}
