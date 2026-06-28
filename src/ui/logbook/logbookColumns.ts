export const logbookColumns = [
  { key: "date", label: "DATE", className: "logbook-col-date" },
  { key: "session", label: "SESSION / MATCH", className: "logbook-col-session" },
  { key: "project", label: "PROJECT", className: "logbook-col-project" },
  { key: "runtime", label: "AGENT", className: "logbook-col-runtime" },
  { key: "model", label: "MODEL", className: "logbook-col-model" },
  { key: "state", label: "STATE", className: "logbook-col-state" },
  { key: "source", label: "SOURCE", className: "logbook-col-source logbook-desktop-column" },
  { key: "tools", label: "TOOLS", className: "logbook-col-count" },
  { key: "errors", label: "ERRORS", className: "logbook-col-count" },
  { key: "duration", label: "DURATION", className: "logbook-col-duration logbook-desktop-column" }
] as const;
