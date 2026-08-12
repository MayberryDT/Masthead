import type { MastheadPagesReleaseUiState } from "../../mastheadPages/releaseState";
import {
  REMOVAL_HONEST_COPY,
  releaseStateLabel
} from "../../mastheadPages/releaseState";
import { AppButton } from "../primitives/AppButton";

export type MastheadPagesReleaseActionsProps = {
  releaseState: MastheadPagesReleaseUiState;
  friendlyUrl?: string;
  exactUrl?: string;
  lastError?: string;
  parentConflictObjectId?: string;
  canRetryPublish?: boolean;
  canRetryRemove?: boolean;
  canRemove?: boolean;
  canPublish?: boolean;
  busy?: boolean;
  showRemovalWarning?: boolean;
  onPublish?: () => void;
  onRetryPublish?: () => void;
  onRetryRemove?: () => void;
  onRemove?: () => void;
  onConfirmRemove?: () => void;
  onCancelRemove?: () => void;
};

export function MastheadPagesReleaseActions({
  busy = false,
  canPublish = false,
  canRemove = false,
  canRetryPublish = false,
  canRetryRemove = false,
  exactUrl,
  friendlyUrl,
  lastError,
  onCancelRemove,
  onConfirmRemove,
  onPublish,
  onRemove,
  onRetryPublish,
  onRetryRemove,
  parentConflictObjectId,
  releaseState,
  showRemovalWarning = false
}: MastheadPagesReleaseActionsProps) {
  const publishLabel =
    releaseState === "changed_locally" || releaseState === "live" ? "Publish new revision" : "Publish to Masthead Pages";

  return (
    <div className="masthead-pages-release-actions" aria-label="Masthead Pages release actions">
      <p className="mono-label">Masthead Pages status</p>
      <p data-release-state={releaseState}>{releaseStateLabel(releaseState)}</p>

      {friendlyUrl ? (
        <p>
          <a href={friendlyUrl} rel="noreferrer" target="_blank">
            {friendlyUrl}
          </a>
        </p>
      ) : null}

      {exactUrl && exactUrl !== friendlyUrl ? (
        <p className="masthead-pages-help">
          Exact revision:{" "}
          <a href={exactUrl} rel="noreferrer" target="_blank">
            {exactUrl}
          </a>
        </p>
      ) : null}

      {parentConflictObjectId ? (
        <p className="masthead-pages-status-error" role="alert">
          Parent conflict. Hosted current object: <span className="mono-label">{parentConflictObjectId}</span>. Refresh
          and run outbound review again — do not blind overwrite.
        </p>
      ) : null}

      {lastError ? (
        <p className="masthead-pages-status-error" role="alert">
          {lastError}
        </p>
      ) : null}

      {showRemovalWarning ? (
        <div className="masthead-pages-removal-warning" role="note">
          <p>{REMOVAL_HONEST_COPY}</p>
          <div className="masthead-pages-review-actions">
            <AppButton disabled={busy} onClick={onCancelRemove} variant="quiet">
              Cancel removal
            </AppButton>
            <AppButton disabled={busy} onClick={onConfirmRemove} variant="primary">
              Confirm remove from Masthead Pages
            </AppButton>
          </div>
        </div>
      ) : (
        <div className="masthead-pages-review-actions">
          {canPublish && onPublish ? (
            <AppButton disabled={busy} onClick={onPublish} variant="primary">
              {publishLabel}
            </AppButton>
          ) : null}
          {canRetryPublish && onRetryPublish ? (
            <AppButton disabled={busy} onClick={onRetryPublish} variant="default">
              Retry publication
            </AppButton>
          ) : null}
          {canRetryRemove && onRetryRemove ? (
            <AppButton disabled={busy} onClick={onRetryRemove} variant="default">
              Retry removal
            </AppButton>
          ) : null}
          {canRemove && onRemove ? (
            <AppButton disabled={busy} onClick={onRemove} variant="quiet">
              Remove from Masthead Pages
            </AppButton>
          ) : null}
        </div>
      )}
    </div>
  );
}
