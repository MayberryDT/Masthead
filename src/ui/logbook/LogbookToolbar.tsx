import { useId, useState } from "react";
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
  { value: "files_desc", label: "Files changed" },
  { value: "tools_desc", label: "Tool calls" },
  { value: "errors_desc", label: "Errors" },
  { value: "project", label: "Project" }
];

export function LogbookToolbar({ filterOptions, filters = {}, onFilterChange, onQueryChange, onSortChange, query, sort }: Props) {
  const runtimeOptions = [{ value: "", label: "All runtimes" }, ...optionRows(filterOptions?.runtimes)];
  const projectOptions = optionRows(filterOptions?.projects, filters.project);
  const modelOptions = optionRows(filterOptions?.models, filters.model);
  const activeDateFilterCount = [filters.dateFrom, filters.dateTo].filter(Boolean).length;
  const activeFileFilterCount = filters.file ? 1 : 0;
  const [dateOpen, setDateOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const datePopoverId = useId();
  const filePopoverId = useId();
  const updateDateFrom = (value: string) => onFilterChange?.({ ...filters, dateFrom: value || undefined });
  const updateDateTo = (value: string) => onFilterChange?.({ ...filters, dateTo: value || undefined });
  const updateFile = (value: string) => onFilterChange?.({ ...filters, file: value || undefined });

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
        <div className={`logbook-date-filter ${activeDateFilterCount > 0 ? "active" : ""}`.trim()}>
          <AppButton
            variant="default"
            className="logbook-date-trigger"
            aria-controls={datePopoverId}
            aria-expanded={dateOpen}
            aria-label="Open date filter"
            onClick={() => setDateOpen((current) => !current)}
          >
            <Icon name="timeRange" size="toolbar" weight={iconWeights.toolbar} />
            <span>Date{activeDateFilterCount > 0 ? ` ${activeDateFilterCount}` : ""}</span>
          </AppButton>
          <div id={datePopoverId} className="logbook-date-popover" aria-hidden={!dateOpen} hidden={!dateOpen}>
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
        </div>

        <AppSelect
          label="Runtime filter"
          icon="runtime"
          value={filters.runtime ?? ""}
          options={runtimeOptions}
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

        <div className={`logbook-file-popover-filter ${activeFileFilterCount > 0 ? "active" : ""}`.trim()}>
          <AppButton
            variant="default"
            className="logbook-file-trigger"
            aria-controls={filePopoverId}
            aria-expanded={fileOpen}
            aria-label="Open file filter"
            onClick={() => setFileOpen((current) => !current)}
          >
            <Icon name="fileSearch" size="toolbar" weight={iconWeights.toolbar} />
            <span>File{activeFileFilterCount > 0 ? ` ${activeFileFilterCount}` : ""}</span>
          </AppButton>
          <div id={filePopoverId} className="logbook-file-popover" aria-hidden={!fileOpen} hidden={!fileOpen}>
            <label>
              <span>Changed file path</span>
              <input
                aria-label="Changed file path"
                value={filters.file ?? ""}
                placeholder="src/app"
                onChange={(event) => updateFile(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              className="logbook-date-clear"
              disabled={activeFileFilterCount === 0}
              onClick={() => onFilterChange?.({ ...filters, file: undefined })}
            >
              Clear
            </button>
          </div>
        </div>
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
