import { useMemo, useState } from "react";
import type { AdapterStatus } from "../../app/daemonClient";
import { onboardingHarnesses } from "../../adapters/harnessCatalog";
import type { FoundSourceDto, SourcesOnboardingScanDto, SourcesSetupRunInput } from "../../shared/sourcesSetup";
import { AppButton } from "../primitives/AppButton";

type Props = {
  adapters: AdapterStatus[];
  busy?: boolean;
  open: boolean;
  onClose: () => void;
  onConnectSelected?: (runtimes: string[]) => void;
  onScan?: () => void;
  onScanSetup?: () => Promise<SourcesOnboardingScanDto | undefined> | SourcesOnboardingScanDto | undefined | void;
  onRunSetup?: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
  scan?: SourcesOnboardingScanDto;
};

type Step = "intro" | "found" | "transcripts" | "enrichment" | "build" | "success";
type EnrichmentMode = SourcesSetupRunInput["enrichmentMode"];

export function SourcesOnboardingModal({ adapters, busy = false, onClose, onConnectSelected, onRunSetup, onScan, onScanSetup, open, scan }: Props) {
  const [step, setStep] = useState<Step>("intro");
  const [localScan, setLocalScan] = useState<SourcesOnboardingScanDto | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [enrichmentMode, setEnrichmentMode] = useState<EnrichmentMode>("local");
  const foundAdapters = useMemo(() => adapters.filter(isFoundAdapter), [adapters]);
  const setupScan = localScan ?? scan;
  const importableSources = useMemo(() => (setupScan?.foundSources ?? []).filter(isImportableSource), [setupScan]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedIds = Array.from(selected);
  const selectedSources = importableSources.filter((source) => selected.has(source.sourceId));
  const selectedRuntimes = setupScan ? selectedSources.map((source) => source.runtime) : selectedIds;
  const usesSetupScan = Boolean(setupScan);
  const harnesses = onboardingHarnesses();

  if (!open) return null;

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleScan = async () => {
    const result = await onScanSetup?.();
    if (result) {
      setLocalScan(result);
      setSelected(new Set(result.foundSources.filter(isImportableSource).map((source) => source.sourceId)));
    } else if (scan) {
      setSelected(new Set(scan.foundSources.filter(isImportableSource).map((source) => source.sourceId)));
    } else {
      onScan?.();
      if (foundAdapters.length > 0) setSelected(new Set(foundAdapters.map((adapter) => adapter.runtime)));
    }
    setStep("found");
  };

  const handleBuild = async () => {
    if (usesSetupScan && onRunSetup) {
      setRunning(true);
      try {
        await onRunSetup({
          enrichmentMode,
          sourceIds: selectedSources.map((source) => source.sourceId),
          transcriptApprovals: selectedSources.map((source) => ({
            approved: source.transcriptApproval?.required ? true : Boolean(source.transcriptApproval?.approved),
            runtime: source.runtime,
            sourceId: source.sourceId
          }))
        });
        setStep("success");
      } finally {
        setRunning(false);
      }
      return;
    }
    onConnectSelected?.(selectedRuntimes);
    setStep("success");
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="session-detail-modal sources-onboarding-modal" role="dialog" aria-modal="true" aria-label="Connect sources">
        <header className="session-detail-header">
          <div>
            <p className="mono-label">Sources setup</p>
            <h2>Connect local sources</h2>
          </div>
          <AppButton type="button" variant="quiet" onClick={onClose}>Close</AppButton>
        </header>

        {step === "intro" ? (
          <div className="session-detail-body">
            <p>
              Masthead checks known local history locations for AI coding tools. It does not scan your whole home directory, and transcripts require explicit approval.
            </p>
            <div className="surface-actions">
              <AppButton type="button" variant="primary" onClick={handleScan} disabled={busy}>Scan this computer</AppButton>
            </div>
            {!onScanSetup ? (
              <details className="advanced-diagnostics-preview">
                <summary>Harnesses Masthead knows how to check</summary>
                <div className="source-adapter-grid">
                  {harnesses.slice(0, 12).map((harness) => (
                    <article className="adapter-card" key={harness.runtime}>
                      <p className="mono-label">{harness.supportLevel.replaceAll("_", " ")}</p>
                      <h3>{harness.label}</h3>
                      <p>{harness.description}</p>
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {step === "found" ? (
          <div className="session-detail-body">
            <p className="surface-status">Select the sources Masthead should connect. Unrecognized schemas stay in Advanced diagnostics until their import shape is verified.</p>
            {usesSetupScan ? (
              importableSources.length > 0 ? (
                <div className="source-adapter-grid">
                  {importableSources.map((source) => (
                    <label className="adapter-card source-select-card" key={source.sourceId}>
                      <span className="adapter-card-head">
                        <span>
                          <span className="mono-label">{source.runtime}</span>
                          <strong>{source.label ?? source.runtime}</strong>
                        </span>
                        <input type="checkbox" checked={selected.has(source.sourceId)} onChange={(event) => toggle(source.sourceId, event.currentTarget.checked)} />
                      </span>
                      <span>{source.discoveredSessions ?? source.sessions ?? 0} sessions</span>
                      {source.path ? <span className="surface-status">{source.path}</span> : null}
                    </label>
                  ))}
                </div>
              ) : (
                <ScanEmptyState />
              )
            ) : foundAdapters.length > 0 ? (
              <div className="source-adapter-grid">
                {foundAdapters.map((adapter) => (
                  <label className="adapter-card source-select-card" key={adapter.runtime}>
                    <span className="adapter-card-head">
                      <span>
                        <span className="mono-label">{adapter.runtime}</span>
                        <strong>{adapter.name ?? adapter.runtime}</strong>
                      </span>
                      <input type="checkbox" checked={selected.has(adapter.runtime)} onChange={(event) => toggle(adapter.runtime, event.currentTarget.checked)} />
                    </span>
                    <span>{adapter.importedSessions || adapter.discoveredSessions || 0} sessions</span>
                  </label>
                ))}
              </div>
            ) : (
              <ScanEmptyState />
            )}
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("intro")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={() => setStep("transcripts")} disabled={selectedIds.length === 0}>Continue</AppButton>
            </div>
          </div>
        ) : null}

        {step === "transcripts" ? (
          <div className="session-detail-body">
            <h3>Transcript approval</h3>
            {usesSetupScan ? (
              <div className="source-adapter-grid">
                {selectedSources.map((source) => (
                  <article className="adapter-card" key={source.sourceId}>
                    <p className="mono-label">{source.runtime}</p>
                    <h4>{source.label ?? source.runtime}</h4>
                    <p>{source.transcriptApproval?.summary ?? "Prompts, code, file paths, command output, and private data may be present."}</p>
                    {source.path ? <p className="surface-status">{source.path}</p> : null}
                    <span className="surface-status">{source.transcriptApproval?.required ? "Transcript import requires approval" : "Transcript approval not required"}</span>
                  </article>
                ))}
              </div>
            ) : (
              <p>Transcripts can include prompts, code, file paths, command output, and private data. This first pass keeps approval explicit and continues to use the existing source policy flow.</p>
            )}
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("found")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={() => setStep("enrichment")}>Continue</AppButton>
            </div>
          </div>
        ) : null}

        {step === "enrichment" ? (
          <div className="session-detail-body">
            <h3>Enrichment</h3>
            <div className="source-adapter-grid">
              <label className="adapter-card source-select-card">
                <span className="adapter-card-head">
                  <span>
                    <span className="mono-label">Recommended</span>
                    <strong>Local deterministic summaries</strong>
                  </span>
                  <input type="radio" name="source-enrichment-mode" checked={enrichmentMode === "local"} onChange={() => setEnrichmentMode("local")} />
                </span>
                <span>Generate titles, summaries, and search context with local rules.</span>
              </label>
              <label className="adapter-card source-select-card">
                <span className="adapter-card-head">
                  <span>
                    <span className="mono-label">Manual</span>
                    <strong>Skip enrichment</strong>
                  </span>
                  <input type="radio" name="source-enrichment-mode" checked={enrichmentMode === "skip"} onChange={() => setEnrichmentMode("skip")} />
                </span>
                <span>Import source records now and enrich later from Sources diagnostics.</span>
              </label>
            </div>
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("transcripts")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={() => setStep("build")}>Continue</AppButton>
            </div>
          </div>
        ) : null}

        {step === "build" ? (
          <div className="session-detail-body">
            <h3>Build session library</h3>
            <p>Masthead will connect selected sources, import metadata, and queue transcript/enrichment work through the existing pipeline.</p>
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("enrichment")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={handleBuild} disabled={busy || running || selectedIds.length === 0}>Build session library</AppButton>
            </div>
          </div>
        ) : null}

        {step === "success" ? (
          <div className="session-detail-body">
            <h3>Session library build started</h3>
            <p>Sources are connected. Import jobs and any skipped work remain visible in Advanced diagnostics.</p>
            <div className="surface-actions">
              <AppButton type="button" variant="primary" onClick={onClose}>Done</AppButton>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ScanEmptyState() {
  return (
    <div className="empty-session-state">
      <p className="mono-label">Scan complete</p>
      <h3>No importable local sources found yet</h3>
      <p>Advanced diagnostics can show checked locations and detector-only harnesses.</p>
    </div>
  );
}

function isImportableSource(source: FoundSourceDto): boolean {
  return source.importable === true || source.state === "importable";
}

function isFoundAdapter(adapter: AdapterStatus): boolean {
  return adapter.state === "connected" || adapter.state === "degraded" || adapter.discoveredSessions > 0 || adapter.importedSessions > 0 || adapter.sourceLocations.length > 0;
}
