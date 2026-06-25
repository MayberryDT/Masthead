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
  const toggleLayoutLabel = density === "compact" ? "Comfortable grid" : "Compact grid";

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
        <button
          type="button"
          className={`toolbar-icon-button metal-control layout-toggle ${density === "compact" ? "active" : ""}`}
          aria-label={toggleLayoutLabel}
          aria-pressed={density === "compact"}
          title={toggleLayoutLabel}
          onClick={onDensityToggle}
        >
          <Icon name="changeLayout" size="toolbar" weight={iconWeights.toolbar} />
        </button>
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
  const [menuState, setMenuState] = useState<"closed" | "open" | "closing">("closed");
  const open = menuState === "open";
  const menuMounted = menuState !== "closed";
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const selected = options[selectedIndex];
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const closeFrameRef = useRef<number | undefined>(undefined);

  const clearCloseTimers = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }

    if (closeFrameRef.current !== undefined) {
      window.cancelAnimationFrame(closeFrameRef.current);
      closeFrameRef.current = undefined;
    }
  };

  const openMenu = () => {
    clearCloseTimers();
    setMenuState("open");
  };

  const closeMenu = () => {
    clearCloseTimers();

    const closeMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur")) || 150;
    setMenuState((current) => (current === "closed" ? current : "closing"));
    closeFrameRef.current = window.requestAnimationFrame(() => {
      closeFrameRef.current = window.requestAnimationFrame(() => {
        closeFrameRef.current = undefined;
        closeTimerRef.current = window.setTimeout(() => {
          setMenuState("closed");
          closeTimerRef.current = undefined;
        }, closeMs);
      });
    });
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeMenu();
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

  useEffect(() => {
    return clearCloseTimers;
  }, []);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    closeMenu();
    triggerRef.current?.focus();
  };

  const focusOption = (index: number) => {
    const nextIndex = Math.max(0, Math.min(options.length - 1, index));
    optionRefs.current[nextIndex]?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu();
      window.requestAnimationFrame(() => focusOption(options.length - 1));
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const activeIndex = optionRefs.current.findIndex((item) => item === document.activeElement);

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
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
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <Icon name={icon} size="toolbar" weight={iconWeights.toolbar} className="toolbar-select-leading-icon" />
        <span>{selected?.label ?? label}</span>
        <Icon name="selectChevron" size="inline" weight={iconWeights.inline} className="toolbar-select-chevron" />
      </button>

      <div
        id={listboxId}
        className={`toolbar-select-menu t-dropdown ${open ? "is-open" : ""} ${menuState === "closing" ? "is-closing" : ""}`.trim()}
        data-origin="top-right"
        role="listbox"
        aria-label={label}
        hidden={!menuMounted}
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
