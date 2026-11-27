import { compareChordSymbolPositions, isHarpInstrumentAt, type RhythmicPosition, type Score } from "@viritura/core";
import {
  resolveAnnotationLocation,
  resolveEventFromSubElement,
  resolveFullMeasureRestLocation,
  resolveGraceLocation,
  resolveHarpPedalLocation,
  type EventLocation,
} from "../score/ElementPath";
import type { SelectionState } from "../store/selectionStore";
import { resolveSelectionEvents } from "../store/selectionUtils";
import { beatPositionToFraction, sequenceContentBoundary } from "../app/timedAnnotationPosition";

export interface HarpPedalTarget {
  partIndex: number;
  measureIndex: number;
  position: Pick<RhythmicPosition, "fraction">;
}

function eventTarget(score: Score, location: EventLocation): HarpPedalTarget | null {
  const sequence = score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
  if (!sequence) return null;
  const path =
    location.contentPath ??
    (location.tupletIndex === undefined ? [location.eventIndex] : [location.tupletIndex, location.eventIndex]);
  return {
    partIndex: location.partIndex,
    measureIndex: location.measureIndex,
    position: { fraction: beatPositionToFraction(sequenceContentBoundary(sequence.content, path)) },
  };
}

function annotationTarget(score: Score, id: string): HarpPedalTarget | null {
  const location = resolveAnnotationLocation(id);
  if (!location || location.kind !== "part" || location.partIndex === undefined) return null;
  const measure = score.parts[location.partIndex]?.measures[location.measureIndex];
  if (!measure) return null;
  const index = location.annotationIndex ?? -1;
  const position =
    location.type === "dyn" || location.type === "hairpin"
      ? measure.dynamics?.find((item, i) =>
          location.annotationId === undefined ? i === index : item.id === location.annotationId,
        )?.position
      : location.type === "expr"
        ? measure.expressions?.[index]?.position
        : location.type === "pedal"
          ? measure.pedals?.[index]?.position
          : location.type === "ottava"
            ? measure.ottavas?.[index]?.position
            : undefined;
  return position
    ? { partIndex: location.partIndex, measureIndex: location.measureIndex, position: { fraction: position.fraction } }
    : null;
}

function elementTarget(score: Score, id: string): HarpPedalTarget | null {
  const pedal = resolveHarpPedalLocation(id, score);
  if (pedal) {
    const setting = score.parts[pedal.partIndex]!.measures[pedal.measureIndex]!.harpPedals![pedal.settingIndex]!;
    return { partIndex: pedal.partIndex, measureIndex: pedal.measureIndex, position: setting.position };
  }
  const grace = resolveGraceLocation(id, score);
  if (grace) {
    return eventTarget(score, {
      partIndex: grace.partIndex,
      measureIndex: grace.measureIndex,
      sequenceIndex: grace.sequenceIndex,
      eventIndex: grace.graceContainerIndex,
      ...(grace.tupletIndex !== undefined && { tupletIndex: grace.tupletIndex }),
    });
  }
  const event = resolveEventFromSubElement(id, score);
  if (event) return eventTarget(score, event);
  const rest = resolveFullMeasureRestLocation(id, score);
  if (rest) return { partIndex: rest.partIndex, measureIndex: rest.measureIndex, position: { fraction: [0, 1] } };
  return annotationTarget(score, id);
}

function earliestTarget(targets: readonly HarpPedalTarget[]): HarpPedalTarget | null {
  const first = targets[0];
  if (!first || targets.some((target) => target.partIndex !== first.partIndex)) return null;
  return targets.reduce((earliest, target) =>
    target.measureIndex < earliest.measureIndex ||
    (target.measureIndex === earliest.measureIndex &&
      compareChordSymbolPositions(target.position, earliest.position) < 0)
      ? target
      : earliest,
  );
}

/** Resolve a selection to one part-wide position without guessing an unresolved source part. */
export function resolveHarpPedalTarget(score: Score | null, selection: SelectionState): HarpPedalTarget | null {
  if (!score || selection.kind === "none") return null;
  let target: HarpPedalTarget | null = null;
  if (selection.kind === "measure") {
    if (selection.startPartIndex !== selection.endPartIndex) return null;
    target = {
      partIndex: selection.startPartIndex,
      measureIndex: Math.min(selection.startMeasure, selection.endMeasure),
      position: { fraction: [0, 1] },
    };
  } else if (selection.kind === "single") {
    target = elementTarget(score, selection.elementId);
  } else if (selection.kind === "multi") {
    const targets = selection.elementIds.map((id) => elementTarget(score, id));
    if (targets.some((item) => item === null)) return null;
    target = earliestTarget(targets.filter((item): item is HarpPedalTarget => item !== null));
  } else {
    const start = elementTarget(score, selection.startElementId);
    const end = elementTarget(score, selection.endElementId);
    if (!start || !end || start.partIndex !== end.partIndex) return null;
    const events = resolveSelectionEvents(selection, score).map((location) => eventTarget(score, location));
    target = earliestTarget([start, end, ...events.filter((item): item is HarpPedalTarget => item !== null)]);
  }
  const part = target && score.parts[target.partIndex];
  if (!target || !part?.measures[target.measureIndex] || !score.global.measures[target.measureIndex]) return null;
  return isHarpInstrumentAt(part, target.measureIndex, target.position.fraction) ? target : null;
}
