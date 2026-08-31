import type { ReactNode } from "react";
import styles from "./StatusBar.module.css";

export interface StatusBarProps {
  /** Left slot — typically selection / cursor info. */
  left?: ReactNode;
  /** Center slot — typically title or transient warnings. */
  center?: ReactNode;
  /** Right slot — typically view-mode / zoom / theme controls. */
  right?: ReactNode;
  /** Additional className applied to the bar root. */
  className?: string;
  /** Accessible label. Defaults to "Status bar". */
  ariaLabel?: string;
  /** Forwarded to data-testid on the bar root. */
  testId?: string;
}

/**
 * StatusBar — the dark "command pill" shell used across editor modes.
 *
 * Owns chrome (glass background, blur, drop shadow, layout grid) and
 * exposes three slots so each mode can compose its own controls without
 * duplicating the pill aesthetic. Render `StatusSelect` / `StatusZoomControls`
 * (siblings in this folder) inside the right slot to match the editor's
 * Write / Engrave / Publish surfaces.
 */
export function StatusBar({ left, center, right, className, ariaLabel = "Status bar", testId }: StatusBarProps) {
  return (
    <div
      className={`${styles.bar} ${className ?? ""}`}
      role="status"
      aria-label={ariaLabel}
      data-testid={testId}
      // Signals to shared primitives (Button, Slider, IconButton) that
      // they're sitting on an intentionally-inverted surface, so they
      // adopt their dark-theme styling regardless of the active app theme.
      // Token vars (--text, --text-muted) are also overridden on `.bar`
      // for descendants that read from the theme cascade (e.g. .link).
      data-on-dark="true"
    >
      {left !== undefined && <div className={styles.left}>{left}</div>}
      {center !== undefined && <div className={styles.center}>{center}</div>}
      {right !== undefined && <div className={styles.right}>{right}</div>}
    </div>
  );
}
