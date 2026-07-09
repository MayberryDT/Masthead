import type { ReactNode } from "react";

type SettingsSectionProps = {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  danger?: boolean;
};

export function SettingsSection({ children, className = "", danger = false, description, title }: SettingsSectionProps) {
  const sectionClassName = ["settings-section", danger ? "settings-section-danger" : "", className].filter(Boolean).join(" ");
  return (
    <section className={sectionClassName} aria-labelledby={sectionId(title)}>
      <header className="settings-section-head">
        <h2 id={sectionId(title)}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function sectionId(title: string): string {
  return `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
