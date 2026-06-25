import type { HTMLAttributes, ReactNode } from "react";

export type StatusBadgeTone = "neutral" | "active" | "info" | "warning" | "danger";

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: StatusBadgeTone;
};

export function StatusBadge({ children, className = "", tone = "neutral", ...props }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge-${tone} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}
