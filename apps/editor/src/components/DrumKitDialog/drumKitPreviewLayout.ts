import { wasmComputeMnxScoreLayout, type DisplayList } from "@viritura/renderer";
import { SLICE_SPATIUM } from "./drumKitSlice";

/**
 * The editable drum-kit preview needs renderer-level element IDs and bboxes,
 * which the public score-engine display-list handle deliberately hides.
 * Recompute this small slice only after the viewer engine has loaded.
 */
export function drumKitPreviewLayout(mnx: string | object, pageWidth: number): DisplayList {
  const margin = pageWidth * (15 / 210);
  return wasmComputeMnxScoreLayout(
    typeof mnx === "string" ? mnx : JSON.stringify(mnx),
    SLICE_SPATIUM,
    pageWidth,
    0,
    JSON.stringify({
      page_height: (pageWidth * (297 / 210)) / SLICE_SPATIUM,
      page_margin_top: margin / SLICE_SPATIUM,
      page_margin_right: margin / SLICE_SPATIUM,
      page_margin_bottom: margin / SLICE_SPATIUM,
      page_margin_left: margin / SLICE_SPATIUM,
    }),
  );
}
