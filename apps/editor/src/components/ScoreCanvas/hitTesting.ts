import type { MeasureBounds, SpatialIndex } from "@viritura/renderer";
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

/** Whether the pointer is inside a measure's actual five-line staff body. */
export function pointerInsideMeasureStaff(
  scoreX: number,
  scoreY: number,
  measureBounds: readonly MeasureBounds[] | undefined,
): boolean {
  return (
    measureBounds?.some(
      (measure) =>
        scoreX >= measure.x &&
        scoreX <= measure.x + measure.width &&
        scoreY >= measure.y &&
        scoreY <= measure.y + measure.height,
    ) ?? false
  );
}

/**
 * Find a nearby selectable element without making blank staff space difficult
 * to use. Ink inside a bar gets a half-spatium tolerance; displaced annotations
 * outside the staff retain the broader two-spatium tolerance.
 */
export function findNearbyElement(
  spatialIndex: SpatialIndex,
  scoreX: number,
  scoreY: number,
  measureBounds: readonly MeasureBounds[] | undefined,
): string | null {
  const tolerance = pointerInsideMeasureStaff(scoreX, scoreY, measureBounds) ? 6 : 24;
  return spatialIndex.findNearest(scoreX, scoreY, tolerance);
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
  const candidates = new Map<
    number,
    {
      top: MeasureBounds;
      spanTop: number;
      spanBottom: number;
      xDistance: number;
    }
  >();

  // Build complete vertical spans before choosing a barline. Different systems
  // commonly align barlines at the same X, so choosing by X first can select a
  // measure on the first system and then reject an otherwise valid lower hit.
  for (const m of measureBounds) {
    const right = m.x + m.width;
    const dx = Math.abs(scoreX - right);
    if (dx > BARLINE_HIT_TOLERANCE) continue;
    const candidate = candidates.get(m.index);
    if (!candidate) {
      candidates.set(m.index, {
        top: m,
        spanTop: m.y,
        spanBottom: m.y + m.height,
        xDistance: dx,
      });
      continue;
    }
    if (m.y < candidate.spanTop) {
      candidate.spanTop = m.y;
      candidate.top = m;
    }
    candidate.spanBottom = Math.max(candidate.spanBottom, m.y + m.height);
    candidate.xDistance = Math.min(candidate.xDistance, dx);
  }

  const hit = [...candidates.values()]
    .filter((candidate) => scoreY >= candidate.spanTop && scoreY <= candidate.spanBottom)
    .sort((left, right) => left.xDistance - right.xDistance)[0];
  if (!hit) return null;
  return {
    measureIndex: hit.top.index,
    partIndex: hit.top.partIndex,
    staffIndex: hit.top.staffIndex,
    barlineX: hit.top.x + hit.top.width,
    staffTopY: hit.top.y,
  };
}
