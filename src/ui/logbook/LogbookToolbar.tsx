import type { LogbookSort } from "../../app/daemonClient";
import type { LogbookFilterOptions, LogbookFilterState } from "../HistoryPanel";
import { AppButton } from "../primitives/AppButton";
import { AppSelect } from "../primitives/AppSelect";
import { SearchInput } from "../primitives/SearchInput";
import { Icon } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";

type LogbookDensity = "comfortable" | "compact";

type Props = {
  query: string;
  sort: LogbookSort;
  density: LogbookDensity;
  filters?: LogbookFilterState;
  filterOptions?: LogbookFilterOptions;
  onFilterChange?: (filters: LogbookFilterState) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LogbookSort) => void;
  onDensityToggle: () => void;
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

export function LogbookToolbar({ density, filterOptions, filters = {}, onDensityToggle, onFilterChange, onQueryChange, onSortChange, query, sort }: Props) {
  const densityLabel = density === "compact" ? "Comfortable rows" : "Compact rows";
  const runtimeOptions = [{ value: "", label: "All runtimes" }, ...optionRows(filterOptions?.runtimes)];
  const lifecycleOptions = [{ value: "", label: "All lifecycles" }, ...optionRows(filterOptions?.lifecycles)];

  return (
    <div className="logbook-toolbar" aria-label="Logbook controls">
      <SearchInput
        containerClassName="logbook-search"
        placeholder="Search all session history..."
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onClear={() => onQueryChange("")}
      />
      <AppSelect
        label="Runtime filter"
        icon="harness"
        value={filters.runtime ?? ""}
        options={runtimeOptions}
        className="logbook-filter-select"
        onChange={(value) => onFilterChange?.({ ...filters, runtime: value || undefined })}
      />
      <label className="logbook-filter-input metal-input">
        <span>Project</span>
        <input value={filters.project ?? ""} placeholder="Any project" onChange={(event) => onFilterChange?.({ ...filters, project: event.currentTarget.value || undefined })} />
      </label>
      <label className="logbook-filter-input metal-input">
        <span>Model</span>
        <input value={filters.model ?? ""} placeholder="Any model" onChange={(event) => onFilterChange?.({ ...filters, model: event.currentTarget.value || undefined })} />
      </label>
      <AppSelect
        label="Lifecycle filter"
        icon="lifecycle"
        value={filters.state ?? ""}
        options={lifecycleOptions}
        className="logbook-filter-select"
        onChange={(value) => onFilterChange?.({ ...filters, state: value || undefined })}
      />
      <label className="logbook-filter-input metal-input logbook-date-filter">
        <span>From</span>
        <input type="date" value={filters.dateFrom ?? ""} onChange={(event) => onFilterChange?.({ ...filters, dateFrom: event.currentTarget.value || undefined })} />
      </label>
      <label className="logbook-filter-input metal-input logbook-date-filter">
        <span>To</span>
        <input type="date" value={filters.dateTo ?? ""} onChange={(event) => onFilterChange?.({ ...filters, dateTo: event.currentTarget.value || undefined })} />
      </label>
      <label className="logbook-filter-input metal-input logbook-file-filter">
        <span>File</span>
        <input value={filters.file ?? ""} placeholder="Path contains" onChange={(event) => onFilterChange?.({ ...filters, file: event.currentTarget.value || undefined })} />
      </label>
      <AppSelect label="Sort sessions" icon="recentActivity" value={sort} options={sortOptions} className="logbook-sort" onChange={(value) => onSortChange(value as LogbookSort)} />
      <AppButton
        variant="icon"
        className={`toolbar-icon-button logbook-density-toggle ${density === "compact" ? "active" : ""}`}
        aria-label={densityLabel}
        aria-pressed={density === "compact"}
        title={densityLabel}
        onClick={onDensityToggle}
      >
        <Icon name="changeLayout" size="toolbar" weight={iconWeights.toolbar} />
      </AppButton>
    </div>
  );
}

function optionRows(values: string[] | undefined): Array<{ value: string; label: string }> {
  return (values ?? []).filter(Boolean).map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
}
