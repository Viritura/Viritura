import type { Score } from "@viritura/core";
import type { Pitch } from "@viritura/core";
import type { Duration, Note, NoteEvent, Sequence, SequenceContent } from "@viritura/core";
import { applyPatchesToScore, isRest, measureBeats, patch } from "@viritura/core";
import type { ScorePatch } from "@viritura/core";

// ═══════════════════════════════════════════
// Duration math + IDs + createRest (extracted to noteCommandsDurations.ts)
// ═══════════════════════════════════════════
export {
  durationToBeats,
  beatsToNoteValueBase,
  beatsToDuration,
  decomposeDuration,
  decomposeRestsAtPosition,
  sequenceContentBeats,
  generateEventId,
  generateNoteId,
  resetIdCounter,
  createRest,
} from "./noteCommandsDurations";
import {
  durationToBeats,
  decomposeDuration,
  decomposeRestsAtPosition,
  sequenceContentBeats,
  generateEventId,
  generateNoteId,
  createRest,
} from "./noteCommandsDurations";

// ═══════════════════════════════════════════
// Helper: compute beat position of events
// ═══════════════════════════════════════════

interface EventAtPosition {
  event: NoteEvent;
  /** Index in the content array (top-level, or inside a tuplet). */
  index: number;
  beatPosition: number;
  /** If inside a tuplet, the index of the tuplet in the top-level content array. */
  tupletIndex?: number;
  /** Duration scaling factor for events inside tuplets (outer/inner). */
  durationScale: number;
}

/** Get beat positions of all note events in a sequence, including inside tuplets. */
function getEventPositions(sequence: Sequence): EventAtPosition[] {
  const result: EventAtPosition[] = [];
  let pos = 0;
  for (let i = 0; i < sequence.content.length; i++) {
    const item = sequence.content[i]!;
    if (item.type === "tuplet") {
      const innerBeats = durationToBeats(item.inner.duration) * item.inner.multiple;
      const outerBeats = durationToBeats(item.outer.duration) * item.outer.multiple;
      const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
      for (let j = 0; j < item.content.length; j++) {
        const ev = item.content[j]!;
        if (ev.type === "event") {
          result.push({ event: ev, index: j, beatPosition: pos, tupletIndex: i, durationScale: scale });
        }
        pos += sequenceContentBeats(ev) * scale;
      }
    } else if (item.type === "event") {
      result.push({ event: item, index: i, beatPosition: pos, durationScale: 1 });
      pos += durationToBeats(item.duration);
    }
  }
  return result;
}

// ═══════════════════════════════════════════
// Parameters for note commands
// ═══════════════════════════════════════════

export interface AddNoteParams {
  pitch: Pitch;
  duration: Duration;
  measureIndex: number;
  partIndex: number;
  /** Voice index (0-based, selects sequence in measure) */
  voice: number;
  /** Beat position within the measure (in quarter-note beats) */
  beatPosition: number;
  /** Staff number (1-indexed) to assign to newly created sequences. Optional. */
  staffNumber?: number;
  /** When set, the event is built as a percussion kit-note (MNX `kitNotes`)
   *  referencing this kit-component ID, instead of a pitched note. The
   *  `pitch` field is ignored in that case. */
  kitComponent?: string;
}

export interface DeleteNoteParams {
  measureIndex: number;
  partIndex: number;
  voice: number;
  /** Index of the event within its containing array (seq.content or tuplet.content). */
  eventIndex: number;
  /** If the event is inside a tuplet, the index of the tuplet in seq.content. */
  tupletIndex?: number;
}

export interface ChangePitchParams {
  measureIndex: number;
  partIndex: number;
  voice: number;
  eventIndex: number;
  /** If the event is inside a tuplet, the index of the tuplet in seq.content. */
  tupletIndex?: number;
  newPitch: Pitch;
}

export interface ChangeDurationParams {
  measureIndex: number;
  partIndex: number;
  voice: number;
  eventIndex: number;
  /** If the event is inside a tuplet, the index of the tuplet in seq.content. */
  tupletIndex?: number;
  newDuration: Duration;
}

export interface AddRestParams {
  duration: Duration;
  measureIndex: number;
  partIndex: number;
  /** Voice index (0-based, selects sequence in measure) */
  voice: number;
  /** Beat position within the measure (in quarter-note beats) */
  beatPosition: number;
  /** Staff number (1-indexed) to assign to newly created sequences. Optional. */
  staffNumber?: number;
}

export interface AddPitchToChordParams {
  pitch: Pitch;
  measureIndex: number;
  partIndex: number;
  voice: number;
  eventIndex: number;
  /** If the event is inside a tuplet, the index of the tuplet in seq.content. */
  tupletIndex?: number;
  /** When set, the kit-component ID is appended to `event.kitNotes` instead
   *  of adding a pitch to `event.notes` (used for percussion staves). */
  kitComponent?: string;
}

