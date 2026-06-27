import type { ReactNode } from "react";

export function UsageSurface({ children }: { children: ReactNode }) {
  return (
    <section className="app-surface usage-surface surface-panel" aria-label="Usage">
      {children}
    </section>
  );
}
