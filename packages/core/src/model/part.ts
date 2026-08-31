import type { PartMeasure } from "./measure";
import type { KitComponent } from "./kit";

/**
 * MNX interval — chromatic + diatonic components.
 */
export interface Interval {
  /** Chromatic distance in semitones (signed). */
  halfSteps: number;
  /** Diatonic staff distance in staff positions (signed). */
  staffDistance: number;
}

/**
 * MNX part-transposition — transposing instrument configuration.
 */
export interface Transposition {
  /** The sounding→written transposition interval. */
  interval: Interval;
  /** Circle-of-fifths value at which key signatures flip enharmonically. */
  keyFifthsFlipAt?: number;
  /** Instrument prefers written pitches even in concert-pitch scores. */
  prefersWrittenPitches?: boolean;
}

/**
 * Viritura vendor extensions for a Part (`_x.viritura`).
 *
 * These travel with the MNX score (under `_x.viritura` on the part) so
 * the editor and audio engine can resolve a Part to a stable instrument
 * identity without falling back to fuzzy name matching.
 */
export interface PartVirituraExt {
  /** Stable instrument-catalog ID (e.g. "flute", "bflat-clarinet"). */
  instrumentId?: string;
  /** General-MIDI program (0..127). Used directly by the audio engine. */
  midiProgram?: number;
  /** Instrument family for spatial placement / catalog routing. */
  family?: string;
  /** Spatial-audio stage position in concert-hall meters. Persisted from Play
   *  mode so a user's instrument arrangement survives reload. */
  spatial?: { x: number; y: number };
}

/**
 * A part (instrument) in the score (MNX "parts[n]").
 */
export interface Part {
  /** Unique part ID (referenced by layout sources) */
  id?: string;
  /** Part name (e.g., "Violin", "Flute 1") */
  name: string;
  /** Short name / abbreviation (e.g., "Vln.", "Fl. 1") */
  shortName?: string;
  /** Measures for this part (indexed same as global measures) */
  measures: PartMeasure[];
  /** Number of staves for this part (default 1; grand staff = 2, organ = 3) */
  staves?: number;
  /** Transposition for transposing instruments (MNX `transposition`). */
  transposition?: Transposition;
  /** Drum-kit component map (MNX `kit`). Key = component ID (referenced by
   *  kit-note `kitComponent`). When present, this is an unpitched percussion part. */
  kit?: Record<string, KitComponent>;
  /** Viritura vendor extensions (MNX `_x.viritura`). */
  _x?: { viritura?: PartVirituraExt };
}