export interface EditEventLocation {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  /** If the event is inside a tuplet or tremolo, the index of the container in seq.content. */
  tupletIndex?: number;
}

/** Location of a note event within the score. */
export interface NoteEventLocation {
  measureIndex: number;
  eventIndex: number;
}

/** Replace a meter-independent full-measure rest with explicit rests before editing it. */
export function ensureMeasureContent(score: Score, measureIndex: number, partIndex: number, voice: number): void {
  const partMeasure = score.parts[partIndex]?.measures[measureIndex];
  if (!partMeasure) return;
  while (partMeasure.sequences.length <= voice) {
    partMeasure.sequences.push({ content: [] });
  }
  const sequence = partMeasure.sequences[voice]!;
  if (!sequence.fullMeasure) return;
  const time = getEffectiveTimeSignature(score, measureIndex);
  const rests = decomposeRestsAtPosition(measureBeats(time), 0, time);
  sequence.content = rests.map((duration) => createRest(duration));
  delete sequence.fullMeasure;
}

interface NoteEditLocation {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  tupletIndex?: number;
  noteIndex?: number;
}

function getEditableNote(score: Score, loc: NoteEditLocation): Note | null {
  const seq = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  if (!seq) return null;
  const content =
    loc.tupletIndex !== undefined
      ? (() => {
          const t = seq.content[loc.tupletIndex!];
          return t?.type === "tuplet" ? t.content : null;
        })()
      : seq.content;
  const event = content?.[loc.eventIndex];
  if (!event || event.type !== "event" || !event.notes || event.notes.length === 0) {
    return null;
  }
  const note = event.notes[loc.noteIndex ?? 0];
  return note ?? null;
}

export type AccidentalEnclosureSymbolValue = "parentheses" | "brackets";

export interface SetNoteAccidentalDisplayParams extends NoteEditLocation {
  show?: boolean;
  force?: boolean;
  enclosureSymbol?: AccidentalEnclosureSymbolValue | null;
}

/**
 * Update note-level accidentalDisplay properties without changing pitch alteration.
 */
export function setNoteAccidentalDisplay(score: Score, params: SetNoteAccidentalDisplayParams): Score | null {
  const note = getEditableNote(score, params);
  if (!note) return null;

  const current = note.accidentalDisplay;
  const show = params.show ?? current?.show ?? true;
  const force = params.force === undefined ? current?.force : params.force ? true : undefined;
  const enclosure =
    params.enclosureSymbol === undefined
      ? current?.enclosure
      : params.enclosureSymbol === null
        ? undefined
        : { symbol: params.enclosureSymbol };

  note.accidentalDisplay = {
    show,
    ...(force === undefined ? {} : { force }),
    ...(enclosure === undefined ? {} : { enclosure }),
  };
  return score;
}

export type ToggleCourtesyAccidentalParams = NoteEditLocation;

/**
 * Convenience toggle for courtesy accidental mode (show=true + force=true).
 */
export function toggleCourtesyAccidental(score: Score, params: ToggleCourtesyAccidentalParams): Score | null {
  const note = getEditableNote(score, params);
  if (!note) return null;
  const current = note.accidentalDisplay;
  const isCourtesy = current?.show === true && current.force === true;
  return setNoteAccidentalDisplay(score, {
    ...params,
    show: true,
    force: !isCourtesy,
  });
}

function editLocationKey(loc: EditEventLocation): string {
  return `${loc.partIndex}:${loc.measureIndex}:${loc.sequenceIndex}:${loc.eventIndex}`;
}

function cloneNoteForRestore(note: Note): Note {
  return JSON.parse(JSON.stringify(note)) as Note;
}

const toggledRestNotes = new Map<string, Note[]>();

/**
 * Toggle selected events between note/rest while preserving note content
 * for a reversible toggle on the same location.
 */
export function toggleRestAtLocations(score: Score, locations: readonly EditEventLocation[]): boolean {
  let changed = false;
  for (const loc of locations) {
    const seq = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
    if (!seq) continue;
    const content =
      loc.tupletIndex !== undefined
        ? (() => {
            const t = seq.content[loc.tupletIndex!];
            return t?.type === "tuplet" ? t.content : null;
          })()
        : seq.content;
    const event = content?.[loc.eventIndex];
    if (!event || event.type !== "event") continue;

    const key = editLocationKey(loc);
    if (isRest(event)) {
      const previousNotes = toggledRestNotes.get(key);
      if (!previousNotes || previousNotes.length === 0) continue;
      delete event.rest;
      event.notes = previousNotes.map(cloneNoteForRestore);
      toggledRestNotes.delete(key);
      changed = true;
      continue;
    }

    if (!event.notes || event.notes.length === 0) continue;
    toggledRestNotes.set(key, event.notes.map(cloneNoteForRestore));
    delete event.notes;
    event.rest = {};
    changed = true;
  }
  return changed;
}

