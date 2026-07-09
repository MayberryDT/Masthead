import type { ReactNode } from "react";

type SettingsRowProps = {
  label: string;
  description?: string;
  value?: ReactNode;
  control?: ReactNode;
};

export function SettingsRow({ control, description, label, value }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <span>{label}</span>
        {description ? <p>{description}</p> : null}
      </div>
      {value || control ? (
        <div className="settings-row-detail">
          {value ? <div className="settings-row-value">{value}</div> : null}
          {control ? <div className="settings-row-control">{control}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
