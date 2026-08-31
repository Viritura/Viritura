/**
 * Chord/grace/backspace commands extracted from noteCommands.ts.
 *
 * Public functions are re-exported from noteCommands for backwards compatibility.
 */

import type { Duration, Grace, Note, NoteEvent, Pitch, Score, SequenceContent } from "@viritura/core";
import { isRest } from "@viritura/core";
import {
  generateEventId,
  generateNoteId,
  sequenceContentBeats,
  type AddPitchToChordParams,
  type NoteEventLocation,
} from "./noteCommands";

// ═══════════════════════════════════════════
// Chord entry: add pitch to existing event
// ═══════════════════════════════════════════

function locateChordEvent(score: Score, params: AddPitchToChordParams): NoteEvent {
  const { measureIndex, partIndex, voice, eventIndex, tupletIndex } = params;
  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);
  const partMeasure = part.measures[measureIndex];
  if (!partMeasure) throw new Error(`Measure ${measureIndex} not found`);
  const sequence = partMeasure.sequences[voice];
  if (!sequence) throw new Error(`Voice ${voice} not found`);

  let contentArray: SequenceContent[];
  if (tupletIndex !== undefined) {
    const tuplet = sequence.content[tupletIndex];
    if (!tuplet || tuplet.type !== "tuplet") throw new Error(`Tuplet ${tupletIndex} not found`);
    contentArray = tuplet.content;
  } else {
    contentArray = sequence.content;
  }

  const ev = contentArray[eventIndex];
  if (!ev) throw new Error(`Event ${eventIndex} not found`);
  return ev as NoteEvent;
}

/** Add or merge a kit-component (percussion) into the event. */
function applyKitComponentToEvent(event: NoteEvent, kitComponent: string): void {
  if (isRest(event)) {
    delete event.rest;
    event.kitNotes = [{ kitComponent }];
    return;
  }
  const dup = event.kitNotes?.some((kn) => kn.kitComponent === kitComponent);
  if (dup) return;
  if (event.kitNotes) {
    event.kitNotes.push({ kitComponent });
  } else {
    event.kitNotes = [{ kitComponent }];
  }
}

/** Add or merge a pitched note into the event. */
function applyPitchToEvent(event: NoteEvent, pitch: Pitch): void {
  if (isRest(event)) {
    delete event.rest;
    event.notes = [{ pitch }];
    return;
  }
  const dup = event.notes?.some(
    (n: Note) =>
      n.pitch.step === pitch.step && n.pitch.octave === pitch.octave && (n.pitch.alter ?? 0) === (pitch.alter ?? 0),
  );
  if (dup) return;
  const newNote: Note = { id: generateNoteId(), pitch };
  if (event.notes) {
    event.notes.push(newNote);
  } else {
    event.notes = [newNote];
  }
}

/**
 * Add a pitch to an existing event to build a chord.
 * - If the event is a note: appends the pitch (skips if duplicate).
 * - If the event is a rest: converts it to a note with the new pitch.
 * Returns the (mutated) score.
 */
export function addPitchToChord(score: Score, params: AddPitchToChordParams): Score {
  const event = locateChordEvent(score, params);
  if (params.kitComponent) {
    applyKitComponentToEvent(event, params.kitComponent);
  } else {
    applyPitchToEvent(event, params.pitch);
  }
  return score;
}

/**
 * Find the last non-rest note event in a given part and voice,
 * scanning backwards from the last measure.
 * Returns null if no note event exists.
 */