/** Toggle one augmentation dot on selected events (0 ↔ 1+).
 *  Adding a dot consumes forward content; removing fills with rests. */
export function toggleDotAtLocations(score: Score, locations: readonly EditEventLocation[]): boolean {
  let changed = false;
  for (const loc of locations) {
    const seq = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
    if (!seq) continue;
    const content =
      loc.tupletIndex !== undefined
        ? (() => {
            const t = seq.content[loc.tupletIndex!];
            return t?.type === "tuplet" ? t.content : null;
          })()
        : seq.content;
    const event = content?.[loc.eventIndex];
    if (!event || event.type !== "event") continue;

    const dots = event.duration.dots ?? 0;
    const newDuration =
      dots > 0 ? ({ ...event.duration, dots: undefined } as Duration) : { ...event.duration, dots: 1 };
    // Clean up undefined dots property
    if (newDuration.dots === undefined) delete (newDuration as unknown as Record<string, unknown>).dots;

    try {
      changeDuration(score, {
        measureIndex: loc.measureIndex,
        partIndex: loc.partIndex,
        voice: loc.sequenceIndex,
        eventIndex: loc.eventIndex,
        newDuration,
      });
      changed = true;
    } catch {
      // Duration change failed (e.g., not enough room) — skip
    }
  }
  return changed;
}

// ═══════════════════════════════════════════
// Core commands
// ═══════════════════════════════════════════

/**
 * Add a note at the specified beat position.
 * - If position falls on a rest, replaces it (splitting if needed).
 * - Adjusts surrounding rests to maintain measure duration.
 * Returns a new Score (immutable update).
 */
