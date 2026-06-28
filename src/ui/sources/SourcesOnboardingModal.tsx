import { useMemo, useState } from "react";
import type { AdapterStatus } from "../../app/daemonClient";
import { onboardingHarnesses } from "../../adapters/harnessCatalog";
import { AppButton } from "../primitives/AppButton";

type Props = {
  adapters: AdapterStatus[];
  busy?: boolean;
  open: boolean;
  onClose: () => void;
  onConnectSelected?: (runtimes: string[]) => void;
  onScan?: () => void;
};

type Step = "intro" | "found" | "transcripts" | "enrichment" | "build";

export function SourcesOnboardingModal({ adapters, busy = false, onClose, onConnectSelected, onScan, open }: Props) {
  const [step, setStep] = useState<Step>("intro");
  const foundAdapters = useMemo(() => adapters.filter(isFoundAdapter), [adapters]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedRuntimes = Array.from(selected);
  const harnesses = onboardingHarnesses();

  if (!open) return null;

  const toggle = (runtime: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(runtime);
      else next.delete(runtime);
      return next;
    });
  };

  const handleScan = () => {
    onScan?.();
    setStep("found");
    if (foundAdapters.length > 0) setSelected(new Set(foundAdapters.map((adapter) => adapter.runtime)));
  };

  const handleBuild = () => {
    onConnectSelected?.(selectedRuntimes);
    setStep("build");
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
          </div>
        ) : null}

        {step === "found" ? (
          <div className="session-detail-body">
            <p className="surface-status">Select the sources Masthead should connect. Unrecognized schemas stay in Advanced diagnostics until their import shape is verified.</p>
            {foundAdapters.length > 0 ? (
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
              <div className="empty-session-state">
                <p className="mono-label">Scan complete</p>
                <h3>No importable local sources found yet</h3>
                <p>Advanced diagnostics can show checked locations and detector-only harnesses.</p>
              </div>
            )}
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("intro")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={() => setStep("transcripts")} disabled={selectedRuntimes.length === 0}>Continue</AppButton>
            </div>
          </div>
        ) : null}

        {step === "transcripts" ? (
          <div className="session-detail-body">
            <h3>Transcript approval</h3>
            <p>Transcripts can include prompts, code, file paths, command output, and private data. This first pass keeps approval explicit and continues to use the existing source policy flow.</p>
            <div className="surface-actions">
              <AppButton type="button" onClick={() => setStep("found")}>Back</AppButton>
              <AppButton type="button" variant="primary" onClick={() => setStep("enrichment")}>Continue</AppButton>
            </div>
          </div>
        ) : null}

        {step === "enrichment" ? (
          <div className="session-detail-body">
            <h3>Enrichment</h3>
            <div className="adapter-card">
              <p className="mono-label">Recommended</p>
              <h4>Local only</h4>
              <p>Use deterministic local rules to generate titles, summaries, and search context. Remote model configuration can be added later.</p>
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
              <AppButton type="button" variant="primary" onClick={handleBuild} disabled={busy || selectedRuntimes.length === 0}>Build session library</AppButton>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function isFoundAdapter(adapter: AdapterStatus): boolean {
  return adapter.state === "connected" || adapter.state === "degraded" || adapter.discoveredSessions > 0 || adapter.importedSessions > 0 || adapter.sourceLocations.length > 0;
}
