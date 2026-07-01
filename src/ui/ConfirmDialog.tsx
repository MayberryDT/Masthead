import { useEffect, useState } from "react";
import { AppButton } from "./primitives/AppButton";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  expectedConfirmation?: string;
  safetyNote?: string;
  busy?: boolean;
  tone?: "danger" | "default";
  onCancel?: () => void;
  onConfirm?: () => void;
};

export function ConfirmDialog({
  busy = false,
  confirmLabel,
  description,
  expectedConfirmation,
  onCancel,
  onConfirm,
  open,
  safetyNote,
  title,
  tone = "default"
}: ConfirmDialogProps) {
  const [confirmationText, setConfirmationText] = useState("");
  const requiresTypedConfirmation = Boolean(expectedConfirmation);
  const confirmDisabled = busy || (requiresTypedConfirmation && confirmationText !== expectedConfirmation);

  useEffect(() => {
    if (open) setConfirmationText("");
  }, [expectedConfirmation, open]);

  if (!open) return null;
  return (
    <section className={`confirm-dialog confirm-dialog-${tone}`} role="dialog" aria-modal="false" aria-labelledby="confirm-dialog-title">
      <div>
        <h2 id="confirm-dialog-title">{title}</h2>
        {description ? <p>{description}</p> : null}
        {safetyNote ? <p className="confirm-dialog-safety">{safetyNote}</p> : null}
        {expectedConfirmation ? (
          <label className="confirm-dialog-typed">
            <span>Type {expectedConfirmation} to confirm</span>
            <input
              autoComplete="off"
              value={confirmationText}
              placeholder={expectedConfirmation}
              onChange={(event) => setConfirmationText(event.currentTarget.value)}
            />
          </label>
        ) : null}
      </div>
      <div className="confirm-dialog-actions">
        <AppButton disabled={busy} onClick={onCancel} variant="quiet">
          Cancel
        </AppButton>
        <AppButton disabled={confirmDisabled} onClick={confirmDisabled ? undefined : onConfirm} variant={tone === "danger" ? "danger" : "primary"}>
          {confirmLabel}
        </AppButton>
      </div>
    </section>
  );
}
