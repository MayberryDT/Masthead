import { useEffect, useState } from "react";

type SettingsToggleProps = {
  checked?: boolean;
  disabled?: boolean;
  label: string;
  onChange?: (checked: boolean) => void;
};

export function SettingsToggle({ checked = false, disabled = false, label, onChange }: SettingsToggleProps) {
  const [localChecked, setLocalChecked] = useState(checked);

  useEffect(() => {
    setLocalChecked(checked);
  }, [checked]);

  return (
    <label className={`settings-toggle ${localChecked ? "checked" : ""} ${disabled ? "disabled" : ""}`.trim()}>
      <input
        type="checkbox"
        checked={localChecked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const nextChecked = event.currentTarget.checked;
          setLocalChecked(nextChecked);
          onChange?.(nextChecked);
        }}
      />
      <span aria-hidden="true" />
      <strong>{localChecked ? "Enabled" : "Disabled"}</strong>
    </label>
  );
}
