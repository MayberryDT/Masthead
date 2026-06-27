import type { BoardFilter } from "./filterBoard";
import type { RefObject } from "react";
import { AppButton } from "./primitives/AppButton";
import { AppSelect } from "./primitives/AppSelect";
import { CollapsibleSearch, type CollapsibleSearchHandle } from "./primitives/CollapsibleSearch";
import { Icon } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";
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
  searchInputRef?: RefObject<CollapsibleSearchHandle | null>;
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
  const toggleLayoutLabel = density === "compact" ? "Comfortable grid" : "Compact grid";

  return (
    <section className="board-toolbar observability-toolbar metal-toolbar" aria-label="Board controls">
      <CollapsibleSearch
        ref={searchInputRef}
        label="Search sessions"
        containerClassName="now-search"
        placeholder="Filter sessions..."
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onClear={() => onQueryChange("")}
      />
      <div className="toolbar-select-row" aria-label="Filter controls">
        <AppSelect
          label="Harnesses"
          icon="harness"
          value={harnessFilter}
          options={HARNESS_OPTIONS}
          onChange={(value) => onHarnessFilterChange(value as HarnessFilter)}
        />
        <AppSelect
          label="Lifecycles"
          icon="lifecycle"
          value={lifecycleFilter}
          options={LIFECYCLE_OPTIONS}
          onChange={(value) => onLifecycleFilterChange(value as LifecycleFilter)}
        />
        <AppSelect
          label="Sort sessions"
          icon="recentActivity"
          value={sortMode}
          options={SORT_OPTIONS}
          className="sort"
          onChange={(value) => onSortModeChange(value as SortMode)}
        />
        <AppSelect
          label="Activity window"
          icon="timeRange"
          value={activityWindow}
          options={ACTIVITY_WINDOW_OPTIONS}
          className="time"
          onChange={(value) => onActivityWindowChange(value as ActivityWindow)}
        />
        <AppSelect
          label="Refresh rate"
          icon="refreshInterval"
          value={String(refreshRateMs)}
          options={REFRESH_RATE_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
          className="refresh"
          onChange={(value) => onRefreshRateChange(Number(value))}
        />
        <AppButton
          variant="icon"
          className={`toolbar-icon-button layout-toggle ${density === "compact" ? "active" : ""}`}
          aria-label={toggleLayoutLabel}
          aria-pressed={density === "compact"}
          onClick={onDensityToggle}
        >
          <Icon name="changeLayout" size="toolbar" weight={iconWeights.toolbar} />
        </AppButton>
      </div>
    </section>
  );
}
