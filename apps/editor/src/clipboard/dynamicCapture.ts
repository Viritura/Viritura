import { measureBeats, type Score, type TimeSignature } from "@viritura/core";
import type { CapturedDynamic, ClipboardTrack } from "./ClipboardFragment";
import type { AnnotationLocation } from "../score/ElementPath";
import { partStaffOffset } from "./clipboardTrackMapping";
import { beatsBetweenMeasures, type CaptureOrigin } from "./annotations";

interface SourceDynamic extends CapturedDynamic {
  partIndex: number;
  sourceMeasureIndex: number;
}

/** A part-level group belongs to one display staff, not every voice on that staff. */
export function assignDynamicsToTracks(
  score: Score,
  startPart: number,
  tracks: ClipboardTrack[],
  dynamics: readonly SourceDynamic[],
  anchorStaffOffset = 0,
): void {
  const seen = new Set<string>();
  for (const captured of dynamics) {
    const { partIndex, sourceMeasureIndex, ...dynamic } = captured;
    const staff = captured.dynamic.staff ?? 1;
    const staffOffset = partStaffOffset(score, startPart, partIndex, staff) - anchorStaffOffset;
    const candidates = tracks.filter((track) => track.partOffset === partIndex - startPart);
    let track = candidates.find((candidate) => candidate.staffOffset === staffOffset);
    if (!track) {
      track = { partOffset: partIndex - startPart, staffOffset, sourceStaff: staff, voiceIndex: 0, content: [] };
      tracks.push(track);
    }
    const key = `${partIndex}:${staff}:${sourceMeasureIndex}:${captured.dynamic.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (track.dynamics ??= []).push({ ...dynamic, partOffset: partIndex - startPart, staffOffset });
  }
}

function dynamicIndexAtLocation(score: Score, location: AnnotationLocation): number {
  if (location.partIndex === undefined) return -1;
  const dynamics = score.parts[location.partIndex]?.measures[location.measureIndex]?.dynamics ?? [];
  if (location.annotationId) return dynamics.findIndex((dynamic) => dynamic.id === location.annotationId);
  if (location.annotationIndex === undefined) return -1;
  if (location.type !== "hairpin") return location.annotationIndex;
  return (
    dynamics.map((dynamic, index) => ({ dynamic, index })).filter(({ dynamic }) => dynamic.type === "gradual")[
      location.annotationIndex
    ]?.index ?? -1
  );
}

export function dynamicStaffAtLocation(score: Score, location: AnnotationLocation): number | undefined {
  if (location.partIndex === undefined || (location.type !== "dyn" && location.type !== "hairpin")) return undefined;
  const dynamic =
    score.parts[location.partIndex]?.measures[location.measureIndex]?.dynamics?.[
      dynamicIndexAtLocation(score, location)
    ];
  return dynamic ? (dynamic.staff ?? 1) : undefined;
}

export function selectedDynamicOrigin(
  score: Score,
  locations: readonly AnnotationLocation[],
  firstNote: CaptureOrigin,
): CaptureOrigin {
  return locations.reduce((origin, location) => {
    if (location.partIndex === undefined || (location.type !== "dyn" && location.type !== "hairpin")) return origin;
    const dynamic =
      score.parts[location.partIndex]?.measures[location.measureIndex]?.dynamics?.[
        dynamicIndexAtLocation(score, location)
      ];
    if (!dynamic || dynamic.position.fraction[1] <= 0) return origin;
    const beat = (dynamic.position.fraction[0] / dynamic.position.fraction[1]) * 4;
    return location.measureIndex < origin.measureIndex ||
      (location.measureIndex === origin.measureIndex && beat < origin.beat)
      ? { measureIndex: location.measureIndex, beat }
      : origin;
  }, firstNote);
}

export function captureSelectedDynamics(
  score: Score,
  locations: readonly AnnotationLocation[],
  origin: CaptureOrigin,
): SourceDynamic[] {
  const seen = new Set<string>();
  return locations.flatMap((location) => {
    if (location.partIndex === undefined || (location.type !== "dyn" && location.type !== "hairpin")) return [];
    const dynamic =
      score.parts[location.partIndex]?.measures[location.measureIndex]?.dynamics?.[
        dynamicIndexAtLocation(score, location)
      ];
    if (!dynamic) return [];
    const key = `${location.partIndex}:${dynamic.staff ?? 1}:${location.measureIndex}:${dynamic.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const cloned = structuredClone(dynamic);
    const [numerator, denominator] = cloned.position.fraction;
    if (denominator === 0) return [];
    const beats = (numerator / denominator) * 4;
    if (location.measureIndex === origin.measureIndex) {
      cloned.position = { fraction: [Math.round((beats - origin.beat) * 256), 1024] };
    }
    let endMeasureOffset: number | undefined;
    let endOffset: [number, number] | undefined;
    if (cloned.type === "gradual") {
      const endMeasure = score.global.measures.findIndex((measure) => measure.id === cloned.end.measure);
      if (endMeasure === -1) return [];
      endMeasureOffset = endMeasure - origin.measureIndex;
      const [endNumerator, endDenominator] = cloned.end.position.fraction;
      const endBeat = (endNumerator / endDenominator) * 4;
      endOffset = [
        Math.round((beatsBetweenMeasures(score, origin.measureIndex, endMeasure) + endBeat - origin.beat) * 256),
        1024,
      ];
      if (endMeasure === origin.measureIndex) {
        cloned.end.position = {
          fraction: [Math.round((endBeat - origin.beat) * 256), 1024],
        };
      }
    }
    const offsetBeats = beatsBetweenMeasures(score, origin.measureIndex, location.measureIndex) + beats - origin.beat;
    return [
      {
        partIndex: location.partIndex,
        sourceMeasureIndex: location.measureIndex,
        measureOffset: location.measureIndex - origin.measureIndex,
        endMeasureOffset,
        offset: [Math.round(offsetBeats * 256), 1024] as [number, number],
        ...(endOffset ? { endOffset } : {}),
        dynamic: cloned,
      },
    ];
  });
}