// eslint-disable-next-line max-statements, complexity -- musical-event insertion is inherently branchy: two-pass onset/range targeting, gap-fill at end, rest-vs-note overwrite, tuplet-inner vs top-level splice, pre/post rest decomposition under metric grid. Each branch is a distinct musical case, not a dispatchable kind — splitting would scatter the splice arithmetic across helpers and obscure the invariant that measure beats are preserved.
export function addNote(score: Score, params: AddNoteParams): Score {
  const { pitch, duration, measureIndex, partIndex, voice, beatPosition, staffNumber } = params;

  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);

  const partMeasure = part.measures[measureIndex];
  if (!partMeasure) throw new Error(`Measure ${measureIndex} not found`);

  // Ensure the voice (sequence) exists
  while (partMeasure.sequences.length <= voice) {
    const newSeq: import("@viritura/core").Sequence = { content: [] };
    // Assign staff number if this is a multi-staff instrument
    if (staffNumber != null) {
      newSeq.staff = staffNumber;
    }
    partMeasure.sequences.push(newSeq);
  }

  ensureMeasureContent(score, measureIndex, partIndex, voice);

  const sequence = partMeasure.sequences[voice]!;
  const noteBeats = durationToBeats(duration);
  const positions = getEventPositions(sequence);
  // Metric context for rest decomposition (used to avoid rests crossing
  // beat boundaries stronger than themselves — see decomposeRestsAtPosition).
  const measureTs = getEffectiveTimeSignature(score, measureIndex);

  // Find the event at or containing the beat position.
  // Use two-pass matching: first look for an event whose onset matches the beat
  // position (within rounding tolerance from buildSnapGrid), then fall back to
  // range containment for mid-event placement.
  let targetIdx = -1;
  let targetBeatStart = 0;
  const ONSET_TOL = 0.005; // handles Math.round(x*1000)/1000 rounding in snap grid

  // Pass 1: exact onset match (handles tuplet beat boundaries where rounding
  // causes the beat to land just inside the previous event's range)
  for (let i = 0; i < positions.length; i++) {
    const ep = positions[i]!;
    if (Math.abs(beatPosition - ep.beatPosition) < ONSET_TOL) {
      targetIdx = i;
      targetBeatStart = ep.beatPosition;
      break;
    }
  }

  // Pass 2: range containment for clicks in the middle of an event
  if (targetIdx === -1) {
    for (let i = 0; i < positions.length; i++) {
      const ep = positions[i]!;
      const eventEnd = ep.beatPosition + durationToBeats(ep.event.duration) * ep.durationScale;
      if (beatPosition >= ep.beatPosition + ONSET_TOL && beatPosition < eventEnd - 1e-9) {
        targetIdx = i;
        targetBeatStart = ep.beatPosition;
        break;
      }
    }
  }

  const newEvent: NoteEvent = params.kitComponent
    ? {
        type: "event",
        id: generateEventId(),
        duration,
        kitNotes: [{ kitComponent: params.kitComponent }],
      }
    : {
        type: "event",
        id: generateEventId(),
        duration,
        notes: [{ id: generateNoteId(), pitch }],
      };

  if (targetIdx === -1) {
    // Beat position is beyond existing content — fill gap with rests, then add note
    const totalBeats = positions.reduce((sum, ep) => sum + durationToBeats(ep.event.duration) * ep.durationScale, 0);
    const gap = beatPosition - totalBeats;
    if (gap > 1e-9) {
      const gapRests = decomposeRestsAtPosition(gap, totalBeats, measureTs);
      for (const d of gapRests) {
        sequence.content.push(createRest(d));
      }
    }
    sequence.content.push(newEvent);
  } else {
    const targetPos = positions[targetIdx]!;
    const targetEvent = targetPos.event;
    const targetBeats = durationToBeats(targetEvent.duration);
    const offsetInTarget = beatPosition - targetBeatStart;

    // Get the content array to splice into (top-level or tuplet-inner)
    const contentArray =
      targetPos.tupletIndex !== undefined
        ? (sequence.content[targetPos.tupletIndex] as import("@viritura/core").Tuplet).content
        : sequence.content;
    const contentIdx = targetPos.index;

    if (isRest(targetEvent)) {
      // Inside a tuplet: simply replace the rest with the note (same duration)
      if (targetPos.tupletIndex !== undefined) {
        newEvent.duration = { ...targetEvent.duration };
        contentArray[contentIdx] = newEvent;
      } else {
        // Top-level: full replacement with pre/post rests
        const noteStartBeat = targetBeatStart + offsetInTarget;
        const noteEndBeat = noteStartBeat + noteBeats;

        let consumeEnd = targetIdx;
        let consumedEndBeat = targetBeatStart + targetBeats;

        while (consumedEndBeat < noteEndBeat - 1e-9 && consumeEnd + 1 < positions.length) {
          const nextPos = positions[consumeEnd + 1]!;
          if (!isRest(nextPos.event)) break;
          if (nextPos.tupletIndex !== targetPos.tupletIndex) break; // don't cross tuplet boundaries
          consumeEnd++;
          consumedEndBeat = nextPos.beatPosition + durationToBeats(nextPos.event.duration) * nextPos.durationScale;
        }

        const newContent: NoteEvent[] = [];

        if (offsetInTarget > 1e-9) {
          const preRests = decomposeRestsAtPosition(offsetInTarget, targetBeatStart, measureTs);
          for (const d of preRests) {
            newContent.push(createRest(d));
          }
        }

        newContent.push(newEvent);

        const postBeats = consumedEndBeat - noteEndBeat;
        if (postBeats > 1e-9) {
          const postRests = decomposeRestsAtPosition(postBeats, noteEndBeat, measureTs);
          for (const d of postRests) {
            newContent.push(createRest(d));
          }
        }

        const startContentIdx = positions[targetIdx]!.index;
        const endContentIdx = positions[consumeEnd]!.index;
        contentArray.splice(startContentIdx, endContentIdx - startContentIdx + 1, ...newContent);
      }
    } else {
      // Target position is occupied by a note — overwrite it
      // Inside a tuplet: replace with same-duration note
      if (targetPos.tupletIndex !== undefined) {
        newEvent.duration = { ...targetEvent.duration };
        contentArray[contentIdx] = newEvent;
      } else {
        const targetBeatsVal = durationToBeats(targetEvent.duration);
        const noteStartBeat = targetBeatStart + offsetInTarget;
        const noteEndBeat = noteStartBeat + noteBeats;

        const newContent: NoteEvent[] = [];

        // Pre-portion: if the new note doesn't start at the target event's beginning,
        // keep the original note truncated to the pre-portion (not replaced with rests)
        if (offsetInTarget > 1e-9) {
          if (isRest(targetEvent)) {
            // Target is a rest — fill pre-portion with rests
            const preRests = decomposeRestsAtPosition(offsetInTarget, targetBeatStart, measureTs);
            for (const d of preRests) {
              newContent.push(createRest(d));
            }
          } else {
            // Target is a note — truncate it to fit before the new note
            const truncDurations = decomposeDuration(offsetInTarget);
            for (const d of truncDurations) {
              newContent.push({
                type: "event",
                id: generateEventId(),
                duration: d,
                notes: targetEvent.notes ? targetEvent.notes.map((n) => ({ ...n })) : undefined,
              });
            }
          }
        }

        // The new note
        newContent.push(newEvent);

        if (noteBeats < targetBeatsVal - offsetInTarget - 1e-9) {
          // Shorter: insert rest for remaining beats
          const postBeats = targetBeatsVal - offsetInTarget - noteBeats;
          if (postBeats > 1e-9) {
            const postRests = decomposeRestsAtPosition(postBeats, noteEndBeat, measureTs);
            for (const d of postRests) {
              newContent.push(createRest(d));
            }
          }
          sequence.content.splice(contentIdx, 1, ...newContent);
        } else if (noteBeats > targetBeatsVal - offsetInTarget + 1e-9) {
          // Longer: consume following rests
          let consumeEnd = targetIdx;
          let consumedEndBeat = targetBeatStart + targetBeatsVal;

          while (consumedEndBeat < noteEndBeat - 1e-9 && consumeEnd + 1 < positions.length) {
            const nextPos = positions[consumeEnd + 1]!;
            if (!isRest(nextPos.event)) break;
            if (nextPos.tupletIndex !== targetPos.tupletIndex) break;
            consumeEnd++;
            consumedEndBeat = nextPos.beatPosition + durationToBeats(nextPos.event.duration) * nextPos.durationScale;
          }

          const postBeats = consumedEndBeat - noteEndBeat;
          if (postBeats > 1e-9) {
            const postRests = decomposeRestsAtPosition(postBeats, noteEndBeat, measureTs);
            for (const d of postRests) {
              newContent.push(createRest(d));
            }
          }

          const endContentIdx = positions[consumeEnd]!.index;
          sequence.content.splice(contentIdx, endContentIdx - contentIdx + 1, ...newContent);
        } else {
          // Same duration: simple replace
          sequence.content.splice(contentIdx, 1, ...newContent);
        }
      }
    }
  }

  // Clear fullMeasure flag since we now have explicit content
  if (sequence.fullMeasure) {
    delete sequence.fullMeasure;
  }

  // Trim measure content to fit the time signature — prevent overflow
  trimMeasureContent(score, sequence, measureIndex);

  return score;
}

