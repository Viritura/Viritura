import type { NoteValueBase } from "./enums";

// ═══════════════════════════════════════════
// Staff & spacing constants
// ═══════════════════════════════════════════

/** Number of staff lines in a standard staff */
export const STAFF_LINES = 5;

/** Default spatium (staff space) in pixels at 100% zoom */
export const DEFAULT_SPATIUM_PX = 10;

// ═══════════════════════════════════════════
// Duration values (in quarter-note beats)
// ═══════════════════════════════════════════

/** Map from NoteValueBase to beats (quarter note = 1). Covers the full MNX
 *  spec range, from `duplexMaxima` (64 beats) down to `4096th`. */
export const DURATION_BEATS: Record<NoteValueBase, number> = {
  duplexMaxima: 64,
  maxima: 32,
  longa: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
  "128th": 0.03125,
  "256th": 0.015625,
  "512th": 0.0078125,
  "1024th": 0.00390625,
  "2048th": 0.001953125,
  "4096th": 0.0009765625,
};

// ═══════════════════════════════════════════
// MIDI pitch mapping
// ═══════════════════════════════════════════

/** Semitone offsets for each step (C=0, D=2, E=4, F=5, G=7, A=9, B=11) */
export const STEP_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

// ═══════════════════════════════════════════
// Key signature sharps/flats
// ═══════════════════════════════════════════

/** Key signature fifths order for sharps */
export const SHARP_ORDER: string[] = ["F", "C", "G", "D", "A", "E", "B"];

/** Key signature fifths order for flats */
export const FLAT_ORDER: string[] = ["B", "E", "A", "D", "G", "C", "F"];
