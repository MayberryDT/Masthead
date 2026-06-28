import type { ReactNode } from "react";
import { advancedHarnesses } from "../../adapters/harnessCatalog";
import { AppButton } from "../primitives/AppButton";

type Props = {
  children: ReactNode;
  onClose?: () => void;
};

export function SourcesAdvancedDiagnostics({ children, onClose }: Props) {
  const harnesses = advancedHarnesses();
  return (
    <section className="sources-advanced-diagnostics surface-panel" aria-label="Advanced source diagnostics">
      <div className="adapter-list-head">
        <div>
          <p className="mono-label">Advanced diagnostics</p>
          <h2>Adapter inventory and import jobs</h2>
          <p className="surface-status">These diagnostics are for troubleshooting connector detection and imports. Most users should use Connect sources, Sync sources, or Repair missing data.</p>
        </div>
        {onClose ? <AppButton type="button" variant="quiet" onClick={onClose}>Hide advanced</AppButton> : null}
      </div>
      <details className="advanced-harness-catalog">
        <summary>{harnesses.length} harnesses in catalog</summary>
        <div className="source-adapter-grid">
          {harnesses.map((harness) => (
            <article className="adapter-card" key={harness.runtime}>
              <p className="mono-label">{harness.supportLevel.replaceAll("_", " ")}</p>
              <h3>{harness.label}</h3>
              <p>{harness.description}</p>
            </article>
          ))}
        </div>
      </details>
      {children}
    </section>
  );
}
