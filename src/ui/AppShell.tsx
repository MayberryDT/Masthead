import type { ReactNode } from "react";

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
  rightRail?: ReactNode;
};

export function AppShell({ sidebar, main, rightRail }: Props) {
  return (
    <main className="masthead-shell" aria-label="Masthead session manager">
      <aside className="masthead-sidebar metal-sidebar" aria-label="Primary navigation">
        {sidebar}
      </aside>
      <section className="masthead-workspace">
        <div className={`masthead-content ${rightRail ? "has-right-rail" : "without-right-rail"}`.trim()}>
          <section className="masthead-main" aria-label="Session workspace">
            {main}
          </section>
          {rightRail ? (
            <aside className="masthead-right-rail" aria-label="Context panel">
              {rightRail}
            </aside>
          ) : null}
        </div>
      </section>
    </main>
  );
}
