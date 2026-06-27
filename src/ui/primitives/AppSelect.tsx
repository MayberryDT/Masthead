import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";
import { createPortal } from "react-dom";

export type AppSelectOption<T extends string> = {
  value: T;
  label: string;
};

type AppSelectProps<T extends string> = {
  label: string;
  icon: IconName;
  value: T;
  options: AppSelectOption<T>[];
  onChange: (value: string) => void;
  className?: string;
};

export function AppSelect<T extends string>({ label, icon, value, options, onChange, className = "" }: AppSelectProps<T>) {
  const [menuState, setMenuState] = useState<"closed" | "open" | "closing">("closed");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const open = menuState === "open";
  const menuMounted = menuState !== "closed";
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const selected = options[selectedIndex];
  const selectedLabel = selected?.label ?? label;
  const triggerLabel = `${label}: ${selectedLabel}`;
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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

  const updateMenuPlacement = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const menuWidth = Math.min(Math.max(rect.width, 180), window.innerWidth - viewportPadding * 2);
    const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - viewportPadding - menuWidth);
    setMenuStyle({
      left,
      minWidth: menuWidth,
      position: "fixed",
      top: rect.bottom + 6
    });
  };

  const openMenu = () => {
    clearCloseTimers();
    updateMenuPlacement();
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
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };

    const onReposition = () => updateMenuPlacement();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const frame = window.requestAnimationFrame(() => {
      updateMenuPlacement();
      optionRefs.current[selectedIndex]?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedIndex]);

  useEffect(() => clearCloseTimers, []);

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

  const menu = (
    <div
      ref={menuRef}
      id={listboxId}
      className={`toolbar-select-menu toolbar-select-menu-portal t-dropdown ${open ? "is-open" : ""} ${menuState === "closing" ? "is-closing" : ""}`.trim()}
      data-origin="top-left"
      role="listbox"
      aria-label={label}
      hidden={!menuMounted}
      onKeyDown={onMenuKeyDown}
      style={menuStyle}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            optionRefs.current[index] = node;
          }}
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={`toolbar-select-option ${option.value === value ? "selected" : ""}`.trim()}
          onClick={() => choose(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className={`toolbar-select metal-control ${open ? "open" : ""} ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="toolbar-select-trigger"
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <Icon name={icon} size="toolbar" weight={iconWeights.toolbar} className="toolbar-select-leading-icon" />
        <span>{selectedLabel}</span>
        <Icon name="selectChevron" size="inline" weight={iconWeights.inline} className="toolbar-select-chevron" />
      </button>

      {menuMounted && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}
