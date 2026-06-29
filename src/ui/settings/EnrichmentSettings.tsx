import type { SettingsStateDto } from "../../app/daemonClient";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type EnrichmentSettingsProps = {
  enrichment?: SettingsStateDto["enrichment"];
};

export function EnrichmentSettings({ enrichment }: EnrichmentSettingsProps) {
  return (
    <SettingsSection eyebrow="Enrichment" title="Enrichment model" description="Add a remote model key when local enrichment is not enough. Use a fast, lightweight model.">
      <SettingsRow
        control={<input className="settings-text-input" type="password" placeholder="Paste API key" aria-label="Enrichment API key" />}
        description="Stored locally when enrichment setup is completed."
        label="API key"
      />
      <SettingsRow
        control={<input className="settings-text-input" type="text" placeholder="Fast model name" defaultValue={enrichment?.remoteModelEnabled ? enrichment.model : ""} aria-label="Enrichment model" />}
        description="Prefer a small, low-latency model for labels, summaries, and search hints."
        label="Model"
      />
    </SettingsSection>
  );
}
