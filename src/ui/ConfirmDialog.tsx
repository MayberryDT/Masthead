import { AppButton } from "./primitives/AppButton";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  busy?: boolean;
  tone?: "danger" | "default";
  onCancel?: () => void;
  onConfirm?: () => void;
};

export function ConfirmDialog({
  busy = false,
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  open,
  title,
  tone = "default"
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <section className={`confirm-dialog confirm-dialog-${tone}`} role="dialog" aria-modal="false" aria-labelledby="confirm-dialog-title">
      <div>
        <h2 id="confirm-dialog-title">{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="confirm-dialog-actions">
        <AppButton disabled={busy} onClick={onCancel} variant="quiet">
          Cancel
        </AppButton>
        <AppButton disabled={busy} onClick={onConfirm} variant={tone === "danger" ? "danger" : "primary"}>
          {confirmLabel}
        </AppButton>
      </div>
    </section>
  );
}
