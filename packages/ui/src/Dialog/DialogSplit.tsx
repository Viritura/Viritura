import type { ReactNode } from "react";
import styles from "./DialogSplit.module.css";

/**
 * Two-pane dialog body: a fixed-width aside (nav rail) beside a scrolling
 * main region.
 *
 * Replaces `DialogBody` — not nested inside it — because the two own
 * conflicting scroll behaviour. `DialogBody` scrolls as one block; a split
 * body must give each pane its own independent scroll so a long detail panel
 * never scrolls the rail out of view.
 *
 * Use with `Dialog size="xwide"`, which already supplies the flex column and
 * `overflow: hidden` the panes need to size against.
 */
export function DialogSplitBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // `data-dialog-split` is read by Dialog.module.css (`:has()`) to pin the
    // dialog to a fixed height — see the rule there for why.
    <div data-dialog-split className={[styles.body, className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

/**
 * The navigation pane. Scrolls independently of the main pane and collapses
 * to a full-width band above it on narrow viewports.
 */
export function DialogSplitAside({
  children,
  ariaLabel,
  className,
}: {
  children: ReactNode;
  /** Accessible name for the landmark, e.g. "Settings categories". */
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={[styles.aside, className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      {children}
    </div>
  );
}

/** The detail pane. Scrolls independently of the aside. */
export function DialogSplitMain({
  children,
  className,
  id,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  /** Panel id, to match a `NavList` `panelIdPrefix`. */
  id?: string;
  /** Id of the tab naming this panel. */
  labelledBy?: string;
}) {
  return (
    <div
      className={[styles.main, className].filter(Boolean).join(" ")}
      id={id}
      role={id !== undefined ? "tabpanel" : undefined}
      aria-labelledby={labelledBy}
      /* A scrollable region needs to be focusable so keyboard-only users can
         scroll it without a pointer. */
      tabIndex={0}
    >
      {children}
    </div>
  );
}

/**
 * Sticky title band at the top of the main pane. Keeps the active category
 * visible while its settings scroll underneath.
 */
export function DialogSplitMainHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Trailing controls, e.g. a per-category "Reset to defaults". */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={[styles.mainHeader, className].filter(Boolean).join(" ")}>
      <div className={styles.mainHeaderText}>
        <h2 className={styles.mainTitle}>{title}</h2>
        {description !== undefined && <p className={styles.mainDescription}>{description}</p>}
      </div>
      {actions !== undefined && <div className={styles.mainActions}>{actions}</div>}
    </div>
  );
}
