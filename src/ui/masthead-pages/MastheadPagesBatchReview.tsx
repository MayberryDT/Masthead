import type { PageLicense, PublicLogbookSummaryV1 } from "../../mastheadPages/types";
import type { MastheadPagesBatchState } from "../../app/mastheadPages/types";
import type { MastheadPagesConnectionState } from "../../app/desktopBridge";
import { AppButton } from "../primitives/AppButton";
import { MastheadPagesStatus } from "./MastheadPagesStatus";

export type MastheadPagesBatchReviewProps = {
  open: boolean;
  batch: MastheadPagesBatchState;
  readyCount: number;
  busy?: boolean;
  onClose: () => void;
  onConnect?: () => void;
  onPublicLogbookIdChange: (id: string) => void;
  onLicenseChange: (license: PageLicense) => void;
  onAcknowledgeWarningsChange: (value: boolean) => void;
  onItemSelectedChange: (artifactId: string, selected: boolean) => void;
  onFinalize: () => void;
  onConfirmPublish: () => void;
};

export function MastheadPagesBatchReview({
  batch,
  busy = false,
  onAcknowledgeWarningsChange,
  onClose,
  onConfirmPublish,
  onConnect,
  onFinalize,
  onItemSelectedChange,
  onLicenseChange,
  onPublicLogbookIdChange,
  open,
  readyCount
}: MastheadPagesBatchReviewProps) {
  if (!open || batch.phase === "closed") return null;

  const fieldsLocked =
    batch.phase === "finalizing" || batch.phase === "publishing" || batch.phase === "complete";
  const ready = batch.items.filter((item) => item.finalized?.decision === "ready" && item.finalized.staged);
  const needsReview = batch.items.filter((item) => item.finalized?.decision === "needs_review");
  const blocked = batch.items.filter(
    (item) =>
      item.finalized?.decision === "blocked" ||
      item.prepared?.eligibility === "ineligible" ||
      (!item.finalized && batch.phase === "reviewing")
  );
  const showGroups = batch.phase === "reviewing" || batch.phase === "publishing" || batch.phase === "complete";

  return (
    <div className="masthead-pages-review-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="masthead-pages-batch-title"
        aria-modal="true"
        className="masthead-pages-review-dialog masthead-pages-batch-dialog metal-surface"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="masthead-pages-review-header">
          <div>
            <p className="mono-label">Publish to Masthead Pages</p>
            <h2 id="masthead-pages-batch-title">Review {batch.artifactIds.length} Pages</h2>
            <p className="masthead-pages-help">
              Ready items are daemon-staged before transfer. Needs review and Blocked items are never sent over IPC.
            </p>
          </div>
          <AppButton aria-label="Close Masthead Pages batch review" onClick={onClose} variant="quiet">
            Close
          </AppButton>
        </header>

        <div className="masthead-pages-review-body">
          <MastheadPagesStatus
            connection={batch.connection as MastheadPagesConnectionState | undefined}
            error={batch.error}
            outcome={{ kind: "idle" }}
          />
          {batch.gate === "disconnected" || batch.gate === "desktop_unavailable" ? (
            <div className="masthead-pages-review-actions">
              <AppButton onClick={onConnect} variant="primary">
                Connect Masthead Pages
              </AppButton>
            </div>
          ) : null}

          <section className="masthead-pages-review-step" aria-label="Destination">
            <p className="mono-label">Destination</p>
            <label className="masthead-pages-field">
              Public Logbook
              <select
                aria-label="Destination Public Logbook"
                disabled={fieldsLocked || batch.logbooks.length === 0}
                value={batch.publicLogbookId}
                onChange={(event) => onPublicLogbookIdChange(event.currentTarget.value)}
              >
                {batch.logbooks.length === 0 ? <option value="">No Public Logbooks</option> : null}
                {batch.logbooks.map((logbook: PublicLogbookSummaryV1) => (
                  <option key={logbook.id} value={logbook.id}>
                    {logbook.title} ({logbook.slug})
                  </option>
                ))}
              </select>
            </label>
            <label className="masthead-pages-field">
              License
              <select
                aria-label="Page license"
                disabled={fieldsLocked}
                value={batch.license}
                onChange={(event) => onLicenseChange(event.currentTarget.value as PageLicense)}
              >
                <option value="all-rights-reserved">All rights reserved</option>
                <option value="cc-by-4.0">CC BY 4.0</option>
                <option value="cc-by-sa-4.0">CC BY-SA 4.0</option>
                <option value="cc0-1.0">CC0 1.0</option>
              </select>
            </label>
            <label className="masthead-pages-checkbox">
              <input
                checked={batch.acknowledgeWarnings}
                disabled={fieldsLocked}
                type="checkbox"
                onChange={(event) => onAcknowledgeWarningsChange(event.currentTarget.checked)}
              />
              <span>Acknowledge warnings for Needs review items so they can be staged when finalized</span>
            </label>
          </section>

          {!showGroups ? (
            <section className="masthead-pages-review-step" aria-label="Batch selection">
              <p className="mono-label">Selected Pages</p>
              <ul className="masthead-pages-batch-list">
                {batch.items.map((item) => (
                  <li key={item.artifactId}>
                    <strong>{item.title ?? item.artifactId}</strong>
                    <span className="mono-label">
                      {item.prepared?.eligibility === "eligible"
                        ? "Eligible"
                        : item.prepared?.ineligibilityReason
                          ? `Ineligible: ${item.prepared.ineligibilityReason}`
                          : batch.phase === "loading"
                            ? "Preparing…"
                            : "Ineligible"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <>
              <BatchGroup
                title="Ready"
                empty="No Ready Pages"
                items={ready}
                selectable
                onItemSelectedChange={onItemSelectedChange}
              />
              <BatchGroup title="Needs review" empty="No Pages need review" items={needsReview} />
              <BatchGroup title="Blocked" empty="No Blocked Pages" items={blocked} />
            </>
          )}
        </div>

        <footer className="masthead-pages-review-actions">
          {batch.phase === "editing" || batch.phase === "loading" || batch.phase === "error" || batch.phase === "finalizing" ? (
            <AppButton
              disabled={busy || batch.phase === "loading" || batch.phase === "finalizing" || Boolean(batch.gate && batch.gate !== "needs_warning_ack")}
              onClick={onFinalize}
              variant="primary"
            >
              {batch.phase === "finalizing" || busy ? "Finalizing…" : "Finalize batch review"}
            </AppButton>
          ) : null}
          {showGroups && batch.phase !== "complete" ? (
            <AppButton
              disabled={busy || readyCount === 0 || batch.phase === "publishing"}
              onClick={onConfirmPublish}
              variant="primary"
            >
              {batch.phase === "publishing"
                ? "Publishing…"
                : `Publish ${readyCount} to Masthead Pages`}
            </AppButton>
          ) : null}
          {batch.phase === "complete" ? (
            <AppButton onClick={onClose} variant="primary">
              Done
            </AppButton>
          ) : null}
          <AppButton disabled={busy && batch.phase === "publishing"} onClick={onClose} variant="quiet">
            Cancel
          </AppButton>
        </footer>
      </section>
    </div>
  );
}

function BatchGroup({
  empty,
  items,
  onItemSelectedChange,
  selectable = false,
  title
}: {
  title: string;
  empty: string;
  items: MastheadPagesBatchState["items"];
  selectable?: boolean;
  onItemSelectedChange?: (artifactId: string, selected: boolean) => void;
}) {
  return (
    <section className="masthead-pages-review-step" aria-label={title}>
      <p className="mono-label">
        {title} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="masthead-pages-help">{empty}</p>
      ) : (
        <ul className="masthead-pages-batch-list">
          {items.map((item) => (
            <li key={item.artifactId}>
              {selectable ? (
                <label className="masthead-pages-checkbox">
                  <input
                    aria-label={`Publish ${item.title ?? item.artifactId}`}
                    checked={item.selectedForPublish}
                    disabled={!item.finalized?.staged}
                    type="checkbox"
                    onChange={(event) => onItemSelectedChange?.(item.artifactId, event.currentTarget.checked)}
                  />
                  <span>
                    <strong>{item.title ?? item.artifactId}</strong>
                    {item.outcome.kind === "published" ? (
                      <span className="masthead-pages-help"> Published</span>
                    ) : null}
                    {item.outcome.kind === "failed" ? (
                      <span className="masthead-pages-status-error"> {item.outcome.message}</span>
                    ) : null}
                  </span>
                </label>
              ) : (
                <span>
                  <strong>{item.title ?? item.artifactId}</strong>
                  {item.prepared?.ineligibilityReason ? (
                    <span className="masthead-pages-help"> — {item.prepared.ineligibilityReason}</span>
                  ) : null}
                  {item.finalized?.findings?.[0] ? (
                    <span className="masthead-pages-help"> — {item.finalized.findings[0]!.message}</span>
                  ) : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
