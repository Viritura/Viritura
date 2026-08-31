/**
 * Slur legato — connects notes under a slur by overlapping their releases.
 *
 * Splits into two phases:
 *  1. A pre-scan (`collectPartLegatoOut`) marks every event id that is interior
 *     to a slur span (covered by a slur and followed by another note still
 *     under it). The slur's final note is excluded — it takes a normal release.
 *  2. At emit time the timeline defers an interior note's `noteOff` and resolves
 *     it against the next note's onset (`resolveLegato`), or flushes it at its
 *     natural time when no next note follows (`flushLegatoNatural`).
 */

import type { Note, NoteEvent, Score, SequenceContent } from "@viritura/core";
import { pitchToMidi } from "@viritura/core";
import type { MidiEvent } from "./types";
import type { TempoModel } from "./tempoModel";
import { timingHumanize } from "./dynamics";

/**
 * Legato overlap for slurred notes, in seconds. An interior slur note's release
 * is pushed just past the next note's onset so the two voices briefly overlap —
 * the next attack masks the previous release, reading as a connected (legato)
 * line rather than re-articulated détaché notes. Standard performance practice:
 * notes under a slur are played without separation. The overlap is capped to
 * the next note's own duration (see `resolveLegato`) so the overhang can never
 * reach the note after it.
 */
const LEGATO_OVERLAP_SEC = 0.02;

/**
 * Flatten a voice's content into an ordered list of note events, recursing into
 * tuplets and unwrapping grace/tremolo containers. The order matches the
 * notated reading order, which is what "interior to a slur span" is defined
 * against.
 */
function collectVoiceEvents(content: readonly SequenceContent[], out: NoteEvent[]): void {
  for (const item of content) {
    if (item.type === "event") {
      out.push(item);
    } else if (item.type === "tuplet") {
      collectVoiceEvents(item.content, out);
    } else if (item.type === "grace") {
      for (const evt of item.content) out.push(evt);
    } else if (item.type === "tremolo") {
      for (const evt of item.content) out.push(evt);
    }
  }
}

/**
 * Pre-scan a part to collect every event id that is *interior* to a slur span —
 * i.e. covered by a slur and followed by another note still under that slur.
 * These events are played legato: their release overlaps the next note's onset.
 * The slur's final note is excluded (it takes a normal, articulated release).
 *
 * Events are grouped by voice (so a slur only connects notes within its own
 * voice) and scanned in score order. Repeats are not expanded: ids are unique
 * in the source, and an interior id stays interior on every repeat pass.
 */
export function collectPartLegatoOut(part: Score["parts"][number]): Set<string> {
  const voices = new Map<string, NoteEvent[]>();
  for (const partMeasure of part.measures) {
    if (!partMeasure) continue;
    partMeasure.sequences.forEach((seq, seqIdx) => {
      const voiceKey = seq.voice ?? `#${seqIdx}`;
      let list = voices.get(voiceKey);
      if (!list) {
        list = [];
        voices.set(voiceKey, list);
      }
      collectVoiceEvents(seq.content, list);
    });
  }

  const legatoOut = new Set<string>();
  for (const events of voices.values()) {
    const indexById = new Map<string, number>();
    events.forEach((evt, i) => {
      if (evt.id) indexById.set(evt.id, i);
    });
    events.forEach((evt, startIdx) => {
      if (!evt.slurs) return;
      for (const slur of evt.slurs) {
        const endIdx = slur.target ? indexById.get(slur.target) : undefined;
        if (endIdx === undefined || endIdx <= startIdx) continue;
        // Mark every event from the slur start up to (not including) its end.
        for (let i = startIdx; i < endIdx; i++) {
          const id = events[i]!.id;
          if (id) legatoOut.add(id);
        }
      }
    });
  }
  return legatoOut;
}

/** Collect the in-range MIDI notes of an event into a set. */
function midiNotesOf(notes: readonly Note[]): Set<number> {
  const set = new Set<number>();
  for (const note of notes) {
    const m = pitchToMidi(note.pitch);
    if (m >= 0 && m <= 127) set.add(m);
  }
  return set;
}

