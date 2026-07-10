import type { ReactNode } from "react";

type SettingsSectionProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  danger?: boolean;
};

export function SettingsSection({ children, className = "", danger = false, description, eyebrow, title }: SettingsSectionProps) {
  const sectionClassName = ["settings-section", danger ? "settings-section-danger" : "", className].filter(Boolean).join(" ");
  return (
    <section className={sectionClassName} aria-labelledby={sectionId(title)}>
      <header className="settings-section-head">
        <div>
          {eyebrow ? <p className="mono-label">{eyebrow}</p> : null}
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
