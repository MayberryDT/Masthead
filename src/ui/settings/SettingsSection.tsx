import type { ReactNode } from "react";

type SettingsSectionProps = {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  danger?: boolean;
};

export function SettingsSection({ children, danger = false, description, eyebrow, title }: SettingsSectionProps) {
  return (
    <section className={`settings-section ${danger ? "settings-section-danger" : ""}`.trim()} aria-labelledby={sectionId(title)}>
      <header className="settings-section-head">
        <div>
          <p className="mono-label">{eyebrow}</p>
          <h2 id={sectionId(title)}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function sectionId(title: string): string {
  return `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
