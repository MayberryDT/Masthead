import { useEffect, useState } from "react";
import type { AdapterStatus } from "../../app/daemonClient";
import { AdapterRow } from "./AdapterRow";
import { SourceAdapterDetailModal } from "./SourceAdapterDetailModal";

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
  const [openRuntime, setOpenRuntime] = useState<string | undefined>(undefined);
  const openAdapter = adapters.find((adapter) => adapter.runtime === openRuntime);

  useEffect(() => {
    if (!openRuntime) return;
    if (!adapters.some((adapter) => adapter.runtime === openRuntime)) setOpenRuntime(undefined);
  }, [adapters, openRuntime]);

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
      <div className="adapter-list-head">
        <p className="mono-label">ADAPTERS</p>
        <span>{adapters.length} runtimes</span>
      </div>
      <div className="source-adapter-grid">
        {adapters.map((adapter) => (
          <AdapterRow
            key={adapter.runtime}
            adapter={adapter}
            busy={busy}
            checked={selectedRuntimes?.has(adapter.runtime) ?? false}
            onOpenDetails={setOpenRuntime}
            onToggleSelected={onToggleSelected}
          />
        ))}
      </div>
      {openAdapter ? (
        <SourceAdapterDetailModal
          adapter={openAdapter}
          busy={busy}
          checked={selectedRuntimes?.has(openAdapter.runtime) ?? false}
          onClose={() => setOpenRuntime(undefined)}
          onEnableTranscriptImport={onEnableTranscriptImport}
          onExcludePath={onExcludePath}
          onImportMetadata={onImportMetadata}
          onImportTranscripts={onImportTranscripts}
          onSyncAdapter={onSyncAdapter}
          onToggleSelected={onToggleSelected}
        />
      ) : null}
    </section>
  );
}
