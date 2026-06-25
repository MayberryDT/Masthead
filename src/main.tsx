import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { MastheadConnectionProvider } from "./app/connection/MastheadConnectionProvider";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/primitives.css";
import "./styles/logbook.css";
import "./styles/sources.css";
import "./styles/agent-access.css";
import "./styles/settings.css";
import "./styles/masthead.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MastheadConnectionProvider>
      <App />
    </MastheadConnectionProvider>
  </React.StrictMode>
);
