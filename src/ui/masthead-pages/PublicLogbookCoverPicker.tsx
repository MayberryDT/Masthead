import type { CoverPreview } from "../../electron/mastheadPagesCover";
import { AppButton } from "../primitives/AppButton";

export type PublicLogbookCoverPickerProps = {
  cover: CoverPreview | null;
  busy?: boolean;
  onChoose: () => void;
  onClear: () => void;
};

export function PublicLogbookCoverPicker({
  busy = false,
  cover,
  onChoose,
  onClear
}: PublicLogbookCoverPickerProps) {
  return (
    <div className="public-logbook-cover-picker" data-testid="public-logbook-cover-picker">
      <div className="public-logbook-cover-picker-label">Cover image (optional)</div>
      {cover ? (
        <div className="public-logbook-cover-preview-wrap">
          <img
            alt="Selected Public Logbook cover preview"
            className="public-logbook-cover-preview"
            data-testid="public-logbook-cover-preview"
            src={cover.previewDataUrl}
          />
          <p className="public-logbook-cover-meta">
            {cover.contentType} · {cover.byteLength.toLocaleString()} bytes
          </p>
        </div>
      ) : (
        <p className="public-logbook-cover-empty">No cover selected. Choose a square PNG, JPEG, or WebP up to 10 MiB.</p>
      )}
      <div className="public-logbook-cover-actions">
        <AppButton disabled={busy} onClick={onChoose} type="button" variant="default">
          {cover ? "Replace cover" : "Choose cover"}
        </AppButton>
        {cover ? (
          <AppButton disabled={busy} onClick={onClear} type="button" variant="quiet">
            Clear cover
          </AppButton>
        ) : null}
      </div>
    </div>
  );
}
