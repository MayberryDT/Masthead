import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import type { LogbookSession } from "../HistoryPanel";

type Props = {
  bulkSelected?: boolean;
  density: "comfortable" | "compact";
  rowIndex?: number;
  selected?: boolean;
  session: LogbookSession;
  onSelect: (sessionId: string) => void;
  onToggleBulkSelect?: (sessionId: string) => void;
};

export function LogbookRow({ bulkSelected = false, density, onSelect, onToggleBulkSelect, rowIndex = 0, selected = false, session }: Props) {
  const title = session.title || "Untitled artifact";
  const highlight = session.snippet || session.objective;
  const style = {
    "--logbook-row-index": Math.min(rowIndex, 12)
  } as CSSProperties & { "--logbook-row-index": number };
  const openSession = () => onSelect(session.sessionId);
  const handleRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (isInteractiveTarget(event.target)) return;
    openSession();
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    openSession();
  };

  return (
    <tr
      className={`logbook-row ${density === "compact" ? "compact" : ""} ${selected ? "selected" : ""}`.trim()}
      tabIndex={0}
      aria-label={`Open artifact: ${title}`}
      aria-selected={selected}
      style={style}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
    >
      <td className="logbook-col-select" data-logbook-row-stop>
        <input
          type="checkbox"
          aria-label={`Select ${title}`}
          checked={bulkSelected}
          onChange={() => onToggleBulkSelect?.(session.sessionId)}
          onClick={(event) => event.stopPropagation()}
        />
      </td>
      <td className="logbook-col-kind">
        <span className="state-token">{kindLabel(session.runtime || session.lifecycle)}</span>
      </td>
      <td className="logbook-session-cell logbook-col-session">
        <button
          type="button"
          className="logbook-session-button"
          onClick={(event) => {
            event.stopPropagation();
            openSession();
          }}
          aria-pressed={selected}
        >
          <strong>{title}</strong>
          {highlight ? <span>{stripMarks(highlight)}</span> : null}
        </button>
      </td>
      <td className="logbook-col-project" title={session.project ?? ""}>
        {session.project ?? "—"}
      </td>
      <td className="logbook-col-confidence">{session.models?.[0] ?? "—"}</td>
      <td className="logbook-col-provenance">{session.hostId || `${session.toolCount ?? 0} sessions`}</td>
      <td className="logbook-date logbook-col-date">
        <time dateTime={session.lastActivityAt}>{formatDate(session.lastActivityAt)}</time>
        <span>{formatTime(session.lastActivityAt)}</span>
      </td>
    </tr>
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a, button, input, select, textarea, [data-logbook-row-stop]"));
}

function kindLabel(kind: string): string {
  if (kind === "session_dossier") return "Dossier";
  if (kind === "runbook") return "Runbook";
  if (kind === "adr") return "ADR";
  if (kind === "incident_timeline") return "Timeline";
  return kind || "Artifact";
}

function stripMarks(value: string): string {
  return value.replace(/<\/?mark>/g, "");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
