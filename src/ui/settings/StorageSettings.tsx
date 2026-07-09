import type { DataSummary, SettingsStateDto } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type StorageSettingsProps = {
  dataSummary?: DataSummary;
  settings?: SettingsStateDto;
  busy?: boolean;
  writeDisabled?: boolean;
  onExport?: () => void;
  onOpenDataDirectory?: () => void;
  onRequestPrune?: () => void;
};

export function StorageSettings({ busy = false, dataSummary, onExport, onOpenDataDirectory, onRequestPrune, settings, writeDisabled = busy }: StorageSettingsProps) {
  const summary = dataSummary ?? settings?.storage.dataSummary;
  const hasDatabaseIdentity = Boolean(settings?.data.databaseId);
  const databasePath = settings?.storage.databasePath;
  return (
    <SettingsSection className="settings-section-wide" title="Storage">
      <SettingsRow
        control={
          <AppButton disabled={!settings?.storage.dataDirectory} onClick={onOpenDataDirectory} variant="quiet">
            Open folder
          </AppButton>
        }
        label="Database"
        value={databasePath ? <span title={databasePath}>{compactPath(databasePath)}</span> : "Loading"}
      />
      <SettingsRow
        control={
          <AppButton disabled={busy || !hasDatabaseIdentity} onClick={onExport}>
            Export data
          </AppButton>
        }
        label="Export"
      />
      <SettingsRow
        control={
          <AppButton disabled={writeDisabled || !summary || !hasDatabaseIdentity} onClick={onRequestPrune} variant="danger">
            Delete raw copies
          </AppButton>
        }
        label="Raw source copies"
        value={summary ? formatCount(summary.rawEvents) : "Loading"}
      />
    </SettingsSection>
  );
}

function compactPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
