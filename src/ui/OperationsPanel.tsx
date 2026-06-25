import { useCallback, useEffect, useState } from "react";
import {
  getSettingsState,
  installCodexHooks,
  testCodexHooks,
  uninstallCodexHooks,
  type DataSummary,
  type SettingsStateDto
} from "../app/daemonClient";
import { ConfirmDialog } from "./ConfirmDialog";
import { EnrichmentSettings } from "./settings/EnrichmentSettings";
import { DangerZone } from "./settings/DangerZone";
import { HookSettings } from "./settings/HookSettings";
import { PrivacySettings } from "./settings/PrivacySettings";
import { StorageSettings } from "./settings/StorageSettings";

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
  dataSummary?: DataSummary;
  deletionScopeKind?: DeletionScopeKind;
  deletionScopeTarget?: string;
  localDataStatus?: LocalDataStatus;
  settingsState?: SettingsStateDto;
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
  onRequestDeleteLocalData,
  onRequestPruneLocalData,
  onRequestScopedDelete,
  settingsState
}: Props) {
  const [loadedSettings, setLoadedSettings] = useState<SettingsStateDto | undefined>();
  const [settingsError, setSettingsError] = useState<string>();
  const [hookBusy, setHookBusy] = useState(false);
  const effectiveSettings = settingsState ?? loadedSettings;
  const effectiveSummary = dataSummary ?? effectiveSettings?.storage.dataSummary;
  const busy = localDataStatus.state === "busy" || hookBusy;

  const loadSettings = useCallback((signal?: AbortSignal) => {
    if (settingsState) return;
    void getSettingsState(undefined, { signal })
      .then((settings) => {
        setLoadedSettings(settings);
        setSettingsError(undefined);
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setSettingsError(error instanceof Error ? error.message : String(error));
      });
  }, [settingsState]);

  useEffect(() => {
    const controller = new AbortController();
    loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);

  const runHookAction = async (action: "install" | "uninstall" | "test") => {
    setHookBusy(true);
    try {
      const hooks =
        action === "install"
          ? await installCodexHooks()
          : action === "uninstall"
            ? await uninstallCodexHooks()
            : await testCodexHooks();
      setLoadedSettings((current) => (current ? { ...current, hooks } : current));
      setSettingsError(undefined);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      setHookBusy(false);
    }
  };

  return (
    <section id="settings" className="settings-panel" aria-label="Settings">
      {settingsError ? <p className="settings-error">{settingsError}</p> : null}

      <HookSettings
        busy={busy}
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
        onExport={onExportLocalData}
        onRequestPrune={onRequestPruneLocalData}
        settings={effectiveSettings}
      />
      <DangerZone
        busy={busy}
        deletionScopeKind={deletionScopeKind}
        deletionScopeTarget={deletionScopeTarget}
        onDeletionScopeKindChange={onDeletionScopeKindChange}
        onDeletionScopeTargetChange={onDeletionScopeTargetChange}
        onRequestDeleteAll={onRequestDeleteLocalData}
        onRequestScopedDelete={onRequestScopedDelete}
        targets={effectiveSettings?.deletionTargets}
      />

      <ConfirmDialog
        confirmLabel="Delete raw copies"
        description={localDataStatus.message}
        onCancel={onCancelLocalDataAction}
        onConfirm={onConfirmPruneLocalData}
        open={localDataStatus.state === "confirm_prune"}
        title="Confirm raw source copy deletion"
        tone="danger"
      />
      <ConfirmDialog
        confirmLabel="Delete selected records"
        description={localDataStatus.message}
        onCancel={onCancelLocalDataAction}
        onConfirm={onConfirmScopedDelete}
        open={localDataStatus.state === "confirm_scoped_delete"}
        title="Confirm scoped deletion"
        tone="danger"
      />
      <ConfirmDialog
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
