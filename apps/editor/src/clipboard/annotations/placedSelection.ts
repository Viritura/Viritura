import { compareChordSymbolPositions, type Score } from "@viritura/core";
import type { PasteResult } from "../../commands/clipboardCommands";
import { dynamicId, hairpinId } from "../../score/ElementPath";
import type { CapturedChordSymbol } from "../ClipboardFragment";
import {
  addWholeFractions,
  compareWholeFractions,
  exactWholeFraction,
  sequenceBoundaryFraction,
  subtractWholeFractions,
} from "../clipboardTrackPlacement";

interface PlacementOrigin {
  partIndex: number;
  measureIndex: number;
  staffIndex: number;
  beat: number;
}

function chordPosition(before: Score, score: Score, captured: CapturedChordSymbol, origin: PlacementOrigin) {
  const sequences = before.parts[origin.partIndex]?.measures[origin.measureIndex]?.sequences ?? [];
  const start =
    sequences
      .filter((sequence) => (sequence.staff ?? 1) === origin.staffIndex + 1)
      .map((sequence) => sequenceBoundaryFraction(sequence.content, origin.beat))
      .find((fraction) => fraction !== undefined) ?? exactWholeFraction(origin.beat);
  const firstMeasure = origin.measureIndex + (captured.offset ? 0 : captured.measureOffset);
  let fraction = addWholeFractions(
    captured.offset || captured.measureOffset === 0 ? start : [0, 1],
    captured.offset ?? captured.chordSymbol.position.fraction,
  );
  let time = { count: 4, unit: 4 };
  for (const [measureIndex, measure] of score.global.measures.entries()) {
    time = measure.time ?? time;
    if (measureIndex < firstMeasure) continue;
    const capacity: [number, number] = [time.count, time.unit];
    if (compareWholeFractions(capacity, [0, 1]) <= 0) return undefined;
    if (compareWholeFractions(fraction, capacity) < 0) {
      return { measureIndex, position: { ...captured.chordSymbol.position, fraction } };
    }
    fraction = subtractWholeFractions(fraction, capacity);
  }
  return undefined;
}

/** Dynamics have fresh IDs; global harmony uses its final position and array index. */
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
    const position = chordPosition(before, after, captured, origin);
    if (!position) continue;
    const index = after.global.measures[position.measureIndex]?.chordSymbols?.findIndex(
      (symbol) => compareChordSymbolPositions(symbol.position, position.position) === 0,
    );
    if (index !== undefined && index >= 0) ids.add(`m${position.measureIndex}/chord${index}`);
  }
  return [...ids];
}
