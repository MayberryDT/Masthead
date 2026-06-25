import type { ReactNode } from "react";
import { PageHeader } from "../../ui/primitives/PageHeader";

type Props = {
  children: ReactNode;
};

export function SettingsSurface({ children }: Props) {
  return (
    <section className="app-surface settings-surface surface-panel" aria-label="Settings">
      <PageHeader eyebrow="Settings" title="Settings" description="Configure Masthead's local session database, integrations, privacy, and storage controls." />
      {children}
    </section>
  );
}
