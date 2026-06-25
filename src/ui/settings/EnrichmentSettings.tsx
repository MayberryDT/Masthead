import type { SettingsStateDto } from "../../app/daemonClient";
import { StatusBadge } from "../primitives/StatusBadge";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type EnrichmentSettingsProps = {
  enrichment?: SettingsStateDto["enrichment"];
};

export function EnrichmentSettings({ enrichment }: EnrichmentSettingsProps) {
  return (
    <SettingsSection eyebrow="Enrichment" title="Enrichment">
      <SettingsRow label="Provider" value={enrichment?.provider ?? "Loading"} />
      <SettingsRow
        label="Remote model"
        value={
          <StatusBadge tone={enrichment?.remoteModelEnabled ? "active" : "neutral"}>
            {enrichment?.remoteModelEnabled ? enrichment.model : "Off"}
          </StatusBadge>
        }
      />
      <SettingsRow
        label="Current enrichments"
        value={
          enrichment ? `${formatCount(enrichment.currentEnrichments)} / ${formatCount(enrichment.sessionCount)}` : "Loading"
        }
      />
      <SettingsRow
        label="Health"
        value={
          enrichment
            ? `${formatCount(enrichment.health.complete)} complete, ${formatCount(enrichment.health.queued)} queued, ${formatCount(
                enrichment.health.failed
              )} failed, ${formatCount(enrichment.health.disabled)} disabled`
            : "Loading"
        }
      />
    </SettingsSection>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
