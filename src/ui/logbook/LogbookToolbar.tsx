import { useEffect, useId, useState } from "react";
import type { LogbookSort } from "../../app/daemonClient";
import type { LogbookFilterOptions, LogbookFilterState } from "../HistoryPanel";
import { AppButton } from "../primitives/AppButton";
import { AppSelect } from "../primitives/AppSelect";
import { CollapsibleSearch } from "../primitives/CollapsibleSearch";
import { FilterableSelect } from "../primitives/FilterableSelect";

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
  const activeAdvancedFilterCount = [filters.project, filters.model, filters.dateFrom, filters.dateTo, filters.file].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(activeAdvancedFilterCount > 0);
  const filterDrawerId = useId();

  useEffect(() => {
    if (activeAdvancedFilterCount > 0) setFiltersOpen(true);
  }, [activeAdvancedFilterCount]);

  return (
    <div className={`logbook-toolbar ${filtersOpen ? "filters-open" : ""}`.trim()} aria-label="Logbook controls">
      <CollapsibleSearch
        containerClassName="logbook-search"
        label="Search sessions"
        placeholder="Search all session history..."
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onClear={() => onQueryChange("")}
      />
      <AppButton
        variant="default"
        className={`logbook-filter-toggle ${filtersOpen ? "active" : ""}`.trim()}
        aria-controls={filterDrawerId}
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((current) => !current)}
      >
        Filters{activeAdvancedFilterCount > 0 ? ` ${activeAdvancedFilterCount}` : ""}
      </AppButton>
      <AppSelect
        label="Runtime filter"
        icon="harness"
        value={filters.runtime ?? ""}
        options={runtimeOptions}
        className="logbook-filter-select"
        onChange={(value) => onFilterChange?.({ ...filters, runtime: value || undefined })}
      />
      <AppSelect label="Sort sessions" icon="recentActivity" value={sort} options={sortOptions} className="logbook-sort" onChange={(value) => onSortChange(value as LogbookSort)} />
      <div id={filterDrawerId} className="logbook-filter-drawer" aria-label="Additional Logbook filters" aria-hidden={!filtersOpen} data-open={filtersOpen ? "true" : "false"}>
        <FilterableSelect
          label="Project filter"
          icon="harness"
          value={filters.project}
          options={projectOptions}
          placeholder="Any project"
          searchPlaceholder="Type or choose project"
          className="logbook-combobox-filter"
          onChange={(value) => onFilterChange?.({ ...filters, project: value })}
          disabled={!filtersOpen}
        />
        <FilterableSelect
          label="Model filter"
          icon="harness"
          value={filters.model}
          options={modelOptions}
          placeholder="Any model"
          searchPlaceholder="Type or choose model"
          className="logbook-combobox-filter"
          onChange={(value) => onFilterChange?.({ ...filters, model: value })}
          disabled={!filtersOpen}
        />
        <div className="logbook-filter-group logbook-date-range" role="group" aria-label="Date range">
          <span className="logbook-filter-label">Date</span>
          <label>
            <span>From</span>
            <input type="date" tabIndex={filtersOpen ? 0 : -1} value={filters.dateFrom ?? ""} onChange={(event) => onFilterChange?.({ ...filters, dateFrom: event.currentTarget.value || undefined })} />
          </label>
          <label>
            <span>To</span>
            <input type="date" tabIndex={filtersOpen ? 0 : -1} value={filters.dateTo ?? ""} onChange={(event) => onFilterChange?.({ ...filters, dateTo: event.currentTarget.value || undefined })} />
          </label>
        </div>
        <label className="logbook-filter-group logbook-file-filter">
          <span className="logbook-filter-label">File</span>
          <input tabIndex={filtersOpen ? 0 : -1} value={filters.file ?? ""} placeholder="Filter changed files..." onChange={(event) => onFilterChange?.({ ...filters, file: event.currentTarget.value || undefined })} />
        </label>
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
