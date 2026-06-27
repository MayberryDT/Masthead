import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type AppButtonVariant = "default" | "primary" | "danger" | "quiet" | "icon";

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: AppButtonVariant;
};

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  { children, className = "", type = "button", variant = "default", ...props },
  ref
) {
  return (
    <button ref={ref} type={type} className={`app-button app-button-${variant} metal-control ${className}`.trim()} {...props}>
      {children}
    </button>
  );
});