/**
 * Trim a sequence's content so total beats don't exceed the time signature.
 * Events that extend past the measure boundary are truncated or removed.
 * Notes are shortened (decomposed to shorter durations), rests are trimmed.
 */
function trimMeasureContent(score: Score, sequence: import("@viritura/core").Sequence, measureIndex: number): void {
  const ts = getEffectiveTimeSignature(score, measureIndex);
  const maxBeats = measureBeats(ts);

  let totalBeats = 0;
  for (let i = 0; i < sequence.content.length; i++) {
    const item = sequence.content[i]!;
    const itemBeats = sequenceContentBeats(item);
    const endBeat = totalBeats + itemBeats;

    if (endBeat > maxBeats + 1e-9) {
      const remainingBeats = maxBeats - totalBeats;
      if (remainingBeats < 1e-9) {
        // This item starts at or past the end — remove it and everything after
        sequence.content.splice(i);
        return;
      }
      // For tuplets, don't truncate — just remove everything after
      if (item.type !== "event") {
        sequence.content.splice(i + 1);
        return;
      }
      // Truncate this event to fit
      const truncDurations = decomposeDuration(remainingBeats);
      if (truncDurations.length > 0) {
        const truncEvents: NoteEvent[] = truncDurations.map((d) => ({
          ...item,
          id: generateEventId(),
          duration: d,
        }));
        sequence.content.splice(i, sequence.content.length - i, ...truncEvents);
      } else {
        sequence.content.splice(i);
      }
      return;
    }
    totalBeats = endBeat;
  }
}

/**
 * Fill the remaining beats in a measure with rests so the total duration
 * matches the time signature. If the content is already correct or exceeds
 * the time signature, does nothing.
 */
function _fillMeasureRests(score: Score, measureIndex: number, partIndex: number, voice: number): void {
  const part = score.parts[partIndex];
  if (!part) return;
  const pm = part.measures[measureIndex];
  if (!pm) return;
  const seq = pm.sequences[voice];
  if (!seq) return;

  // Get the time signature for this measure
  const ts = getEffectiveTimeSignature(score, measureIndex);
  const maxBeats = measureBeats(ts);

  // Compute current total beats
  let totalBeats = 0;
  for (const item of seq.content) {
    totalBeats += sequenceContentBeats(item);
  }

  // If content is shorter than time sig, fill with rests
  const remainder = maxBeats - totalBeats;
  if (remainder > 1e-9) {
    const fillRests = decomposeRestsAtPosition(remainder, totalBeats, ts);
    for (const d of fillRests) {
      seq.content.push(createRest(d));
    }
  }
}

/**
 * Add a rest at the specified beat position (overwrite mode).
 * Replaces whatever event is at that position with a rest.
 * Returns a new Score (immutable update).
 */
