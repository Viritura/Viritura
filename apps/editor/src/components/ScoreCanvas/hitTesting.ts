import type { MeasureBounds } from "@viritura/renderer";
import type { MeasureSelectionPoint } from "../../store/selectionStore";
import type { BarlineHit } from "./ScoreCanvas";

/**
 * Hit tolerance for clicking a barline, in engine layout pixels.
 * The engine uses 1 sp = 12 px (4 sp = 48 px staff height), so 14 ≈ 1.17 sp.
 */
const BARLINE_HIT_TOLERANCE = 14;

/** Convert a system-wide visual staff index to its 0-based index within a part. */
export function partLocalStaffIndex(
  measureBounds: readonly MeasureBounds[] | undefined,
  partIndex: number,
  visualStaffIndex: number,
): number {
  if (!measureBounds?.length) return 0;
  const partStaffIndices = Array.from(
    new Set(measureBounds.filter((bound) => bound.partIndex === partIndex).map((bound) => bound.staffIndex)),
  ).sort((left, right) => left - right);
  const localIndex = partStaffIndices.indexOf(visualStaffIndex);
  return localIndex >= 0 ? localIndex : 0;
}

/**
 * Resolve a pointer to the closest visual staff's measure. The one-staff-height
 * vertical padding keeps empty space around a staff selectable while nearest
 * center distance disambiguates overlapping padded regions.
 */
export function pointerToMeasure(
  scoreX: number,
  scoreY: number,
  measureBounds: readonly MeasureBounds[] | undefined,
): MeasureSelectionPoint | null {
  if (!measureBounds?.length) return null;
  let hit: MeasureSelectionPoint | null = null;
  let bestDistance = Infinity;
  for (const measure of measureBounds) {
    if (scoreX < measure.x || scoreX > measure.x + measure.width) continue;
    const padding = measure.height;
    if (scoreY < measure.y - padding || scoreY > measure.y + measure.height + padding) continue;
    const distance = Math.abs(scoreY - (measure.y + measure.height / 2));
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    hit = {
      partIndex: measure.partIndex,
      staffIndex: measure.staffIndex,
      localStaffIndex: partLocalStaffIndex(measureBounds, measure.partIndex, measure.staffIndex),
      measureIndex: measure.index,
      isExpansion: measure.isExpansion,
    };
  }
  return hit;
}

/**
 * Find the right-barline of a measure under (scoreX, scoreY). Considered hit
 * when within BARLINE_HIT_TOLERANCE of the right edge AND vertically within
 * the system span — i.e. anywhere between the top of the topmost staff and
 * the bottom of the bottommost staff sharing that measure index. This makes
 * the hitbox cover the connector between staves, not just each staff body.
 * Picks the topmost staff for the resulting hit.
 */
export function pointerToBarline(
  scoreX: number,
  scoreY: number,
  measureBounds: MeasureBounds[] | undefined,
): BarlineHit | null {
  if (!measureBounds || measureBounds.length === 0) return null;
  // Group same-index measures within X tolerance into a single system span.
  let bestTop: MeasureBounds | null = null;
  let bestSpanTop = Infinity;
  let bestSpanBottom = -Infinity;
  let bestXDist = Infinity;
  // First pass: find the closest right-barline X within tolerance, and the
  // measure index it belongs to.
  let targetIndex = -1;
  for (const m of measureBounds) {
    const right = m.x + m.width;
    const dx = Math.abs(scoreX - right);
    if (dx > BARLINE_HIT_TOLERANCE) continue;
    if (dx < bestXDist) {
      bestXDist = dx;
      targetIndex = m.index;
    }
  }
  if (targetIndex < 0) return null;
  // Second pass: collect every staff sharing that index near the same X to
  // compute the full vertical span of this barline.
  for (const m of measureBounds) {
    if (m.index !== targetIndex) continue;
    const right = m.x + m.width;
    if (Math.abs(scoreX - right) > BARLINE_HIT_TOLERANCE) continue;
    if (m.y < bestSpanTop) {
      bestSpanTop = m.y;
      bestTop = m;
    }
    if (m.y + m.height > bestSpanBottom) bestSpanBottom = m.y + m.height;
  }
  if (!bestTop) return null;
  if (scoreY < bestSpanTop || scoreY > bestSpanBottom) return null;
  return {
    measureIndex: bestTop.index,
    partIndex: bestTop.partIndex,
    staffIndex: bestTop.staffIndex,
    barlineX: bestTop.x + bestTop.width,
    staffTopY: bestTop.y,
  };
}
