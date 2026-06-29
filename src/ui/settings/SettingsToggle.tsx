type SettingsToggleProps = {
  checked?: boolean;
  disabled?: boolean;
  label: string;
};

export function SettingsToggle({ checked = false, disabled = true, label }: SettingsToggleProps) {
  return (
    <label className={`settings-toggle ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}`.trim()}>
      <input type="checkbox" checked={checked} disabled={disabled} readOnly aria-label={label} />
      <span aria-hidden="true" />
      <strong>{checked ? "Enabled" : "Disabled"}</strong>
    </label>
  );
}