// eslint-disable-next-line max-statements, complexity -- mirror of addNote for rest insertion (overwrite mode): same beat-targeting + tuplet/top-level + pre/post rest-decomposition branches, but with rest-specific merge semantics. The branching is musical case analysis, not a dispatchable kind.
export function addRest(score: Score, params: AddRestParams): Score {
  const { duration, measureIndex, partIndex, voice, beatPosition, staffNumber } = params;

  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);

  const partMeasure = part.measures[measureIndex];
  if (!partMeasure) throw new Error(`Measure ${measureIndex} not found`);

  while (partMeasure.sequences.length <= voice) {
    const newSeq: import("@viritura/core").Sequence = { content: [] };
    if (staffNumber != null) newSeq.staff = staffNumber;
    partMeasure.sequences.push(newSeq);
  }

  ensureMeasureContent(score, measureIndex, partIndex, voice);

  const sequence = partMeasure.sequences[voice]!;
  const restBeats = durationToBeats(duration);
  const positions = getEventPositions(sequence);
  const measureTs = getEffectiveTimeSignature(score, measureIndex);

  // Find the event at or containing the beat position.
  // Two-pass: onset match first (handles tuplet rounding), then range containment.
  let targetIdx = -1;
  let targetBeatStart = 0;
  const ONSET_TOL = 0.005;

  for (let i = 0; i < positions.length; i++) {
    const ep = positions[i]!;
    if (Math.abs(beatPosition - ep.beatPosition) < ONSET_TOL) {
      targetIdx = i;
      targetBeatStart = ep.beatPosition;
      break;
    }
  }

  if (targetIdx === -1) {
    for (let i = 0; i < positions.length; i++) {
      const ep = positions[i]!;
      const eventEnd = ep.beatPosition + durationToBeats(ep.event.duration) * ep.durationScale;
      if (beatPosition >= ep.beatPosition + ONSET_TOL && beatPosition < eventEnd - 1e-9) {
        targetIdx = i;
        targetBeatStart = ep.beatPosition;
        break;
      }
    }
  }

  const newRestEvent = createRest(duration);

  if (targetIdx === -1) {
    // Beyond existing content — fill gap with rests, then add rest
    const totalBeats = positions.reduce((sum, ep) => sum + durationToBeats(ep.event.duration) * ep.durationScale, 0);
    const gap = beatPosition - totalBeats;
    if (gap > 1e-9) {
      const gapRests = decomposeRestsAtPosition(gap, totalBeats, measureTs);
      for (const d of gapRests) {
        sequence.content.push(createRest(d));
      }
    }
    sequence.content.push(newRestEvent);
  } else {
    const targetPos = positions[targetIdx]!;
    const targetEvent = targetPos.event;
    const targetBeatsVal = durationToBeats(targetEvent.duration);
    const offsetInTarget = beatPosition - targetBeatStart;

    const restStartBeat = targetBeatStart + offsetInTarget;
    const restEndBeat = restStartBeat + restBeats;

    // Get the content array to splice into (top-level or tuplet-inner)
    const contentArray =
      targetPos.tupletIndex !== undefined
        ? (sequence.content[targetPos.tupletIndex] as import("@viritura/core").Tuplet).content
        : sequence.content;

    if (targetPos.tupletIndex !== undefined) {
      // Inside a tuplet: replace the target inner event with the rest
      // (preserving the inner duration so the tuplet structure stays intact).
      const innerRest = createRest(targetEvent.duration);
      contentArray[targetPos.index] = innerRest;
    } else {
      // Top-level: original behavior — find consumed events, splice with pre/post rests
      let consumeEnd = targetIdx;
      let consumedEndBeat = targetBeatStart + targetBeatsVal;

      while (consumedEndBeat < restEndBeat - 1e-9 && consumeEnd + 1 < positions.length) {
        const nextPos = positions[consumeEnd + 1]!;
        if (!isRest(nextPos.event)) break;
        if (nextPos.tupletIndex !== targetPos.tupletIndex) break;
        consumeEnd++;
        consumedEndBeat = nextPos.beatPosition + durationToBeats(nextPos.event.duration) * nextPos.durationScale;
      }

      const newContent: NoteEvent[] = [];

      // Pre-rest: if rest doesn't start at the target event's beginning
      if (offsetInTarget > 1e-9) {
        if (isRest(targetEvent)) {
          const preRests = decomposeRestsAtPosition(offsetInTarget, targetBeatStart, measureTs);
          for (const d of preRests) {
            newContent.push(createRest(d));
          }
        } else {
          // Truncate the existing note
          const truncDurations = decomposeDuration(offsetInTarget);
          for (const d of truncDurations) {
            newContent.push({
              type: "event",
              id: generateEventId(),
              duration: d,
              notes: targetEvent.notes ? targetEvent.notes.map((n) => ({ ...n })) : undefined,
            });
          }
        }
      }

      // The rest itself
      newContent.push(newRestEvent);

      // Post-rest: remaining beats after the rest
      const postBeats = consumedEndBeat - restEndBeat;
      if (postBeats > 1e-9) {
        const postRests = decomposeRestsAtPosition(postBeats, restEndBeat, measureTs);
        for (const d of postRests) {
          newContent.push(createRest(d));
        }
      }

      const startContentIdx = positions[targetIdx]!.index;
      const endContentIdx = positions[consumeEnd]!.index;
      sequence.content.splice(startContentIdx, endContentIdx - startContentIdx + 1, ...newContent);

      // Merge adjacent rests (only at top level)
      mergeAdjacentRests(sequence, undefined, measureTs);
    }
  }

  // Clear fullMeasure flag
  if (sequence.fullMeasure) {
    delete sequence.fullMeasure;
  }

  return score;
}

