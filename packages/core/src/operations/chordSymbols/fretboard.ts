import type { Fretboard, Score } from "../../model";

/** Remove instrument-owned diagrams when their instrument leaves the document. */
export function pruneFretboards(score: Score): Score {
  const ids = new Set(score.parts.map((part) => part.id));
  let changed = false;
  const measures = score.global.measures.map((measure) => {
    let measureChanged = false;
    const chordSymbols = measure.chordSymbols?.map((chord) => {
      if (!chord.fretboards?.some((frame) => !ids.has(frame.partId))) return chord;
      changed = measureChanged = true;
      const frames = chord.fretboards.filter((frame) => ids.has(frame.partId));
      const next = { ...chord };
      if (frames.length) next.fretboards = frames;
      else delete next.fretboards;
      return next;
    });
    return measureChanged ? { ...measure, chordSymbols } : measure;
  });
  return changed ? { ...score, global: { ...score.global, measures } } : score;
}

/** Cross-field invariants shared by document validation and diagram editors. */
export function validateFretboard(frame: Omit<Fretboard, "partId">): string[] {
  const errors: string[] = [];
  const integer = (value: number, min: number, max: number) =>
    Number.isSafeInteger(value) && value >= min && value <= max;
  if (!integer(frame.frameStrings, 2, 12)) errors.push("String count must be between 2 and 12.");
  if (!integer(frame.frameFrets, 1, 12)) errors.push("Displayed fret count must be between 1 and 12.");
  const first = frame.firstFret?.fret ?? 1;
  if (!integer(first, 1, 36) || first + frame.frameFrets - 1 > 36)
    errors.push("Displayed frets must be within frets 1 to 36.");
  if ((frame.firstFret?.text?.length ?? 0) > 16) errors.push("First-fret labels may contain at most 16 characters.");
  if (frame.firstFret?.location !== undefined && !["left", "right"].includes(frame.firstFret.location))
    errors.push("First-fret label location must be left or right.");
  if ((frame.unplayed?.length ?? 0) > 8) errors.push("Unplayed-string indicators may contain at most 8 characters.");
  errors.push(...validateFrameNotes(frame));
  return errors;
}

function validateFrameNotes(frame: Omit<Fretboard, "partId">): string[] {
  const errors: string[] = [];
  const first = frame.firstFret?.fret ?? 1;
  const strings = new Map<number, Fretboard["frameNotes"]>();
  const barres = new Map<number, { start?: number; stop?: number }>();
  for (const note of frame.frameNotes) validateFrameNote(note, frame, first, strings, barres, errors);
  validateRepeatedStringPositions(strings, errors);
  validateBarrePairs(barres, errors);
  return errors;
}

function validateFrameNote(
  note: Fretboard["frameNotes"][number],
  frame: Omit<Fretboard, "partId">,
  first: number,
  strings: Map<number, Fretboard["frameNotes"]>,
  barres: Map<number, { start?: number; stop?: number }>,
  errors: string[],
): void {
  const integer = (value: number, min: number, max: number) =>
    Number.isSafeInteger(value) && value >= min && value <= max;
  if (!integer(note.string, 1, frame.frameStrings)) {
    errors.push("Strings must be within the diagram.");
  } else {
    const notes = strings.get(note.string) ?? [];
    notes.push(note);
    strings.set(note.string, notes);
  }
  if (!integer(note.fret, 0, 36) || (note.fret !== 0 && (note.fret < first || note.fret >= first + frame.frameFrets)))
    errors.push("Stopped notes must fall within the displayed fret range.");
  if ((note.fingering?.length ?? 0) > 8) errors.push("Fingerings may contain at most 8 characters.");
  if (note.barre === undefined) return;
  if (note.fret === 0 || !["start", "stop"].includes(note.barre)) {
    errors.push("Barre endpoints require a stopped fret and a start or stop marker.");
    return;
  }
  const endpoints = barres.get(note.fret) ?? {};
  if (endpoints[note.barre] !== undefined) errors.push("A fret may have only one barre.");
  endpoints[note.barre] = note.string;
  barres.set(note.fret, endpoints);
}

function validateRepeatedStringPositions(strings: Map<number, Fretboard["frameNotes"]>, errors: string[]): void {
  for (const notes of strings.values()) {
    if (notes.length === 1) continue;
    const barreNote = notes.find((note) => note.barre !== undefined);
    const playedNotes = notes.filter((note) => note !== barreNote);
    if (
      notes.length !== 2 ||
      barreNote === undefined ||
      barreNote.fret === 0 ||
      playedNotes.length !== 1 ||
      playedNotes[0]!.barre !== undefined ||
      barreNote.fret >= playedNotes[0]!.fret
    ) {
      errors.push("A string may have a second note only for a lower-fret barre endpoint.");
    }
  }
}

function validateBarrePairs(barres: Map<number, { start?: number; stop?: number }>, errors: string[]): void {
  for (const { start, stop } of barres.values()) {
    if (start === undefined || stop === undefined || start <= stop)
      errors.push("A barre needs paired endpoints on one fret, starting on the higher-numbered string.");
  }
}
