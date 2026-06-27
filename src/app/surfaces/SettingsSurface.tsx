import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function SettingsSurface({ children }: Props) {
  return (
    <section className="app-surface settings-surface surface-panel" aria-label="Settings">
      {children}
    </section>
  );
}