/**
 * Delete a note event (replace with rest of same duration).
 */
function collapseRestOnlySequence(sequence: Sequence): void {
  const containsOnlyRests = sequence.content.every((item) => {
    if (item.type === "event") return isRest(item);
    if (item.type === "tuplet" || item.type === "tremolo") {
      return item.content.every((event) => event.type === "event" && isRest(event));
    }
    return false;
  });
  if (!containsOnlyRests) return;
  sequence.content = [];
  sequence.fullMeasure = { visualDuration: { base: "whole" } };
}

export function deleteNote(score: Score, params: DeleteNoteParams): Score {
  const { measureIndex, partIndex, voice, eventIndex, tupletIndex } = params;

  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);

  const partMeasure = part.measures[measureIndex];
  if (!partMeasure) throw new Error(`Measure ${measureIndex} not found`);

  const sequence = partMeasure.sequences[voice];
  if (!sequence) throw new Error(`Voice ${voice} not found`);

  let contentArray: SequenceContent[];
  if (tupletIndex !== undefined) {
    const container = sequence.content[tupletIndex];
    if (!container || (container.type !== "tuplet" && container.type !== "tremolo")) {
      throw new Error(`Container at index ${tupletIndex} not found`);
    }
    if (container.type === "tremolo") {
      const restored = container.content.map(
        (innerEvent): NoteEvent => ({
          ...innerEvent,
          duration: container.individualDuration ? { ...container.individualDuration } : { ...innerEvent.duration },
        }),
      );
      const event = restored[eventIndex];
      if (!event) throw new Error(`Event ${eventIndex} not found`);
      if (!isRest(event)) restored[eventIndex] = createRest(event.duration);
      sequence.content.splice(tupletIndex, 1, ...restored);
      collapseRestOnlySequence(sequence);
      return score;
    }
    contentArray = container.content;
  } else {
    contentArray = sequence.content;
  }

  const event = contentArray[eventIndex] as NoteEvent | undefined;
  if (!event) throw new Error(`Event ${eventIndex} not found`);

  if (isRest(event)) {
    collapseRestOnlySequence(sequence);
    return score;
  }

  // Replace note with rest of same duration
  const rest = createRest(event.duration);
  contentArray[eventIndex] = rest;

  // Merge adjacent rests only in the top-level sequence (not inside tuplets).
  if (tupletIndex === undefined) {
    const ts = getEffectiveTimeSignature(score, measureIndex);
    mergeAdjacentRests(sequence, undefined, ts);
  }
  collapseRestOnlySequence(sequence);

  return score;
}

/**
 * Plan the patches needed to change the pitch of the first note in an event.
 *
 * The command takes index-based params (legacy ergonomics) but emits an
 * id-anchored `ScorePatch`, so the same patch is replay-safe in the future
 * Y-projection interpreter without reference to indices that may have shifted
 * under concurrent inserts.
 */
function planChangePitch(score: Score, params: ChangePitchParams): ScorePatch[] {
  const { measureIndex, partIndex, voice, eventIndex, tupletIndex, newPitch } = params;

  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);
  if (!part.id) throw new Error(`Part ${partIndex} has no id (cannot plan patch)`);

  const partMeasure = part.measures[measureIndex];
  if (!partMeasure) throw new Error(`Measure ${measureIndex} not found`);

  const sequence = partMeasure.sequences[voice];
  if (!sequence) throw new Error(`Voice ${voice} not found`);

  let event: NoteEvent | undefined;
  if (tupletIndex !== undefined) {
    const tuplet = sequence.content[tupletIndex];
    if (!tuplet || tuplet.type !== "tuplet") {
      throw new Error(`Tuplet ${tupletIndex} not found`);
    }
    const inner = tuplet.content[eventIndex];
    if (inner && inner.type === "event") event = inner;
  } else {
    const top = sequence.content[eventIndex];
    if (top && top.type === "event") event = top;
  }
  if (!event) throw new Error(`Event ${eventIndex} not found`);
  if (isRest(event)) throw new Error("Cannot change pitch of a rest");
  if (!event.id) throw new Error(`Event at index ${eventIndex} has no id`);

  const firstNote = event.notes?.[0];
  if (!firstNote) throw new Error(`Event ${event.id} has no notes`);
  if (!firstNote.id) throw new Error(`First note of event ${event.id} has no id`);

  return [
    patch.setNotePitch(
      { sequencePath: { partId: part.id, measureIndex, voice }, eventId: event.id },
      firstNote.id,
      newPitch,
    ),
  ];
}

