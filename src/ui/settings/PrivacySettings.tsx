import type { SettingsStateDto } from "../../app/daemonClient";
import { StatusBadge } from "../primitives/StatusBadge";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type PrivacySettingsProps = {
  privacy?: SettingsStateDto["privacy"];
};

export function PrivacySettings({ privacy }: PrivacySettingsProps) {
  return (
    <SettingsSection eyebrow="Privacy" title="Privacy">
      <SettingsRow
        description="Transcript import follows the current global source policy."
        label="Transcript import"
        value={<StatusBadge tone={privacy?.transcriptImportEnabled ? "active" : "neutral"}>{privacy?.transcriptImportEnabled ? "Enabled" : "Disabled"}</StatusBadge>}
      />
      <SettingsRow
        description="MCP retrieval remains read-only and respects project, session, and source exclusions."
        label="MCP access"
        value={<StatusBadge tone={privacy?.mcpAccessEnabled ? "active" : "danger"}>{privacy?.mcpAccessEnabled ? "Enabled" : "Disabled"}</StatusBadge>}
      />
      <SettingsRow label="Redaction" value={<StatusBadge tone={privacy?.redactionEnabled ? "active" : "danger"}>{privacy?.redactionEnabled ? "On" : "Off"}</StatusBadge>} />
    </SettingsSection>
  );
}
