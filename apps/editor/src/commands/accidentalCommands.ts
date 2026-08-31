/**
 * Deleting an accidental.
 *
 * An accidental is not an ornament hung off a note — it is the written form of
 * the note's alteration. Erasing the glyph without touching the pitch would
 * leave the score saying one thing and sounding another, so removing an
 * accidental respells the note as whatever alteration would have been in force
 * had the accidental never been written: the key signature, or an earlier
 * accidental on the same step and octave in the same measure.
 *
 * A redundant accidental (a courtesy, or one forced onto a note whose pitch
 * already matches what's in force) is the exception. There is no pitch to
 * restore, so only the display directive goes.
 */

import type { Note, Score, SequenceContent } from "@viritura/core";
import { FLAT_ORDER, SHARP_ORDER } from "@viritura/core";
import { durationToBeats, sequenceContentBeats } from "./noteCommandsDurations";
import type { EventLocation } from "../score/ElementPath";
import { getEventAtLocation, resolveEventLocation } from "../score/ElementPath";

/** Matches the trailing `/acc{noteIndex}` segment the engine tags accidentals with. */
const ACCIDENTAL_SUFFIX = /\/acc(\d+)$/;

/** True when `elementId` names an accidental rather than any other element. */
export function isAccidentalId(elementId: string): boolean {
  return ACCIDENTAL_SUFFIX.test(elementId);
}

interface AccidentalLocation {
  location: EventLocation;
  noteIndex: number;
}

/** Resolve an accidental element id to the note whose alteration it spells. */
function resolveAccidentalLocation(elementId: string, score: Score): AccidentalLocation | null {
  const match = elementId.match(ACCIDENTAL_SUFFIX);
  if (!match) return null;
  const noteIndex = parseInt(match[1]!, 10);
  const location = resolveEventLocation(elementId.slice(0, match.index), score);
  if (!location) return null;
  return { location, noteIndex };
}

/**
 * Remove the accidental named by `elementId`, mutating `score` in place and
 * returning it. Returns null when the id doesn't resolve to a note carrying a
 * visible accidental, so the caller can fall through to its other delete paths.
 */
export function removeAccidental(score: Score, elementId: string): Score | null {
  const resolved = resolveAccidentalLocation(elementId, score);
  if (!resolved) return null;

  const event = getEventAtLocation(score, resolved.location);
  if (!event || event.type !== "event") return null;
  const note = event.notes?.[resolved.noteIndex];
  if (!note) return null;

  const prevailing = prevailingAlteration(score, resolved.location, note);
  const alter = note.pitch.alter ?? 0;
  const hadDisplay = note.accidentalDisplay !== undefined;

  // Nothing is drawn and nothing is overridden — not ours to delete.
  if (alter === prevailing && !hadDisplay) return null;

  if (alter !== prevailing) {
    if (prevailing === 0) delete note.pitch.alter;
    else note.pitch.alter = prevailing;
  }
  // Clearing the directive is right in both accidental modes: with
  // `useAccidentalDisplay` the engine draws only what `show` asks for, and in
  // auto mode the note now matches what's in force, so nothing is drawn.
  delete note.accidentalDisplay;
  return score;
}

/**
 * The alteration in force for a note's step and octave at its own position,
 * ignoring the note itself: an earlier accidental on the same step and octave
 * in the same measure, else the key signature.
 *
 * Mirrors the engine's running measure-accidental state, which is shared
 * across every voice of the measure and seeded from the key signature.
 */
export function prevailingAlteration(score: Score, location: EventLocation, target: Note): number {
  const key = keyAlterationForStep(effectiveFifths(score, location.measureIndex), target.pitch.step);
  const measure = score.parts[location.partIndex]?.measures[location.measureIndex];
  if (!measure) return key;

  let inForce = key;
  for (const sequence of measure.sequences) {
    if (walkForPrevailing(sequence.content, target, key, (alter) => (inForce = alter))) return inForce;
  }
  return inForce;
}

