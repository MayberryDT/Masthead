import type { CodexHookSettingsDto } from "../../app/daemonClient";
import type { FoundSourceDto } from "../../shared/sourcesSetup";
import { HarnessLiveCaptureSection } from "./HarnessLiveCaptureSection";

type HarnessSetupControlsProps = {
  hooks?: CodexHookSettingsDto;
  importMetadata: boolean;
  liveCaptureEnabled: boolean;
  selectedSources: FoundSourceDto[];
  onImportMetadataChange: (checked: boolean) => void;
  onLiveCaptureEnabledChange: (checked: boolean) => void;
};

export function HarnessSetupControls({
  hooks,
  importMetadata,
  liveCaptureEnabled,
  onImportMetadataChange,
  onLiveCaptureEnabledChange,
  selectedSources
}: HarnessSetupControlsProps) {
  const hasCodex = selectedSources.some((source) => source.runtime === "codex");

  return (
    <div className="harness-setup-controls">
      <label className="source-choice">
        <input type="checkbox" checked={importMetadata} onChange={(event) => onImportMetadataChange(event.currentTarget.checked)} />
        <span>
          <strong>Metadata only</strong>
          <small>Import session identity, timing, runtime, project, and searchable metadata without bulk transcript ingestion.</small>
        </span>
      </label>
      <div className="source-choice is-static">
        <span>
          <strong>Transcripts hydrate when a Dossier opens</strong>
          <small>Masthead imports transcript evidence for an individual session automatically when that session Dossier is opened.</small>
        </span>
      </div>
      <div className="source-choice is-static">
        <span>
          <strong>Enrich Dossiers when opened</strong>
          <small>Provider settings can be configured now, but setup does not enqueue enrichment for every imported session.</small>
        </span>
      </div>
      {hasCodex ? (
        <label className="source-choice">
          <input type="checkbox" checked={liveCaptureEnabled} onChange={(event) => onLiveCaptureEnabledChange(event.currentTarget.checked)} />
          <span>
            <strong>Install or repair Codex live capture</strong>
            <small>Backs up and updates the Masthead-managed Codex hook entries.</small>
          </span>
        </label>
      ) : null}
      {hasCodex ? <HarnessLiveCaptureSection hooks={hooks} runtime="codex" /> : null}
    </div>
  );
}
