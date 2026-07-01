import { useEffect, useId, useRef, useState } from "react";
import type { LogbookSort } from "../../app/daemonClient";
import type { LogbookFilterOptions, LogbookFilterState } from "../HistoryPanel";
import { AppButton } from "../primitives/AppButton";
import { AppSelect } from "../primitives/AppSelect";
import { CollapsibleSearch } from "../primitives/CollapsibleSearch";
import { FilterableSelect } from "../primitives/FilterableSelect";
import { Icon } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";

type Props = {
  query: string;
  sort: LogbookSort;
  filters?: LogbookFilterState;
  filterOptions?: LogbookFilterOptions;
  onFilterChange?: (filters: LogbookFilterState) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LogbookSort) => void;
};

const sortOptions: Array<{ value: LogbookSort; label: string }> = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
  { value: "duration_desc", label: "Duration" },
  { value: "tools_desc", label: "Tool calls" },
  { value: "errors_desc", label: "Errors" },
  { value: "project", label: "Project" }
];

function cssDurationMs(value: string, fallbackMs: number): number {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return fallbackMs;
  if (trimmed.endsWith("ms")) return parsed;
  if (trimmed.endsWith("s")) return parsed * 1000;
  return parsed;
}

function dropdownCloseDelayMs(): number {
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 1;
  if (typeof window.getComputedStyle !== "function") return 150;
  return cssDurationMs(window.getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur"), 150);
}

export function LogbookToolbar({ filterOptions, filters = {}, onFilterChange, onQueryChange, onSortChange, query, sort }: Props) {
  const runtimeOptions = [{ value: "", label: "All runtimes" }, ...optionRows(filterOptions?.runtimes)];
  const projectOptions = optionRows(filterOptions?.projects, filters.project);
  const modelOptions = optionRows(filterOptions?.models, filters.model);
  const activeDateFilterCount = [filters.dateFrom, filters.dateTo].filter(Boolean).length;
  const [dateState, setDateState] = useState<"closed" | "open" | "closing">("closed");
  const dateCloseTimerRef = useRef<number | undefined>(undefined);
  const dateOpen = dateState === "open";
  const datePopoverId = useId();
  const updateDateFrom = (value: string) => onFilterChange?.({ ...filters, dateFrom: value || undefined });
  const updateDateTo = (value: string) => onFilterChange?.({ ...filters, dateTo: value || undefined });
  const dateMounted = dateState !== "closed" || activeDateFilterCount > 0;
  const clearDateCloseTimer = () => {
    if (dateCloseTimerRef.current !== undefined) {
      window.clearTimeout(dateCloseTimerRef.current);
      dateCloseTimerRef.current = undefined;
    }
  };
  const openDatePopover = () => {
    clearDateCloseTimer();
    setDateState("open");
  };
  const closeDatePopover = () => {
    clearDateCloseTimer();
    setDateState((current) => (current === "closed" ? current : "closing"));
    dateCloseTimerRef.current = window.setTimeout(() => {
      setDateState("closed");
      dateCloseTimerRef.current = undefined;
    }, dropdownCloseDelayMs());
  };
  const toggleDatePopover = () => {
    if (dateOpen) closeDatePopover();
    else openDatePopover();
  };

  useEffect(() => clearDateCloseTimer, []);

  return (
    <div className="logbook-toolbar observability-toolbar metal-toolbar" aria-label="Logbook controls">
      <CollapsibleSearch
        containerClassName="logbook-search"
        label="Search sessions"
        placeholder="Search all session history..."
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onClear={() => onQueryChange("")}
      />
      <div className="toolbar-select-row logbook-toolbar-row" aria-label="Logbook filter controls">
        <div className={`logbook-date-filter ${activeDateFilterCount > 0 ? "active" : ""} ${dateMounted ? "open" : ""}`.trim()}>
          <AppButton
            variant="default"
            className="logbook-date-trigger"
            aria-controls={datePopoverId}
            aria-expanded={dateOpen}
            aria-label="Open date filter"
            onClick={toggleDatePopover}
          >
            <Icon name="timeRange" size="toolbar" weight={iconWeights.toolbar} />
            <span>Date{activeDateFilterCount > 0 ? ` ${activeDateFilterCount}` : ""}</span>
          </AppButton>
          {dateMounted ? (
            <div
              id={datePopoverId}
              className={`logbook-date-popover t-dropdown ${dateOpen ? "is-open" : ""} ${dateState === "closing" ? "is-closing" : ""}`.trim()}
              data-origin="top-left"
              aria-hidden={!dateOpen}
              hidden={dateState === "closed"}
            >
              <label>
                <span>From</span>
                <input
                  aria-label="From date"
                  type="date"
                  value={filters.dateFrom ?? ""}
                  onInput={(event) => updateDateFrom(event.currentTarget.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  aria-label="To date"
                  type="date"
                  value={filters.dateTo ?? ""}
                  onInput={(event) => updateDateTo(event.currentTarget.value)}
                />
              </label>
              <button
                type="button"
                className="logbook-date-clear"
                disabled={activeDateFilterCount === 0}
                onClick={() => onFilterChange?.({ ...filters, dateFrom: undefined, dateTo: undefined })}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>

        <FilterableSelect
          label="Runtime filter"
          icon="runtime"
          value={filters.runtime ?? ""}
          options={runtimeOptions}
          placeholder="All runtimes"
          searchPlaceholder="Type or choose runtime"
          className="logbook-filter-select logbook-runtime-filter"
          onChange={(value) => onFilterChange?.({ ...filters, runtime: value || undefined })}
        />
        <FilterableSelect
          label="Project filter"
          icon="project"
          value={filters.project}
          options={projectOptions}
          placeholder="Any project"
          searchPlaceholder="Type or choose project"
          className="logbook-combobox-filter logbook-project-filter"
          onChange={(value) => onFilterChange?.({ ...filters, project: value })}
        />
        <FilterableSelect
          label="Model filter"
          icon="model"
          value={filters.model}
          options={modelOptions}
          placeholder="Any model"
          searchPlaceholder="Type or choose model"
          className="logbook-combobox-filter logbook-model-filter"
          onChange={(value) => onFilterChange?.({ ...filters, model: value })}
        />

        <AppSelect label="Sort sessions" icon="recentActivity" value={sort} options={sortOptions} className="logbook-sort" onChange={(value) => onSortChange(value as LogbookSort)} />
      </div>
    </div>
  );
}
function optionRows(values: string[] | undefined, currentValue?: string): Array<{ value: string; label: string }> {
  const uniqueValues = Array.from(new Set([...(values ?? []), currentValue].filter((value): value is string => Boolean(value))));
  return uniqueValues.map((value) => ({ value, label: formatFilterLabel(value) }));
}

function formatFilterLabel(value: string): string {
  return /^[a-z]+$/.test(value) ? value[0].toUpperCase() + value.slice(1) : value;
}
