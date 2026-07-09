import type { SessionDossierDto } from "../../shared/sessionDossier";

type Props = {
  coverage?: SessionDossierDto["coverage"];
  onOpenWorkbench?: () => void;
};

export function DossierCoverageBanner({ coverage, onOpenWorkbench }: Props) {
  if (!coverage || (coverage.level === "complete" && coverage.warnings.length === 0)) return null;
  const transcriptWarning = coverage.warnings.find((warning) => warning.code === "transcript_missing");
  return (
    <section className={`dossier-coverage dossier-coverage-${coverage.level}`} aria-label="Session data coverage">
      <div>
        <strong>{coverageTitle(coverage.level)}</strong>
        <p>{coverageSummary(coverage.level)}</p>
      </div>
      {coverage.warnings.length > 0 ? (
        <ul>
          {coverage.warnings.slice(0, 4).map((warning) => (
            <li key={warning.code}>{warning.message}</li>
          ))}
        </ul>
      ) : null}
      {transcriptWarning && onOpenWorkbench ? (
        <button type="button" className="dossier-link-button" onClick={onOpenWorkbench}>
          {transcriptWarning.action?.label ?? "Import transcripts"}
        </button>
      ) : null}
    </section>
  );
}

function coverageTitle(level: SessionDossierDto["coverage"]["level"]): string {
  if (level === "complete") return "Complete session data";
  if (level === "partial") return "Partial session data";
  if (level === "hook_only") return "Hook events only";
  return "Metadata only";
}

function coverageSummary(level: SessionDossierDto["coverage"]["level"]): string {
  if (level === "complete") return "Transcript, tools, and verification records are available.";
  if (level === "partial") return "Masthead has useful session data, but some evidence is missing.";
  if (level === "hook_only") return "Masthead captured live hook metadata, but no imported transcript.";
  return "Only sparse session metadata is available.";
}
