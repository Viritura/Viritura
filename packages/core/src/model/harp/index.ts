import type {
  HarpPedalAlter as RawHarpPedalAlter,
  HarpPedalSetting as RawHarpPedalSetting,
  HarpPedalTuning as RawHarpPedalTuning,
} from "../../raw/raw-viritura";
import type { MultiStaffPlacement, RhythmicPosition } from "../measure";

export type HarpPedalAlter = RawHarpPedalAlter;
export type HarpPedalLetter = keyof RawHarpPedalTuning;
export type HarpPedalTuning = Readonly<RawHarpPedalTuning>;
export type HarpPedalSource = NonNullable<RawHarpPedalSetting["source"]>;
/** Omitted means diagram. */
export type HarpPedalDisplay = NonNullable<RawHarpPedalSetting["display"]>;

/** A part-wide snapshot; staff affects only where the diagram is printed. */
export interface HarpPedalSetting {
  id: string;
  position: Pick<RhythmicPosition, "fraction">;
  tuning: HarpPedalTuning;
  /** Omitted means manual. */
  source?: HarpPedalSource;
  staff?: number;
  /** Omitted/auto uses the inter-staff gap when available, otherwise below. */
  placement?: MultiStaffPlacement;
  /** Manual [dx, dy] offset in spatia (sp); positive y is up. */
  manualOffset?: [number, number];
  /** Whether collision avoidance may move the diagram. Unset means enabled. */
  avoidCollisions?: boolean;
  /** Diagram (default), all pedal names, or only changes from the preceding setting. */
  display?: HarpPedalDisplay;
}

export { isHarpInstrumentAt, resolveHarpPedalState } from "./pedalState";
export {
  analyzeHarpPedalCompatibility,
  collectHarpPedalNotes,
  harpPedalFractionFromNumber,
  harpPedalSpellingMidi,
  harpPitchSpellings,
} from "./pedalAnalysis";
export type { HarpPedalAnalysis, HarpPedalIssue, HarpPedalNote } from "./pedalAnalysis";
export { calculateHarpPedalSolutions } from "./calculator";
export type {
  HarpPedalCalculation,
  HarpPedalCalculatedSetting,
  HarpPedalSolution,
  HarpPedalSolutionKind,
  HarpPedalSpellingEdit,
} from "./calculator";
