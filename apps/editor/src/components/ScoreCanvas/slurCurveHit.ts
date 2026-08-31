/**
 * slurCurveHit — precise hit-testing against the painted slur arc.
 *
 * Slurs are not published in `element_bboxes`; the spatial index only sees the
 * axis-aligned rectangle derived from the bezier command. That rectangle is a
 * poor stand-in for a thin crescent: it is large (so `SpatialIndex.hitTest`,
 * which returns the *smallest* containing box, hands the click to any notehead
 * / stem / beam box that also covers the point) and it is mostly empty space.
 * The result is that long or steep slurs are effectively unclickable.
 *
 * The engine already publishes the exact spine cubic per slur segment in
 * `DisplayList.slurGeometries` (one entry per drawn segment, so cross-system
 * halves share an element id). Measuring the click's distance to that cubic
 * gives a hitbox that matches what the user actually sees.
 */
import type { SlurGeometry } from "@viritura/renderer";

/** Extra click slop (px) beyond the painted crescent's half-thickness. */
const SLUR_CURVE_HIT_PAD = 3;

/** Polyline samples used to approximate one cubic segment. */
const CURVE_SAMPLES = 24;

/** Squared distance from a point to the segment `a`→`b`. */
function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/** Squared distance from a point to a slur's spine cubic. */
function distSqToSpine(g: SlurGeometry, x: number, y: number): number {
  let prevX = g.p0x;
  let prevY = g.p0y;
  let best = Infinity;
  for (let i = 1; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    const cx = b0 * g.p0x + b1 * g.p1x + b2 * g.p2x + b3 * g.p3x;
    const cy = b0 * g.p0y + b1 * g.p1y + b2 * g.p2y + b3 * g.p3y;
    const d2 = distSqToSegment(x, y, prevX, prevY, cx, cy);
    if (d2 < best) best = d2;
    prevX = cx;
    prevY = cy;
  }
  return best;
}

/**
 * Return the element id of the slur whose painted arc is closest to
 * `(x, y)` (engine layout coordinates) within its click tolerance, or null
 * when the point is not on a slur.
 */
export function hitTestSlurCurve(
  slurGeometries: readonly SlurGeometry[] | undefined,
  x: number,
  y: number,
): string | null {
  if (!slurGeometries || slurGeometries.length === 0) return null;

  let bestId: string | null = null;
  let bestD2 = Infinity;
  for (const g of slurGeometries) {
    const tol = Math.max(g.thickness, 1) / 2 + SLUR_CURVE_HIT_PAD;
    // Cheap reject: the cubic is contained in its control-point hull, so the
    // hull's padded bounding box is a conservative pre-filter.
    if (x < Math.min(g.p0x, g.p1x, g.p2x, g.p3x) - tol) continue;
    if (x > Math.max(g.p0x, g.p1x, g.p2x, g.p3x) + tol) continue;
    if (y < Math.min(g.p0y, g.p1y, g.p2y, g.p3y) - tol) continue;
    if (y > Math.max(g.p0y, g.p1y, g.p2y, g.p3y) + tol) continue;

    const d2 = distSqToSpine(g, x, y);
    if (d2 <= tol * tol && d2 < bestD2) {
      bestD2 = d2;
      bestId = g.elementId;
    }
  }
  return bestId;
}
