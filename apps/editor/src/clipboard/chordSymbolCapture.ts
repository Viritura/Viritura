import type { ChordSymbol, Score } from "@viritura/core";
import type { AnnotationLocation } from "../score/ElementPath";
import type { SelectionTrackRhythmicRange } from "../store/selectionStore";
import type { CapturedChordSymbol } from "./ClipboardFragment";
import { partStaffOffset } from "./clipboardTrackMapping";
import {
  annotationInTrackRanges,
  beatsBetweenMeasures,
  exactCaptureDifference,
  type CaptureOrigin,
} from "./annotations";

export function chordSymbolStaffAtLocation(score: Score, location: AnnotationLocation): number | undefined {
  if (location.partIndex === undefined || location.type !== "chord" || location.annotationIndex === undefined) {
    return undefined;
  }
  const symbol =
    score.parts[location.partIndex]?.measures[location.measureIndex]?.chordSymbols?.[location.annotationIndex];
  return symbol ? (symbol.displayStaff ?? 1) : undefined;
}

function selectedChordSymbols(score: Score, locations: readonly AnnotationLocation[]) {
  const seen = new Set<string>();
  return locations.flatMap((location) => {
    if (location.partIndex === undefined || location.type !== "chord" || location.annotationIndex === undefined) {
      return [];
    }
    const key = `${location.partIndex}:${location.measureIndex}:${location.annotationIndex}`;
    const chordSymbol =
      score.parts[location.partIndex]?.measures[location.measureIndex]?.chordSymbols?.[location.annotationIndex];
    if (!chordSymbol || chordSymbol.position.fraction[1] <= 0 || seen.has(key)) return [];
    seen.add(key);
    return [{ partIndex: location.partIndex, measureIndex: location.measureIndex, chordSymbol }];
  });
}

export function selectedChordSymbolOrigin(
  score: Score,
  locations: readonly AnnotationLocation[],
  firstOrigin: CaptureOrigin,
): CaptureOrigin {
  return selectedChordSymbols(score, locations).reduce((origin, { measureIndex, chordSymbol }) => {
    const beat = (chordSymbol.position.fraction[0] / chordSymbol.position.fraction[1]) * 4;
    return measureIndex < origin.measureIndex || (measureIndex === origin.measureIndex && beat < origin.beat)
      ? { measureIndex, beat }
      : origin;
  }, firstOrigin);
}

function captureChordSymbol(
  score: Score,
  partIndex: number,
  measureIndex: number,
  chordSymbol: ChordSymbol,
  origin: CaptureOrigin,
  partOffset: number,
  anchorStaffOffset: number,
): CapturedChordSymbol {
  const beat = (chordSymbol.position.fraction[0] / chordSymbol.position.fraction[1]) * 4;
  const cloned = structuredClone(chordSymbol);
  if (measureIndex === origin.measureIndex) {
    cloned.position = { fraction: exactCaptureDifference(beat, origin.beat) };
  }
  return {
    ...(partOffset === 0 ? {} : { partOffset }),
    staffOffset:
      partStaffOffset(score, partIndex - partOffset, partIndex, chordSymbol.displayStaff ?? 1) - anchorStaffOffset,
    measureOffset: measureIndex - origin.measureIndex,
    offset: exactCaptureDifference(beatsBetweenMeasures(score, origin.measureIndex, measureIndex) + beat, origin.beat),
    chordSymbol: cloned,
  };
}

export function captureSelectedChordSymbols(
  score: Score,
  locations: readonly AnnotationLocation[],
  origin: CaptureOrigin,
  startPart: number,
  anchorStaffOffset: number,
): CapturedChordSymbol[] {
  return selectedChordSymbols(score, locations).map(({ partIndex, measureIndex, chordSymbol }) =>
    captureChordSymbol(score, partIndex, measureIndex, chordSymbol, origin, partIndex - startPart, anchorStaffOffset),
  );
}

interface ChordSymbolSelection {
  locations?: readonly AnnotationLocation[];
  tracks?: readonly SelectionTrackRhythmicRange[];
}

export function captureChordSymbols(
  score: Score,
  partIndex: number,
  startMeasure: number,
  endMeasure: number,
  firstMeasureStartBeat: number,
  lastMeasureEndBeat: number,
  partOffset = 0,
  anchorStaffOffset = 0,
  sourceStaves?: ReadonlySet<number>,
  selection?: ChordSymbolSelection,
): CapturedChordSymbol[] {
  const result: CapturedChordSymbol[] = [];
  const origin = { measureIndex: startMeasure, beat: firstMeasureStartBeat };
  for (let measureIndex = startMeasure; measureIndex <= endMeasure; measureIndex++) {
    const symbols = score.parts[partIndex]?.measures[measureIndex]?.chordSymbols ?? [];
    for (const [annotationIndex, chordSymbol] of symbols.entries()) {
      const selected = selection?.locations?.some(
        (location) =>
          location.type === "chord" &&
          location.partIndex === partIndex &&
          location.measureIndex === measureIndex &&
          location.annotationIndex === annotationIndex,
      );
      const staff = chordSymbol.displayStaff ?? 1;
      if (!selected && sourceStaves && !sourceStaves.has(staff)) continue;
      const [numerator, denominator] = chordSymbol.position.fraction;
      if (denominator === 0) continue;
      const beat = (numerator / denominator) * 4;
      if (!selected && measureIndex === startMeasure && beat < firstMeasureStartBeat - 1e-9) continue;
      if (!selected && measureIndex === endMeasure && beat >= lastMeasureEndBeat - 1e-9) continue;
      if (!annotationInTrackRanges(selection?.tracks, partIndex, staff, measureIndex, beat)) continue;
      result.push(
        captureChordSymbol(score, partIndex, measureIndex, chordSymbol, origin, partOffset, anchorStaffOffset),
      );
    }
  }
  return result;
}
