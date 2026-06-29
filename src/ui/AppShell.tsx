import { useEffect, useState, type ReactNode } from "react";
import { invokeDesktopCommand, isDesktopBridgeAvailable } from "../app/desktopBridge";
import { Icon } from "./icons/Icon";

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
};

export function AppShell({ sidebar, main }: Props) {
  const [desktopChrome, setDesktopChrome] = useState(false);

  useEffect(() => {
    setDesktopChrome(isDesktopBridgeAvailable());
  }, []);

  return (
    <main className={`masthead-shell ${desktopChrome ? "desktop-chrome" : ""}`} aria-label="Masthead session manager">
      <aside className="masthead-sidebar metal-sidebar" aria-label="Primary navigation">
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
    <header className="masthead-window-bar" aria-label="Window controls">
      <div className="masthead-window-drag-region" aria-hidden="true" />
      <div className="masthead-window-controls">
        <button
          className="masthead-window-control"
          type="button"
          title="Minimize"
          aria-label="Minimize window"
          onClick={() => void invokeDesktopCommand("window_minimize_command")}
        >
          <Icon name="minimize" size={14} weight="bold" />
        </button>
        <button
          className="masthead-window-control"
          type="button"
          title="Maximize"
          aria-label="Maximize window"
          onClick={() => void invokeDesktopCommand("window_maximize_command")}
        >
          <Icon name="maximize" size={12} weight="bold" />
        </button>
        <button
          className="masthead-window-control close"
          type="button"
          title="Close"
          aria-label="Close window"
          onClick={() => void invokeDesktopCommand("window_close_command")}
        >
          <Icon name="close" size={13} weight="regular" />
        </button>
      </div>
    </header>
  );
}
