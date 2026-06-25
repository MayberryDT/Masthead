import type { ReactNode } from "react";

type FieldRowProps = {
  label: string;
  description?: string;
  value?: ReactNode;
  control?: ReactNode;
};

export function FieldRow({ control, description, label, value }: FieldRowProps) {
  return (
    <div className="field-row">
      <div className="field-row-copy">
        <span>{label}</span>
        {description ? <p>{description}</p> : null}
      </div>
      {value ? <div className="field-row-value">{value}</div> : null}
      {control ? <div className="field-row-control">{control}</div> : null}
    </div>
  );
}
