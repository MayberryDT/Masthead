import type { ReactNode } from "react";

type Props = {
  rail: ReactNode;
  center: ReactNode;
  inspector: ReactNode;
};

export function ControlDesktopShell({ rail, center, inspector }: Props) {
  return (
    <main className="control-desktop" aria-label="Masthead control desktop">
      <aside className="control-rail" aria-label="Session navigation">
        {rail}
      </aside>
      <section className="control-center" aria-label="Operations scan">
        {center}
      </section>
      <aside className="control-inspector" aria-label="Session inspector">
        {inspector}
      </aside>
    </main>
  );
}