/**
 * Change the pitch of a note event. Returns a new Score (immutable).
 *
 * Internally: plans a `ScorePatch[]` and applies it via the Immer interpreter.
 * Once all commands are converted, the editor will route patches through both
 * the Score and Y-doc interpreters in live mode.
 */
export function changePitch(score: Score, params: ChangePitchParams): Score {
  return applyPatchesToScore(score, planChangePitch(score, params));
}

// ═══════════════════════════════════════════
// changeDuration (extracted to changeDurationCommand.ts)
// ═══════════════════════════════════════════
export { changeDuration } from "./changeDurationCommand";
import { changeDuration } from "./changeDurationCommand";

// ═══════════════════════════════════════════
// Chord/grace/backspace (extracted to chordGraceCommands.ts)
// ═══════════════════════════════════════════
export { addPitchToChord, findLastNoteEvent, addGraceNote, backspaceInNoteInput } from "./chordGraceCommands";

// ═══════════════════════════════════════════
// Helper: merge adjacent rests
// ═══════════════════════════════════════════

/** Merge adjacent rests into larger durations.
 *  Only merges if the combined rest is metrically clean (doesn't cross beat
 *  boundaries stronger than itself). Requires the time signature to do this
 *  correctly; if not provided, falls back to the legacy "single duration" rule.
 *  @param protectIndex - If set, the event at this index won't be merged with its neighbors. */
export function mergeAdjacentRests(
  sequence: Sequence,
  protectIndex?: number,
  ts?: import("@viritura/core").TimeSignature,
): void {
  let i = 0;
  while (i < sequence.content.length - 1) {
    if (protectIndex !== undefined && (i === protectIndex || i + 1 === protectIndex)) {
      i++;
      continue;
    }
    const curr = sequence.content[i]!;
    const next = sequence.content[i + 1]!;
    if (curr.type === "event" && next.type === "event" && isRest(curr) && isRest(next)) {
      const totalBeats = durationToBeats(curr.duration) + durationToBeats(next.duration);
      // Compute the start beat of `curr` to determine metric position.
      let startBeat = 0;
      for (let j = 0; j < i; j++) {
        startBeat += sequenceContentBeats(sequence.content[j]!);
      }
      const merged = ts ? decomposeRestsAtPosition(totalBeats, startBeat, ts) : decomposeDuration(totalBeats);
      if (merged.length === 1) {
        sequence.content.splice(i, 2, createRest(merged[0]!));
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
}
// ═══════════════════════════════════════════
// Slur and tie operations (extracted to slurTieCommands.ts)
// ═══════════════════════════════════════════
export {
  addSlur,
  addTie,
  removeTies,
  setTieProperties,
  setSlurProperties,
  findForwardSlurTargetId,
} from "./slurTieCommands";

// ═══════════════════════════════════════════
// Time signature + auto-tie (auto-tie extracted to autoTieCommands.ts)
// ═══════════════════════════════════════════

// Per-Score memoization for `getEffectiveTimeSignature`. The lookup walks
// `global.measures` backward from the queried index; on a score with the time
// signature declared once at measure 0, a query at measure N is O(N), and
// auto-tie/changeDuration paths call it many times per edit. WeakMap keyed
// off the score reference (which is immutable per edit thanks to
// `produce()`) lets us pay the full forward scan once and answer every later
// query in O(1) — without holding the score alive after it's replaced.
const TIME_SIG_CACHE = new WeakMap<Score, ({ count: number; unit: number } | null)[]>();
const DEFAULT_TIME_SIG = { count: 4, unit: 4 } as const;

function buildTimeSigTable(score: Score): ({ count: number; unit: number } | null)[] {
  const measures = score.global.measures;
  const table: ({ count: number; unit: number } | null)[] = new Array(measures.length);
  let active: { count: number; unit: number } | null = null;
  for (let i = 0; i < measures.length; i++) {
    const gm = measures[i];
    if (gm?.time) active = gm.time;
    table[i] = active;
  }
  return table;
}

/**
 * Resolve the effective time signature at a given measure index.
 * Walks backwards through global measures to find the most recent
 * time signature declaration. Defaults to 4/4 if none found.
 */
export function getEffectiveTimeSignature(score: Score, measureIndex: number): { count: number; unit: number } {
  let table = TIME_SIG_CACHE.get(score);
  if (!table) {
    table = buildTimeSigTable(score);
    TIME_SIG_CACHE.set(score, table);
  }
  const idx = Math.min(Math.max(measureIndex, 0), table.length - 1);
  return table[idx] ?? DEFAULT_TIME_SIG;
}

export { addNoteWithAutoTie } from "./autoTieCommands";
