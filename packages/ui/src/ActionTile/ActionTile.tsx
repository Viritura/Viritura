import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./ActionTile.module.css";
import { withTooltip } from "../Tooltip/withTooltip";

export interface ActionTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  /** Leading icon (e.g. a lucide icon). */
  icon?: ReactNode;
  /** Primary title. */
  title: ReactNode;
  /** Optional secondary hint shown under the title. */
  hint?: ReactNode;
  /** `recommended` paints the tile in accent colors and bumps the title weight. */
  variant?: "default" | "recommended";
  /** Marks this tile as the current destination in a navigation group. */
  active?: boolean;
  /** Tooltip text. Rendered through `<Tooltip>` (not the native browser title). */
  tooltip?: string;
  /** Optional className extension. */
  className?: string;
}

/**
 * A button-shaped tile with optional leading icon plus a stacked title +
 * hint. Used in the Start Center sidebar actions, the folder-confirm
 * dialog, and ensemble template pickers — anywhere we want a clickable
 * surface that's bigger and more descriptive than a plain `<Button>`.
 */
export const ActionTile = forwardRef<HTMLButtonElement, ActionTileProps>(function ActionTile(
  { icon, title, hint, variant = "default", active = false, tooltip, className, type = "button", ...rest },
  ref,
) {
  const cls = [styles.tile, variant === "recommended" ? styles.recommended : "", active ? styles.active : "", className]
    .filter(Boolean)
    .join(" ");
  return withTooltip(
    <button ref={ref} type={type} className={cls} aria-current={active ? "page" : undefined} {...rest}>
      {icon !== undefined && <span className={styles.icon}>{icon}</span>}
      <span className={styles.textStack}>
        <span className={styles.title}>{title}</span>
        {hint !== undefined && <span className={styles.hint}>{hint}</span>}
      </span>
    </button>,
    tooltip,
  );
});
