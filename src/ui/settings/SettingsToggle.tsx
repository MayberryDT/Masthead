type SettingsToggleProps = {
  checked?: boolean;
  disabled?: boolean;
  label: string;
  offLabel?: string;
  onChange?: (checked: boolean) => void;
  onLabel?: string;
};

export function SettingsToggle({
  checked = false,
  disabled = false,
  label,
  offLabel = "Disabled",
  onChange,
  onLabel = "Enabled"
}: SettingsToggleProps) {
  const controlDisabled = disabled || !onChange;

  return (
    <label className={`settings-toggle ${checked ? "checked" : ""} ${controlDisabled ? "disabled" : ""}`.trim()}>
      <input
        type="checkbox"
        checked={checked}
        disabled={controlDisabled}
        aria-label={label}
        onChange={(event) => onChange?.(event.currentTarget.checked)}
      />
      <span aria-hidden="true" />
      <strong>{checked ? onLabel : offLabel}</strong>
    </label>
  );
}
