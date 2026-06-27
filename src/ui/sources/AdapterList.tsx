import type { AdapterStatus } from "../../app/daemonClient";
import { AdapterRow } from "./AdapterRow";

type Props = {
  adapters: AdapterStatus[];
  busy: boolean;
  onEnableTranscriptImport?: (runtime: string) => void;
  onExcludePath: (path: string) => void;
  onImportMetadata?: (runtime: string) => void;
  onImportTranscripts?: (runtime: string) => void;
  onToggleSelected?: (runtime: string, checked: boolean) => void;
  onSyncAdapter?: (runtime: string) => void;
  selectedRuntimes?: Set<string>;
};

export function AdapterList({
  adapters,
  busy,
  onEnableTranscriptImport,
  onExcludePath,
  onImportMetadata,
  onImportTranscripts,
  onSyncAdapter,
  onToggleSelected,
  selectedRuntimes
}: Props) {
  if (adapters.length === 0) {
    return (
      <div className="empty-session-state surface-empty-state">
        <p className="mono-label">Sources</p>
        <h2>{busy ? "Scanning sources" : "No runtimes detected"}</h2>
        <p>{busy ? "Masthead is checking the local source index." : "Discover sources or import Codex metadata to populate this intake view."}</p>
      </div>
    );
  }

  return (
    <section className="adapter-list" aria-label="Runtime adapters">
      <p className="mono-label">ADAPTERS</p>
      {adapters.map((adapter) => (
        <AdapterRow
          key={adapter.runtime}
          adapter={adapter}
          busy={busy}
          checked={selectedRuntimes?.has(adapter.runtime) ?? false}
          onEnableTranscriptImport={onEnableTranscriptImport}
          onExcludePath={onExcludePath}
          onImportMetadata={onImportMetadata}
          onImportTranscripts={onImportTranscripts}
          onToggleSelected={onToggleSelected}
          onSyncAdapter={onSyncAdapter}
        />
      ))}
    </section>
  );
}
