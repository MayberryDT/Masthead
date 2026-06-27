import { useEffect, useState } from "react";
import type { AdapterStatus, SourceStatus, SourceStatusPage } from "../../app/daemonClient";
import { AdapterRow } from "./AdapterRow";
import { SourceAdapterDetailModal } from "./SourceAdapterDetailModal";

type Props = {
  adapters: AdapterStatus[];
  busy: boolean;
  onEnableTranscriptImport?: (runtime: string) => void;
  onExcludePath: (path: string) => void;
  onImportMetadata?: (runtime: string) => void;
  onImportTranscripts?: (runtime: string) => void;
  onLoadAdapterSources?: (runtime: string, page: { limit: number; offset: number }) => Promise<SourceStatusPage>;
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
  onLoadAdapterSources,
  onSyncAdapter,
  onToggleSelected,
  selectedRuntimes
}: Props) {
  const [openRuntime, setOpenRuntime] = useState<string | undefined>(undefined);
  const [adapterSources, setAdapterSources] = useState<Record<string, { error?: string; loading: boolean; sources: SourceStatus[]; total: number }>>({});
  const openAdapter = adapters.find((adapter) => adapter.runtime === openRuntime);
  const openAdapterSources = openRuntime ? adapterSources[openRuntime] : undefined;
  const openAdapterWithSources =
    openAdapter && openAdapterSources
      ? { ...openAdapter, sourceLocations: openAdapterSources.sources, sourceLocationCount: openAdapterSources.total }
      : openAdapter;

  useEffect(() => {
    if (!openRuntime) return;
    if (!adapters.some((adapter) => adapter.runtime === openRuntime)) setOpenRuntime(undefined);
  }, [adapters, openRuntime]);

  useEffect(() => {
    if (!openRuntime || !openAdapter || !onLoadAdapterSources || openAdapter.sourceLocations.length > 0) return;
    const current = adapterSources[openRuntime];
    if (current?.loading || current?.sources.length) return;
    setAdapterSources((state) => ({ ...state, [openRuntime]: { loading: true, sources: [], total: openAdapter.sourceLocationCount ?? 0 } }));
    void onLoadAdapterSources(openRuntime, { limit: 100, offset: 0 })
      .then((page) => {
        setAdapterSources((state) => ({
          ...state,
          [openRuntime]: { loading: false, sources: page.sources, total: page.total }
        }));
      })
      .catch((error: unknown) => {
        setAdapterSources((state) => ({
          ...state,
          [openRuntime]: {
            error: error instanceof Error ? error.message : String(error),
            loading: false,
            sources: [],
            total: openAdapter.sourceLocationCount ?? 0
          }
        }));
      });
  }, [adapterSources, onLoadAdapterSources, openAdapter, openRuntime]);

  const handleLoadMoreSources = (runtime: string) => {
    if (!onLoadAdapterSources) return;
    const current = adapterSources[runtime];
    if (!current || current.loading || current.sources.length >= current.total) return;
    setAdapterSources((state) => ({ ...state, [runtime]: { ...current, loading: true } }));
    void onLoadAdapterSources(runtime, { limit: 100, offset: current.sources.length })
      .then((page) => {
        setAdapterSources((state) => {
          const latest = state[runtime] ?? current;
          const byId = new Map(latest.sources.map((source) => [source.sourceId, source]));
          for (const source of page.sources) byId.set(source.sourceId, source);
          return {
            ...state,
            [runtime]: { loading: false, sources: Array.from(byId.values()), total: page.total }
          };
        });
      })
      .catch((error: unknown) => {
        setAdapterSources((state) => ({
          ...state,
          [runtime]: {
            ...current,
            error: error instanceof Error ? error.message : String(error),
            loading: false
          }
        }));
      });
  };

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
      {openAdapterWithSources ? (
        <SourceAdapterDetailModal
          adapter={openAdapterWithSources}
          busy={busy}
          checked={selectedRuntimes?.has(openAdapterWithSources.runtime) ?? false}
          locationError={openAdapterSources?.error}
          locationLoading={openAdapterSources?.loading}
          locationTotal={openAdapterSources?.total ?? openAdapterWithSources.sourceLocationCount}
          onClose={() => setOpenRuntime(undefined)}
          onEnableTranscriptImport={onEnableTranscriptImport}
          onExcludePath={onExcludePath}
          onImportMetadata={onImportMetadata}
          onImportTranscripts={onImportTranscripts}
          onLoadMoreLocations={() => handleLoadMoreSources(openAdapterWithSources.runtime)}
          onSyncAdapter={onSyncAdapter}
          onToggleSelected={onToggleSelected}
        />
      ) : null}
    </section>
  );
}
