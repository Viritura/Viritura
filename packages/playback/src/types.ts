/**
 * Public types shared across the playback package and consumers.
 *
 * `ViewMode` is the canonical layout mode for score viewers — used by the
 * playhead overlay to know how to translate (measure, beat) coordinates
 * into canvas pixels for paged vs spread vs horizon layouts.
 */

/** Score viewport layout mode. */
export type ViewMode = "page" | "spread" | "spread-h" | "horizon";
