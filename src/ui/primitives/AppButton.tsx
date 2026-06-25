import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AppButtonVariant = "default" | "primary" | "danger" | "quiet" | "icon";

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: AppButtonVariant;
};

export function AppButton({ children, className = "", type = "button", variant = "default", ...props }: AppButtonProps) {
  return (
    <button type={type} className={`app-button app-button-${variant} metal-control ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
