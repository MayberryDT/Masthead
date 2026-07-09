export const logbookColumns = [
  { key: "select", label: "", className: "logbook-col-select" },
  { key: "kind", label: "KIND", className: "logbook-col-kind" },
  { key: "title", label: "TITLE / HIGHLIGHT", className: "logbook-col-session" },
  { key: "project", label: "PROJECT", className: "logbook-col-project" },
  { key: "confidence", label: "CONF", className: "logbook-col-confidence" },
  { key: "provenance", label: "PROVENANCE", className: "logbook-col-provenance" },
  { key: "published", label: "PUBLISHED", className: "logbook-col-date" }
] as const;
