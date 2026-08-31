import type { Time as RawTime } from "../raw";
import type { Narrow } from "./_derive";

/**
 * Time signature. Derived from MNX raw `time`, with the `display` enum
 * extended to cover `"senzaMisura"` and `"note"` — Viritura-specific
 * display modes the parser produces from vendor extensions.
 *
 * Field naming preserved: raw `count` (numerator), `unit` (denominator).
 */
export type TimeSignature = Narrow<
  RawTime,
  {
    /** Beat unit: 1, 2, 4, 8, 16, 32, 64, 128. Kept as `number` rather than
     *  the raw narrow union so editor/UI callers that compute units
     *  numerically type-check without per-call widening casts. */
    unit: number;
    display?: "common" | "cut" | "senzaMisura" | "note";
  }
>;

/**
 * Compute the total number of quarter-note beats in a measure with this time sig.
 */
export function measureBeats(ts: TimeSignature): number {
  return (ts.count * 4) / ts.unit;
}
