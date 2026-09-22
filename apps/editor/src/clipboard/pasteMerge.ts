/**
 * Paste-and-merge: add pasted pitches to the destination chords instead of
 * replacing them.
 *
 * This is the manual counterpart to a staff reduction. The ordinary paste path
 * already knows how to place content at the right staff, voice, and beat, so
 * merging runs *after* it: for every event the paste placed, the event the
 * destination had at that exact position is folded back in. Positions where the
 * destination rhythm disagrees keep the pasted rhythm — a merge must never
 * invent a rhythmic reconciliation the user did not ask for.
 */

import { isRest, type Score, type Sequence, type SequenceContent } from "@viritura/core";
import { sequenceContentBeats } from "../commands/noteCommands";
import { mergeNotesIntoEvent } from "../score/chordDistribution";
import { voiceIndexWithinStaff } from "./clipboardTrackMapping";

const EPSILON = 1e-9;

export interface PasteMergeOutcome {
  /** Events that absorbed destination pitches. */
  merged: number;
  /** Events whose destination position held music the merge could not align to. */
  unaligned: number;
}

/** The sequence in `score` holding the given staff's nth voice, if any. */
function sequenceForTrack(
  score: Score,
  partIndex: number,
  measureIndex: number,
  staff: number,
  voice: number,
): Sequence | undefined {
  const sequences = score.parts[partIndex]?.measures[measureIndex]?.sequences ?? [];
  return sequences.filter((sequence) => (sequence.staff ?? 1) === staff)[voice];
}

/** The top-level event starting at `beat` with a matching length, if any. */
function eventAtBeat(sequence: Sequence, beat: number, beats: number): SequenceContent | undefined {
  let position = 0;
  for (const item of sequence.content) {
    const itemBeats = sequenceContentBeats(item);
    if (Math.abs(position - beat) < EPSILON) {
      return Math.abs(itemBeats - beats) < EPSILON ? item : undefined;
    }
    if (position > beat + EPSILON) return undefined;
    position += itemBeats;
  }
  return undefined;
}

/** Fold `source`'s chords into whichever of `sequence`'s events the paste placed. */
function mergeSequence(
  sequence: Sequence,
  source: Sequence | undefined,
  placedSet: ReadonlySet<SequenceContent>,
  outcome: PasteMergeOutcome,
): void {
  let beat = 0;
  for (const item of sequence.content) {
    const beats = sequenceContentBeats(item);
    if (placedSet.has(item) && item.type === "event" && source && !source.fullMeasure) {
      const destination = eventAtBeat(source, beat, beats);
      if (!destination) outcome.unaligned++;
      else if (destination.type === "event" && !isRest(destination)) {
        if (mergeNotesIntoEvent(item, destination.notes ?? [])) outcome.merged++;
      }
    }
    beat += beats;
  }
}

/**
 * Fold the pre-paste content of `previous` back into the events `placed` wrote
 * into `next`. Mutates `next` in place and reports what happened.
 */
export function mergeDestinationIntoPaste(
  previous: Score,
  next: Score,
  placed: readonly SequenceContent[],
): PasteMergeOutcome {
  const placedSet = new Set(placed);
  const outcome: PasteMergeOutcome = { merged: 0, unaligned: 0 };
  if (placedSet.size === 0) return outcome;

  for (const [partIndex, part] of next.parts.entries()) {
    for (const [measureIndex, measure] of part.measures.entries()) {
      for (const [sequenceIndex, sequence] of measure.sequences.entries()) {
        const staff = sequence.staff ?? 1;
        const voice = voiceIndexWithinStaff(next, partIndex, measureIndex, sequenceIndex);
        mergeSequence(sequence, sequenceForTrack(previous, partIndex, measureIndex, staff, voice), placedSet, outcome);
      }
    }
  }
  return outcome;
}

/** Human-readable warnings for a merge outcome, or an empty list when it was clean. */
export function pasteMergeWarnings(outcome: PasteMergeOutcome): string[] {
  if (outcome.unaligned === 0) return [];
  const events = outcome.unaligned === 1 ? "1 position" : `${outcome.unaligned} positions`;
  return [`${events} had a different rhythm in the destination and kept the pasted notes.`];
}
