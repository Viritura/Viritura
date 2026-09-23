import { ChevronDown } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./SelectTrigger.module.css";

export interface SelectTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly children: ReactNode;
  readonly leading?: ReactNode;
  readonly size?: "md" | "lg";
  readonly fullWidth?: boolean;
  readonly indicator?: "chevron" | "corner";
  readonly variant?: "default" | "icon-button";
}

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(function SelectTrigger(
  {
    children,
    leading,
    size = "md",
    fullWidth = false,
    indicator,
    variant = "default",
    className,
    type = "button",
    ...props
  },
  ref,
) {
  const resolvedIndicator = indicator ?? (variant === "icon-button" ? "corner" : "chevron");
  return (
    <button
      ref={ref}
      type={type}
      className={[
        styles.trigger,
        size === "lg" ? styles.triggerLg : "",
        fullWidth ? styles.fullWidth : "",
        variant === "icon-button" ? styles.iconButton : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <span className={styles.triggerInner}>
        {leading ? <span className={styles.leading}>{leading}</span> : null}
        {children}
      </span>
      {resolvedIndicator === "corner" ? (
        <span className={styles.corner} data-select-corner aria-hidden="true" />
      ) : (
        <ChevronDown className={styles.chevron} size={12} aria-hidden="true" />
      )}
    </button>
  );
});
