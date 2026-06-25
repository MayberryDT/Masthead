import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  trailing?: ReactNode;
};

export function PageHeader({ description, eyebrow, title, trailing }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <p className="mono-label">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {trailing ? <div className="page-header-trailing">{trailing}</div> : null}
    </header>
  );
}
