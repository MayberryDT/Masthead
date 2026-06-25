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
  return (
    <SettingsSection eyebrow="Storage" title="Storage">
      <SettingsRow
        control={
          <AppButton disabled={!settings?.storage.dataDirectory} onClick={onOpenDataDirectory} variant="quiet">
            Open folder
          </AppButton>
        }
        label="Database"
        value={settings?.storage.databasePath ?? "Loading"}
      />
      <SettingsRow label="Sessions" value={summary ? formatCount(summary.sessions) : "Loading"} />
      <SettingsRow
        control={
          <AppButton disabled={writeDisabled || !summary} onClick={onRequestPrune} variant="danger">
            Delete raw copies
          </AppButton>
        }
        description="Keeps normalized session metadata, summaries, and search records."
        label="Raw source copies"
        value={summary ? formatCount(summary.rawEvents) : "Loading"}
      />
      <SettingsRow
        control={
          <AppButton disabled={busy} onClick={onExport}>
            Export data
          </AppButton>
        }
        description="Export the local Masthead database graph."
        label="Export"
      />
    </SettingsSection>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
