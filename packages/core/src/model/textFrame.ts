import type { TextContent } from "./text";

/** The single locator that determines which rendered page contains a text frame. */
export type TextFrameLocator =
  | { type: "page"; pageIndex: number }
  | { type: "globalMeasure"; measureId: string }
  | { type: "event"; partId: string; eventId: string };

/** A page edge or corner relative to which a frame is placed. */
export type TextFramePageAnchor =
  "top" | "right" | "bottom" | "left" | "top-left" | "top-right" | "bottom-right" | "bottom-left";

/** Width in staff spaces or as a fraction of the available text column. */
export type TextFrameWidth = { unit: "staffSpaces"; value: number } | { unit: "textColumnFraction"; value: number };

/** Source-unit metadata retained for future loss-aware import conversions. */
export interface TextFrameSourceReference {
  unit: string;
  /** Source-unit size of the reference staff, when the source defines one. */
  referenceStaffSize?: number;
}

/**
 * A per-score, freely authored rectangular text block.
 *
 * Its locator selects the page directly or the measure/event whose page it
 * follows after pagination. Placement offsets are measured in staff spaces
 * in page coordinates (+x right, +y down), unlike staff-relative engraving
 * deltas.
 * Height is always automatic; text wrapping and collision handling are left
 * to the renderer.
 */
export interface TextFrame {
  id: string;
  locator: TextFrameLocator;
  placement: {
    anchor: TextFramePageAnchor;
    offset: { x: number; y: number };
  };
  width: TextFrameWidth;
  content: TextContent;
  horizontalAlignment?: "left" | "center" | "right";
  paragraphJustification?: "left" | "center" | "right" | "justify";
  padding?: number;
  border?: "none" | "solid";
  sourceReference?: TextFrameSourceReference;
}
