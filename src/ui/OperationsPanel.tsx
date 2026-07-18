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
import { OnboardingSettings } from "./settings/OnboardingSettings";
import type { SettingsFeedback } from "./settings/SettingsActionFeedback";
import { SettingsSpineCard } from "./settings/SettingsSpineCard";
import { StorageSettings } from "./settings/StorageSettings";
import { AppButton } from "./primitives/AppButton";

export type DeletionScopeKind = "project" | "session" | "runtime" | "host";
export type LocalDataAction = "none" | "export" | "raw_copies" | "scoped_delete" | "delete_all";

export type LocalDataStatus = {
  action: LocalDataAction;
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
  keepRunningInTray?: boolean;
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
  onKeepRunningInTrayChange?: (enabled: boolean) => void;
  onMotionDisabledChange?: (disabled: boolean) => void;
  onOpenOnboarding?: () => void;
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
  localDataStatus = { action: "none", state: "idle" },
  keepRunningInTray,
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
  onKeepRunningInTrayChange,
  onMotionDisabledChange,
  onOpenOnboarding,
  onReloadSettings,
  onRequestDeleteLocalData,
  onRequestPruneLocalData,
  onRequestScopedDelete,
  readOnly = false,
  settingsState
}: Props) {
  const [loadedSettings, setLoadedSettings] = useState<SettingsStateDto | undefined>();
  const [localSettingsError, setLocalSettingsError] = useState<string>();
  const [localSettingsLoadState, setLocalSettingsLoadState] = useState<"loading" | "ready" | "error">(settingsState ? "ready" : "loading");
  const [openDataDirectoryFeedback, setOpenDataDirectoryFeedback] = useState<SettingsFeedback>();
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
    setOpenDataDirectoryFeedback({ message: "Opening data folder…" });
    try {
      if (!isDesktopBridgeAvailable()) {
        throw new Error("Opening the data directory requires the Masthead desktop app.");
      }
      await invokeDesktopCommand<void>("open_data_directory_command", { path: dataDirectory });
      setOpenDataDirectoryFeedback({ message: "Opened data folder.", tone: "success" });
    } catch (error) {
      setOpenDataDirectoryFeedback({
        message: error instanceof Error ? error.message : String(error),
        tone: "error"
      });
    }
  };

  const writesDisabled = busy || readOnly;
  const showSettingsSections = Boolean(effectiveSettings) || settingsLoadState !== "error";
  const localOnlyDeletionNote =
    "Deletes Masthead's local canonical data only. Original source harness files are not modified.";
  const exportFeedback = actionFeedback(localDataStatus, "export");
  const rawCopiesFeedback = actionFeedback(localDataStatus, "raw_copies");
  const scopedDeleteFeedback = actionFeedback(localDataStatus, "scoped_delete");
  const deleteAllFeedback = actionFeedback(localDataStatus, "delete_all");

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
          <SettingsSpineCard
            keepRunningInTray={keepRunningInTray}
            motionDisabled={motionDisabled}
            onMotionDisabledChange={onMotionDisabledChange}
            onKeepRunningInTrayChange={onKeepRunningInTrayChange}
            onSessionEndedNotificationsEnabledChange={onSessionEndedNotificationsEnabledChange}
            sessionEndedNotificationsEnabled={sessionEndedNotificationsEnabled}
          >
            <StorageSettings
              busy={busy}
              dataSummary={effectiveSummary}
              onOpenDataDirectory={openDataDirectory}
              onExport={onExportLocalData}
              onRequestPrune={onRequestPruneLocalData}
              exportFeedback={exportFeedback}
              openDataDirectoryFeedback={openDataDirectoryFeedback}
              rawCopiesFeedback={rawCopiesFeedback}
              settings={effectiveSettings}
              writeDisabled={writesDisabled}
            />
            <OnboardingSettings onOpenOnboarding={onOpenOnboarding} readOnly={readOnly} />
            <McpSettings baseUrl={baseUrl} privacy={effectiveSettings?.privacy} />
            <AdvancedSettings settings={effectiveSettings} />
            <DangerZone
              busy={writesDisabled}
              databaseId={effectiveSettings?.data.databaseId}
              deletionScopeKind={deletionScopeKind}
              deletionScopeTarget={deletionScopeTarget}
              onDeletionScopeKindChange={onDeletionScopeKindChange}
              onDeletionScopeTargetChange={onDeletionScopeTargetChange}
              onRequestDeleteAll={onRequestDeleteLocalData}
              onRequestScopedDelete={onRequestScopedDelete}
              deleteAllFeedback={deleteAllFeedback}
              scopedDeleteFeedback={scopedDeleteFeedback}
              targets={effectiveSettings?.deletionTargets}
            />
          </SettingsSpineCard>
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

    </section>
  );
}

function actionFeedback(
  status: LocalDataStatus,
  action: Exclude<LocalDataAction, "none">
): SettingsFeedback | undefined {
  if (!status.message || status.state.startsWith("confirm")) return undefined;
  if (status.action !== action) return undefined;
  return {
    message: status.message,
    tone:
      status.state === "error"
        ? "error"
        : status.state === "exported" || status.state === "pruned" || status.state === "deleted"
          ? "success"
          : undefined
  };
}
