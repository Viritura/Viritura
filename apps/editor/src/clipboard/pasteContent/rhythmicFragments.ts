import { measureBeats, type Duration, type NoteEvent, type Score, type SequenceContent } from "@viritura/core";
import { beatPositionToFraction } from "../../app/timedAnnotationPosition";
import {
  decomposeDuration,
  durationToBeats,
  generateEventId,
  generateNoteId,
  getEffectiveTimeSignature,
  sequenceContentBeats,
} from "../../commands/noteCommands";

export interface MeasureFragment {
  measureIndex: number;
  beat: number;
  beats: number;
  content: SequenceContent[];
}

interface PastePosition {
  measureIndex: number;
  beat: number;
}

function measureCapacity(score: Score, position: PastePosition): number {
  const capacity = measureBeats(getEffectiveTimeSignature(score, position.measureIndex));
  if (!Number.isFinite(capacity) || capacity <= 1e-9) {
    throw new Error("Cannot paste into a measure with an invalid duration.");
  }
  return capacity;
}

function availableBeats(score: Score, position: PastePosition): number {
  const capacity = measureCapacity(score, position);
  if (position.beat > capacity + 1e-9) throw new Error("The paste position is beyond the destination measure.");
  if (position.beat >= capacity - 1e-9) {
    position.measureIndex++;
    position.beat = 0;
    return measureCapacity(score, position);
  }
  return capacity - position.beat;
}

function appendFragment(
  fragments: MeasureFragment[],
  position: PastePosition,
  content: SequenceContent[],
  beats: number,
): void {
  const last = fragments.at(-1);
  if (last?.measureIndex === position.measureIndex) {
    last.content.push(...content);
    last.beats += beats;
  } else {
    fragments.push({ ...position, beats, content });
  }
  position.beat += beats;
}

function exactDurations(beats: number): Duration[] {
  const durations = decomposeDuration(beats);
  if (Math.abs(durations.reduce((sum, duration) => sum + durationToBeats(duration), 0) - beats) > 1e-9) {
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
  fragments: MeasureFragment[],
  totalBeats: number,
): void {
  let remaining = totalBeats;
  let previous: NoteEvent | undefined;
  while (remaining > 1e-9) {
    const beats = Math.min(remaining, availableBeats(score, position));
    let pieces: SequenceContent[];
    if (item.type === "space") {
      pieces = [{ type: "space", duration: beatPositionToFraction(beats) }];
    } else {
      pieces = exactDurations(beats).map((duration) => {
        const piece = notePiece(item, duration, previous);
        previous = piece;
        return piece;
      });
    }
    appendFragment(fragments, position, pieces, beats);
    const nextRemaining = remaining - beats;
    if (nextRemaining >= remaining) throw new Error("Clipboard placement made no rhythmic progress.");
    remaining = nextRemaining;
  }
}

/** Plan the whole track before clearing anything; containers never move to a later bar to fit. */
export function planPasteFragments(
  score: Score,
  measureIndex: number,
  beat: number,
  content: SequenceContent[],
): MeasureFragment[] {
  if (!Number.isFinite(beat) || beat < 0) throw new Error("Invalid clipboard paste position.");
  const fragments: MeasureFragment[] = [];
  const position = { measureIndex, beat };
  for (const item of content) {
    const beats = sequenceContentBeats(item);
    if (!Number.isFinite(beats) || beats < 0) throw new Error("Invalid clipboard content duration.");
    const available = availableBeats(score, position);
    if (beats <= available + 1e-9) {
      appendFragment(fragments, position, [structuredClone(item)], beats);
    } else if (item.type === "event" || item.type === "space") {
      splitAcrossMeasures(score, item, position, fragments, beats);
    } else {
      throw new Error(`Cannot paste a ${item.type} across a destination barline.`);
    }
  }
  return fragments;
}
