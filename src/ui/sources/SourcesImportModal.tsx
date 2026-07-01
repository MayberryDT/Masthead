import { useMemo, useState } from "react";
import type { AdapterStatus, SourcesImportPreview } from "../../app/daemonClient";
import type { ImportScopeDto } from "../../shared/sourceImport";
import type { SourcesSetupRunInput } from "../../shared/sourcesSetup";
import { AppButton } from "../primitives/AppButton";
import { HarnessImportCard } from "./HarnessImportCard";

type Props = {
  adapters: AdapterStatus[];
  busy?: boolean;
  open: boolean;
  previews?: SourcesImportPreview[];
  onClose: () => void;
  onPreviewImport?: (input: SourcesSetupRunInput) => Promise<SourcesImportPreview[]> | SourcesImportPreview[];
  onRunSetup?: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
};

type ScopeChoice = "recent" | "full";

export function SourcesImportModal({
  adapters,
  busy = false,
  onClose,
  onPreviewImport,
  onRunSetup,
  open,
  previews: externalPreviews
}: Props) {
  const importableAdapters = useMemo(() => adapters.filter((adapter) => adapter.state !== "not_detected" && adapter.state !== "planned"), [adapters]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(importableAdapters.slice(0, 1).map((adapter) => adapter.runtime)));
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>("recent");
  const [localPreviews, setLocalPreviews] = useState<SourcesImportPreview[]>([]);
  const previews = externalPreviews ?? localPreviews;
  const selectedRuntimes = Array.from(selected);
  const scope = scopeForChoice(scopeChoice);

  if (!open) return null;

  const updateSelected = (runtime: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(runtime);
      else next.delete(runtime);
      return next;
    });
  };

  const preview = async (choice = scopeChoice) => {
    const nextScope = scopeForChoice(choice);
    const result = await onPreviewImport?.({
      importMetadata: true,
      importScope: nextScope,
      importTranscripts: true,
      queueEnrichment: true,
      runtimes: selectedRuntimes,
      transcriptApproved: true
    });
    if (result) setLocalPreviews(result);
  };

  const runImport = async () => {
    await onRunSetup?.({
      importMetadata: true,
      importScope: scope,
      importTranscripts: true,
      queueEnrichment: true,
      runtimes: selectedRuntimes,
      transcriptApproved: true
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="session-detail-modal sources-import-modal" role="dialog" aria-modal="true" aria-label="Import session history">
        <header className="session-detail-header">
          <div>
            <p className="mono-label">Sources</p>
            <h2>Import session history</h2>
          </div>
          <AppButton type="button" variant="quiet" onClick={onClose}>Close</AppButton>
        </header>
        <div className="session-detail-body sources-import-body">
          <section className="sources-import-step">
            <div className="source-detail-section-head">
              <div>
                <p className="mono-label">Coding harness</p>
                <h3>Choose history to import</h3>
              </div>
            </div>
            <div className="source-adapter-grid">
              {importableAdapters.map((adapter) => (
                <HarnessImportCard
                  adapter={adapter}
                  checked={selected.has(adapter.runtime)}
                  disabled={busy}
                  key={adapter.runtime}
                  onToggle={updateSelected}
                />
              ))}
            </div>
          </section>

          <section className="sources-import-step">
            <div className="source-choice-list">
              <label className="source-choice">
                <input
                  type="radio"
                  checked={scopeChoice === "recent"}
                  onChange={() => {
                    setScopeChoice("recent");
                    void preview("recent");
                  }}
                />
                <span>
                  <strong>Last 30 days</strong>
                  <small>Includes changed transcripts since the last cursor and caps the first run.</small>
                </span>
              </label>
              <label className="source-choice">
                <input
                  type="radio"
                  checked={scopeChoice === "full"}
                  onChange={() => {
                    setScopeChoice("full");
                    void preview("full");
                  }}
                />
                <span>
                  <strong>Full archive</strong>
                  <small>Longer running. Every file remains visible as a child work unit.</small>
                </span>
              </label>
            </div>
          </section>

          <ScopePreview previews={previews} />

          <footer className="sources-import-footer">
            <AppButton type="button" onClick={() => void preview()} disabled={busy || selectedRuntimes.length === 0}>
              Preview
            </AppButton>
            <AppButton type="button" variant="primary" onClick={() => void runImport()} disabled={busy || selectedRuntimes.length === 0}>
              Import history
            </AppButton>
          </footer>
        </div>
      </section>
    </div>
  );
}

function ScopePreview({ previews }: { previews: SourcesImportPreview[] }) {
  if (previews.length === 0) {
    return <p className="surface-status">Preview shows file counts before the import starts.</p>;
  }
  return (
    <dl className="sources-import-preview" aria-label="Import preview">
      {previews.map((preview) => (
        <div key={preview.runtime}>
          <dt>{preview.runtime}</dt>
          <dd>{preview.summary.includedUnits} {preview.summary.includedUnits === 1 ? "file" : "files"}</dd>
          <dd>{preview.summary.excludedUnits} skipped</dd>
          <dd>{formatBytes(preview.summary.totalBytes)}</dd>
        </div>
      ))}
    </dl>
  );
}

function scopeForChoice(choice: ScopeChoice): ImportScopeDto {
  return choice === "full"
    ? { includeChangedSinceCursor: true, mode: "transcript_full" }
    : { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 };
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
