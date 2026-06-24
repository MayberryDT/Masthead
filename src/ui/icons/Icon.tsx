import type { IconWeight } from "@phosphor-icons/react";
import { iconRegistry, type IconName } from "./icon-registry";
import { iconSizes, type IconSizeToken } from "./icon-tokens";

type Props = {
  name: IconName;
  size?: IconSizeToken | number;
  weight?: IconWeight;
  label?: string;
  className?: string;
};

export function Icon({ name, size = "inline", weight = "regular", label, className }: Props) {
  const PhosphorIcon = iconRegistry[name];
  const resolvedSize = typeof size === "number" ? size : iconSizes[size];
  const iconClassName = className ? `masthead-icon ${className}` : "masthead-icon";

  return (
    <PhosphorIcon
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={iconClassName}
      color="currentColor"
      focusable="false"
      role={label ? "img" : undefined}
      size={resolvedSize}
      weight={weight}
    />
  );
}

export type { IconName };
