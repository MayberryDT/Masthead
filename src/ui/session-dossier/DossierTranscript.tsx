import { useState } from "react";
import type { SessionTranscriptItem, SessionTranscriptKindFilter, SessionTranscriptResult } from "../../app/daemonClient";

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
  | { type: "item"; item: SessionTranscriptItem }
  | { type: "group"; key: string; count: number; firstObservedAt: string; label: string; text: string };

const filters: Array<{ label: string; value: SessionTranscriptKindFilter }> = [
  { label: "All", value: "all" },
  { label: "User", value: "user" },
  { label: "Assistant", value: "assistant" },
  { label: "Tools", value: "tools" },
  { label: "Checkpoints", value: "checkpoints" },
  { label: "Files", value: "files" },
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
  transcript
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const renderedItems = compressLowValueRuns(transcript?.items ?? []);
  const hasUsableTranscript = transcript?.coverage.hasUsableTranscript ?? false;
  const hasQuery = query.trim().length > 0;

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

      {renderedItems.length > 0 ? (
        <ol className="dossier-transcript-list">
          {renderedItems.map((entry) =>
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
                key={entry.item.itemId}
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

      {transcript?.nextCursor ? (
        <button type="button" className="dossier-link-button" onClick={onLoadMore} disabled={loading}>
          {loading ? "Loading..." : "Load more"}
        </button>
      ) : null}
    </div>
  );
}

function TranscriptRow({ expanded, item, onToggle }: { expanded: boolean; item: SessionTranscriptItem; onToggle: () => void }) {
  const collapsible = item.collapsedByDefault;
  const visibleText = collapsible && !expanded ? `${item.text.slice(0, 220).trim()}...` : item.text;
  return (
    <li className={["dossier-transcript-item", item.lowValue ? "is-low-value" : ""].filter(Boolean).join(" ")}>
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

function compressLowValueRuns(items: SessionTranscriptItem[]): RenderedTranscriptItem[] {
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
        key: `group:${item.label}:${item.text}:${index}`,
        label: item.label,
        text: item.text,
        type: "group"
      });
    } else {
      for (let itemIndex = index; itemIndex < cursor; itemIndex += 1) rendered.push({ item: items[itemIndex]!, type: "item" });
    }
    index = cursor;
  }
  return rendered;
}

function sameLowValue(left: SessionTranscriptItem, right: SessionTranscriptItem): boolean {
  return left.text === right.text && left.label === right.label;
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
