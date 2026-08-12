import type { MastheadPagesEvidenceCandidate } from "../../app/mastheadPages/types";

type Props = {
  candidates: MastheadPagesEvidenceCandidate[];
  selectedRefs: string[];
  disabled?: boolean;
  onChange: (refs: string[]) => void;
};

export function MastheadPagesEvidencePicker({ candidates, disabled = false, onChange, selectedRefs }: Props) {
  const selected = new Set(selectedRefs);

  const toggle = (ref: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(ref)) next.delete(ref);
    else next.add(ref);
    onChange([...next]);
  };

  if (candidates.length === 0) {
    return (
      <section className="masthead-pages-evidence-picker" aria-label="Evidence choices">
        <p className="mono-label">Evidence</p>
        <p className="surface-status">No public evidence candidates available for this Page.</p>
      </section>
    );
  }

  return (
    <section className="masthead-pages-evidence-picker" aria-label="Evidence choices">
      <p className="mono-label">Evidence</p>
      <p className="masthead-pages-help">Select only evidence that should leave this machine.</p>
      <ul className="masthead-pages-evidence-list">
        {candidates.map((candidate) => {
          const id = `masthead-pages-evidence-${candidate.ref}`;
          return (
            <li key={candidate.ref}>
              <label htmlFor={id} className={candidate.lowValue ? "is-low-value" : undefined}>
                <input
                  checked={selected.has(candidate.ref)}
                  disabled={disabled}
                  id={id}
                  type="checkbox"
                  onChange={() => toggle(candidate.ref)}
                />
                <span>
                  <strong>{candidate.label || candidate.toolName || candidate.ref}</strong>
                  <span className="masthead-pages-evidence-meta">
                    {candidate.kind}
                    {candidate.lowValue ? " · low value" : ""}
                  </span>
                  <span className="masthead-pages-evidence-text">{candidate.text}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
