import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function SourcesSurface({ children }: Props) {
  return (
    <section className="app-surface sources-surface" aria-label="Sources">
      {children}
    </section>
  );
}
