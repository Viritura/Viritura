import type { Score, Sequence } from "@viritura/core";
import { ensureLaneSequence, laneSequenceIndex } from "./voiceLanes";

/**
 * A voice lane on a particular staff. Unlike a sequence index, a lane is
 * meaningful in every measure, so code that walks across barlines (cursor
 * travel, chord targeting, end-of-content search) should carry one of these
 * and resolve it afresh in each bar.
 */
export interface LaneRef {
  readonly lane: number;
  /** 1-based staff within the part. Defaults to 1. */
  readonly staff?: number;
}

/**
 * Either a raw sequence index — valid only in the measure it was read from —
 * or a lane, which is resolved per measure.
 */
export type VoiceTarget = number | LaneRef;

function isLaneRef(target: VoiceTarget): target is LaneRef {
  return typeof target === "object";
}

/** Sequence index for `target` within one measure's sequences, if present. */
export function resolveVoiceTarget(sequences: readonly Sequence[], target: VoiceTarget): number | undefined {
  if (!isLaneRef(target)) return target < sequences.length ? target : undefined;
  return laneSequenceIndex(sequences, target.lane, target.staff ?? 1);
}

/** The sequence `target` names in a given measure, if that measure has one. */
export function sequenceAt(
  score: Score,
  partIndex: number,
  measureIndex: number,
  target: VoiceTarget,
): Sequence | undefined {
  const sequences = score.parts[partIndex]?.measures[measureIndex]?.sequences;
  if (!sequences) return undefined;
  const index = resolveVoiceTarget(sequences, target);
  return index === undefined ? undefined : sequences[index];
}

/**
 * Find or create the sequence for `lane` in one measure of a draft score and
 * return its index. Creation stamps the lane's `voice` name and
 * `directionHint`, so every entry path produces sequences the lane model and
 * the engraver can both identify. Mutates `draft`.
 */
export function prepareLaneSequence(draft: Score, partIndex: number, measureIndex: number, lane: LaneRef): number {
  const sequences = draft.parts[partIndex]?.measures[measureIndex]?.sequences;
  if (!sequences) return lane.lane - 1;
  return ensureLaneSequence(sequences, lane.lane, lane.staff);
}

/**
 * Run `write` against the lane's sequence, creating it first if the bar lacks
 * one. If `write` throws, a sequence created here is removed again before the
 * error propagates, so a rejected edit (e.g. a tuplet that does not fit) never
 * leaves an empty voice behind. Mutates `draft`.
 */
export function writeToLane(
  draft: Score,
  partIndex: number,
  measureIndex: number,
  lane: LaneRef,
  write: (sequenceIndex: number) => void,
): void {
  const sequences = draft.parts[partIndex]?.measures[measureIndex]?.sequences;
  const before = sequences?.length ?? 0;
  const sequenceIndex = prepareLaneSequence(draft, partIndex, measureIndex, lane);
  try {
    write(sequenceIndex);
  } catch (error) {
    if (sequences && sequences.length > before) sequences.splice(before);
    throw error;
  }
}
