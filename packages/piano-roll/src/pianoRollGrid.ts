/**
 * Pure geometry helpers for the piano roll.
 *
 * The roll has two axes:
 *
 *   - X = pitch. Each MIDI note has a `KeyBounds` (x, width) computed
 *     from the white-key/black-key layout. Black keys are narrower
 *     (60% of a white-key cell) and centred on the boundary between
 *     their two adjacent white keys, the way physical piano keys are
 *     laid out.
 *   - Y = time. The playhead sits at the bottom of the canvas; future
 *     notes are higher up and fall toward the bottom as time advances.
 *
 * All math is closed over a `PianoRollViewport` (pitch range +
 * `secondsAhead`) and the current canvas size. No React, no DOM —
 * trivially unit-testable.
 */

import type { PianoRollGrid, PianoRollViewport } from "./types";

/** Standard piano range. Used for clamping and default viewport bounds. */
export const MIN_MIDI = 21; // A0
export const MAX_MIDI = 108; // C8

/** Pixel positioning for a single key on the horizontal keyboard. */
export interface KeyBounds {
  /** Left edge of the key, in pixels. */
  readonly x: number;
  /** Width of the key in pixels. */
  readonly width: number;
}

/** Black-key width relative to a white-key cell. Tuned to feel piano-like. */
const BLACK_KEY_WIDTH_RATIO = 0.6;

/** True if `midi` falls on a black key (C#, D#, F#, G#, A#). */
export function isBlackKey(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

/** True if `midi` falls on a white key. */
export function isWhiteKey(midi: number): boolean {
  return !isBlackKey(midi);
}

/** Count how many white keys exist in `[minMidi..maxMidi]` (inclusive). */
function countWhiteKeys(minMidi: number, maxMidi: number): number {
  let n = 0;
  for (let m = minMidi; m <= maxMidi; m++) if (isWhiteKey(m)) n++;
  return n;
}

/**
 * Precompute `KeyBounds` for every MIDI note in the viewport. Useful
 * when the renderer or the keyboard strip needs to look up many keys
 * against the same layout (typical case).
 */
export function buildKeyLayout(viewport: PianoRollViewport, widthPx: number): ReadonlyMap<number, KeyBounds> {
  const totalWhite = countWhiteKeys(viewport.minMidi, viewport.maxMidi);
  const whiteW = widthPx / Math.max(1, totalWhite);
  const blackW = whiteW * BLACK_KEY_WIDTH_RATIO;
  const out = new Map<number, KeyBounds>();
  let nextWhiteIdx = 0;
  for (let m = viewport.minMidi; m <= viewport.maxMidi; m++) {
    if (isWhiteKey(m)) {
      out.set(m, { x: nextWhiteIdx * whiteW, width: whiteW });
      nextWhiteIdx++;
    } else {
      const leftWhiteIdx = nextWhiteIdx - 1;
      const boundaryX = (leftWhiteIdx + 1) * whiteW;
      out.set(m, { x: boundaryX - blackW / 2, width: blackW });
    }
  }
  return out;
}

/**
 * Map a score-time to a Y pixel coordinate, given the playhead.
 *
 *   - `time === playheadSeconds`            → y = heightPx (bottom edge)
 *   - `time === playheadSeconds + ahead`    → y = 0        (top edge)
 *   - `time < playheadSeconds`              → y > heightPx (past — clipped)
 */
export function timeToY(
  timeSeconds: number,
  playheadSeconds: number,
  viewport: PianoRollViewport,
  heightPx: number,
): number {
  const pxPerSec = heightPx / Math.max(0.001, viewport.secondsAhead);
  return heightPx - (timeSeconds - playheadSeconds) * pxPerSec;
}

/** Inverse of `timeToY`. Useful for future hit-testing. */
export function yToTime(y: number, playheadSeconds: number, viewport: PianoRollViewport, heightPx: number): number {
  const pxPerSec = heightPx / Math.max(0.001, viewport.secondsAhead);
  return playheadSeconds + (heightPx - y) / pxPerSec;
}

/**
 * Snap a beat position to the nearest grid step.
 *
 * Unused by the read-only renderer; defined now so future gesture code
 * doesn't need to introduce its own snap convention.
 */
export function snapBeatToGrid(beatQuarters: number, grid: PianoRollGrid): number {
  return Math.round(beatQuarters / grid.stepQuarters) * grid.stepQuarters;
}
