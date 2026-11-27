import type {
  HarpPedalAlter as RawHarpPedalAlter,
  HarpPedalSetting as RawHarpPedalSetting,
  HarpPedalTuning as RawHarpPedalTuning,
} from "../../raw/raw-viritura";
import type { RhythmicPosition } from "../measure";

export type HarpPedalAlter = RawHarpPedalAlter;
export type HarpPedalLetter = keyof RawHarpPedalTuning;
export type HarpPedalTuning = Readonly<RawHarpPedalTuning>;
export type HarpPedalSource = NonNullable<RawHarpPedalSetting["source"]>;

/** A part-wide snapshot; staff affects only where the diagram is printed. */
export interface HarpPedalSetting {
  id: string;
  position: Pick<RhythmicPosition, "fraction">;
  tuning: HarpPedalTuning;
  /** Omitted means manual. */
  source?: HarpPedalSource;
  staff?: number;
}
