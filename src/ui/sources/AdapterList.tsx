import type { AdapterStatus } from "../../app/daemonClient";
import { AdapterRow } from "./AdapterRow";

type Props = {
  adapters: AdapterStatus[];
  busy: boolean;
  onExcludePath: (path: string) => void;
  onImportCodexMetadata?: () => void;
};

export function AdapterList({ adapters, busy, onExcludePath, onImportCodexMetadata }: Props) {
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
          onExcludePath={onExcludePath}
          onImportCodexMetadata={onImportCodexMetadata}
        />
      ))}
    </section>
  );
}
