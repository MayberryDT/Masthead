import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import type { LogbookSession } from "../HistoryPanel";

type Props = {
  density: "comfortable" | "compact";
  rowIndex?: number;
  selected?: boolean;
  session: LogbookSession;
  onSelect: (sessionId: string) => void;
};

export function LogbookRow({ density, onSelect, rowIndex = 0, selected = false, session }: Props) {
  const primaryModel = session.models?.[0] ?? session.model ?? "Not captured";
  const lifecycle = session.lifecycle ?? session.state ?? "indexed";
  const title = sessionTitle(session);
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
      aria-label={`Open session: ${title}`}
      aria-selected={selected}
      style={style}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
    >
      <td className="logbook-date logbook-col-date">
        <time dateTime={session.lastActivityAt}>{formatDate(session.lastActivityAt)}</time>
        <span>{formatTime(session.lastActivityAt)}</span>
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
          {session.snippet ? <HighlightedSnippet snippet={session.snippet} /> : <span>{session.objective ?? session.outcome ?? session.sourceSessionId}</span>}
        </button>
      </td>
      <td className="logbook-col-project" title={session.project ?? ""}>{session.project ?? "Not captured"}</td>
      <td className="logbook-col-runtime">{runtimeLabel(session.runtime)}</td>
      <td className="logbook-col-model" title={primaryModel}>{primaryModel}</td>
      <td className="logbook-col-state">
        <span className={`state-token ${stateToneClass(lifecycle)}`.trim()}>{statusLabel(lifecycle)}</span>
      </td>
      <td className="logbook-col-source logbook-desktop-column">
        <span className="logbook-source-confidence">{statusLabel(session.sourceConfidence ?? "inferred")}</span>
        <span>{session.hostId ?? session.host ?? session.sourceSessionId ?? "Source pending"}</span>
      </td>
      <td className="logbook-number logbook-col-count">{session.toolCount ?? 0}</td>
      <td className={`logbook-number logbook-col-count ${(session.errorCount ?? 0) > 0 ? "attention" : ""}`.trim()}>{session.errorCount ?? 0}</td>
      <td className="logbook-col-duration logbook-desktop-column">{durationLabel(session.startedAt, session.endedAt)}</td>
    </tr>
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a, button, input, select, textarea, [data-logbook-row-stop]"));
}

function HighlightedSnippet({ snippet }: { snippet: string }) {
  const parts = snippet.split(/(<mark>|<\/mark>)/g);
  let highlighted = false;

  return (
    <span className="logbook-snippet">
      {parts.map((part, index) => {
        if (part === "<mark>") {
          highlighted = true;
          return null;
        }
        if (part === "</mark>") {
          highlighted = false;
          return null;
        }
        if (!part) return null;
        return highlighted ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>;
      })}
    </span>
  );
}

function sessionTitle(session: LogbookSession): string {
  return session.title || session.objective || session.project || `${runtimeLabel(session.runtime)} session`;
}

function formatDate(value: string | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { day: "2-digit", month: "short" });
}

function formatTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function durationLabel(startedAt: string | undefined, endedAt: string | undefined): string {
  if (!startedAt || !endedAt) return "n/a";
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) return "n/a";
  const seconds = Math.round((ended - started) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function runtimeLabel(runtime: string | undefined): string {
  if (!runtime) return "Unknown";
  return runtime === "codex" ? "Codex" : runtime;
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function stateToneClass(value: string | undefined): string {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("fail") || normalized.includes("attention") || normalized.includes("blocked")) return "attention";
  if (normalized.includes("unknown") || normalized.includes("pending")) return "neutral";
  return "";
}
