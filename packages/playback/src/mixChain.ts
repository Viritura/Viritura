/**
 * Mix-chain constants and stage formulas shared by live Web Audio playback
 * and offline audio export, so both render the same balance and room.
 */

import { DEFAULT_LISTENER_POSITION, type BiquadSpec, type SpatialPosition } from "@viritura/audio";
import { PAN_RANGE } from "./playbackReducer";

/**
 * EQ color buses assigned round-robin to orchestra sections so adjacent
 * sections get subtly distinct tonal colors without per-part EQ.
 *
 * Bus 0: Neutral (passthrough)
 * Bus 1: Slightly bright: high-shelf +1.5 dB @ 3 kHz
 * Bus 2: Slightly warm: low-shelf +1 dB @ 300 Hz, high-shelf -1 dB @ 4 kHz
 * Bus 3: Slightly nasal: peaking +2 dB @ 1.2 kHz, Q 1.5
 */
export const EQ_COLOR_BUS_FILTERS: readonly (readonly BiquadSpec[])[] = [
  [],
  [{ type: "highshelf", frequency: 3000, gain: 1.5 }],
  [
    { type: "lowshelf", frequency: 300, gain: 1 },
    { type: "highshelf", frequency: 4000, gain: -1 },
  ],
  [{ type: "peaking", frequency: 1200, gain: 2, Q: 1.5 }],
];

/** Master air EQ: a gentle high-shelf that adds presence to GM instruments. */
export const AIR_EQ_FREQUENCY = 8000;

/** Fixed master limiter envelope (threshold and ratio come from mixer settings). */
export const LIMITER_KNEE_DB = 6;
export const LIMITER_ATTACK_SECONDS = 0.002;
export const LIMITER_RELEASE_SECONDS = 0.18;

/**
 * Initial pan for a profile ensemble layer seated at its stage offset. Saved
 * mixer layer pans replace it; the part's mixer pan does not shift it.
 */
export function profileLayerPan(partX: number, stageOffsetX: number): number {
  return Math.max(-1, Math.min(1, (partX + stageOffsetX - DEFAULT_LISTENER_POSITION.x) / PAN_RANGE));
}

/** Distance from a section centroid to the listener. */
export function sectionListenerDistance(position: SpatialPosition, listener: SpatialPosition): number {
  return Math.hypot(position.x - listener.x, position.y - listener.y);
}

/** Farther sections sound wetter: the reverb send grows with distance. */
export function sectionReverbSend(distance: number): number {
  return Math.max(0.05, Math.min(0.9, 0.05 + distance * 0.075));
}

/**
 * Reverb pre-delay of 3 ms/m, capped at 40 ms. Front desks: ~0 ms (in your
 * face); back of stage at 12-14 m: ~36-40 ms (sits behind the room).
 */
export function sectionPredelaySeconds(distance: number): number {
  return Math.min(0.04, distance * 0.003);
}
