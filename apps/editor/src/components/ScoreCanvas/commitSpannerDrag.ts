import { produce } from "immer";
import type { Score } from "@viritura/core";
import type { SpannerHandleHit } from "@viritura/renderer";
import { resolveAnnotationLocation } from "../../score/ElementPath";
import { reanchorTrillExtension } from "../../score/trillExtensionMutations";

export interface SpannerDragSnap {
  x: number;
  y?: number;
  beat?: number;
  eventId?: string;
  targetEdge?: "start" | "end";
  measureIndex: number;
}

type SpannerLike = {
  position: { fraction: [number, number] };
  end: { measure: string; position: { fraction: [number, number] } };
};

export interface TrillLineDragTarget {
  eventId: string;
  targetEdge: "start" | "end";
  elementId: string;
}

export function resolveTrillLineDragTarget(
  hit: SpannerHandleHit,
  dragX: number,
  snapPoints: SpannerDragSnap[],
  dragY?: number,
): TrillLineDragTarget | null {
  if (!hit.elementId.startsWith("trill-line/") || hit.handle !== "end") return null;
  const sourceId = hit.elementId.split("/")[1];
  const eventSnaps = snapPoints.filter(
    (point): point is SpannerDragSnap & { eventId: string } => point.eventId !== undefined,
  );
  if (!sourceId || eventSnaps.length === 0) return null;

  let target = eventSnaps[0]!;
  let bestDistance = Math.hypot(dragX - target.x, (dragY ?? hit.handleY) - (target.y ?? hit.handleY));
  for (const candidate of eventSnaps.slice(1)) {
    const distance = Math.hypot(dragX - candidate.x, (dragY ?? hit.handleY) - (candidate.y ?? hit.handleY));
    if (distance < bestDistance) {
      target = candidate;
      bestDistance = distance;
    }
  }
  return {
    eventId: target.eventId,
    targetEdge: target.targetEdge ?? "start",
    elementId: `trill-line/${sourceId}/${target.eventId.replaceAll("/", "_")}`,
  };
}

/**
 * Commit a spanner drag: snap to nearest ruler position and return the
 * updated score (or the original score if no change).
 */
export function commitSpannerDragImpl(
  score: Score,
  hit: SpannerHandleHit,
  dragX: number,
  snapPoints: SpannerDragSnap[],
  dragY?: number,
): Score {
  if (snapPoints.length === 0) return score;

  if (hit.elementId.startsWith("trill-line/")) {
    const target = resolveTrillLineDragTarget(hit, dragX, snapPoints, dragY);
    return target ? reanchorTrillExtension(score, hit.elementId, target.eventId, target.targetEdge) : score;
  }

  // Find the snap point nearest to dragX
  let bestSnap = snapPoints[0]!;
  let bestDist = Math.abs(dragX - bestSnap.x);
  for (const sp of snapPoints) {
    const dist = Math.abs(dragX - sp.x);
    if (dist < bestDist) {
      bestDist = dist;
      bestSnap = sp;
    }
  }

  const loc = resolveAnnotationLocation(hit.elementId);
  if (!loc || loc.partIndex === undefined) return score;

  const locPartIndex = loc.partIndex;
  const locMeasureIndex = loc.measureIndex;
  const locAnnotationIndex = loc.annotationIndex;
  const locAnnotationId = loc.annotationId;
  const locType = loc.type;

  // Resolve beatsInMeasure for the target measure
  let activeTime = { count: 4, unit: 4 };
  for (let m = 0; m <= bestSnap.measureIndex; m++) {
    const gm = score.global.measures[m];
    if (gm?.time) activeTime = gm.time;
  }
  const beatsInMeasure = activeTime.count * (4 / activeTime.unit);
  if (bestSnap.beat === undefined) return score;
  const snappedBeat = bestSnap.beat;

  // Build the fraction for this snap point
  const denom = Math.round(beatsInMeasure * 4); // sixteenth-note precision
  const numer = Math.round(snappedBeat * 4);
  const fraction: [number, number] = [Math.max(0, Math.min(numer, denom)), Math.max(1, denom)];

  return produce(score, (draft) => {
    const partMeasure = draft.parts[locPartIndex]?.measures[locMeasureIndex];
    if (!partMeasure) return;

    let spanners: SpannerLike[] | undefined;
    let spannerIndex = locAnnotationIndex;
    if (locType === "hairpin") {
      const dynamics = partMeasure.dynamics;
      spanners = dynamics as SpannerLike[] | undefined;
      // Hairpin element ids carry the dynamic *group id*
      // (`p{p}/m{m}/hairpin{groupId}`), so resolve by id first; the ordinal
      // path only covers legacy index-shaped ids.
      if (dynamics && locAnnotationId) {
        const byId = dynamics.findIndex((group) => group.id === locAnnotationId);
        spannerIndex = byId >= 0 ? byId : undefined;
      } else if (dynamics && locAnnotationIndex !== undefined) {
        spannerIndex = dynamics
          .map((group, index) => ({ group, index }))
          .filter(({ group }) => group.type === "gradual")[locAnnotationIndex]?.index;
      }
    } else if (locType === "pedal") spanners = partMeasure.pedals as SpannerLike[] | undefined;
    else if (locType === "ottava") spanners = partMeasure.ottavas as SpannerLike[] | undefined;
    if (!spanners || spannerIndex === undefined) return;

    const spanner = spanners[spannerIndex];
    if (!spanner) return;

    // Ensure target measure has an ID
    const targetMeasure = draft.global.measures[bestSnap.measureIndex];
    if (targetMeasure && !targetMeasure.id) {
      targetMeasure.id = `m${bestSnap.measureIndex}`;
    }

    if (hit.handle === "start") {
      updateStartHandle(
        draft,
        partMeasure,
        spanners,
        spanner,
        fraction,
        locType,
        locPartIndex,
        locMeasureIndex,
        spannerIndex,
        bestSnap.measureIndex,
      );
    } else {
      updateEndHandle(draft, spanner, bestSnap.measureIndex, snappedBeat, beatsInMeasure, fraction);
    }
  });
}

