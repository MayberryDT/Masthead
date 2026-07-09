import { useCallback, useEffect, useState } from "react";
import { invokeDesktopCommand, isDesktopBridgeAvailable } from "../app/desktopBridge";
import {
  getSettingsState,
  type DataSummary,
  type SettingsStateDto
} from "../app/daemonClient";
import type { MastheadConnectionState } from "../app/connection/MastheadConnectionProvider";
import { ConfirmDialog } from "./ConfirmDialog";
import { AdvancedSettings } from "./settings/AdvancedSettings";
import { DangerZone } from "./settings/DangerZone";
import { McpSettings } from "./settings/McpSettings";
import { PreferencesSettings } from "./settings/PreferencesSettings";
import { SettingsCategoryNav, type SettingsCategory } from "./settings/SettingsCategoryNav";
import { StorageSettings } from "./settings/StorageSettings";
import { AppButton } from "./primitives/AppButton";

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
  motionDisabled?: boolean;
  sessionEndedNotificationsEnabled?: boolean;
  onSessionEndedNotificationsEnabledChange?: (enabled: boolean) => void;
  settingsError?: string;
  settingsLoadState?: "loading" | "ready" | "error";
  settingsState?: SettingsStateDto;
  readOnly?: boolean;
  connection?: MastheadConnectionState;
  onReconnect?: () => void;
  onStartConnector?: () => void;
  onCancelLocalDataAction?: () => void;
  onDeletionScopeKindChange?: (kind: DeletionScopeKind) => void;
  onDeletionScopeTargetChange?: (target: string) => void;
  onExportLocalData?: () => void;
  onMotionDisabledChange?: (disabled: boolean) => void;
  onReloadSettings?: () => void;
  onRequestPruneLocalData?: () => void;
  onConfirmPruneLocalData?: () => void;
  onRequestScopedDelete?: () => void;
  onConfirmScopedDelete?: () => void;
  onRequestDeleteLocalData?: () => void;
  onConfirmDeleteLocalData?: () => void;
};

