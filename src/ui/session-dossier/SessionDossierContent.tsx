import type { SessionTranscriptResult } from "../../app/daemonClient";
import type { ReadableSessionDossier } from "../../shared/sessionDossier";
import { SessionDossierContentImpl } from "./SessionDossier";

type Props = {
  dossier: ReadableSessionDossier;
  transcript?: SessionTranscriptResult;
  transcriptError?: string;
  compactShell?: boolean;
};

/**
 * The original human-readable dossier presentation without live modal ownership.
 * Published snapshots omit `artifacts`, so related artifacts remain absent instead
 * of being recursively copied into the canonical artifact body.
 */
export function SessionDossierContent({ compactShell = false, dossier, transcript, transcriptError }: Props) {
  const content = <SessionDossierContentImpl dossier={dossier} showClose={false} transcript={transcript} transcriptError={transcriptError} />;
  if (!compactShell) return content;

  return (
    <section className="session-dossier is-compact-shell" aria-label="Canonical dossier content">
      <article className="dossier">{content}</article>
    </section>
  );
}
