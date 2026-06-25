import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";

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
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const frame = window.requestAnimationFrame(() => {
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
    </div>
  );
}
