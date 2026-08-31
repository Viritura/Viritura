/**
 * Pitch-ordered chord redistribution across a condensed multi-source staff.
 *
 * When a user enters a new pitch (Shift+letter) on a condensed staff with no
 * explicit routing override, we collect all existing pitches at that beat
 * across every source, add the new pitch, and reassign them top->bottom by
 * pitch height: source 0 receives the highest pitch, source 1 the next, etc.
 * Overflow (more pitches than sources) chord-stacks on the last source.
 *
 * This produces orchestral-natural divisi behavior: typing C then Shift+E
 * yields source 0 = E (top voice), source 1 = C (bottom voice).
 */

import type { Score, Pitch, Duration } from "@viritura/core";
import { isRest, pitchToMidi } from "@viritura/core";
import { addNoteWithAutoTie, generateNoteId } from "../commands/noteCommands";
import { durationToBeats } from "../commands/noteCommands";
import { produce } from "./scoreClone";

export interface RedistributeChordParams {
  /** Source-part indices in top->bottom display order (e.g. cs.sourcePartIndices). */
  sourcePartIndices: number[];
  /** Pitch the user just entered. */
  newPitch: Pitch;
  /** Duration of the new event (used to insert into rest slots). */
  duration: Duration;
  /** Measure of the chord beat. */
  measureIndex: number;
  /** Beat position (in quarter beats) of the chord. */
  beatPosition: number;
  /** Beats covered by the matched event (used to identify the slot uniquely). */
  beats: number;
}

interface SourceSlot {
  partIndex: number;
  /** Existing pitches at this slot in voice 0 (empty if rest/missing). */
  existingPitches: Pitch[];
  /** True if a matching event already exists at exactly (beatPosition, beats). */
  hasMatchingEvent: boolean;
}

/**
 * For each source part, find the voice-0 event at exactly `beatPosition` with
 * duration matching `beats` (within 1e-9). Returns its pitches (rest -> empty
 * array) and whether a matching event was found.
 */
function collectSlots(
  score: Score,
  sourcePartIndices: number[],
  measureIndex: number,
  beatPosition: number,
  beats: number,
): SourceSlot[] {
  const slots: SourceSlot[] = [];
  for (const pi of sourcePartIndices) {
    const sseq = score.parts[pi]?.measures[measureIndex]?.sequences[0];
    if (!sseq) {
      slots.push({ partIndex: pi, existingPitches: [], hasMatchingEvent: false });
      continue;
    }
    let acc = 0;
    let matched: SourceSlot | null = null;
    for (const ev of sseq.content) {
      if (ev.type !== "event") continue;
      const evBeats = durationToBeats(ev.duration);
      if (Math.abs(acc - beatPosition) < 1e-9 && Math.abs(evBeats - beats) < 1e-9) {
        const pitches = isRest(ev) ? [] : (ev.notes ?? []).map((n) => n.pitch);
        matched = { partIndex: pi, existingPitches: pitches, hasMatchingEvent: true };
        break;
      }
      if (acc > beatPosition + 1e-9) break;
      acc += evBeats;
    }
    slots.push(matched ?? { partIndex: pi, existingPitches: [], hasMatchingEvent: false });
  }
  return slots;
}

/**
 * Compute the pitch->source assignment without mutating any score.
 *
 * Pool = (all existing pitches across slots) + newPitch, sorted descending.
 * Top source gets pool[0], next gets pool[1], etc. The LAST source receives
 * any overflow as a chord (so a 4-note pool on 2 sources gives [0]->src0,
 * [1..3]->src1).
 *
 * Empty assignments mean that source's event becomes a rest.
 */
export function computeChordAssignments(
  slots: readonly { existingPitches: readonly Pitch[] }[],
  newPitch: Pitch,
): Pitch[][] {
  const pool: Pitch[] = [];
  for (const s of slots) for (const p of s.existingPitches) pool.push(p);
  pool.push(newPitch);
  pool.sort((a, b) => pitchToMidi(b) - pitchToMidi(a));

  const lastIdx = slots.length - 1;
  return slots.map((_, si) => (si < lastIdx ? (pool[si] ? [pool[si]!] : []) : pool.slice(lastIdx)));
}

/**
 * Apply the pitch-ordered redistribute model to `score` and return a new
 * score. For sources with no matching event yet (slot covered by a longer
 * rest or missing entirely), uses `addNoteWithAutoTie` to insert/decompose
 * first, then mutates the resulting event's notes to hold exactly the
 * assigned pitches.
 */
export function redistributeChordAcrossSources(score: Score, params: RedistributeChordParams): Score {
  const { sourcePartIndices, newPitch, duration, measureIndex, beatPosition, beats } = params;

  const slots = collectSlots(score, sourcePartIndices, measureIndex, beatPosition, beats);
  const assignments = computeChordAssignments(slots, newPitch);

  let result = score;

  // Insert events for sources that don't yet have a matching slot at this
  // beat. We use addNoteWithAutoTie so rest decomposition is handled for us.
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si]!;
    const assigned = assignments[si]!;
    if (!slot.hasMatchingEvent && assigned.length > 0) {
      result = addNoteWithAutoTie(result, {
        pitch: assigned[0]!,
        duration,
        measureIndex,
        partIndex: slot.partIndex,
        voice: 0,
        beatPosition,
        staffNumber: 1,
      });
    }
  }

  // Now overwrite every slot's event at (beatPosition, beats) with exactly
  // the assigned pitches (or convert to rest if no assignment).
  result = produce(result, (draft) => {
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si]!;
      const assigned = assignments[si]!;
      const dseq = draft.parts[slot.partIndex]?.measures[measureIndex]?.sequences[0];
      if (!dseq) continue;
      let acc = 0;
      for (const ev of dseq.content) {
        if (ev.type !== "event") continue;
        const evBeats = durationToBeats(ev.duration);
        if (Math.abs(acc - beatPosition) < 1e-9 && Math.abs(evBeats - beats) < 1e-9) {
          if (assigned.length === 0) {
            delete (ev as { notes?: unknown }).notes;
            (ev as { rest?: object }).rest = {};
          } else {
            delete (ev as { rest?: unknown }).rest;
            (ev as { notes: { id: string; pitch: Pitch }[] }).notes = assigned.map((p) => ({
              id: generateNoteId(),
              pitch: { ...p },
            }));
          }
          break;
        }
        if (acc > beatPosition + 1e-9) break;
        acc += evBeats;
      }
    }
  });

  return result;
}
