/**
 * Page navigation arrows for `RadialMenu` paged item display.
 */

import type { CSSProperties } from "react";
import styles from "./RadialMenu.module.css";
import { isMac } from "./radialMenuHelpers";

function radialMenuPrevArrowStyle(posX: number, posY: number, radius: number): CSSProperties {
  return { left: posX - radius - 46, top: posY - 16 };
}
function radialMenuNextArrowStyle(posX: number, posY: number, radius: number): CSSProperties {
  return { left: posX + radius + 14, top: posY - 16 };
}

interface RadialMenuPageArrowsProps {
  posX: number;
  posY: number;
  radius: number;
  totalPages: number;
  currentPage: number;
  onPrev: () => void;
  onNext: () => void;
}

export function RadialMenuPageArrows({
  posX,
  posY,
  radius,
  totalPages,
  currentPage,
  onPrev,
  onNext,
}: RadialMenuPageArrowsProps): React.ReactElement | null {
  if (totalPages <= 1) return null;
  return (
    <>
      <span className={styles.pageIndicator} style={{ left: posX, top: posY - radius - 26 }} aria-live="polite">
        {currentPage + 1} / {totalPages}
      </span>
      <button
        type="button"
        className={styles.pageArrow}
        style={radialMenuPrevArrowStyle(posX, posY, radius)}
        onClick={onPrev}
        aria-label="Previous page"
      >
        <span className={styles.pageArrowIcon}>‹</span>
        <span className={styles.pageArrowHint}>{isMac ? "⌥" : "Ctrl"}</span>
      </button>
      <button
        type="button"
        className={styles.pageArrow}
        style={radialMenuNextArrowStyle(posX, posY, radius)}
        onClick={onNext}
        aria-label="Next page"
      >
        <span className={styles.pageArrowIcon}>›</span>
        <span className={styles.pageArrowHint}>{isMac ? "⌃" : "Alt"}</span>
      </button>
    </>
  );
}