/**
 * Resolve all deferred legato noteOffs against the next note's onset.
 *
 * - Distinct pitch: release overlaps the next attack by `LEGATO_OVERLAP_SEC`,
 *   capped to the next note's own duration so the overhang ends within that
 *   note and never reaches the note after it.
 * - Repeated pitch (same MIDI note): no overlap — release exactly at the next
 *   onset. Overlapping a note with itself would steal/cut the voice; a gapless
 *   release-then-attack instead re-articulates the repeated note cleanly.
 */
function resolveLegato(
  pendingLegato: MidiEvent[],
  out: MidiEvent[],
  nextOnset: number,
  nextDurationSec: number,
  nextNotes: readonly Note[],
): void {
  const nextMidi = midiNotesOf(nextNotes);
  const overlap = Math.min(LEGATO_OVERLAP_SEC, Math.max(0, nextDurationSec));
  for (const off of pendingLegato) {
    off.time = nextMidi.has(off.midiNote) ? nextOnset : nextOnset + overlap;
    out.push(off);
  }
  pendingLegato.length = 0;
}

/**
 * Flush deferred legato noteOffs at their natural (un-extended) time. Used when
 * the slur runs into a rest or the end of the part — there is no next note to
 * overlap, so the note releases as written.
 */
function flushLegatoNatural(pendingLegato: MidiEvent[], out: MidiEvent[]): void {
  for (const off of pendingLegato) out.push(off);
  pendingLegato.length = 0;
}

// ═══════════════════════════════════════════
// Per-voice deferral buckets
// ═══════════════════════════════════════════
//
// A part's deferred legato offs are bucketed BY VOICE so a slur in one voice
// isn't resolved (or stolen) by a note in another — critical for multi-voice
// parts like piano where two hands share pitches.

/** Append a deferred legato off to its voice's bucket (created on demand). */
export function pushVoiceLegato(map: Map<string, MidiEvent[]>, voiceKey: string, off: MidiEvent): void {
  const bucket = map.get(voiceKey);
  if (bucket) bucket.push(off);
  else map.set(voiceKey, [off]);
}

/** Flush one voice's deferred legato offs at their natural time (rest boundary). */
export function flushVoiceLegato(map: Map<string, MidiEvent[]>, voiceKey: string, out: MidiEvent[]): void {
  const bucket = map.get(voiceKey);
  if (bucket) flushLegatoNatural(bucket, out);
}

/** Flush every voice's remaining deferred legato offs (end of part). */
export function flushAllLegato(map: Map<string, MidiEvent[]>, out: MidiEvent[]): void {
  for (const bucket of map.values()) flushLegatoNatural(bucket, out);
}

/** Args for `resolveVoiceLegato` — the current voice's deferred offs against the next onset. */
export interface ResolveVoiceLegatoArgs {
  map: Map<string, MidiEvent[]>;
  voiceKey: string;
  out: MidiEvent[];
  /** Continuous tempo model (timing source). */
  model: TempoModel;
  /** Global beat at the current measure's start. */
  measureStartBeat: number;
  partIndex: number;
  /** Measure-start time (seconds) — used only as the deterministic jitter seed. */
  measureStartTime: number;
  beatOffset: number;
  beats: number;
  notes: readonly Note[];
}

/**
 * Resolve the current voice's deferred legato offs against the event at
 * (`measureStartBeat + beatOffset`). No-op when that voice has nothing pending.
 * The onset uses the same jittered formula as the noteOn so the overlap is exact.
 */
export function resolveVoiceLegato(a: ResolveVoiceLegatoArgs): void {
  const bucket = a.map.get(a.voiceKey);
  if (!bucket || bucket.length === 0) return;
  const onset = Math.max(
    0,
    a.model.timeAtBeat(a.measureStartBeat + a.beatOffset) +
      timingHumanize(a.measureStartTime, a.beatOffset, a.partIndex),
  );
  const nextDur = a.model.secondsForBeats(a.measureStartBeat + a.beatOffset, a.beats);
  resolveLegato(bucket, a.out, onset, nextDur, a.notes);
}
