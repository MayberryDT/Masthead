import type { BoardFilter } from "./filterBoard";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Icon, type IconName } from "./icons/Icon";
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
  type SelectOption,
  type SortMode
} from "./toolbarOptions";

export type ConnectorDisplayState = "connected" | "connecting" | "disconnected";

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
  connectorState?: ConnectorDisplayState;
  connectorBusy?: boolean;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: BoardFilter) => void;
  onHarnessFilterChange: (filter: HarnessFilter) => void;
  onLifecycleFilterChange: (filter: LifecycleFilter) => void;
  onSortModeChange: (mode: SortMode) => void;
  onActivityWindowChange: (window: ActivityWindow) => void;
  onRefreshRateChange: (rateMs: number) => void;
  onConnectorAction?: () => void;
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
  connectorState,
  connectorBusy = false,
  onQueryChange,
  onFilterChange: _onFilterChange,
  onHarnessFilterChange,
  onLifecycleFilterChange,
  onSortModeChange,
  onActivityWindowChange,
  onRefreshRateChange,
  onConnectorAction,
  onDensityToggle,
  searchInputRef
}: Props) {
  const connectorLabel = connectorButtonLabel(connectorState, connectorBusy);
  const connectorDisabled = connectorState !== "disconnected" || connectorBusy || !onConnectorAction;

  return (
    <section className="board-toolbar observability-toolbar metal-toolbar" aria-label="Board controls">
      <label className="search-field metal-input">
        <Icon name="search" size="toolbar" weight={iconWeights.toolbar} className="search-icon" />
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
          icon="harness"
          value={harnessFilter}
          options={HARNESS_OPTIONS}
          onChange={(value) => onHarnessFilterChange(value as HarnessFilter)}
        />
        <ToolbarSelect
          label="Lifecycles"
          icon="lifecycle"
          value={lifecycleFilter}
          options={LIFECYCLE_OPTIONS}
          onChange={(value) => onLifecycleFilterChange(value as LifecycleFilter)}
        />
        <ToolbarSelect
          label="Sort sessions"
          icon="recentActivity"
          value={sortMode}
          options={SORT_OPTIONS}
          className="sort"
          onChange={(value) => onSortModeChange(value as SortMode)}
        />
        <ToolbarSelect
          label="Activity window"
          icon="timeRange"
          value={activityWindow}
          options={ACTIVITY_WINDOW_OPTIONS}
          className="time"
          onChange={(value) => onActivityWindowChange(value as ActivityWindow)}
        />
        <ToolbarSelect
          label="Refresh rate"
          icon="refreshInterval"
          value={String(refreshRateMs)}
          options={REFRESH_RATE_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
          className="refresh"
          onChange={(value) => onRefreshRateChange(Number(value))}
        />
      </div>
      <div className="toolbar-actions">
        {connectorState ? (
          <button
            type="button"
            className={`toolbar-connector-button metal-control ${connectorState}`}
            disabled={connectorDisabled}
            onClick={onConnectorAction}
          >
            {connectorLabel}
          </button>
        ) : null}
        <button
          type="button"
          className={`toolbar-icon-button metal-control ${density === "compact" ? "active" : ""}`}
          aria-label={density === "compact" ? "Comfortable grid" : "Compact grid"}
          aria-pressed={density === "compact"}
          title="Change layout"
          onClick={onDensityToggle}
        >
          <Icon name="changeLayout" size="toolbar" weight={iconWeights.toolbar} />
        </button>
      </div>
    </section>
  );
}

function connectorButtonLabel(state: ConnectorDisplayState | undefined, busy: boolean): string {
  if (busy) return "Reconnecting";
  if (state === "connected") return "Connected";
  if (state === "connecting") return "Connecting";
  return "Reconnect";
}

function ToolbarSelect<T extends string>({
  label,
  icon,
  value,
  options,
  onChange,
  className = ""
}: {
  label: string;
  icon: IconName;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const selected = options[selectedIndex];
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      optionRefs.current[selectedIndex]?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedIndex]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const focusOption = (index: number) => {
    const nextIndex = Math.max(0, Math.min(options.length - 1, index));
    optionRefs.current[nextIndex]?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      window.requestAnimationFrame(() => focusOption(options.length - 1));
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const activeIndex = optionRefs.current.findIndex((item) => item === document.activeElement);

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(activeIndex + 1);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(activeIndex - 1);
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    }

    if (event.key === "End") {
      event.preventDefault();
      focusOption(options.length - 1);
    }
  };

  return (
    <div ref={rootRef} className={`toolbar-select metal-control ${open ? "open" : ""} ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="toolbar-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <Icon name={icon} size="toolbar" weight={iconWeights.toolbar} className="toolbar-select-leading-icon" />
        <span>{selected?.label ?? label}</span>
        <Icon name="selectChevron" size="inline" weight={iconWeights.inline} className="toolbar-select-chevron" />
      </button>

      <div
        id={listboxId}
        className="toolbar-select-menu"
        role="listbox"
        aria-label={label}
        hidden={!open}
        onKeyDown={onMenuKeyDown}
      >
        {options.map((option) => (
          <button
            key={option.value}
            ref={(node) => {
              optionRefs.current[options.indexOf(option)] = node;
            }}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={`toolbar-select-option ${option.value === value ? "selected" : ""}`}
            onClick={() => choose(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
