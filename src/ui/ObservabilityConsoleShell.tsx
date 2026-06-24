import type { ReactNode } from "react";

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
  rightRail: ReactNode;
};

export function ObservabilityConsoleShell({ sidebar, main, rightRail }: Props) {
  return (
    <main className="observability-console" aria-label="Masthead observability console">
      <aside className="observability-sidebar metal-sidebar" aria-label="Primary navigation">
        {sidebar}
      </aside>
      <section className="observability-workspace">
        <div className="observability-content">
          <section className="observability-main" aria-label="Session observability board">
            {main}
          </section>
          <aside className="observability-right-rail" aria-label="Telemetry panels">
            {rightRail}
          </aside>
        </div>
      </section>
    </main>
  );
}
