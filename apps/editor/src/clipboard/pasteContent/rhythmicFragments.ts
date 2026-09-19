import type { Duration, NoteEvent, Score, SequenceContent, Space } from "@viritura/core";
import {
  addWholeFractions,
  compareWholeFractions,
  contentWholeFraction,
  exactWholeFraction,
  sequenceBoundaryFraction,
  subtractWholeFractions,
} from "../clipboardTrackPlacement";
import {
  decomposeDuration,
  durationToBeats,
  generateEventId,
  generateNoteId,
  getEffectiveTimeSignature,
} from "../../commands/noteCommands";

export interface MeasureFragment {
  measureIndex: number;
  beat: number;
  beats: number;
  content: SequenceContent[];
}

interface PastePosition {
  measureIndex: number;
  beat: Space["duration"];
}

interface ExactMeasureFragment extends PastePosition {
  beats: Space["duration"];
  content: SequenceContent[];
}

function measureCapacity(score: Score, position: PastePosition): Space["duration"] {
  const time = getEffectiveTimeSignature(score, position.measureIndex);
  const capacity: Space["duration"] = [time.count, time.unit];
  if (!capacity.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Cannot paste into a measure with an invalid duration.");
  }
  return addWholeFractions([0, 1], capacity);
}

function availableBeats(score: Score, position: PastePosition): Space["duration"] {
  const capacity = measureCapacity(score, position);
  const comparison = compareWholeFractions(position.beat, capacity);
  if (comparison > 0) throw new Error("The paste position is beyond the destination measure.");
  if (comparison === 0) {
    position.measureIndex++;
    position.beat = [0, 1];
    return measureCapacity(score, position);
  }
  return subtractWholeFractions(capacity, position.beat);
}

function appendFragment(
  fragments: ExactMeasureFragment[],
  position: PastePosition,
  content: SequenceContent[],
  beats: Space["duration"],
): void {
  const last = fragments.at(-1);
  if (last?.measureIndex === position.measureIndex) {
    last.content.push(...content);
    last.beats = addWholeFractions(last.beats, beats);
  } else {
    fragments.push({ ...position, beats, content });
  }
  position.beat = addWholeFractions(position.beat, beats);
}

function exactDurations(beats: Space["duration"]): Duration[] {
  const durations = decomposeDuration((beats[0] / beats[1]) * 4);
  const actual = durations.reduce<Space["duration"]>(
    (sum, duration) => addWholeFractions(sum, exactWholeFraction(durationToBeats(duration))),
    [0, 1],
  );
  if (compareWholeFractions(actual, beats) !== 0) {
    throw new Error("Cannot split clipboard content exactly at the destination barline.");
  }
  return durations;
}

function notePiece(event: NoteEvent, duration: Duration, previous?: NoteEvent): NoteEvent {
  const piece = structuredClone(event);
  piece.duration = duration;
  piece.id = previous ? generateEventId() : (event.id ?? generateEventId());
  for (const kind of ["notes", "kitNotes"] as const) {
    for (const [index, note] of (piece[kind] ?? []).entries()) {
      note.id = previous ? generateNoteId() : (note.id ?? generateNoteId());
      const previousNote = previous?.[kind]?.[index];
      if (previousNote) previousNote.ties = [{ target: note.id }];
    }
  }
  if (previous) {
    // Attack markings and slurs belong to the onset; outgoing ties and fermatas
    // belong to the final piece of the sustained event.
    delete piece.slurs;
    delete piece.markings;
    delete piece.lyrics;
    delete previous.fermata;
    delete previous.glissandos;
  }
  return piece;
}

function splitAcrossMeasures(
  score: Score,
  item: NoteEvent | Extract<SequenceContent, { type: "space" }>,
  position: PastePosition,
  fragments: ExactMeasureFragment[],
  totalBeats: Space["duration"],
): void {
  let remaining = totalBeats;
  let previous: NoteEvent | undefined;
  while (remaining[0] > 0) {
    const available = availableBeats(score, position);
    const beats = compareWholeFractions(remaining, available) <= 0 ? remaining : available;
    let pieces: SequenceContent[];
    if (item.type === "space") {
      pieces = [{ ...structuredClone(item), duration: beats }];
    } else {
      pieces = exactDurations(beats).map((duration) => {
        const piece = notePiece(item, duration, previous);
        previous = piece;
        return piece;
      });
    }
    appendFragment(fragments, position, pieces, beats);
    remaining = subtractWholeFractions(remaining, beats);
  }
}

function exactPasteBeat(score: Score, measureIndex: number, beat: number): Space["duration"] {
  // The caller may have accumulated the onset as floats. Recover its exact
  // source boundary instead of treating that summation error as new notation.
  let boundary: Space["duration"] | undefined;
  for (const part of score.parts) {
    for (const sequence of part.measures[measureIndex]?.sequences ?? []) {
      const fraction = sequenceBoundaryFraction(sequence.content, beat);
      if (!fraction) continue;
      if (boundary && compareWholeFractions(boundary, fraction) !== 0) {
        throw new Error("Cannot determine the exact clipboard paste position without the destination prefix.");
      }
      boundary = fraction;
    }
  }
  return boundary ?? exactWholeFraction(beat);
}

/** Plan the whole track before clearing anything; containers never move to a later bar to fit. */
export function planPasteFragments(
  score: Score,
  measureIndex: number,
  beat: number,
  content: SequenceContent[],
  destinationPrefix?: readonly SequenceContent[],
): MeasureFragment[] {
  if (!Number.isFinite(beat) || beat < 0) throw new Error("Invalid clipboard paste position.");
  const fragments: ExactMeasureFragment[] = [];
  const position = {
    measureIndex,
    beat: destinationPrefix
      ? destinationPrefix.reduce<Space["duration"]>(
          (sum, item) => addWholeFractions(sum, contentWholeFraction(item)),
          [0, 1],
        )
      : exactPasteBeat(score, measureIndex, beat),
  };
  for (const item of content) {
    const beats = contentWholeFraction(item);
    const available = availableBeats(score, position);
    if (compareWholeFractions(beats, available) <= 0) {
      appendFragment(fragments, position, [structuredClone(item)], beats);
    } else if (item.type === "event" || item.type === "space") {
      splitAcrossMeasures(score, item, position, fragments, beats);
    } else {
      throw new Error(`Cannot paste a ${item.type} across a destination barline.`);
    }
  }
  return fragments.map((fragment) => ({
    ...fragment,
    beat: (fragment.beat[0] / fragment.beat[1]) * 4,
    beats: (fragment.beats[0] / fragment.beats[1]) * 4,
  }));
}
