import type { SettingsStateDto } from "../../app/daemonClient";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type AdvancedSettingsProps = {
  settings?: SettingsStateDto;
};

export function AdvancedSettings({ settings }: AdvancedSettingsProps) {
  return (
    <SettingsSection title="Advanced">
      <SettingsRow label="Database ID" value={settings?.data.databaseId ?? "Loading"} />
      <SettingsRow label="Database path" value={settings?.data.databasePath ?? "Loading"} />
      <SettingsRow label="Data directory" value={settings?.data.dataDirectory ?? "Loading"} />
      <SettingsRow
        label="Runtime"
        value={settings ? `${settings.runtime.host}:${settings.runtime.port}` : "Loading"}
      />
      <SettingsRow label="Mode" value={settings?.runtime.mode ?? "Loading"} />
      <SettingsRow
        label="Protocol"
        value={settings ? `API ${settings.apiVersion} / schema ${settings.schemaVersion}` : "Loading"}
      />
    </SettingsSection>
  );
}
