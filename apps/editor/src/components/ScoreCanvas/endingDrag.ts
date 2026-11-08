import type { Score } from "@viritura/core";
import type { MeasureBounds, SpannerHandleHit } from "@viritura/renderer";
import type { SpannerDragSnap } from "./commitSpannerDrag";

export type EndingDragPlan =
  | { kind: "noop" }
  | { kind: "error"; error: string }
  | { kind: "move"; sourceMeasure: number; startMeasure: number; endMeasure: number; elementId: string };

export function buildEndingDragSnaps(
  bounds: readonly MeasureBounds[] | undefined,
  handle: SpannerHandleHit["handle"],
): SpannerDragSnap[] {
  const topStaffBounds = new Map<number, MeasureBounds>();
  for (const bound of bounds ?? []) {
    if (bound.ghostStaff || bound.isExpansion || bound.isHidden) continue;
    const previous = topStaffBounds.get(bound.index);
    if (!previous || bound.y < previous.y) topStaffBounds.set(bound.index, bound);
  }
  return [...topStaffBounds.values()].map((bound) => ({
    x: handle === "start" ? bound.x : bound.x + bound.width,
    y: bound.y,
    measureIndex: bound.index,
    targetEdge: handle,
  }));
}

export function planEndingDrag(
  score: Score,
  hit: SpannerHandleHit,
  dragX: number,
  snapPoints: readonly SpannerDragSnap[],
  dragY?: number,
): EndingDragPlan {
  const match = hit.elementId.match(/^m(\d+)\/volta$/);
  if (!match) return { kind: "noop" };
  const sourceMeasure = Number(match[1]);
  const ending = score.global.measures[sourceMeasure]?.ending;
  if (!ending) return { kind: "noop" };
  const candidates = snapPoints.filter(
    (point) =>
      point.targetEdge === hit.handle &&
      Number.isInteger(point.measureIndex) &&
      point.measureIndex >= 0 &&
      point.measureIndex < score.global.measures.length,
  );
  const distance = (point: SpannerDragSnap) =>
    Math.hypot(dragX - point.x, dragY === undefined || point.y === undefined ? 0 : dragY - point.y);
  const target = candidates.reduce<SpannerDragSnap | undefined>(
    (best, point) => (!best || distance(point) < distance(best) ? point : best),
    undefined,
  );
  if (!target) return { kind: "noop" };

  const originalEnd = Math.min(sourceMeasure + ending.duration - 1, score.global.measures.length - 1);
  const startMeasure = hit.handle === "start" ? Math.min(target.measureIndex, originalEnd) : sourceMeasure;
  const endMeasure = hit.handle === "end" ? Math.max(target.measureIndex, sourceMeasure) : originalEnd;
  if (startMeasure === sourceMeasure && endMeasure === sourceMeasure + ending.duration - 1) return { kind: "noop" };
  const overlaps = score.global.measures.some(
    (measure, index) =>
      index !== sourceMeasure &&
      measure.ending !== undefined &&
      index <= endMeasure &&
      index + measure.ending.duration > startMeasure,
  );
  if (overlaps) return { kind: "error", error: "Ending brackets cannot overlap. Move the other ending first." };
  return { kind: "move", sourceMeasure, startMeasure, endMeasure, elementId: `m${startMeasure}/volta` };
}