export function findLastNoteEvent(score: Score, partIndex: number, voice: number): NoteEventLocation | null {
  const part = score.parts[partIndex];
  if (!part) return null;

  for (let m = part.measures.length - 1; m >= 0; m--) {
    const seq = part.measures[m]?.sequences[voice];
    if (!seq) continue;
    for (let i = seq.content.length - 1; i >= 0; i--) {
      const ev = seq.content[i] as NoteEvent;
      if (ev && !isRest(ev)) {
        return { measureIndex: m, eventIndex: i };
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════
// Grace note commands
// ═══════════════════════════════════════════

export interface AddGraceNoteParams {
  pitch: Pitch;
  duration: Duration;
  measureIndex: number;
  partIndex: number;
  /** Voice index (0-based) */
  voice: number;
  /** Beat position of the main note this grace note precedes */
  beatPosition: number;
  /** true = acciaccatura (slashed), false = appoggiatura */
  slash: boolean;
  /** When set, the grace event is built as a kit-note (percussion). */
  kitComponent?: string;
}

function buildGraceEvent(pitch: Pitch, duration: Duration, kitComponent: string | undefined): NoteEvent {
  if (kitComponent) {
    return {
      type: "event",
      id: generateEventId(),
      duration,
      kitNotes: [{ kitComponent }],
    };
  }
  return {
    type: "event",
    id: generateEventId(),
    duration,
    notes: [{ id: generateNoteId(), pitch }],
  };
}

/** Find the content index at or after beatPosition (grace containers skipped). */
function findContentIndexAtBeat(content: SequenceContent[], beatPosition: number): number {
  let beatAcc = 0;
  for (let i = 0; i < content.length; i++) {
    const item = content[i]!;
    if (item.type === "grace") continue;
    if (beatAcc >= beatPosition - 1e-9) return i;
    beatAcc += sequenceContentBeats(item);
  }
  return content.length;
}

function findGraceTarget(
  content: SequenceContent[],
  beatPosition: number,
): {
  content: SequenceContent[];
  index: number;
} {
  let beatAcc = 0;
  for (const item of content) {
    const itemBeats = sequenceContentBeats(item);
    if (item.type === "tuplet" && beatPosition >= beatAcc - 1e-9 && beatPosition < beatAcc + itemBeats - 1e-9) {
      const innerBeats =
        item.inner.multiple *
        sequenceContentBeats({
          type: "event",
          duration: item.inner.duration,
          rest: {},
        });
      const scale = innerBeats > 0 ? itemBeats / innerBeats : 1;
      const innerBeat = (beatPosition - beatAcc) / scale;
      return { content: item.content, index: findContentIndexAtBeat(item.content, innerBeat) };
    }
    beatAcc += itemBeats;
  }
  return { content, index: findContentIndexAtBeat(content, beatPosition) };
}

/**
 * Add a grace note before the event at the specified beat position.
 * If a Grace container already exists immediately before that event,
 * the new note is appended to it. Otherwise a new Grace container is created.
 */
export function addGraceNote(score: Score, params: AddGraceNoteParams): Score {
  const { pitch, duration, measureIndex, partIndex, voice, beatPosition, slash } = params;

  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);
  const partMeasure = part.measures[measureIndex];
  if (!partMeasure) throw new Error(`Measure ${measureIndex} not found`);

  while (partMeasure.sequences.length <= voice) {
    partMeasure.sequences.push({ content: [] });
  }
  const sequence = partMeasure.sequences[voice]!;

  const graceEvent = buildGraceEvent(pitch, duration, params.kitComponent);
  const target = findGraceTarget(sequence.content, beatPosition);
  const targetContentIdx = target.index;

  const prevIdx = targetContentIdx - 1;
  if (prevIdx >= 0) {
    const prev = target.content[prevIdx]!;
    if (prev.type === "grace" && prev.slash === slash) {
      prev.content.push(graceEvent);
      return score;
    }
  }

  const grace: Grace = { type: "grace", content: [graceEvent], slash };
  target.content.splice(targetContentIdx, 0, grace as SequenceContent);
  return score;
}

// ═══════════════════════════════════════════
// Backspace in note input mode
// ═══════════════════════════════════════════

/** Trim trailing rest events from the end of a sequence's content. */
function trimTrailingRests(content: SequenceContent[]): void {
  while (content.length > 0) {
    const last = content[content.length - 1]! as NoteEvent;
    if (isRest(last)) {
      content.pop();
    } else {
      break;
    }
  }
}

/**
 * Backspace in note input mode: find the last non-rest event
 * across all measures for the given part/voice, replace with a
 * rest, and trim trailing rests so the implicit cursor moves back.
 *
 * Returns true if a note was found and removed.
 */
export function backspaceInNoteInput(score: Score, partIndex: number, voice: number): boolean {
  const part = score.parts[partIndex];
  if (!part) return false;

  for (let m = part.measures.length - 1; m >= 0; m--) {
    const sequence = part.measures[m]?.sequences[voice];
    if (!sequence || sequence.content.length === 0) continue;

    for (let i = sequence.content.length - 1; i >= 0; i--) {
      const event = sequence.content[i]! as NoteEvent;
      if (!isRest(event)) {
        sequence.content[i] = {
          type: "event",
          id: generateEventId(),
          duration: { ...event.duration },
          rest: {},
        };
        trimTrailingRests(sequence.content);
        return true;
      }
    }
  }

  return false;
}
