import { SessionDossierContent, type SessionDossierContentProps } from "./SessionDossierContent";

type SessionDossierProps = Omit<SessionDossierContentProps, "compactShell" | "showClose">;

/** Live-only modal shell. The reusable presentation lives in SessionDossierContent. */
export function SessionDossier(props: SessionDossierProps) {
  return (
    <section className="session-dossier stage" aria-label="Session dossier">
      <div className="backdrop">
        <article className="dossier" aria-label="Session dossier modal">
          <SessionDossierContent {...props} showClose />
        </article>
      </div>
    </section>
  );
}
