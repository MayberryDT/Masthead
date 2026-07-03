import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";
import { createPortal } from "react-dom";

export type FilterableSelectOption = {
  value: string;
  label: string;
};

type FilterableSelectProps = {
  label: string;
  icon: IconName;
  value?: string;
  options: FilterableSelectOption[];
  placeholder: string;
  allowCustomValue?: boolean;
  clearable?: boolean;
  clearLabel?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: string | undefined) => void;
};

type FilterableSelectMenuStyle = CSSProperties & {
  "--filterable-select-options-max-height"?: string;
};

export function FilterableSelect({
  allowCustomValue = true,
  className = "",
  clearable = true,
  clearLabel,
  disabled = false,
  emptyLabel = "No matches",
  icon,
  label,
  onChange,
  options,
  placeholder,
  searchPlaceholder = "Type to filter...",
  value
}: FilterableSelectProps) {
  const [menuState, setMenuState] = useState<"closed" | "open" | "closing">("closed");
  const [draft, setDraft] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const open = menuState === "open";
  const menuMounted = menuState !== "closed";
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const closeFrameRef = useRef<number | undefined>(undefined);
  const selectionTimerRef = useRef<number | undefined>(undefined);
  const [selectingKey, setSelectingKey] = useState<string | undefined>(undefined);
  const selected = options.find((option) => option.value === value);
  const displayValue = selected?.label ?? value ?? placeholder;
  const filteredOptions = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(needle));
  }, [draft, options]);

  const clearCloseTimers = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }

    if (closeFrameRef.current !== undefined) {
      window.cancelAnimationFrame(closeFrameRef.current);
      closeFrameRef.current = undefined;
    }

    if (selectionTimerRef.current !== undefined) {
      window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = undefined;
    }
  };

  const updateMenuPlacement = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const menuGap = 6;
    const preferredMenuHeight = 320;
    const minimumMenuHeight = 128;
    const viewportHeight = Math.max(1, window.innerHeight - viewportPadding * 2);
    const menuWidth = Math.min(Math.max(rect.width, 260), window.innerWidth - viewportPadding * 2);
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - viewportPadding - menuWidth);
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding - menuGap;
    const availableAbove = rect.top - viewportPadding - menuGap;
    const placeAbove = availableBelow < 220 && availableAbove > availableBelow;
    const sideHeight = Math.max(0, placeAbove ? availableAbove : availableBelow);
    const availableHeight = Math.max(
      Math.min(minimumMenuHeight, viewportHeight),
      Math.min(preferredMenuHeight, viewportHeight, sideHeight)
    );
    const preferredTop = placeAbove ? rect.top - menuGap - availableHeight : rect.bottom + menuGap;
    const maxTop = Math.max(viewportPadding, window.innerHeight - viewportPadding - availableHeight);
    const top = Math.min(Math.max(viewportPadding, preferredTop), maxTop);

    setMenuStyle({
      "--filterable-select-options-max-height": `${Math.max(24, availableHeight - 50)}px`,
      left,
      maxHeight: availableHeight,
      minWidth: menuWidth,
      position: "fixed",
      top
    } as FilterableSelectMenuStyle);
  };

  const closeMenu = () => {
    clearCloseTimers();
    setSelectingKey(undefined);
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

  const openMenu = () => {
    if (disabled) return;
    clearCloseTimers();
    setSelectingKey(undefined);
    updateMenuPlacement();
    setMenuState("open");
  };

  useEffect(() => {
    if (disabled) closeMenu();
  }, [disabled]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };
    const onReposition = () => updateMenuPlacement();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      updateMenuPlacement();
      searchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => clearCloseTimers, []);

  const choose = (nextValue: string | undefined) => {
    const nextKey = nextValue ?? "__clear__";
    clearCloseTimers();
    setSelectingKey(nextKey);
    onChange(nextValue);
    setDraft("");
    selectionTimerRef.current = window.setTimeout(() => {
      selectionTimerRef.current = undefined;
      closeMenu();
      triggerRef.current?.focus();
    }, 120);
  };

  const commitDraft = () => {
    const nextValue = draft.trim();
    if (allowCustomValue) {
      choose(nextValue || undefined);
      return;
    }
    if (filteredOptions.length > 0) choose(filteredOptions[0].value);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft("");
      closeMenu();
      triggerRef.current?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
    }
  };

  const menu = (
    <div
      ref={menuRef}
      id={listboxId}
      className={`filterable-select-menu toolbar-select-menu toolbar-select-menu-portal t-dropdown ${open ? "is-open" : ""} ${menuState === "closing" ? "is-closing" : ""}`.trim()}
      aria-label={label}
      data-origin="top-left"
      hidden={!menuMounted}
      style={menuStyle}
    >
      <label className="filterable-select-search metal-input">
        <Icon name="search" size="toolbar" weight={iconWeights.toolbar} className="search-icon" />
        <input ref={searchRef} value={draft} placeholder={searchPlaceholder} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={onSearchKeyDown} />
      </label>
      {value && clearable ? (
        <div className="filterable-select-selection" aria-label={`${label} selection`}>
          <span>
            <small>Selected</small>
            <strong>{displayValue}</strong>
          </span>
          <button type="button" onClick={() => choose(undefined)} aria-label={`Clear ${label}`}>
            <Icon name="close" size="inline" weight={iconWeights.inline} />
          </button>
        </div>
      ) : null}
      <div className="filterable-select-options" role="listbox" aria-label={`${label} options`}>
        {value && clearable ? (
          <button
            type="button"
            role="option"
            aria-selected="false"
            className={`toolbar-select-option filterable-select-clear ${selectingKey === "__clear__" ? "is-selecting" : ""}`.trim()}
            style={{ "--option-index": "0" } as CSSProperties}
            onClick={() => choose(undefined)}
          >
            {clearLabel ?? `Any ${label.toLowerCase().replace(" filter", "")}`}
          </button>
        ) : null}
        {filteredOptions.length > 0 ? (
          filteredOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`toolbar-select-option ${option.value === value ? "selected" : ""} ${selectingKey === option.value ? "is-selecting" : ""}`.trim()}
              style={{ "--option-index": String(value ? index + 1 : index) } as CSSProperties}
              onClick={() => choose(option.value)}
            >
              {option.label}
            </button>
          ))
        ) : (
          <button
            type="button"
            role="option"
            disabled={!allowCustomValue}
            aria-selected="false"
            className={`toolbar-select-option filterable-select-empty ${selectingKey === (draft.trim() || "__clear__") ? "is-selecting" : ""}`.trim()}
            style={{ "--option-index": String(value ? 1 : 0) } as CSSProperties}
            onClick={allowCustomValue ? commitDraft : undefined}
          >
            {allowCustomValue && draft.trim() ? `Use “${draft.trim()}”` : emptyLabel}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={`filterable-select toolbar-select metal-control ${open ? "open" : ""} ${value ? "has-value" : ""} ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="toolbar-select-trigger filterable-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? closeMenu() : openMenu())}
        disabled={disabled}
      >
        <Icon name={icon} size="toolbar" weight={iconWeights.toolbar} className="toolbar-select-leading-icon" />
        <span>{displayValue}</span>
        <Icon name="selectChevron" size="inline" weight={iconWeights.inline} className="toolbar-select-chevron" />
      </button>
      {menuMounted && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}
