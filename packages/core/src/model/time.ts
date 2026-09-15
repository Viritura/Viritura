import type { Time as RawTime } from "../raw";
import type { HoistVendor, Narrow } from "./_derive";

/**
 * How a meter's beat grouping is presented, independent of the semantic
 * {@link TimeSignatureExtensions.beatStructure} it is derived from.
 *
 * `"standard"` engraves an ordinary numeric (or symbolic) meter with no
 * grouping decoration. `"additive"` and `"annotation"` are only ever
 * engraved for a meter whose resolved beat structure is structurally
 * non-default and has more than one group; see {@link resolveGroupingDisplay}.
 */
export type GroupingDisplay = "standard" | "additive" | "annotation";

export interface TimeSignatureExtensions {
  /** Ordered beat-group lengths in units of the time-signature denominator. */
  beatStructure?: number[];
  /**
   * Explicit per-occurrence grouping-display override for this time
   * signature. Forces the named mode regardless of the document's house
   * style, subject only to the symbolic-display/single-group safety
   * fallback in {@link resolveGroupingDisplay}.
   */
  groupingDisplay?: GroupingDisplay;
}

/**
 * Time signature. Derived from MNX raw `time`, with the `display` enum
 * extended to cover `"senzaMisura"` and `"note"` — Viritura-specific
 * display modes the parser produces from vendor extensions.
 *
 * Field naming preserved: raw `count` (numerator), `unit` (denominator).
 */
export type TimeSignature = HoistVendor<
  Narrow<
    RawTime,
    {
      /** Beat unit: 1, 2, 4, 8, 16, 32, 64, 128. Kept as `number` rather than
       *  the raw narrow union so editor/UI callers that compute units
       *  numerically type-check without per-call widening casts. */
      unit: number;
      display?: "common" | "cut" | "senzaMisura" | "note";
    }
  >,
  TimeSignatureExtensions
>;

/**
 * Compute the total number of quarter-note beats in a measure with this time sig.
 */
export function measureBeats(ts: TimeSignature): number {
  return (ts.count * 4) / ts.unit;
}

export interface ResolvedMeter {
  count: number;
  unit: number;
  /** Ordered beat-group lengths in denominator units. */
  beatStructure: number[];
  /** Beat-group boundaries in quarter-note beats, including measure start and end. */
  beatBoundaries: number[];
  source: "authored" | "default";
}

const IRREGULAR_EIGHTH_DEFAULTS: Readonly<Record<number, readonly number[]>> = {
  5: [3, 2],
  7: [2, 2, 3],
  8: [3, 3, 2],
};

export function defaultBeatStructure(count: number, unit: number): number[] {
  assertValidTimeSignature(count, unit);
  const irregularShortMeter = unit >= 8 ? IRREGULAR_EIGHTH_DEFAULTS[count] : undefined;
  if (irregularShortMeter) return [...irregularShortMeter];
  if (count % 3 === 0 && (unit >= 8 || count > 3)) {
    return Array.from({ length: count / 3 }, () => 3);
  }
  if (unit >= 8) {
    const quarterUnits = unit / 4;
    const groups: number[] = [];
    for (let remaining = count; remaining > 0; remaining -= quarterUnits) {
      groups.push(Math.min(quarterUnits, remaining));
    }
    return groups;
  }
  return Array.from({ length: count }, () => 1);
}

export function resolveMeter(time: TimeSignature): ResolvedMeter {
  assertValidTimeSignature(time.count, time.unit);

  const authored = time.beatStructure;
  if (
    authored &&
    (authored.length === 0 ||
      authored.some((group) => !Number.isInteger(group) || group <= 0) ||
      authored.reduce((sum, group) => sum + group, 0) !== time.count)
  ) {
    throw new RangeError("Time-signature beatStructure must contain positive integers that sum to count");
  }

  const beatStructure = authored ? [...authored] : defaultBeatStructure(time.count, time.unit);
  const beatBoundaries = [0];
  for (const group of beatStructure) {
    beatBoundaries.push(beatBoundaries[beatBoundaries.length - 1]! + (group * 4) / time.unit);
  }
  return {
    count: time.count,
    unit: time.unit,
    beatStructure,
    beatBoundaries,
    source: authored ? "authored" : "default",
  };
}

function assertValidTimeSignature(count: number, unit: number): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError("Time-signature count must be a positive integer");
  }
  if (![1, 2, 4, 8, 16, 32, 64, 128].includes(unit)) {
    throw new RangeError("Time-signature unit must be a supported power-of-two denominator");
  }
}

/**
 * Whether a resolved beat structure differs from the meter's conventional
 * default — i.e. whether it is worth decorating at all. An authored
 * structure that happens to match the automatic default (a "redundant"
 * structure) does not count as non-default.
 */
function isNonDefaultGrouping(resolved: ResolvedMeter): boolean {
  const defaults = defaultBeatStructure(resolved.count, resolved.unit);
  return (
    resolved.beatStructure.length !== defaults.length ||
    resolved.beatStructure.some((group, index) => group !== defaults[index])
  );
}

/**
 * Resolve which {@link GroupingDisplay} mode a rendered meter should
 * actually engrave.
 *
 * Precedence: an explicit staff occurrence override wins outright, then the
 * time signature's own occurrence override (`time.groupingDisplay`), then
 * the document's non-default house style — but only when `resolved` is
 * structurally non-default (its beat structure differs from the meter's
 * conventional default). Ordinary/default meters always stay `"standard"`
 * under the house style, so a plain 4/4 never engraves `"1+1+1+1"`.
 *
 * A symbolic display (`common`/`cut`/`senzaMisura`/`note`) or a resolved
 * beat structure of one group has nothing for additive/annotation to show,
 * so both fall back to `"standard"` unconditionally — even under an
 * explicit occurrence or staff override.
 */
export function resolveGroupingDisplay(
  time: TimeSignature,
  resolved: ResolvedMeter,
  houseStyle: GroupingDisplay,
  staffOverride?: GroupingDisplay,
): GroupingDisplay {
  if (time.display || resolved.beatStructure.length <= 1) {
    return "standard";
  }
  if (staffOverride) return staffOverride;
  if (time.groupingDisplay) return time.groupingDisplay;
  if (houseStyle !== "standard" && isNonDefaultGrouping(resolved)) {
    return houseStyle;
  }
  return "standard";
}
