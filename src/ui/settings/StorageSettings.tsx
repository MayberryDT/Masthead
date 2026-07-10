import type { ReactNode } from "react";
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
  exportFeedback?: SettingsActionFeedback;
  openDataDirectoryFeedback?: SettingsActionFeedback;
  rawCopiesFeedback?: SettingsActionFeedback;
};

export type SettingsActionFeedback = {
  message: string;
  tone?: "error" | "success";
};

export function StorageSettings({
  busy = false,
  dataSummary,
  exportFeedback,
  onExport,
  onOpenDataDirectory,
  onRequestPrune,
  openDataDirectoryFeedback,
  rawCopiesFeedback,
  settings,
  writeDisabled = busy
}: StorageSettingsProps) {
  const summary = dataSummary ?? settings?.storage.dataSummary;
  const hasDatabaseIdentity = Boolean(settings?.data.databaseId);
  const databasePath = settings?.storage.databasePath;
  return (
    <SettingsSection className="settings-section-wide" title="Storage">
      <SettingsRow
        control={
          <ActionControl feedback={openDataDirectoryFeedback}>
            <AppButton disabled={!settings?.storage.dataDirectory} onClick={onOpenDataDirectory} variant="quiet">
              Open folder
            </AppButton>
          </ActionControl>
        }
        label="Open data folder"
        value={databasePath ? <span title={databasePath}>{compactPath(databasePath)}</span> : "Loading"}
      />
      <SettingsRow
        control={
          <ActionControl feedback={exportFeedback}>
            <AppButton disabled={busy || !hasDatabaseIdentity} onClick={onExport}>
              Export data
            </AppButton>
          </ActionControl>
        }
        label="Export archive"
      />
      <SettingsRow
        control={
          <ActionControl feedback={rawCopiesFeedback}>
            <AppButton disabled={writeDisabled || !summary || !hasDatabaseIdentity} onClick={onRequestPrune} variant="danger">
              Delete raw copies
            </AppButton>
          </ActionControl>
        }
        description="Deletes stored raw copies only; normalized records and original harness files remain."
        label="Include raw copies"
        value={summary ? formatCount(summary.rawEvents) : "Loading"}
      />
    </SettingsSection>
  );
}

function ActionControl({ children, feedback }: { children: ReactNode; feedback?: SettingsActionFeedback }) {
  return (
    <div className="settings-inline-actions">
      {children}
      {feedback ? (
        <span className={`settings-inline-feedback ${feedback.tone ?? ""}`.trim()} role="status">
          {feedback.message}
        </span>
      ) : null}
    </div>
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
