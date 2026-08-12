import type { ReactNode } from "react";
import type { EgressFinding } from "../../mastheadPages/egressPreflight";
import type { PageLicense, PublicLogbookSummaryV1, SourceLinkV1 } from "../../mastheadPages/types";
import type { MastheadPagesEvidenceCandidate, MastheadPagesPublicationOutcome, MastheadPagesReviewPhase } from "../../app/mastheadPages/types";
import type { MastheadPagesConnectionState } from "../../app/desktopBridge";
import { AppButton } from "../primitives/AppButton";
import { MastheadPagesEvidencePicker } from "./MastheadPagesEvidencePicker";
import { MastheadPagesStatus } from "./MastheadPagesStatus";

export type MastheadPagesReviewDialogProps = {
  open: boolean;
  phase: MastheadPagesReviewPhase;
  title?: string;
  artifactId?: string;
  connection?: MastheadPagesConnectionState;
  logbooks: PublicLogbookSummaryV1[];
  publicLogbookId: string;
  license: PageLicense;
  slug: string;
  evidenceCandidates: MastheadPagesEvidenceCandidate[];
  selectedEvidenceRefs: string[];
  sourceLinks: SourceLinkV1[];
  includeSourceDate: boolean;
  acknowledgeWarnings: boolean;
  findings: EgressFinding[];
  previewObject?: unknown;
  previewRequest?: unknown;
  decision?: "ready" | "needs_review" | "blocked";
  canConfirmPublish: boolean;
  confirmPublishLabel?: string;
  releaseActions?: ReactNode;
  outcome: MastheadPagesPublicationOutcome;
  error?: string;
  gate?: string;
  busy?: boolean;
  onClose: () => void;
  onConnect?: () => void;
  onPublicLogbookIdChange: (id: string) => void;
  onLicenseChange: (license: PageLicense) => void;
  onSlugChange: (slug: string) => void;
  onEvidenceChange: (refs: string[]) => void;
  onIncludeSourceDateChange: (value: boolean) => void;
  onAcknowledgeWarningsChange: (value: boolean) => void;
  onFinalize: () => void;
  onConfirmPublish: () => void;
};

