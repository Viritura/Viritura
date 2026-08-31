/**
 * PanelHeader — the single header treatment used by every docked panel
 * across activities (Write, Engrave, Play, Publish, plus the floating
 * MNX Source / AI panels).
 *
 * Anatomy (top to bottom, left to right):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [icon] Title                          [actions] [close] │
 *   │ Optional subtitle on a second line                       │
 *   └──────────────────────────────────────────────────────────┘
 *
 * - Title:    13px / 600, primary text color, ellipsises when narrow.
 * - Subtitle: 12px, dim, multi-line wrap.
 * - Actions:  capsule pills (use the exported `PanelActionButton`) so
 *             every panel's All / None / Reset / Show All etc. share
 *             the same vocabulary as Mixer M/S toggles.
 * - Close:    small circular icon button on the far right.
 *
 * The bottom hairline border is shared with the rest of the editor
 * (rgba(20,20,28,0.06) light / rgba(255,255,255,0.06) dark) and matches
 * the dividers used in WorkspacePanel footers, Tabs, Mixer master section.
 */

import type { ReactNode } from "react";
import styles from "./PanelHeader.module.css";
import { withTooltip } from "../Tooltip/withTooltip";

export interface PanelHeaderProps {
  /** Primary panel title. */
  title: ReactNode;
  /** Optional second-line description / status. */
  subtitle?: ReactNode;
  /** Optional small icon shown to the left of the title. */
  icon?: ReactNode;
  /** Optional action buttons (right side). Wrap in <PanelActionButton>. */
  actions?: ReactNode;
  /** Close handler — when provided, renders a small ✕ button. */
  onClose?: () => void;
  /** Override the default ✕ glyph. */
  closeIcon?: ReactNode;
  /** Additional className for the outer container. */
  className?: string;
}

export function PanelHeader({ title, subtitle, icon, actions, onClose, closeIcon, className }: PanelHeaderProps) {
  return (
    <div className={`${styles.header} ${className ?? ""}`}>
      <div className={styles.row}>
        <span className={styles.titleGroup}>
          {icon && <span className={styles.icon}>{icon}</span>}
          <span className={styles.title}>{title}</span>
        </span>
        {(actions || onClose) && (
          <span className={styles.actions}>
            {actions}
            {onClose && (
              <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close panel">
                {closeIcon ?? "✕"}
              </button>
            )}
          </span>
        )}
      </div>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
    </div>
  );
}

/** Small action button for use in PanelHeader's `actions` slot. */
export function PanelActionButton({
  children,
  onClick,
  tooltip,
  disabled,
  active,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  /** Tooltip text. Rendered through `<Tooltip>` (not the native browser title). */
  tooltip?: string;
  disabled?: boolean;
  /** Visually mark as the currently-selected option in a toggle group. */
  active?: boolean;
  className?: string;
}) {
  return withTooltip(
    <button
      type="button"
      className={`${styles.actionButton} ${active ? styles.actionButtonActive : ""} ${className ?? ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      {children}
    </button>,
    tooltip,
  );
}
