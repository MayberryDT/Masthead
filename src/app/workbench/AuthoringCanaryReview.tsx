import { useState } from "react";
import type { GuidedAuthoringReviewDto } from "../../shared/guidedAuthoring";
import { AppButton } from "../../ui/primitives/AppButton";
import { sanitizeWorkbenchVisibleText } from "../../ui/workbench/workbenchHandoff";

type AuthoringCanaryReviewProps = {
  busy?: boolean;
  onApprove: (review: GuidedAuthoringReviewDto, reviewedBy: string) => Promise<void> | void;
  onReject: (review: GuidedAuthoringReviewDto, notes: string, reviewedBy: string) => Promise<void> | void;
  review: GuidedAuthoringReviewDto;
};

export function AuthoringCanaryReview({
  busy = false,
  onApprove,
  onReject,
  review
}: AuthoringCanaryReviewProps) {
  const [operatorIdentifier, setOperatorIdentifier] = useState("");
  const [operatorError, setOperatorError] = useState<string>();
  const [notes, setNotes] = useState("");
  const [notesError, setNotesError] = useState<string>();
  const draft = review.draft;
  const support = [
    ...(draft?.sessionEnrichments.flatMap((item) => item.claimSupport) ?? []),
    ...(draft?.artifacts.flatMap((artifact) => artifact.output.claimSupport ?? []) ?? [])
  ].filter(isClaimSupport);

  const reviewedBy = (): string | undefined => {
    const normalized = operatorIdentifier.trim();
    if (!normalized) {
      setOperatorError("Enter your operator identifier before reviewing this canary.");
      return undefined;
    }
    setOperatorError(undefined);
    return normalized;
  };

  const approve = () => {
    const operator = reviewedBy();
    if (!operator) return;
    void Promise.resolve(onApprove(review, operator)).catch(() => undefined);
  };

  const reject = () => {
    const operator = reviewedBy();
    if (!operator) return;
    const normalizedNotes = notes.trim();
    if (!normalizedNotes) {
      setNotesError("Add review notes before rejecting this canary.");
      return;
    }
    setNotesError(undefined);
    void Promise.resolve(onReject(review, normalizedNotes, operator)).catch(() => undefined);
  };

  return (
    <section className="authoring-canary-review" aria-label="Guided authoring canary review">
        <header className="authoring-canary-head">
          <div>
            <p className="mono-label">Canary review</p>
            <p className="authoring-canary-identity">
              {sanitizeWorkbenchVisibleText(review.assignmentId)} · draft {review.draftRevision ?? "—"}
            </p>
          </div>
          <span className="authoring-canary-status">
            {sanitizeWorkbenchVisibleText(review.status).replaceAll("_", " ")}
          </span>
        </header>

        {review.editorialQuestions.length > 0 ? (
          <div className="authoring-canary-questions">
            <p className="mono-label">Editorial questions</p>
            {review.editorialQuestions.map((question) => (
              <p key={question}>{sanitizeWorkbenchVisibleText(question)}</p>
            ))}
          </div>
        ) : null}

        <div className="authoring-canary-drafts" aria-label="Canary drafts">
          {draft?.sessionEnrichments.map((item) => (
            <article className="authoring-draft-capsule" key={item.sessionId}>
              <span className="authoring-draft-kind">session dossier</span>
              <strong>{sanitizeWorkbenchVisibleText(item.enrichment.sessionTitle.text)}</strong>
              <p>{sanitizeWorkbenchVisibleText(item.enrichment.sessionSummary.text)}</p>
              <small>{sanitizeWorkbenchVisibleText(item.sessionId)}</small>
            </article>
          ))}
          {draft?.artifacts.map((artifact) => (
            <article className="authoring-draft-capsule" key={artifact.draftId}>
              <span className="authoring-draft-kind">{sanitizeWorkbenchVisibleText(artifact.kind)}</span>
              <strong>{artifactTitle(artifact.output)}</strong>
              <p>{artifactSummary(artifact.output)}</p>
              <small>{artifact.provenanceSessionIds.length} source session{artifact.provenanceSessionIds.length === 1 ? "" : "s"}</small>
            </article>
          ))}
          {!draft ? <p className="workbench-muted">Draft payload unavailable</p> : null}
        </div>

        {support.length > 0 ? (
          <div className="authoring-canary-support">
            <p className="mono-label">Claim support</p>
            {support.map((claim, index) => (
              <blockquote key={`${claim.evidenceRef}:${index}`}>
                <p>{sanitizeWorkbenchVisibleText(claim.excerpt)}</p>
                <cite>{sanitizeWorkbenchVisibleText(claim.evidenceRef)}</cite>
              </blockquote>
            ))}
          </div>
        ) : null}

        {review.findings.length > 0 ? (
          <div className="authoring-canary-findings" aria-label="Quality findings">
            <p className="mono-label">Quality findings</p>
            <ul>
              {review.findings.map((finding, index) => (
                <li className={`is-${finding.severity}`} key={`${finding.code}:${finding.path ?? index}`}>
                  <strong>{sanitizeWorkbenchVisibleText(finding.code)}</strong>
                  <span>{sanitizeWorkbenchVisibleText(finding.message)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="authoring-canary-decision">
          <label>
            <span className="mono-label">Operator identifier</span>
            <input
              type="text"
              value={operatorIdentifier}
              onChange={(event) => {
                setOperatorIdentifier(event.target.value);
                if (operatorError) setOperatorError(undefined);
              }}
              disabled={busy}
              autoComplete="username"
              placeholder="Your name, email, or team identifier"
            />
          </label>
          {operatorError ? <p className="authoring-canary-error" role="alert">{operatorError}</p> : null}
          <label>
            <span className="mono-label">Rejection notes</span>
            <textarea
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                if (notesError) setNotesError(undefined);
              }}
              disabled={busy}
              rows={3}
              placeholder="Required when rejecting"
            />
          </label>
          {notesError ? <p className="authoring-canary-error" role="alert">{notesError}</p> : null}
          <div className="authoring-canary-actions">
            <AppButton
              variant="primary"
              disabled={busy}
              onClick={approve}
            >
              Approve canary
            </AppButton>
            <AppButton variant="quiet" disabled={busy} onClick={reject}>
              Reject canary
            </AppButton>
          </div>
        </div>
    </section>
  );
}

function isClaimSupport(value: unknown): value is { evidenceRef: string; excerpt: string } {
  return Boolean(value) && typeof value === "object" &&
    typeof (value as { evidenceRef?: unknown }).evidenceRef === "string" &&
    typeof (value as { excerpt?: unknown }).excerpt === "string";
}

function artifactTitle(output: Record<string, unknown>): string {
  for (const key of ["title", "decision", "problem", "summary"]) {
    if (typeof output[key] === "string" && output[key].trim()) {
      return sanitizeWorkbenchVisibleText(output[key]);
    }
  }
  return "Authored knowledge artifact";
}

function artifactSummary(output: Record<string, unknown>): string {
  for (const key of ["summary", "outcome", "decision", "context", "problem"]) {
    if (typeof output[key] === "string" && output[key].trim()) {
      return sanitizeWorkbenchVisibleText(output[key]);
    }
  }
  return "Grounded draft ready for operator review.";
}
