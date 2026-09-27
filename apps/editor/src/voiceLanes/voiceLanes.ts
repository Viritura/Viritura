import type { Sequence } from "@viritura/core";

/**
 * Voice lanes — the editor's stable notion of "which voice am I writing in".
 *
 * MNX gives a part measure an array of sequences with no cross-measure
 * identity: slot N in one bar need not be the same musical line as slot N in
 * the next, and bars may carry different numbers of sequences. A lane is the
 * editor-side identity that survives those changes. Lanes are directional, in
 * the manner of up-stem/down-stem voices: the lane's direction *is* its
 * `sequence.directionHint`, so choosing a lane states intent the engraver can
 * act on rather than relying on array position.
 *
 * Lanes are numbered so the familiar Alt+1..4 shortcuts keep their muscle
 * memory — odd numbers are up-stem, even are down-stem:
 *
 *   1 = Up 1, 2 = Down 1, 3 = Up 2, 4 = Down 2, …
 */

type LaneDirection = "up" | "down";

export interface VoiceLane {
  /** 1-based lane number, the value stored as `noteInput.currentVoice`. */
  readonly number: number;
  readonly direction: LaneDirection;
  /** 1-based ordinal within the direction (Up **2**). */
  readonly ordinal: number;
  /** `sequence.voice` written onto sequences the editor creates for this lane. */
  readonly name: string;
  /** `sequence.directionHint` written for this lane. */
  readonly hint: "upper" | "lower";
  /** Human label, e.g. "Up 1". */
  readonly label: string;
}

export function voiceLane(laneNumber: number): VoiceLane {
  const number = Math.max(1, Math.trunc(laneNumber));
  const direction: LaneDirection = number % 2 === 1 ? "up" : "down";
  const ordinal = Math.ceil(number / 2);
  return {
    number,
    direction,
    ordinal,
    name: `${direction}${ordinal}`,
    hint: direction === "up" ? "upper" : "lower",
    label: `${direction === "up" ? "Up" : "Down"} ${ordinal}`,
  };
}

function laneNumberFor(direction: LaneDirection, ordinal: number): number {
  return direction === "up" ? ordinal * 2 - 1 : ordinal * 2;
}

const LANE_NAME = /^(up|down)([1-9]\d*)$/;

function laneNumberFromName(name: string | undefined): number | undefined {
  const match = name ? LANE_NAME.exec(name) : null;
  if (!match) return undefined;
  return laneNumberFor(match[1] as LaneDirection, Number(match[2]));
}

/**
 * Whether a sequence belongs to the given staff. When no sequence in the
 * measure declares a staff (the single-staff case) every sequence does.
 */
function onStaff(sequences: readonly Sequence[], staffNumber: number): (sequence: Sequence) => boolean {
  if (!sequences.some((sequence) => sequence.staff != null)) return () => true;
  return (sequence) => (sequence.staff ?? 1) === staffNumber;
}

/**
 * Assign every sequence on a staff to a lane, returning `laneNumber → index`.
 *
 * Resolution runs strongest evidence first so imported and hand-authored MNX
 * both land sensibly:
 *   1. an editor lane name (`voice: "down1"`) claims its lane outright;
 *   2. a `directionHint` claims the next free lane of that direction, in
 *      array order — so imported `upper`/`lower` voices need no renaming;
 *   3. unhinted sequences fill the remaining lanes in lane order, which for
 *      legacy two-voice bars reproduces the old "slot 0 up, slot 1 down" rule.
 */
export function assignLanes(sequences: readonly Sequence[], staffNumber = 1): Map<number, number> {
  const belongs = onStaff(sequences, staffNumber);
  const lanes = new Map<number, number>();
  const unassigned: number[] = [];

  sequences.forEach((sequence, index) => {
    if (!belongs(sequence)) return;
    const named = laneNumberFromName(sequence.voice);
    if (named !== undefined && !lanes.has(named)) lanes.set(named, index);
    else unassigned.push(index);
  });

  const unhinted: number[] = [];
  const nextOrdinal: Record<LaneDirection, number> = { up: 1, down: 1 };
  for (const index of unassigned) {
    const hint = sequences[index]!.directionHint;
    if (hint !== "upper" && hint !== "lower") {
      unhinted.push(index);
      continue;
    }
    const direction: LaneDirection = hint === "upper" ? "up" : "down";
    while (lanes.has(laneNumberFor(direction, nextOrdinal[direction]))) nextOrdinal[direction]++;
    lanes.set(laneNumberFor(direction, nextOrdinal[direction]), index);
  }

  let lane = 1;
  for (const index of unhinted) {
    while (lanes.has(lane)) lane++;
    lanes.set(lane, index);
  }
  return lanes;
}

/** Index of the sequence holding `laneNumber` on a staff, if the bar has one. */
export function laneSequenceIndex(
  sequences: readonly Sequence[],
  laneNumber: number,
  staffNumber = 1,
): number | undefined {
  return assignLanes(sequences, staffNumber).get(laneNumber);
}

/** The lane a given sequence occupies — the inverse of `laneSequenceIndex`. */
export function laneOfSequence(sequences: readonly Sequence[], sequenceIndex: number): number | undefined {
  const sequence = sequences[sequenceIndex];
  if (!sequence) return undefined;
  for (const [lane, index] of assignLanes(sequences, sequence.staff ?? 1)) {
    if (index === sequenceIndex) return lane;
  }
  return undefined;
}

/**
 * Find or create the sequence for a lane, returning its index. A created
 * sequence carries the lane's name and hint, so the lane stays identifiable in
 * later bars and the engraver knows which side it belongs on. Mutates
 * `sequences`; call on a draft.
 *
 * `staffNumber` is written only when given, matching how the rest of the
 * editor sets `sequence.staff` only for multi-staff parts.
 */
export function ensureLaneSequence(sequences: Sequence[], laneNumber: number, staffNumber?: number): number {
  const existing = laneSequenceIndex(sequences, laneNumber, staffNumber ?? 1);
  if (existing !== undefined) return existing;
  const lane = voiceLane(laneNumber);
  const created: Sequence = { content: [], voice: lane.name, directionHint: lane.hint };
  if (staffNumber != null) created.staff = staffNumber;
  sequences.push(created);
  return sequences.length - 1;
}
