import { useEffect, useState, type ReactNode } from "react";
import { isDesktopBridgeAvailable } from "../app/desktopBridge";

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
  motionMode?: "daily" | "presentation" | "off";
};

export function AppShell({ sidebar, main, motionMode = "daily" }: Props) {
  const [desktopChrome, setDesktopChrome] = useState(false);

  useEffect(() => {
    setDesktopChrome(isDesktopBridgeAvailable());
  }, []);

  return (
    <main
      className={`masthead-shell ${desktopChrome ? "desktop-chrome" : ""}`}
      data-motion-mode={motionMode}
      aria-label="Masthead session manager"
    >
      <aside className="masthead-sidebar" aria-label="Primary navigation">
        {sidebar}
      </aside>
      <section className="masthead-workspace">
        {desktopChrome ? <MastheadWindowBar /> : null}
        <div className="masthead-content">
          <section className="masthead-main" aria-label="Session workspace">
            {main}
          </section>
        </div>
      </section>
    </main>
  );
}

function MastheadWindowBar() {
  return (
    <header className="masthead-window-bar" aria-label="Window title bar">
      <div className="masthead-window-drag-region" aria-hidden="true" />
    </header>
  );
}