/**
 * Alteration in force immediately before an insertion beat. Earlier notes on
 * the same step and octave override the key signature; notes at the insertion
 * onset or later do not. Event onsets from every voice participate.
 */
export function prevailingAlterationAtPosition(
  score: Score,
  partIndex: number,
  measureIndex: number,
  beatPosition: number,
  pitch: Note["pitch"],
): number {
  const keyAlter = keyAlterationForStep(effectiveFifths(score, measureIndex), pitch.step);
  const measure = score.parts[partIndex]?.measures[measureIndex];
  if (!measure) return keyAlter;

  const prior: Array<{ beat: number; sequenceIndex: number; order: number; alter: number }> = [];
  for (let sequenceIndex = 0; sequenceIndex < measure.sequences.length; sequenceIndex++) {
    const sequence = measure.sequences[sequenceIndex]!;
    let order = 0;
    collectPriorAlterations(sequence.content, 0, 1, beatPosition, pitch, sequenceIndex, prior, () => order++);
  }
  prior.sort(
    (left, right) => left.beat - right.beat || left.sequenceIndex - right.sequenceIndex || left.order - right.order,
  );
  return prior.at(-1)?.alter ?? keyAlter;
}

function collectPriorAlterations(
  content: readonly SequenceContent[],
  startBeat: number,
  scale: number,
  beforeBeat: number,
  pitch: Note["pitch"],
  sequenceIndex: number,
  out: Array<{ beat: number; sequenceIndex: number; order: number; alter: number }>,
  nextOrder: () => number,
): number {
  let beat = startBeat;
  for (const item of content) {
    if (item.type === "tuplet") {
      const innerBeats = durationToBeats(item.inner.duration) * item.inner.multiple;
      const outerBeats = durationToBeats(item.outer.duration) * item.outer.multiple;
      const tupletScale = innerBeats > 0 ? scale * (outerBeats / innerBeats) : scale;
      collectPriorAlterations(item.content, beat, tupletScale, beforeBeat, pitch, sequenceIndex, out, nextOrder);
    } else if (item.type === "tremolo" || item.type === "grace") {
      collectPriorAlterations(item.content, beat, scale, beforeBeat, pitch, sequenceIndex, out, nextOrder);
    } else if (item.type === "event" && beat < beforeBeat - 1e-9) {
      for (const note of item.notes ?? []) {
        if (note.pitch.step === pitch.step && note.pitch.octave === pitch.octave) {
          out.push({ beat, sequenceIndex, order: nextOrder(), alter: note.pitch.alter ?? 0 });
        }
      }
    }
    beat += sequenceContentBeats(item) * scale;
  }
  return beat;
}

/**
 * Walk `content` in document order, tracking the alteration in force for the
 * target's step and octave. Returns true once the target note is reached, which
 * stops the walk — accidentals written later in the measure say nothing about
 * what was in force at this note.
 */
function walkForPrevailing(
  content: readonly SequenceContent[],
  target: Note,
  keyAlter: number,
  record: (alter: number) => void,
): boolean {
  for (const item of content) {
    if (item.type === "tuplet" || item.type === "tremolo" || item.type === "grace") {
      if (walkForPrevailing(item.content, target, keyAlter, record)) return true;
      continue;
    }
    if (item.type !== "event" || !item.notes) continue;
    for (const note of item.notes) {
      if (note === target) return true;
      if (note.pitch.step !== target.pitch.step || note.pitch.octave !== target.pitch.octave) continue;
      // Every sounding alteration carries forward, whether or not a glyph was
      // drawn for it — a hidden accidental still governs the notes after it.
      record(note.pitch.alter ?? 0);
    }
  }
  return false;
}

/** The key signature in force at `measureIndex`, as a circle-of-fifths value. */
function effectiveFifths(score: Score, measureIndex: number): number {
  for (let m = measureIndex; m >= 0; m--) {
    const fifths = score.global.measures[m]?.key?.fifths;
    if (fifths !== undefined) return fifths;
  }
  return 0;
}

/** The alteration a key signature imposes on one step. */
function keyAlterationForStep(fifths: number, step: string): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}
