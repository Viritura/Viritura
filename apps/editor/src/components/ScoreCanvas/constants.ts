import type { CSSProperties } from "react";
import { DEFAULT_PART_PAGE_SETUP } from "@viritura/core";

/** mm-to-px conversion used everywhere ScoreCanvas converts page geometry. */
export const PX_PER_MM = 12;

/** Font size used for glyph atlas (1em = 4sp in Bravura). */
export const ATLAS_FONT_SIZE = Math.round(4 * DEFAULT_PART_PAGE_SETUP.spatiumMm * PX_PER_MM);

export const SCORE_ROOT_STYLE: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  height: "100%",
};
export const SCORE_LOADING_STYLE: CSSProperties = { padding: "2rem", color: "var(--text-muted)" };
export const SCORE_ERROR_STYLE: CSSProperties = {
  padding: "1rem",
  background: "var(--surface-raised)",
  border: "none",
  borderRadius: "10px",
  boxShadow: "var(--inset-soft), inset 0 0 0 1.5px var(--error)",
  color: "var(--warning)",
};
export const SCORE_CANVAS_WRAP_STYLE: CSSProperties = { position: "relative", flex: 1 };

export function scoreCanvasElementStyle(
  visible: boolean,
  cursor: CSSProperties["cursor"],
  printPreview: boolean,
  theme: string,
): CSSProperties {
  return {
    display: visible ? "block" : "none",
    cursor,
    touchAction: "none",
    outline: "none",
    width: "100%",
    height: "100%",
    pointerEvents: printPreview ? "none" : "auto",
    filter: theme === "midnight" ? "invert(1) hue-rotate(180deg)" : undefined,
  };
}
