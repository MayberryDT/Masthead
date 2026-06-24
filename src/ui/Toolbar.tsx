import type { BoardFilter } from "./filterBoard";
import type { RefObject } from "react";
import {
  ACTIVITY_WINDOW_OPTIONS,
  HARNESS_OPTIONS,
  LIFECYCLE_OPTIONS,
  REFRESH_RATE_OPTIONS,
  SORT_OPTIONS,
  type ActivityWindow,
  type CardDensity,
  type HarnessFilter,
  type LifecycleFilter,
  type SelectOption,
  type SortMode
} from "./toolbarOptions";

type Props = {
  query: string;
  filter: BoardFilter;
  resultCount: number;
  totalCount: number;
  harnessFilter: HarnessFilter;
  lifecycleFilter: LifecycleFilter;
  sortMode: SortMode;
  activityWindow: ActivityWindow;
  refreshRateMs: number;
  density: CardDensity;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: BoardFilter) => void;
  onHarnessFilterChange: (filter: HarnessFilter) => void;
  onLifecycleFilterChange: (filter: LifecycleFilter) => void;
  onSortModeChange: (mode: SortMode) => void;
  onActivityWindowChange: (window: ActivityWindow) => void;
  onRefreshRateChange: (rateMs: number) => void;
  onDensityToggle: () => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
};

export function Toolbar({
  query,
  filter: _filter,
  resultCount: _resultCount,
  totalCount: _totalCount,
  harnessFilter,
  lifecycleFilter,
  sortMode,
  activityWindow,
  refreshRateMs,
  density,
  onQueryChange,
  onFilterChange: _onFilterChange,
  onHarnessFilterChange,
  onLifecycleFilterChange,
  onSortModeChange,
  onActivityWindowChange,
  onRefreshRateChange,
  onDensityToggle,
  searchInputRef
}: Props) {
  return (
    <section className="board-toolbar observability-toolbar" aria-label="Board controls">
      <label className="search-field">
        <SearchIcon />
        <input
          ref={searchInputRef}
          type="search"
          placeholder="Filter sessions..."
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onQueryChange("");
            }
          }}
        />
      </label>
      <div className="toolbar-select-row" aria-label="Filter controls">
        <ToolbarSelect
          label="Harnesses"
          value={harnessFilter}
          options={HARNESS_OPTIONS}
          onChange={(value) => onHarnessFilterChange(value as HarnessFilter)}
        />
        <ToolbarSelect
          label="Lifecycles"
          value={lifecycleFilter}
          options={LIFECYCLE_OPTIONS}
          onChange={(value) => onLifecycleFilterChange(value as LifecycleFilter)}
        />
        <ToolbarSelect
          label="Sort sessions"
          value={sortMode}
          options={SORT_OPTIONS}
          className="sort"
          onChange={(value) => onSortModeChange(value as SortMode)}
        />
        <ToolbarSelect
          label="Activity window"
          value={activityWindow}
          options={ACTIVITY_WINDOW_OPTIONS}
          className="time"
          onChange={(value) => onActivityWindowChange(value as ActivityWindow)}
        />
        <ToolbarSelect
          label="Refresh rate"
          value={String(refreshRateMs)}
          options={REFRESH_RATE_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
          className="refresh"
          onChange={(value) => onRefreshRateChange(Number(value))}
        />
      </div>
      <button
        type="button"
        className={`toolbar-icon-button ${density === "compact" ? "active" : ""}`}
        aria-label={density === "compact" ? "Comfortable grid" : "Compact grid"}
        aria-pressed={density === "compact"}
        onClick={onDensityToggle}
      >
        <GridIcon />
      </button>
    </section>
  );
}

function ToolbarSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className = ""
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`toolbar-select ${className}`} aria-label={label}>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}
