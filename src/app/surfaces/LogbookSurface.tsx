import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function LogbookSurface({ children }: Props) {
  return (
    <section className="app-surface logbook-surface" aria-label="Logbook">
      {children}
    </section>
  );
}
