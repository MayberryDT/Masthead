import { forwardRef, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { Icon } from "../icons/Icon";
import { iconWeights } from "../icons/icon-tokens";

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  containerClassName?: string;
  density?: "regular" | "compact";
  onClear?: () => void;
  shortcutHint?: string;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { className = "", containerClassName = "", density = "regular", onClear, onKeyDown, shortcutHint, ...props },
  ref
) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") onClear?.();
    onKeyDown?.(event);
  };

  return (
    <label className={`search-field metal-input search-input search-input-${density} ${containerClassName}`.trim()}>
      <Icon name="search" size="toolbar" weight={iconWeights.toolbar} className="search-icon" />
      <input ref={ref} type="search" className={className} onKeyDown={handleKeyDown} {...props} />
      {shortcutHint ? <span className="search-input-shortcut">{shortcutHint}</span> : null}
    </label>
  );
});