function updateStartHandle(
  draft: Score,
  partMeasure: Score["parts"][number]["measures"][number],
  spanners: SpannerLike[],
  spanner: SpannerLike,
  fraction: [number, number],
  locType: string,
  locPartIndex: number,
  locMeasureIndex: number,
  locAnnotationIndex: number,
  newMeasureIndex: number,
): void {
  if (newMeasureIndex === locMeasureIndex) {
    // Same measure — just update the fraction
    spanner.position.fraction = fraction;
    return;
  }
  // Cross-bar: move spanner from old measure to new measure
  spanners.splice(locAnnotationIndex, 1);
  if (spanners.length === 0) {
    if (locType === "hairpin") delete (partMeasure as unknown as Record<string, unknown>).dynamics;
    else if (locType === "pedal") delete (partMeasure as unknown as Record<string, unknown>).pedals;
    else if (locType === "ottava") delete (partMeasure as unknown as Record<string, unknown>).ottavas;
  }
  // Add to new measure with updated start position
  const newPartMeasure = draft.parts[locPartIndex]?.measures[newMeasureIndex];
  if (!newPartMeasure) return;
  const movedSpanner = { ...spanner, position: { fraction } };
  if (locType === "hairpin") {
    newPartMeasure.dynamics = [
      ...(newPartMeasure.dynamics ?? []),
      movedSpanner as typeof newPartMeasure.dynamics extends Array<infer T> | undefined ? T : never,
    ];
  } else if (locType === "pedal") {
    newPartMeasure.pedals = [...(newPartMeasure.pedals ?? []), movedSpanner] as typeof newPartMeasure.pedals;
  } else if (locType === "ottava") {
    newPartMeasure.ottavas = [...(newPartMeasure.ottavas ?? []), movedSpanner] as typeof newPartMeasure.ottavas;
  }
}

function updateEndHandle(
  draft: Score,
  spanner: SpannerLike,
  measureIndex: number,
  beat: number,
  beatsInMeasure: number,
  fraction: [number, number],
): void {
  let endMeasureIdx = measureIndex;
  let endFraction = fraction;

  // If snapped to end-of-measure (beat == beatsInMeasure), reference
  // beat 0 of the next measure to avoid an off-by-one past the barline.
  if (Math.abs(beat - beatsInMeasure) < 0.001 && endMeasureIdx + 1 < draft.global.measures.length) {
    endMeasureIdx = measureIndex + 1;
    endFraction = [0, 1];
    const nextMeasure = draft.global.measures[endMeasureIdx];
    if (nextMeasure && !nextMeasure.id) {
      nextMeasure.id = `m${endMeasureIdx}`;
    }
  }

  const endMeasureId = draft.global.measures[endMeasureIdx]?.id ?? `m${endMeasureIdx}`;
  spanner.end = {
    measure: endMeasureId,
    position: { fraction: endFraction },
  };
}
