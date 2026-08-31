/**
 * Pure coordinate helpers for the drum-kit staff overlay.
 *
 * All geometry comes from the engine's rendered display list (staff lines via
 * `detectStaves`, notehead boxes via the spatial index) — these helpers only
 * convert between the engine's pixel space and the MNX staff-position space.
 */

import type { StaffInfo } from "@viritura/renderer";

/** Clamp the drawable staff-position range (room for cymbals / kick). */
const MAX_POS = 12;
const MIN_POS = -10;

/**
 * Convert a Y coordinate (in display-list pixels) to an MNX staff position.
 *
 * The engine renders a kit component at `pos_from_top = 4 - staffPosition`
 * half-spaces below the top staff line, so the inverse is
 * `staffPosition = 4 - posFromTop`. Snaps to the nearest half-space.
 */
export function staffPositionFromDlY(dlY: number, staff: StaffInfo): number {
  const posFromTop = Math.round((dlY - staff.y) / (staff.spatium / 2));
  const sp = 4 - posFromTop;
  return Math.max(MIN_POS, Math.min(MAX_POS, sp));
}
