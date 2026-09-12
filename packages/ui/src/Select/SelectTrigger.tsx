import { ChevronDown } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./SelectTrigger.module.css";

export interface SelectTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly children: ReactNode;
  readonly leading?: ReactNode;
  readonly size?: "md" | "lg";
  readonly fullWidth?: boolean;
}

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(function SelectTrigger(
  { children, leading, size = "md", fullWidth = false, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={[
        styles.trigger,
        size === "lg" ? styles.triggerLg : "",
        fullWidth ? styles.fullWidth : "",
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
      <ChevronDown className={styles.chevron} size={12} aria-hidden="true" />
    </button>
  );
});
