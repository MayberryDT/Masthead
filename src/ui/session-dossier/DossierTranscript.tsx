import { useEffect, useRef, useState } from "react";
import type { SessionTranscriptItem, SessionTranscriptKindFilter, SessionTranscriptResult } from "../../app/daemonClient";
import { readableTranscriptText } from "./transcriptPresentation";

type Props = {
  sessionId?: string;
  transcript?: SessionTranscriptResult;
  loading?: boolean;
  error?: string;
  filter: SessionTranscriptKindFilter;
  query: string;
  onFilterChange: (filter: SessionTranscriptKindFilter) => void;
  onQueryChange: (query: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
};

type RenderedTranscriptItem =
  | { type: "item"; item: ReadableTranscriptItem }
  | { type: "group"; key: string; count: number; firstObservedAt: string; label: string; text: string };

type ReadableTranscriptItem = SessionTranscriptItem & { displayText: string };

const filters: Array<{ label: string; value: SessionTranscriptKindFilter }> = [
  { label: "All", value: "all" },
  { label: "User", value: "user" },
  { label: "Assistant", value: "assistant" },
  { label: "Tools", value: "tools" },
  { label: "Checkpoints", value: "checkpoints" },
  { label: "Signals", value: "signals" }
];

export function DossierTranscript({
  error,
  filter,
  loading = false,
  onFilterChange,
  onLoadMore,
  onQueryChange,
  onRetry,
  query,
  sessionId,
  transcript
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const resultsRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestedCursorRef = useRef<string | undefined>(undefined);
  const visibleTranscriptItems = (transcript?.items ?? [])
    .filter((item) => item.kind !== "file_effect")
    .map((item) => ({ ...item, displayText: readableTranscriptText(item.text) }))
    .filter((item) => item.displayText.length > 0);
  const renderedItems = compressLowValueRuns(visibleTranscriptItems);
  const hasUsableTranscript = transcript?.coverage.hasUsableTranscript ?? false;
  const hasQuery = query.trim().length > 0;
  const nextCursor = transcript?.nextCursor;

  useEffect(() => {
    requestedCursorRef.current = undefined;
  }, [filter, query, sessionId]);

  useEffect(() => {
    if (!nextCursor || loading || typeof IntersectionObserver === "undefined") return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (requestedCursorRef.current === nextCursor) return;
        requestedCursorRef.current = nextCursor;
        onLoadMore();
      },
      { root: resultsRef.current, rootMargin: "120px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, nextCursor, onLoadMore]);

  return (
    <div className="dossier-transcript">
      <div className="dossier-transcript-toolbar">
        <label>
          <span className="sr-only">Search transcript</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="Search in session..."
          />
        </label>
        <div className="dossier-filter-row" aria-label="Transcript filters">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              className={item.value === filter ? "is-active" : ""}
              onClick={() => onFilterChange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {!hasUsableTranscript && !hasQuery ? (
        <div className="dossier-transcript-note">
          <strong>No usable transcript messages imported.</strong>
          <p>Masthead has hook metadata for this session, but not the conversation text.</p>
        </div>
      ) : null}

      {error ? (
        <div className="dossier-banner dossier-banner-error">
          <span>{error}</span>
          <button type="button" className="dossier-link-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      {loading && !transcript ? <p className="dossier-muted">Loading transcript...</p> : null}

      <div className="dossier-transcript-results" aria-live="polite" ref={resultsRef}>
        {renderedItems.length > 0 ? (
          <ol className="dossier-transcript-list">
            {renderedItems.map((entry, index) =>
              entry.type === "group" ? (
                <li key={entry.key} className="dossier-transcript-group">
                  <time dateTime={entry.firstObservedAt}>{formatDateTime(entry.firstObservedAt)}</time>
                  <div>
                    <strong>{entry.count} low-value {entry.text} events captured</strong>
                    <p>{entry.label}</p>
                  </div>
                </li>
              ) : (
                <TranscriptRow
                  expanded={expanded.has(entry.item.itemId)}
                  item={entry.item}
                  key={`${entry.item.itemId}:${index}`}
                  onToggle={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(entry.item.itemId)) next.delete(entry.item.itemId);
                      else next.add(entry.item.itemId);
                      return next;
                    })
                  }
                />
              )
            )}
          </ol>
        ) : !loading ? (
          <p className="dossier-muted">{hasQuery ? "No transcript items match this search." : "No transcript items captured."}</p>
        ) : null}
        {nextCursor ? (
          <div className="dossier-transcript-sentinel" ref={sentinelRef} aria-live="polite">
            {loading ? "Loading more transcript..." : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TranscriptRow({ expanded, item, onToggle }: { expanded: boolean; item: ReadableTranscriptItem; onToggle: () => void }) {
  const collapsible = item.collapsedByDefault;
  const visibleText = collapsible && !expanded ? `${item.displayText.slice(0, 220).trim()}...` : item.displayText;
  return (
    <li className={["dossier-transcript-item", `is-role-${item.role}`, item.lowValue ? "is-low-value" : ""].filter(Boolean).join(" ")}>
      <time dateTime={item.observedAt}>{formatDateTime(item.observedAt)}</time>
      <div>
        <span>{itemLabel(item)}</span>
        <p>{visibleText}</p>
        {collapsible ? (
          <button type="button" className="dossier-link-button" onClick={onToggle}>
            {expanded ? "Hide output" : "Show output"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function compressLowValueRuns(items: ReadableTranscriptItem[]): RenderedTranscriptItem[] {
  const rendered: RenderedTranscriptItem[] = [];
  for (let index = 0; index < items.length; ) {
    const item = items[index]!;
    if (!item.lowValue) {
      rendered.push({ item, type: "item" });
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (cursor < items.length && items[cursor]?.lowValue && sameLowValue(item, items[cursor]!)) {
      cursor += 1;
    }
    const count = cursor - index;
    if (count >= 3) {
      rendered.push({
        count,
        firstObservedAt: item.observedAt,
        key: `group:${item.label}:${item.displayText}:${index}`,
        label: item.label,
        text: item.displayText,
        type: "group"
      });
    } else {
      for (let itemIndex = index; itemIndex < cursor; itemIndex += 1) rendered.push({ item: items[itemIndex]!, type: "item" });
    }
    index = cursor;
  }
  return rendered;
}

function sameLowValue(left: ReadableTranscriptItem, right: ReadableTranscriptItem): boolean {
  return left.displayText === right.displayText && left.label === right.label;
}

function itemLabel(item: SessionTranscriptItem): string {
  if (item.kind === "tool_call") return `Tool · ${item.toolName ?? item.label}`;
  if (item.kind === "tool_result") return `Tool result · ${item.status ?? item.label}`;
  if (item.kind === "file_effect") return `File · ${item.label}`;
  if (item.kind === "runtime_signal") return `Signal · ${item.label}`;
  if (item.kind === "checkpoint") return `Checkpoint · ${item.label}`;
  return item.role[0].toUpperCase() + item.role.slice(1);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
