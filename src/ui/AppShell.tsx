import type { ReactNode } from "react";

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
};

export function AppShell({ sidebar, main }: Props) {
  return (
    <main className="masthead-shell" aria-label="Masthead session manager">
      <aside className="masthead-sidebar metal-sidebar" aria-label="Primary navigation">
        {sidebar}
      </aside>
      <section className="masthead-workspace">
        <div className="masthead-content">
          <section className="masthead-main" aria-label="Session workspace">
            {main}
          </section>
        </div>
      </section>
    </main>
  );
}
