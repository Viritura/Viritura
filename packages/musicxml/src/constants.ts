import type { MnxDuration } from "./types";

// ─── MusicXML note type → MNX base duration ─────────────────────────

export const TYPE_MAP: Record<string, string> = {
  maxima: "maxima",
  long: "longa",
  breve: "breve",
  whole: "whole",
  half: "half",
  quarter: "quarter",
  eighth: "eighth",
  "16th": "16th",
  "32nd": "32nd",
  "64th": "64th",
  "128th": "128th",
  "256th": "256th",
  "512th": "512th",
  "1024th": "1024th",
};

// ─── Clef sign+line → MNX staffPosition ─────────────────────────────
// Key format: "G-2", "F-4", etc.

export const CLEF_POSITIONS: Record<string, number> = {
  "G-2": -2,
  "G-1": -4,
  "F-4": 2,
  "F-3": 0,
  "F-5": 4,
  "C-3": 0,
  "C-4": 2,
  "C-1": -4,
  "C-2": -2,
  "C-5": 4,
  // Percussion clef (no pitch, centered)
  "percussion-": 0,
};

// ─── MusicXML bar-style → MNX barline type ──────────────────────────

export const BARLINE_STYLE_MAP: Record<string, string> = {
  regular: "regular",
  "light-heavy": "final",
  "light-light": "double",
  "heavy-light": "heavyLight",
  "heavy-heavy": "heavyHeavy",
  dotted: "dotted",
  dashed: "dashed",
  tick: "tick",
  short: "short",
  none: "noBarline",
};

// ─── MusicXML accidental text → normalized name ─────────────────────

export const ACCIDENTAL_MAP: Record<string, string> = {
  sharp: "sharp",
  flat: "flat",
  natural: "natural",
  "double-sharp": "double-sharp",
  "sharp-sharp": "double-sharp",
  "flat-flat": "double-flat",
  "double-flat": "double-flat",
  "three-quarters-flat": "three-quarters-flat",
  "quarter-flat": "quarter-flat",
  "three-quarters-sharp": "three-quarters-sharp",
  "quarter-sharp": "quarter-sharp",
};

// ─── Fraction key → MNX duration (fallback when <type> is absent) ───

export const DURATION_FROM_FRACTION: Record<string, MnxDuration> = {
  "4/1": { base: "maxima" },
  "2/1": { base: "breve" },
  "1/1": { base: "whole" },
  "3/4": { base: "half", dots: 1 },
  "1/2": { base: "half" },
  "3/8": { base: "quarter", dots: 1 },
  "1/4": { base: "quarter" },
  "3/16": { base: "eighth", dots: 1 },
  "1/8": { base: "eighth" },
  "3/32": { base: "16th", dots: 1 },
  "1/16": { base: "16th" },
  "1/32": { base: "32nd" },
  "1/64": { base: "64th" },
  "1/128": { base: "128th" },
  "7/8": { base: "half", dots: 2 },
  "7/16": { base: "quarter", dots: 2 },
  "7/32": { base: "eighth", dots: 2 },
};

// ─── MusicXML articulation element names → MNX marking property ─────

export const ARTICULATION_MAP: Record<string, string> = {
  accent: "accent",
  "strong-accent": "strongAccent",
  staccato: "staccato",
  tenuto: "tenuto",
  staccatissimo: "staccatissimo",
  spiccato: "spiccato",
  stress: "stress",
  unstress: "unstress",
  "soft-accent": "softAccent",
  "detached-legato": "staccato", // approximation
  "breath-mark": "breath",
};

// ─── MusicXML beat unit text → MNX note-value base ──────────────────

export const BEAT_UNIT_MAP: Record<string, string> = {
  whole: "whole",
  half: "half",
  quarter: "quarter",
  eighth: "eighth",
  "16th": "16th",
  "32nd": "32nd",
  "64th": "64th",
};

// ─── Orchestral family classification ───────────────────────────────

export const FAMILY_ORDER = ["woodwind", "brass", "percussion", "keyboard", "strings"] as const;

const WOODWINDS = [
  "piccolo",
  "flute",
  "oboe",
  "clarinet",
  "bassoon",
  "contrabassoon",
  "english horn",
  "cor anglais",
  "saxophone",
  "sax",
  "recorder",
];
const BRASS = ["horn", "trumpet", "trombone", "tuba", "cornet", "euphonium", "bugle"];
const PERCUSSION_NAMES = [
  "timpani",
  "percussion",
  "drum",
  "cymbal",
  "triangle",
  "xylophone",
  "glockenspiel",
  "marimba",
  "vibraphone",
  "tambourine",
  "snare",
  "bass drum",
  "tam-tam",
  "celesta",
];
const KEYBOARDS = ["piano", "organ", "harpsichord", "celesta", "harp"];
const STRINGS = ["violin", "viola", "violoncello", "cello", "double bass", "contrabass", "bass", "string"];

export function classifyInstrument(partName: string): string {
  const name = partName.toLowerCase();
  for (const w of WOODWINDS) if (name.includes(w)) return "woodwind";
  for (const b of BRASS) if (name.includes(b)) return "brass";
  for (const p of PERCUSSION_NAMES) if (name.includes(p)) return "percussion";
  for (const k of KEYBOARDS) if (name.includes(k)) return "keyboard";
  for (const s of STRINGS) if (name.includes(s)) return "strings";
  return "other";
}
