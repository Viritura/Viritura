/**
 * SectionLabel — small uppercase heading used to demarcate subsections
 * inside a panel body (under a PanelHeader).
 *
 *   ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
 *   [icon] CHANGES                              (9)
 *
 * Typography matches the rest of the editor's section-title vocabulary:
 * 0.66rem / 600 / uppercase / 0.06em tracking. Use sparingly — the
 * panel's primary title comes from PanelHeader, this is a sub-heading.
 */
import type { ReactNode } from "react";
import styles from "./SectionLabel.module.css";

export interface SectionLabelProps {
  /** Required text label. */
  label: ReactNode;
  /** Optional small icon shown to the left. */
  icon?: ReactNode;
  /** Optional badge content (typically a count). */
  badge?: ReactNode;
  /** Additional className for the outer container. */
  className?: string;
}

export function SectionLabel({ label, icon, badge, className }: SectionLabelProps) {
  return (
    <div className={`${styles.label} ${className ?? ""}`}>
      <span className={styles.text}>
        {icon && <span className={styles.icon}>{icon}</span>}
        {label}
      </span>
      {badge !== undefined && badge !== null && <span className={styles.badge}>{badge}</span>}
    </div>
  );
}
