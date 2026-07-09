import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function WorkbenchSurface({ children }: Props) {
  return (
    <section className="app-surface workbench-surface surface-panel" aria-label="Workbench">
      {children}
    </section>
  );
}
