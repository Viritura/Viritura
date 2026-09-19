import type { MeasureBounds, SpatialIndex } from "@viritura/renderer";
import type { Score } from "@viritura/core";
import { trillExtensionPartIndex, trillExtensionSourceId } from "../../score/trillExtensionMutations";
import { resolveAnnotationLocation } from "../../score/ElementPath";
import { buildSlurAnchorPoints } from "./slurAnchorSnap";
import type { SpannerDragState } from "./paintScoreFrame";

interface PrepareSpannerDragArgs {
  score: Score | null;
  spatialIndex: SpatialIndex;
  measureBounds?: readonly MeasureBounds[];
  elementId: string;
  altKey: boolean;
  buildRhythmicSnaps: (partIndex: number, fine: boolean) => SpannerDragState["snapPoints"];
}

export interface SpannerDragSetup {
  eventAnchored: boolean;
  partIndex: number;
  snapPoints: SpannerDragState["snapPoints"];
}

function forwardTrillAnchors(
  score: Score | null,
  spatialIndex: SpatialIndex,
  measureBounds: readonly MeasureBounds[] | undefined,
  partIndex: number,
  elementId: string,
): SpannerDragState["snapPoints"] {
  const points = buildSlurAnchorPoints(score, spatialIndex, partIndex, measureBounds);
  const sourceId = trillExtensionSourceId(elementId);
  const source = points.find((point) => point.eventId.replaceAll("/", "_") === sourceId);
  if (!source) return [];
  const candidates: SpannerDragState["snapPoints"] = [];
  for (const point of points) {
    if (point.sequenceIndex !== source.sequenceIndex || Math.abs(point.y - source.y) >= 60) continue;
    const isSource = point.eventId === source.eventId;
    const isLater =
      point.measureIndex > source.measureIndex || (point.measureIndex === source.measureIndex && point.x > source.x);
    if (!isSource && !isLater) continue;
    if (!isSource) candidates.push({ ...point, targetEdge: "start" });
    candidates.push({ ...point, x: point.endX ?? point.x, targetEdge: "end" });
  }
  return candidates;
}

export function prepareSpannerDrag({
  score,
  spatialIndex,
  measureBounds,
  elementId,
  altKey,
  buildRhythmicSnaps,
}: PrepareSpannerDragArgs): SpannerDragSetup {
  const eventAnchored = elementId.startsWith("trill-line/");
  const partIndex = eventAnchored
    ? (trillExtensionPartIndex(score, elementId) ?? 0)
    : (resolveAnnotationLocation(elementId)?.partIndex ?? 0);
  return {
    eventAnchored,
    partIndex,
    snapPoints: eventAnchored
      ? forwardTrillAnchors(score, spatialIndex, measureBounds, partIndex, elementId)
      : buildRhythmicSnaps(partIndex, altKey),
  };
}

export function updateSpannerDrag(
  drag: SpannerDragState,
  event: PointerEvent,
  rect: DOMRect,
  viewport: { zoom: number; scrollX: number; scrollY: number },
  setup: SpannerDragSetup,
  buildRhythmicSnaps: PrepareSpannerDragArgs["buildRhythmicSnaps"],
): void {
  drag.dragX = (event.clientX - rect.left) / viewport.zoom + viewport.scrollX;
  drag.dragY = (event.clientY - rect.top) / viewport.zoom + viewport.scrollY;
  if (setup.eventAnchored || event.altKey === drag.altKey) return;
  drag.altKey = event.altKey;
  drag.snapPoints = buildRhythmicSnaps(setup.partIndex, event.altKey);
}
