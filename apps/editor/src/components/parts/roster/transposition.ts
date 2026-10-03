import type { Part } from "@viritura/core";

export type PartUpdate = Partial<
  Pick<Part, "name" | "shortName" | "staves" | "transposition" | "chordSymbolVisibility">
>;

/** Default MNX `staffDistance` for a given halfSteps count. */
function diatonicFromChromatic(chromatic: number): number {
  return Math.round((chromatic * 7) / 12);
}

/** Build the MNX `transposition` field, or undefined when everything is at
 *  its identity (no transposition + no key flip + no written-pitch
 *  preference). */
export function buildTransposition(
  chromatic: number,
  staffDistance: number,
  flipAt: number | "",
  prefersWritten: boolean,
) {
  if (chromatic === 0 && staffDistance === 0 && flipAt === "" && !prefersWritten) {
    return undefined;
  }
  return {
    interval: { halfSteps: chromatic, staffDistance },
    ...(flipAt !== "" ? { keyFifthsFlipAt: flipAt } : {}),
    ...(prefersWritten ? { prefersWrittenPitches: true } : {}),
  };
}

// MNX spec descriptions, shown verbatim as tooltips. Pulled from
// mnx/doctools/data.json.
export const KEY_FIFTHS_FLIP_AT_DESCRIPTION =
  "When transposing key signatures to accommodate this part, " +
  '"keyFifthsFlipAt" describes the point at which the key signature ' +
  '"flips" enharmonically (to avoid an overly large number of sharps ' +
  'or flats). Non-negative values (including 0) mean "subtract 12 ' +
  'fifths," and negative values mean "add 12." If this value isn\'t ' +
  "provided, default behavior is to not flip the key signature.";

export const PREFERS_WRITTEN_PITCHES_DESCRIPTION =
  "Specifies that this instrument prefers displaying written pitches " +
  "(e.g., transposed pitches) even in the context of concert-pitch " +
  "scores. By convention, this is applied to piccolos, glockenspiels " +
  "and double basses. If not provided, this should be interpreted as false.";

/** Initial values for the edit-buffer state in `RosterPartRow`. Pulled
 *  into a helper so the component itself doesn't accumulate `?.` chains
 *  toward the eslint complexity ceiling. */
export interface PartEditBuffers {
  name: string;
  shortName: string;
  chromatic: number;
  staffDistance: number;
  keyFifthsFlipAt: number | "";
  prefersWritten: boolean;
}

export function partEditBuffersFor(part: Part): PartEditBuffers {
  const halfSteps = part.transposition?.interval?.halfSteps ?? 0;
  return {
    name: part.name,
    shortName: part.shortName ?? "",
    chromatic: halfSteps,
    staffDistance: part.transposition?.interval?.staffDistance ?? diatonicFromChromatic(halfSteps),
    keyFifthsFlipAt: part.transposition?.keyFifthsFlipAt ?? "",
    prefersWritten: !!part.transposition?.prefersWrittenPitches,
  };
}
