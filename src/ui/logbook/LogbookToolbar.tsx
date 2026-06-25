import type { LogbookSort } from "../../app/daemonClient";
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

export function LogbookToolbar({ density, onDensityToggle, onQueryChange, onSortChange, query, sort }: Props) {
  const densityLabel = density === "compact" ? "Comfortable rows" : "Compact rows";
  return (
    <div className="logbook-toolbar" aria-label="Logbook controls">
      <SearchInput
        containerClassName="logbook-search"
        placeholder="Search all session history..."
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onClear={() => onQueryChange("")}
      />
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
