import type { Barline as RawBarline } from "../raw";
import type { BarlineType } from "../enums";
import type { Narrow } from "./_derive";

/**
 * Barline definition. Derived from MNX raw `barline`, with the `type`
 * enum extended to cover repeat barlines (`repeat-start`, `repeat-end`,
 * `repeat-both`) that the parser synthesises by folding raw `repeat-start`
 * and `repeat-end` objects into the barline at the same position.
 */
export type Barline = Narrow<RawBarline, { type: BarlineType }>;