export function MastheadPagesReviewDialog({
  acknowledgeWarnings,
  artifactId,
  busy = false,
  canConfirmPublish,
  confirmPublishLabel = "Publish to Masthead Pages",
  connection,
  decision,
  error,
  evidenceCandidates,
  findings,
  gate,
  includeSourceDate,
  license,
  logbooks,
  onAcknowledgeWarningsChange,
  onClose,
  onConfirmPublish,
  onConnect,
  onEvidenceChange,
  onFinalize,
  onIncludeSourceDateChange,
  onLicenseChange,
  onPublicLogbookIdChange,
  onSlugChange,
  open,
  outcome,
  phase,
  previewObject,
  previewRequest,
  publicLogbookId,
  releaseActions,
  selectedEvidenceRefs,
  slug,
  title
}: MastheadPagesReviewDialogProps) {
  if (!open) return null;

  const fieldsLocked =
    phase === "finalizing" || phase === "publishing" || phase === "removing" || phase === "complete";
  const showWarningAck = decision === "needs_review" || findings.some((finding) => finding.severity === "warn");
  const blocked = decision === "blocked" || gate === "blocked";
  const publishBusyLabel =
    phase === "publishing" ? "Publishing…" : phase === "removing" ? "Removing…" : confirmPublishLabel;

  return (
    <div className="masthead-pages-review-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="masthead-pages-review-title"
        aria-modal="true"
        className="masthead-pages-review-dialog metal-surface"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="masthead-pages-review-header">
          <div>
            <p className="mono-label">{confirmPublishLabel}</p>
            <h2 id="masthead-pages-review-title">{title ?? "Review outbound Page"}</h2>
            {artifactId ? <p className="masthead-pages-review-artifact mono-label">{artifactId}</p> : null}
          </div>
          <AppButton aria-label="Close Masthead Pages review" onClick={onClose} variant="quiet">
            Close
          </AppButton>
        </header>

        <div className="masthead-pages-review-body">
          <section aria-label="Destination" className="masthead-pages-review-step">
            <p className="mono-label">1. Destination</p>
            <MastheadPagesStatus connection={connection} error={undefined} outcome={outcome} />
            {releaseActions}
            {connection?.status !== "connected" ? (
              <AppButton disabled={busy} onClick={onConnect} variant="primary">
                Connect Masthead Pages
              </AppButton>
            ) : (
              <label className="masthead-pages-field">
                <span>Public Logbook</span>
                <select
                  disabled={fieldsLocked || logbooks.length === 0}
                  value={publicLogbookId}
                  onChange={(event) => onPublicLogbookIdChange(event.currentTarget.value)}
                >
                  <option value="">Select a Public Logbook</option>
                  {logbooks.map((logbook) => (
                    <option key={logbook.id} value={logbook.id}>
                      {logbook.title} ({logbook.slug})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="masthead-pages-field">
              <span>License</span>
              <select
                disabled={fieldsLocked}
                value={license}
                onChange={(event) => onLicenseChange(event.currentTarget.value as PageLicense)}
              >
                <option value="all-rights-reserved">All rights reserved</option>
                <option value="cc-by-4.0">CC BY 4.0</option>
              </select>
            </label>
            <label className="masthead-pages-field">
              <span>Public slug</span>
              <input
                disabled={fieldsLocked}
                value={slug}
                onChange={(event) => onSlugChange(event.currentTarget.value)}
              />
            </label>
          </section>

          <section aria-label="Content and evidence" className="masthead-pages-review-step">
            <p className="mono-label">2. Content and evidence</p>
            <MastheadPagesEvidencePicker
              candidates={evidenceCandidates}
              disabled={fieldsLocked}
              selectedRefs={selectedEvidenceRefs}
              onChange={onEvidenceChange}
            />
            <label className="masthead-pages-checkbox">
              <input
                checked={includeSourceDate}
                disabled={fieldsLocked}
                type="checkbox"
                onChange={(event) => onIncludeSourceDateChange(event.currentTarget.checked)}
              />
              <span>Include source date on the public Page</span>
            </label>
          </section>

          <section aria-label="Findings" className="masthead-pages-review-step">
            <p className="mono-label">3. Findings</p>
            {findings.length === 0 ? (
              <p className="surface-status">No findings yet. Run review to scan the exact outbound request.</p>
            ) : (
              <ul className="masthead-pages-findings">
                {findings.map((finding, index) => (
                  <li key={`${finding.code}-${finding.path}-${index}`} data-severity={finding.severity}>
                    <strong>{finding.severity}</strong> {finding.code} · {finding.path}
                    <span>{finding.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {showWarningAck ? (
              <label className="masthead-pages-checkbox">
                <input
                  checked={acknowledgeWarnings}
                  disabled={phase === "finalizing" || phase === "publishing" || phase === "complete"}
                  type="checkbox"
                  onChange={(event) => onAcknowledgeWarningsChange(event.currentTarget.checked)}
                />
                <span>I reviewed the warnings and accept publishing this outbound request</span>
              </label>
            ) : null}
          </section>

          <section aria-label="Human preview" className="masthead-pages-review-step">
            <p className="mono-label">4. Human preview</p>
            <pre className="masthead-pages-json">{pretty(previewObject)}</pre>
          </section>

          <section aria-label="Complete JSON request" className="masthead-pages-review-step">
            <p className="mono-label">5. Complete JSON / request envelope</p>
            <pre className="masthead-pages-json">{pretty(previewRequest)}</pre>
          </section>

          <section aria-label="Confirmation" className="masthead-pages-review-step">
            <p className="mono-label">6. Confirmation</p>
            {error ? (
              <p className="masthead-pages-status-error" role="alert">
                {error}
              </p>
            ) : null}
            {decision ? <p className="surface-status">Review decision: {decision}</p> : null}
            <div className="masthead-pages-review-actions">
              <AppButton
                disabled={
                  busy ||
                  phase === "finalizing" ||
                  phase === "publishing" ||
                  phase === "removing" ||
                  phase === "complete"
                }
                onClick={onFinalize}
                variant="default"
              >
                {phase === "finalizing" ? "Running review…" : "Run outbound review"}
              </AppButton>
              <AppButton
                disabled={
                  busy ||
                  !canConfirmPublish ||
                  blocked ||
                  phase === "publishing" ||
                  phase === "removing" ||
                  phase === "complete"
                }
                onClick={onConfirmPublish}
                variant="primary"
              >
                {publishBusyLabel}
              </AppButton>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function pretty(value: unknown): string {
  if (value === undefined) return "Run outbound review to materialize the exact request.";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
