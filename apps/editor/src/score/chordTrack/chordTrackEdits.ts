import { compareChordSymbolPositions, parseChordSymbolText, upsertGlobalChordSymbol, type Score } from "@viritura/core";
import { beatPositionToFraction } from "../../app/timedAnnotationPosition";
import { produce } from "../scoreClone";
import type { TimedChord, TrackPoint } from "../../components/ChordTrack";

export function scoreTrackChords(score: Score): TimedChord[] {
  return score.global.measures.flatMap((measure, measureIndex) =>
    (measure.chordSymbols ?? []).map((symbol, chordIndex) => ({
      measureIndex,
      symbol,
      elementId: `m${measureIndex}/chord${chordIndex}`,
    })),
  );
}

function positionAt(point: TrackPoint) {
  if (!Number.isFinite(point.beat) || point.beat < 0) throw new RangeError("Invalid chord-track position");
  return point.position ?? { fraction: beatPositionToFraction(point.beat) };
}

export function editChordTrackText(score: Score, point: TrackPoint, text: string): Score {
  const measure = score.global.measures[point.measureIndex];
  if (!measure || !text.trim()) throw new RangeError("Cannot enter a chord at this position");
  const position = positionAt(point);
  const existing = measure.chordSymbols?.find((chord) => compareChordSymbolPositions(chord.position, position) === 0);
  const chord = {
    ...parseChordSymbolText(text, existing?.position ?? position),
    ...(existing?.textOverride !== undefined && { textOverride: existing.textOverride }),
  };
  if (existing && JSON.stringify(existing) === JSON.stringify(chord)) return score;
  const updated = upsertGlobalChordSymbol(measure, chord);
  return produce(score, (draft) => {
    draft.global.measures[point.measureIndex] = updated;
  });
}

export function removeChordTrackChord(score: Score, point: TrackPoint): Score {
  const measure = score.global.measures[point.measureIndex];
  if (!measure) throw new RangeError("Cannot remove a chord at this position");
  const position = positionAt(point);
  const remaining = measure.chordSymbols?.filter(
    (chord) => compareChordSymbolPositions(chord.position, position) !== 0,
  );
  if (!remaining || remaining.length === measure.chordSymbols?.length) return score;
  return produce(score, (draft) => {
    draft.global.measures[point.measureIndex]!.chordSymbols = remaining.length ? remaining : undefined;
  });
}

export function moveTrackChordChanges(
  chords: readonly TimedChord[],
  source: TimedChord,
  target: TrackPoint,
): readonly TimedChord[] {
  const current = chords.find(
    (chord) =>
      chord.measureIndex === source.measureIndex &&
      compareChordSymbolPositions(chord.symbol.position, source.symbol.position) === 0,
  );
  if (!current || JSON.stringify(current.symbol) !== JSON.stringify(source.symbol)) {
    throw new Error("The chord changed while dragging. Try again.");
  }
  const position = positionAt(target);
  if (
    source.measureIndex === target.measureIndex &&
    compareChordSymbolPositions(source.symbol.position, position) === 0
  )
    return chords;
  const moved = chords.filter(
    (chord) =>
      !(
        chord.measureIndex === source.measureIndex &&
        compareChordSymbolPositions(chord.symbol.position, source.symbol.position) === 0
      ) &&
      !(
        chord.measureIndex === target.measureIndex && compareChordSymbolPositions(chord.symbol.position, position) === 0
      ),
  );
  moved.push({ measureIndex: target.measureIndex, symbol: { ...current.symbol, position } });
  moved.sort(
    (a, b) => a.measureIndex - b.measureIndex || compareChordSymbolPositions(a.symbol.position, b.symbol.position),
  );
  const indices = new Map<number, number>();
  const identified = chords.some((chord) => chord.elementId !== undefined);
  return moved.map((chord) => {
    const index = indices.get(chord.measureIndex) ?? 0;
    indices.set(chord.measureIndex, index + 1);
    return identified ? { ...chord, elementId: `m${chord.measureIndex}/chord${index}` } : chord;
  });
}

export function moveChordTrackChord(score: Score, source: TimedChord, target: TrackPoint): Score {
  if (!score.global.measures[target.measureIndex])
    throw new RangeError("The destination measure is no longer available");
  const chords = scoreTrackChords(score);
  const moved = moveTrackChordChanges(chords, source, target);
  if (moved === chords) return score;
  return produce(score, (draft) => {
    for (const index of new Set([source.measureIndex, target.measureIndex])) {
      const symbols = moved.filter((chord) => chord.measureIndex === index).map((chord) => chord.symbol);
      draft.global.measures[index]!.chordSymbols = symbols.length ? symbols : undefined;
    }
  });
}
