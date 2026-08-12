import type { MastheadPagesController } from "../../app/mastheadPages/publicLogbookController";
import type { LogbookVisibility, PageLicense } from "../../mastheadPages/types";
import { AppButton } from "../primitives/AppButton";
import { PublicLogbookCoverPicker } from "./PublicLogbookCoverPicker";

export type PublicLogbookDialogProps = {
  open: boolean;
  controller: MastheadPagesController;
  error?: string | null;
  onCancel: () => void;
  onCreated?: () => void;
  onChange?: () => void;
};

const LICENSE_LABELS: Record<PageLicense, string> = {
  "all-rights-reserved": "All rights reserved",
  "cc-by-4.0": "CC BY 4.0"
};

export function PublicLogbookDialog({
  controller,
  error = null,
  onCancel,
  onChange,
  onCreated,
  open
}: PublicLogbookDialogProps) {
  if (!open) return null;

  const form = controller.getForm();
  const cover = controller.getCover();
  const busy = controller.getBusy();
  const unlistedWarning = controller.unlistedWarning();

  return (
    <section
      aria-labelledby="public-logbook-dialog-title"
      aria-modal="true"
      className="public-logbook-dialog confirm-dialog"
      data-testid="public-logbook-dialog"
      role="dialog"
    >
      <div>
        <h2 id="public-logbook-dialog-title">Create Public Logbook</h2>
        <p>Hosted Public Logbook metadata only. Optional source links remain per-Page review choices.</p>

        <label className="public-logbook-field">
          <span>Title</span>
          <input
            autoComplete="off"
            data-testid="public-logbook-title"
            disabled={busy}
            onChange={(event) => {
              controller.setForm({ title: event.currentTarget.value });
              onChange?.();
            }}
            value={form.title}
          />
        </label>

        <label className="public-logbook-field">
          <span>Slug</span>
          <input
            autoComplete="off"
            data-testid="public-logbook-slug"
            disabled={busy}
            onChange={(event) => {
              controller.setForm({ slug: event.currentTarget.value });
              onChange?.();
            }}
            spellCheck={false}
            value={form.slug}
          />
        </label>

        <label className="public-logbook-field">
          <span>Description</span>
          <textarea
            data-testid="public-logbook-description"
            disabled={busy}
            onChange={(event) => {
              controller.setForm({ description: event.currentTarget.value });
              onChange?.();
            }}
            rows={3}
            value={form.description}
          />
        </label>

        <label className="public-logbook-field">
          <span>Visibility</span>
          <select
            data-testid="public-logbook-visibility"
            disabled={busy}
            onChange={(event) => {
              controller.setForm({ visibility: event.currentTarget.value as LogbookVisibility });
              onChange?.();
            }}
            value={form.visibility}
          >
            <option value="discoverable">Discoverable</option>
            <option value="unlisted">Unlisted</option>
          </select>
        </label>
        {unlistedWarning ? (
          <p className="public-logbook-unlisted-warning" data-testid="public-logbook-unlisted-warning">
            {unlistedWarning}
          </p>
        ) : null}

        <fieldset className="public-logbook-field" data-testid="public-logbook-license">
          <legend>Default Page license</legend>
          {controller.licenseChoices.map((license) => (
            <label key={license} className="public-logbook-radio">
              <input
                checked={form.defaultLicense === license}
                disabled={busy}
                name="public-logbook-default-license"
                onChange={() => {
                  controller.setForm({ defaultLicense: license });
                  onChange?.();
                }}
                type="radio"
                value={license}
              />
              <span>{LICENSE_LABELS[license]}</span>
            </label>
          ))}
        </fieldset>

        <label className="public-logbook-field">
          <span>Companion link (optional, HTTPS)</span>
          <input
            autoComplete="off"
            data-testid="public-logbook-companion"
            disabled={busy}
            onChange={(event) => {
              controller.setForm({ companionUrl: event.currentTarget.value });
              onChange?.();
            }}
            placeholder="https://"
            spellCheck={false}
            value={form.companionUrl}
          />
        </label>

        <PublicLogbookCoverPicker
          busy={busy}
          cover={cover}
          onChoose={() => {
            void controller.chooseCover().then(() => onChange?.());
          }}
          onClear={() => {
            void controller.clearCover().then(() => onChange?.());
          }}
        />

        {error ? (
          <p className="public-logbook-error" data-testid="public-logbook-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="confirm-dialog-actions">
        <AppButton
          disabled={busy}
          onClick={() => {
            void controller.clearCover().finally(() => onCancel());
          }}
          variant="quiet"
        >
          Cancel
        </AppButton>
        <AppButton
          disabled={busy}
          onClick={() => {
            void controller.confirmCreateLogbook().then(() => onCreated?.());
          }}
          variant="primary"
        >
          Create Public Logbook
        </AppButton>
      </div>
    </section>
  );
}
