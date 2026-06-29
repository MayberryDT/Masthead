import type { SettingsStateDto } from "../../app/daemonClient";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsToggle } from "./SettingsToggle";

type PrivacySettingsProps = {
  privacy?: SettingsStateDto["privacy"];
};

export function PrivacySettings({ privacy }: PrivacySettingsProps) {
  return (
    <SettingsSection eyebrow="Privacy" title="Data boundaries">
      <SettingsRow
        control={<SettingsToggle label="Transcript import" checked={privacy?.transcriptImportEnabled} />}
        description="Allow source transcript import into the local Masthead database."
        label="Transcript import"
      />
      <SettingsRow
        control={<SettingsToggle label="Redaction" checked={privacy?.redactionEnabled} />}
        description="Redact sensitive values before storing or showing imported session text."
        label="Redaction"
      />
    </SettingsSection>
  );
}
