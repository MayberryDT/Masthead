import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type InputHTMLAttributes } from "react";
import { Icon } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";
import { SearchInput } from "./SearchInput";

export type CollapsibleSearchHandle = {
  focus: () => void;
};

type CollapsibleSearchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  label: string;
  value: string;
  containerClassName?: string;
  onClear: () => void;
};

export const CollapsibleSearch = forwardRef<CollapsibleSearchHandle, CollapsibleSearchProps>(function CollapsibleSearch(
  { containerClassName = "", label, onClear, placeholder, value, ...props },
  ref
) {
  const [expanded, setExpanded] = useState(Boolean(value));
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const panelId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };


  useEffect(() => () => clearCloseTimer(), []);

  const focusInput = () => {
    clearCloseTimer();
    setClosing(false);
    setExpanded(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  useImperativeHandle(ref, () => ({ focus: focusInput }), []);

  const beginClose = () => {
    clearCloseTimer();
    setClosing(true);
    setExpanded(false);
    const closeDelayMs = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 380;
    closeTimerRef.current = window.setTimeout(() => {
      setClosing(false);
      closeTimerRef.current = null;
    }, closeDelayMs);
  };

  const clearFromKeyboard = () => {
    if (value) {
      onClear();
      return;
    }
    beginClose();
  };

  const dismiss = () => {
    if (value) onClear();
    beginClose();
  };
  const handleTriggerClick = () => {
    if (expanded) {
      beginClose();
      return;
    }
    focusInput();
  };

  return (
    <div className={`collapsible-search ${expanded ? "expanded" : "collapsed"} ${closing ? "closing" : ""} ${value ? "has-value" : ""} ${containerClassName}`.trim()}>
      <button type="button" className="collapsible-search-trigger" aria-label={expanded ? "Collapse search" : label} aria-expanded={expanded} aria-controls={panelId} tabIndex={expanded && !closing ? -1 : 0} onClick={handleTriggerClick}>
        <Icon name="search" size="toolbar" weight={iconWeights.toolbar} className="search-icon" />
        <span>{label}</span>
      </button>
      <div id={panelId} className="collapsible-search-panel" aria-hidden={!expanded}>
        <SearchInput
          ref={inputRef}
          containerClassName="collapsible-search-input"
          placeholder={placeholder}
          value={value}
          onClear={clearFromKeyboard}
          tabIndex={expanded ? 0 : -1}
          trailingAction={
            <button type="button" className="search-input-action collapsible-search-dismiss" aria-label={value ? "Clear and collapse search" : "Collapse search"} tabIndex={expanded ? 0 : -1} onClick={dismiss}>
              ×
            </button>
          }
          {...props}
        />
      </div>
    </div>
  );
});