export function OperationsPanel({
  baseUrl,
  dataSummary,
  deletionScopeKind = "project",
  deletionScopeTarget = "",
  localDataStatus = { state: "idle" },
  motionDisabled,
  sessionEndedNotificationsEnabled,
  onSessionEndedNotificationsEnabledChange,
  settingsError: controlledSettingsError,
  settingsLoadState: controlledSettingsLoadState,
  onCancelLocalDataAction,
  onConfirmDeleteLocalData,
  onConfirmPruneLocalData,
  onConfirmScopedDelete,
  onDeletionScopeKindChange,
  onDeletionScopeTargetChange,
  onExportLocalData,
  onMotionDisabledChange,
  onReloadSettings,
  onRequestDeleteLocalData,
  onRequestPruneLocalData,
  onRequestScopedDelete,
  readOnly = false,
  settingsState
}: Props) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("general");
  const [loadedSettings, setLoadedSettings] = useState<SettingsStateDto | undefined>();
  const [localSettingsError, setLocalSettingsError] = useState<string>();
  const [localSettingsLoadState, setLocalSettingsLoadState] = useState<"loading" | "ready" | "error">(settingsState ? "ready" : "loading");
  const settingsError = controlledSettingsError ?? localSettingsError;
  const settingsLoadState = controlledSettingsLoadState ?? localSettingsLoadState;
  const effectiveSettings = loadedSettings ?? settingsState;
  const effectiveSummary = dataSummary ?? effectiveSettings?.storage.dataSummary;
  const busy = localDataStatus.state === "busy";
  const settingsControlled = settingsState !== undefined || controlledSettingsLoadState !== undefined;

  const loadSettings = useCallback((signal?: AbortSignal) => {
    if (settingsControlled) {
      onReloadSettings?.();
      return;
    }
    setLocalSettingsLoadState("loading");
    void getSettingsState(baseUrl, { signal })
      .then((settings) => {
        setLoadedSettings(settings);
        setLocalSettingsError(undefined);
        setLocalSettingsLoadState("ready");
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setLocalSettingsError(error instanceof Error ? error.message : String(error));
        setLocalSettingsLoadState("error");
      });
  }, [baseUrl, onReloadSettings, settingsControlled]);

  useEffect(() => {
    if (settingsControlled) return undefined;
    const controller = new AbortController();
    loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings, settingsControlled]);

  const openDataDirectory = async () => {
    const dataDirectory = effectiveSettings?.storage.dataDirectory ?? effectiveSettings?.data.dataDirectory;
    if (!dataDirectory) return;
    try {
      if (!isDesktopBridgeAvailable()) {
        throw new Error("Opening the data directory requires the Masthead desktop app.");
      }
      await invokeDesktopCommand<void>("open_data_directory_command", { path: dataDirectory });
      setLocalSettingsError(undefined);
    } catch (error) {
      setLocalSettingsError(error instanceof Error ? error.message : String(error));
    }
  };

  const writesDisabled = busy || readOnly;
  const showSettingsSections = Boolean(effectiveSettings) || settingsLoadState !== "error";
  const localOnlyDeletionNote =
    "Deletes Masthead's local canonical data only. Original source harness files are not modified.";

  return (
    <section id="settings" className="settings-panel" aria-label="Settings">
      {settingsError ? <p className="settings-error">{settingsError}</p> : null}
      {settingsLoadState === "error" && !effectiveSettings ? (
        <div className="settings-recovery connection-recovery observability-toolbar metal-toolbar offline" role="alert">
          <h2>Settings unavailable</h2>
          <p>{settingsError ?? "Masthead settings could not be loaded."}</p>
          <AppButton variant="primary" onClick={() => loadSettings()}>
            Retry settings
          </AppButton>
        </div>
      ) : null}

      {showSettingsSections ? (
        <div className="settings-workspace">
          <SettingsCategoryNav active={activeCategory} onChange={setActiveCategory} />
          <div className="settings-pane" data-settings-category={activeCategory}>
            {activeCategory === "general" ? (
              <PreferencesSettings
                motionDisabled={motionDisabled}
                onMotionDisabledChange={onMotionDisabledChange}
                sessionEndedNotificationsEnabled={sessionEndedNotificationsEnabled}
                onSessionEndedNotificationsEnabledChange={onSessionEndedNotificationsEnabledChange}
              />
            ) : null}
            {activeCategory === "data" ? (
              <StorageSettings
                busy={busy}
                dataSummary={effectiveSummary}
                onOpenDataDirectory={openDataDirectory}
                onExport={onExportLocalData}
                onRequestPrune={onRequestPruneLocalData}
                settings={effectiveSettings}
                writeDisabled={writesDisabled}
              />
            ) : null}
            {activeCategory === "agent-access" ? (
              <McpSettings baseUrl={baseUrl} privacy={effectiveSettings?.privacy} />
            ) : null}
            {activeCategory === "advanced" ? <AdvancedSettings settings={effectiveSettings} /> : null}
            {activeCategory === "danger" ? (
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
            ) : null}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        busy={writesDisabled}
        confirmLabel="Delete raw copies"
        description={localDataStatus.message}
        onCancel={onCancelLocalDataAction}
        onConfirm={onConfirmPruneLocalData}
        open={localDataStatus.state === "confirm_prune"}
        safetyNote={localOnlyDeletionNote}
        title="Confirm raw source copy deletion"
        tone="danger"
      />
      <ConfirmDialog
        busy={writesDisabled}
        confirmLabel="Delete selected records"
        description={localDataStatus.message}
        expectedConfirmation={deletionScopeTarget.trim() || undefined}
        onCancel={onCancelLocalDataAction}
        onConfirm={onConfirmScopedDelete}
        open={localDataStatus.state === "confirm_scoped_delete"}
        safetyNote={localOnlyDeletionNote}
        title="Confirm scoped deletion"
        tone="danger"
      />
      <ConfirmDialog
        busy={writesDisabled}
        confirmLabel="Delete all Masthead data"
        description={localDataStatus.message}
        expectedConfirmation={effectiveSettings?.data.databaseId}
        onCancel={onCancelLocalDataAction}
        onConfirm={onConfirmDeleteLocalData}
        open={localDataStatus.state === "confirm_delete"}
        safetyNote={localOnlyDeletionNote}
        title="Confirm delete all Masthead data"
        tone="danger"
      />

      {localDataStatus.message && !localDataStatus.state.startsWith("confirm") ? (
        <p className={`settings-status ${localDataStatus.state === "error" ? "error" : ""}`}>{localDataStatus.message}</p>
      ) : null}
    </section>
  );
}
