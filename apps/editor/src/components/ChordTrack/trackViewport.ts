import type { DisplayList } from "@viritura/renderer";
import type { TrackSystem } from "./types";

/** Base dimensions at a 12px spatium; staff size and canvas zoom scale the lane together. */
export const CHORD_TRACK_GAP = 12;
export const CHORD_TRACK_INSET = 108;

export function chordTrackScale(displayList: DisplayList): number {
  const staff = displayList.measureBounds?.find(
    (measure) => !measure.ghostStaff && !measure.isExpansion && !measure.isHidden,
  );
  return staff ? staff.height / 48 : 1;
}

export function scaleTrackSystem(system: TrackSystem, scale: number): TrackSystem {
  return {
    ...system,
    measures: system.measures.map((measure) => ({
      ...measure,
      x: measure.x * scale,
      width: measure.width * scale,
      prefixWidth: measure.prefixWidth * scale,
      beatAnchors: measure.beatAnchors.map(([beat, anchorX]) => [beat, anchorX * scale]),
    })),
    width: system.width * scale,
  };
}
