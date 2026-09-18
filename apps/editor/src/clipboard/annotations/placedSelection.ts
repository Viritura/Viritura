import { measureBeats, type Score } from "@viritura/core";
import type { PasteResult } from "../../commands/clipboardCommands";
import { chordSymbolId, dynamicId, hairpinId } from "../../score/ElementPath";
import type { CapturedChordSymbol } from "../ClipboardFragment";
import { capturedAnnotationDestination } from "./staffDestination";

interface PlacementOrigin {
  partIndex: number;
  measureIndex: number;
  staffIndex: number;
  beat: number;
}

function chordPosition(score: Score, captured: CapturedChordSymbol, origin: PlacementOrigin) {
  if (!captured.offset) {
    return {
      measureIndex: origin.measureIndex + captured.measureOffset,
      beat:
        (captured.measureOffset === 0 ? origin.beat : 0) +
        (captured.chordSymbol.position.fraction[0] / captured.chordSymbol.position.fraction[1]) * 4,
    };
  }
  let beat = origin.beat + (captured.offset[0] / captured.offset[1]) * 4;
  let time = { count: 4, unit: 4 };
  for (const [measureIndex, measure] of score.global.measures.entries()) {
    time = measure.time ?? time;
    if (measureIndex < origin.measureIndex) continue;
    const capacity = measureBeats(time);
    if (capacity <= 0) return undefined;
    if (beat < capacity - 1e-9) return { measureIndex, beat };
    beat = Math.max(0, beat - capacity);
  }
  return undefined;
}

/** Dynamics have fresh IDs; harmony is identified by its final staff/position and array index. */
export function findPlacedAnnotationIds(
  before: Score,
  after: Score,
  paste: PasteResult,
  origin: PlacementOrigin,
): string[] {
  if (before === after) return [];
  const ids = new Set<string>();
  for (const [partIndex, part] of after.parts.entries()) {
    for (let measureIndex = origin.measureIndex; measureIndex < part.measures.length; measureIndex++) {
      const previous = new Set(before.parts[partIndex]?.measures[measureIndex]?.dynamics?.map((dynamic) => dynamic.id));
      for (const dynamic of part.measures[measureIndex]!.dynamics ?? []) {
        if (previous.has(dynamic.id)) continue;
        const elementId = dynamic.type === "gradual" ? hairpinId : dynamicId;
        ids.add(elementId(partIndex, measureIndex, dynamic.id));
      }
    }
  }
  for (const captured of paste.chordSymbols ?? []) {
    const destination = capturedAnnotationDestination(
      after,
      origin.partIndex,
      origin.staffIndex,
      paste.tracks,
      captured.partOffset ?? 0,
      captured.chordSymbol.displayStaff ?? 1,
      captured.staffOffset,
    );
    const position = chordPosition(after, captured, origin);
    if (!position) continue;
    const staff = destination.staff ?? captured.chordSymbol.displayStaff ?? 1;
    const index = after.parts[destination.partIndex]?.measures[position.measureIndex]?.chordSymbols?.findIndex(
      (symbol) => {
        const beat = (symbol.position.fraction[0] / symbol.position.fraction[1]) * 4;
        // Placement adds exact fractions; the selection's numeric origin can
        // differ by summation roundoff without identifying a different harmony.
        const roundoff = Number.EPSILON * Math.max(1, Math.abs(beat), Math.abs(position.beat)) * 8;
        return (symbol.displayStaff ?? 1) === staff && Math.abs(beat - position.beat) <= roundoff;
      },
    );
    if (index !== undefined && index >= 0) ids.add(chordSymbolId(destination.partIndex, position.measureIndex, index));
  }
  return [...ids];
}