export function collectDynamics(
  score: Score,
  partIndex: number,
  startMeasure: number,
  endMeasure: number,
  firstMeasureStartBeat: number,
  lastMeasureEndBeat: number,
  sourceStaves?: ReadonlySet<number>,
): CapturedDynamic[] {
  const result: CapturedDynamic[] = [];
  const part = score.parts[partIndex];
  if (!part) return result;
  const measureIndexById = new Map(
    score.global.measures.flatMap((measure, index) => (measure.id ? [[measure.id, index] as const] : [])),
  );
  let beatsBeforeMeasure = 0;
  for (
    let measureIndex = startMeasure;
    measureIndex <= Math.min(endMeasure, part.measures.length - 1);
    measureIndex++
  ) {
    const dynamics = part.measures[measureIndex]?.dynamics ?? [];
    const isFirst = measureIndex === startMeasure;
    const isLast = measureIndex === endMeasure;
    for (const dynamic of dynamics.filter((item) => !sourceStaves || sourceStaves.has(item.staff ?? 1))) {
      const fraction = dynamic.position?.fraction;
      if (!fraction || fraction[1] === 0) continue;
      const beats = (fraction[0] / fraction[1]) * 4;
      if (isFirst && beats < firstMeasureStartBeat - 1e-9) continue;
      if (isLast && beats >= lastMeasureEndBeat - 1e-9) continue;
      const cloned = structuredClone(dynamic);
      if (isFirst && firstMeasureStartBeat > 0) {
        cloned.position = { fraction: [Math.round((beats - firstMeasureStartBeat) * 4), 16] };
      }
      let endMeasureOffset: number | undefined;
      let endOffset: [number, number] | undefined;
      if (cloned.type === "gradual") {
        const endMeasureIndex = measureIndexById.get(cloned.end.measure);
        if (endMeasureIndex === undefined) continue;
        endMeasureOffset = endMeasureIndex - startMeasure;
        const endBeats = (cloned.end.position.fraction[0] / cloned.end.position.fraction[1]) * 4;
        endOffset = [
          Math.round(
            (beatsBetweenMeasures(score, startMeasure, endMeasureIndex) + endBeats - firstMeasureStartBeat) * 256,
          ),
          1024,
        ];
        if (endMeasureIndex === startMeasure && firstMeasureStartBeat > 0) {
          cloned.end.position = { fraction: [Math.round((endBeats - firstMeasureStartBeat) * 4), 16] };
        }
      }
      result.push({
        measureOffset: measureIndex - startMeasure,
        endMeasureOffset,
        offset: [Math.round((beatsBeforeMeasure + beats - firstMeasureStartBeat) * 256), 1024],
        ...(endOffset ? { endOffset } : {}),
        dynamic: cloned,
      });
    }
    let activeTime: TimeSignature = { count: 4, unit: 4 };
    for (let index = 0; index <= measureIndex; index++) {
      if (score.global.measures[index]?.time) activeTime = score.global.measures[index]!.time!;
    }
    beatsBeforeMeasure += measureBeats(activeTime);
  }
  return result;
}
