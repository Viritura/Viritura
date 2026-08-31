import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./ListRow.module.css";
import { withTooltip } from "../Tooltip/withTooltip";

export interface ListRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  /** Leading element (icon, dot, avatar). */
  leading?: ReactNode;
  /** Primary content (typically a label string, but accepts arbitrary nodes). */
  children: ReactNode;
  /** Trailing element (count, plus icon, chevron). */
  trailing?: ReactNode;
  /** Density. `comfortable` (default) for primary rows, `compact` for nested entries. */
  density?: "comfortable" | "compact";
  /** Indent the row so it can sit inside a section/group header. */
  indent?: boolean;
  /** When true, paint the row as selected. */
  selected?: boolean;
  /** Tooltip text. Rendered through `<Tooltip>` (not the native browser title). */
  tooltip?: string;
  /** Optional className extension. */
  className?: string;
}

/**
 * A clickable list row used in pickers, browsers, and side panels. Has
 * three slots — leading / body / trailing — and two density modes.
 * Backing element is a `<button>` so it's keyboard-accessible and
 * doesn't need extra ARIA wiring.
 */
export const ListRow = forwardRef<HTMLButtonElement, ListRowProps>(function ListRow(
  {
    leading,
    children,
    trailing,
    density = "comfortable",
    indent = false,
    selected = false,
    tooltip,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const cls = [
    styles.row,
    density === "compact" ? styles.compact : styles.comfortable,
    indent ? styles.indent : "",
    selected ? styles.selected : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return withTooltip(
    <button ref={ref} type={type} className={cls} aria-pressed={selected || undefined} {...rest}>
      {leading !== undefined && <span className={styles.leading}>{leading}</span>}
      <span className={styles.body}>{children}</span>
      {trailing !== undefined && <span className={styles.trailing}>{trailing}</span>}
    </button>,
    tooltip,
  );
});
