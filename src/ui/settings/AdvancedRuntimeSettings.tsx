import type { DataSummary, SettingsStateDto } from "../../app/daemonClient";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type AdvancedRuntimeSettingsProps = {
  dataSummary?: DataSummary;
  settings?: SettingsStateDto;
};

export function AdvancedRuntimeSettings({ dataSummary, settings }: AdvancedRuntimeSettingsProps) {
  const summary = dataSummary ?? settings?.storage.dataSummary;
  const storageClasses = summary ? Object.entries(summary.storageClasses) : [];
  return (
    <SettingsSection eyebrow="Advanced" title="Advanced runtime">
      <SettingsRow label="Database ID" value={settings?.data.databaseId ?? "Loading"} />
      <SettingsRow
        label="Runtime"
        value={
          settings
            ? `${settings.runtime.mode} / ${settings.runtime.writable ? "writable" : "read only"} / API ${settings.apiVersion} / schema ${settings.schemaVersion}`
            : "Loading"
        }
      />
      <SettingsRow
        description={storageClasses.length > 0 ? storageClasses.map(([name, item]) => `${name}: ${item.retention}`).join(", ") : undefined}
        label="Retention classes"
        value={storageClasses.length > 0 ? `${storageClasses.length} classes` : "Loading"}
      />
      <SettingsRow label="Raw event rows" value={summary ? formatCount(summary.rawEvents) : "Loading"} />
      <SettingsRow label="MCP audit rows" value={summary ? formatCount(summary.auditRows) : "Loading"} />
    </SettingsSection>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
