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

/** Optional block presentation, independent of attachment and musical scope. */
export interface TextFramePresentation {
  /** Omitted width leaves sizing to the owning text role; page frames require it. */
  width?: TextFrameWidth;
  horizontalAlignment?: "left" | "center" | "right";
  paragraphJustification?: "left" | "center" | "right" | "justify";
  /** Interior inset in staff spaces. */
  padding?: number;
  border?: "none" | "solid";
}

/** Shared text container; attachment, placement and visibility belong to its owner. */
export interface TextBlock extends TextFramePresentation {
  content: TextContent;
}

/** Music-relative frames use staff-space widths, never a page-column reference. */
export interface StaffTextFramePresentation extends Omit<TextFramePresentation, "width"> {
  width?: Extract<TextFrameWidth, { unit: "staffSpaces" }>;
}

/**
 * A per-score, page-positioned specialization of the shared text container.
 *
 * Its locator selects the page directly or the measure/event whose page it
 * follows after pagination. Placement offsets are measured in staff spaces
 * in page coordinates (+x right, +y down), unlike staff-relative engraving
 * deltas.
 * Height is automatic and text wraps to the required width. Page frames do
 * not reserve music space or participate in collision avoidance.
 */
export interface TextFrame extends TextBlock {
  id: string;
  locator: TextFrameLocator;
  placement: {
    anchor: TextFramePageAnchor;
    offset: { x: number; y: number };
  };
  width: TextFrameWidth;
  sourceReference?: TextFrameSourceReference;
}
