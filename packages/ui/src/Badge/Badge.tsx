import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export interface BadgeProps {
  /** Badge content */
  children: ReactNode;
  /** Color variant */
  variant?: "accent" | "muted" | "error" | "warning" | "success";
  /** Use monospace font (for technical values) */
  mono?: boolean;
  /** Test ID for testing */
  testId?: string;
  /** Additional className */
  className?: string;
}

export function Badge({ children, variant = "accent", mono = false, testId, className }: BadgeProps) {
  const classNames = [styles.badge, styles[variant], mono ? styles.mono : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classNames} data-testid={testId}>
      {children}
    </span>
  );
}
