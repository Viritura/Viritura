/**
 * Placement of the in-canvas condensed-staff handles.
 *
 * ── Horizontal ──────────────────────────────────────────────────────────
 * Two regimes, because horizon view swaps in a sticky clef column once a
 * staff's own clef scrolls out of view:
 *
 *  • **Normal** — the handle rides just left of the staff's opening barline,
 *    so it travels with the score and never covers the clef.
 *  • **Sticky** — the staff's start is off-screen and the renderer is painting
 *    a substitute clef pinned to the left edge. The handle parks just past
 *    that column rather than drifting off-screen with the staff it belongs to.
 *
 * `safeAreaLeft` is the floating left panel's width, i.e. the first x the user
 * can actually see; the renderer anchors the sticky column to the same value,
 * so both agree on where "the left edge" is.
 *
 * ── Vertical ────────────────────────────────────────────────────────────
 * The handle sits in the **gap below** its condensed staff, not centred on it.
 * Instrument names are centred on each staff, so a centred handle collides
 * with them; the inter-staff gap is empty by construction. It also puts the
 * control exactly where the expanded staves will appear, since
 * `injectExpandedStaves` inserts them directly below the condensed staff.
 *
 * Same idea as the engrave-mode ghost rail, which centres itself between the
 * two staves it separates.
 */

/** Handle size in CSS px. Fixed so it stays clickable at any zoom. */
export const HANDLE_SIZE = 22;
/** Breathing room between the handle and whatever it sits beside. */
const GAP = 6;
/**
 * Sticky clef column width in spatia. Mirrors `clefWidth` in the renderer's
 * `paintStickyClefs` — the handle has to clear exactly that column.
 */
const STICKY_COLUMN_SPATIA = 3.5;
/**
 * How far past a staff's left edge the score must scroll before the renderer
 * swaps in the sticky clef. Mirrors `minScrollThreshold` in `paintStickyClefs`.
 */
const STICKY_THRESHOLD_SPATIA = 2;

export interface HandleXArgs {
  /** Staff's leftmost barline, in score coordinates. */
  readonly staffLeftScore: number;
  /** Staff spatium in score units (staff height / 4). */
  readonly spatium: number;
  readonly scrollX: number;
  readonly zoom: number;
  /** Sticky clef substitution only happens in horizon view. */
  readonly horizon: boolean;
  /** Left inset of the floating panel — the first visible x. */
  readonly safeAreaLeft: number;
}

export function condensedHandleX(args: HandleXArgs): number {
  const { staffLeftScore, spatium, scrollX, zoom, horizon, safeAreaLeft } = args;

  // Leftmost score position actually visible past the floating panel — the
  // same anchor the renderer uses for the sticky clef column.
  const visibleLeftScore = scrollX + safeAreaLeft / zoom;
  const stickyActive = horizon && visibleLeftScore >= staffLeftScore + spatium * STICKY_THRESHOLD_SPATIA;

  if (stickyActive) {
    return safeAreaLeft + spatium * STICKY_COLUMN_SPATIA * zoom + GAP;
  }
  const staffLeftScreen = (staffLeftScore - scrollX) * zoom;
  return Math.max(staffLeftScreen - HANDLE_SIZE - GAP, safeAreaLeft + GAP);
}

export interface HandleYArgs {
  /** Bottom of the condensed staff, in score coordinates. */
  readonly staffBottomScore: number;
  /** Top of the next staff down in the same system, or null if it's the last. */
  readonly nextStaffTopScore: number | null;
  readonly scrollY: number;
  readonly zoom: number;
}

/** Screen-space `top` for the handle, centred in the gap below its staff. */
export function condensedHandleY(args: HandleYArgs): number {
  const { staffBottomScore, nextStaffTopScore, scrollY, zoom } = args;
  const staffBottomScreen = (staffBottomScore - scrollY) * zoom;

  // Last staff of a system: no gap to centre in, so hang the handle just under
  // the staff. Centring on a nominal gap here would push the handle's top edge
  // back over the staff at low zoom, which is exactly the collision we're
  // avoiding.
  if (nextStaffTopScore === null) return staffBottomScreen + GAP;

  const nextStaffTopScreen = (nextStaffTopScore - scrollY) * zoom;
  return (staffBottomScreen + nextStaffTopScreen) / 2 - HANDLE_SIZE / 2;
}
