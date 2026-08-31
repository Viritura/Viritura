/**
 * General MIDI instrument name → program number mapping.
 *
 * Maps common orchestral instrument names (as used in MNX part names)
 * to GM program numbers (0-indexed: 0 = Acoustic Grand Piano).
 *
 * Reference: https://www.midi.org/specifications-old/item/gm-level-1-sound-set
 */

/** GM program 44 — Tremolo Strings (used for 3-slash unmeasured string tremolos). */
export const GM_TREMOLO_STRINGS = 44;

/** GM program 48 — String Ensemble 1 (used as a layer beneath solo strings). */
export const GM_STRING_ENSEMBLE_1 = 48;

/** GM program 49 — String Ensemble 2 (second ensemble layer for wider stereo). */
export const GM_STRING_ENSEMBLE_2 = 49;

/** Solo string GM programs (Violin 40, Viola 41, Cello 42, Contrabass 43). */
const STRING_SOLO_PROGRAMS = new Set([40, 41, 42, 43]);

/** Returns true if the GM program is a solo string instrument (40–43). */
export function isStringSoloProgram(program: number): boolean {
  return STRING_SOLO_PROGRAMS.has(program);
}

/**
 * Minimal structural shape of an MNX Part needed to resolve a GM program.
 * Kept structural (no `@viritura/core` dep) so this package stays standalone.
 */
interface PartLike {
  readonly name: string;
  readonly _x?: {
    readonly viritura?: {
      readonly midiProgram?: number;
      readonly instrumentId?: string;
    };
  };
}

/**
 * Resolve a GM program for a Part, preferring explicit metadata.
 *
 * Priority:
 *   1. `part._x.viritura.midiProgram` — written by the wizard / catalog
 *      whenever the user picks an instrument from the list.
 *   2. Fuzzy match on `part.name` — fallback for legacy MNX, hand-written
 *      MNX, or imports that didn't resolve a catalog instrument.
 */
export function gmProgramForPart(part: PartLike): number | null {
  const explicit = part._x?.viritura?.midiProgram;
  if (typeof explicit === "number" && Number.isInteger(explicit) && explicit >= 0 && explicit <= 127) {
    return explicit;
  }
  return gmProgramForInstrument(part.name);
}

/** GM program number for an instrument name (case-insensitive fuzzy match). */
export function gmProgramForInstrument(name: string): number | null {
  const lower = name.toLowerCase().trim();

  // Unpitched percussion instruments do not have a GM melodic program — they
  // play on channel 9 with a fixed drum-key MIDI number. Returning null here
  // prevents the substring matcher below from misclassifying e.g. "Bass Drum"
  // → choir (because the "bass" alias substring-matches).
  // Strip trailing numbering (e.g. "Snare Drum 2") before matching.
  const stripped = lower.replace(/\s+\d+$/, "").trim();
  const PERCUSSION_NAMES = new Set([
    "drum kit",
    "drumset",
    "drum set",
    "snare drum",
    "bass drum",
    "cymbals",
    "triangle",
    "tambourine",
    "kick drum",
    "hi-hat",
    "hihat",
    "tom-tom",
    "cowbell",
    "woodblock",
  ]);
  if (PERCUSSION_NAMES.has(stripped)) return null;

  // Exact matches first
  for (const [key, program] of Object.entries(GM_INSTRUMENT_MAP)) {
    if (lower === key) return program;
  }

  // Alias matches (sort longest-first to prevent partial matches like "bass" in "bassoon")
  const sortedAliases = Object.entries(GM_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, key] of sortedAliases) {
    if (lower === alias) {
      const program = GM_INSTRUMENT_MAP[key];
      if (program !== undefined) return program;
    }
  }
  // Substring alias match (longest first)
  for (const [alias, key] of sortedAliases) {
    if (lower.includes(alias)) {
      const program = GM_INSTRUMENT_MAP[key];
      if (program !== undefined) return program;
    }
  }

  // Fuzzy substring matches (longest key first)
  const sortedKeys = Object.keys(GM_INSTRUMENT_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key)) {
      const program = GM_INSTRUMENT_MAP[key];
      if (program !== undefined) return program;
    }
  }

  return null;
}

/**
 * Canonical instrument name → GM program number (0-indexed).
 */
const GM_INSTRUMENT_MAP: Record<string, number> = {
  // Piano (0-7)
  piano: 0,
  "acoustic grand piano": 0,
  "bright acoustic piano": 1,
  "electric grand piano": 2,
  "honky-tonk piano": 3,
  "electric piano": 4,
  harpsichord: 6,
  clavinet: 7,

  // Chromatic Percussion (8-15)
  celesta: 8,
  glockenspiel: 9,
  "music box": 10,
  vibraphone: 11,
  marimba: 12,
  xylophone: 13,
  "tubular bells": 14,
  dulcimer: 15,

  // Organ (16-23)
  organ: 19,
  "church organ": 19,
  "reed organ": 20,
  accordion: 21,
  harmonica: 22,

  // Guitar (24-31)
  guitar: 25,
  "acoustic guitar": 25,
  "electric guitar": 27,

  // Bass (32-39)
  "acoustic bass": 32,
  "electric bass": 33,

  // Strings (40-47)
  violin: 40,
  viola: 41,
  cello: 42,
  contrabass: 43,
  "double bass": 43,

  // Ensemble (48-55)
  "string ensemble": 48,
  strings: 48,
  "synth strings": 50,
  choir: 52,
  voice: 52,
  soprano: 52,
  alto: 52,
  tenor: 52,
  "bass voice": 52,
  "orchestra hit": 55,

  // Brass (56-63)
  trumpet: 56,
  trombone: 57,
  tuba: 58,
  "french horn": 60,
  horn: 60,

  // Reed (64-71)
  "soprano sax": 64,
  "alto sax": 65,
  "tenor sax": 66,
  "baritone sax": 67,
  oboe: 68,
  "english horn": 69,
  bassoon: 70,
  clarinet: 71,

  // Pipe (72-79)
  piccolo: 72,
  flute: 73,
  recorder: 74,
  "pan flute": 75,

  // Synth Lead (80-87)
  // Synth Pad (88-95)
  // Synth Effects (96-103)
  // Ethnic (104-111)

  // Percussive (112-119)
  timpani: 47, // GM has timpani as orchestral hit area; some SF2s map it differently
  "steel drums": 114,

  // Harp
  harp: 46,

  // Choir bass (standalone "Bass" part = voice, not string contrabass)
  bass: 52,
};

/**
 * Common abbreviations and aliases → canonical name in GM_INSTRUMENT_MAP.
 */
const GM_ALIASES: Record<string, string> = {
  // Strings
  vln: "violin",
  vla: "viola",
  violoncello: "cello",
  vc: "cello",
  vcl: "cello",
  cb: "contrabass",
  db: "double bass",
  "string bass": "contrabass",

  // Woodwinds
  fl: "flute",
  ob: "oboe",
  cl: "clarinet",
  bn: "bassoon",
  bsn: "bassoon",
  picc: "piccolo",
  "cor anglais": "english horn",
  contrabassoon: "bassoon",
  "bass clarinet": "clarinet",
  "alto flute": "flute",

  // Brass
  tpt: "trumpet",
  tbn: "trombone",
  hn: "french horn",
  "bass trombone": "trombone",

  // Keys
  pno: "piano",
  pf: "piano",
  org: "organ",
  cel: "celesta",

  // Percussion
  timp: "timpani",
  glock: "glockenspiel",
  xyl: "xylophone",
  mar: "marimba",
  vib: "vibraphone",
  chimes: "tubular bells",
  "tub. bells": "tubular bells",

  // Harp
  hp: "harp",

  // Choir
  "choir aahs": "choir",
};

/** Standard GM program names (0-indexed). */
const GM_PROGRAM_NAMES: string[] = [
  "Acoustic Grand Piano",
  "Bright Acoustic Piano",
  "Electric Grand Piano",
  "Honky-tonk Piano",
  "Electric Piano 1",
  "Electric Piano 2",
  "Harpsichord",
  "Clavinet",
  "Celesta",
  "Glockenspiel",
  "Music Box",
  "Vibraphone",
  "Marimba",
  "Xylophone",
  "Tubular Bells",
  "Dulcimer",
  "Drawbar Organ",
  "Percussive Organ",
  "Rock Organ",
  "Church Organ",
  "Reed Organ",
  "Accordion",
  "Harmonica",
  "Tango Accordion",
  "Nylon Guitar",
  "Steel Guitar",
  "Jazz Guitar",
  "Clean Guitar",
  "Muted Guitar",
  "Overdrive Guitar",
  "Distortion Guitar",
  "Guitar Harmonics",
  "Acoustic Bass",
  "Finger Bass",
  "Pick Bass",
  "Fretless Bass",
  "Slap Bass 1",
  "Slap Bass 2",
  "Synth Bass 1",
  "Synth Bass 2",
  "Violin",
  "Viola",
  "Cello",
  "Contrabass",
  "Tremolo Strings",
  "Pizzicato Strings",
  "Harp",
  "Timpani",
  "String Ensemble 1",
  "String Ensemble 2",
  "Synth Strings 1",
  "Synth Strings 2",
  "Choir Aahs",
  "Voice Oohs",
  "Synth Choir",
  "Orchestra Hit",
  "Trumpet",
  "Trombone",
  "Tuba",
  "Muted Trumpet",
  "French Horn",
  "Brass Section",
  "Synth Brass 1",
  "Synth Brass 2",
  "Soprano Sax",
  "Alto Sax",
  "Tenor Sax",
  "Baritone Sax",
  "Oboe",
  "English Horn",
  "Bassoon",
  "Clarinet",
  "Piccolo",
  "Flute",
  "Recorder",
  "Pan Flute",
  "Blown Bottle",
  "Shakuhachi",
  "Whistle",
  "Ocarina",
  "Lead 1 (Square)",
  "Lead 2 (Sawtooth)",
  "Lead 3 (Calliope)",
  "Lead 4 (Chiff)",
  "Lead 5 (Charang)",
  "Lead 6 (Voice)",
  "Lead 7 (Fifths)",
  "Lead 8 (Bass+Lead)",
  "Pad 1 (New Age)",
  "Pad 2 (Warm)",
  "Pad 3 (Polysynth)",
  "Pad 4 (Choir)",
  "Pad 5 (Bowed)",
  "Pad 6 (Metallic)",
  "Pad 7 (Halo)",
  "Pad 8 (Sweep)",
  "FX 1 (Rain)",
  "FX 2 (Soundtrack)",
  "FX 3 (Crystal)",
  "FX 4 (Atmosphere)",
  "FX 5 (Brightness)",
  "FX 6 (Goblins)",
  "FX 7 (Echoes)",
  "FX 8 (Sci-fi)",
  "Sitar",
  "Banjo",
  "Shamisen",
  "Koto",
  "Kalimba",
  "Bagpipe",
  "Fiddle",
  "Shanai",
  "Tinkle Bell",
  "Agogo",
  "Steel Drums",
  "Woodblock",
  "Taiko Drum",
  "Melodic Tom",
  "Synth Drum",
  "Reverse Cymbal",
  "Guitar Fret Noise",
  "Breath Noise",
  "Seashore",
  "Bird Tweet",
  "Telephone Ring",
  "Helicopter",
  "Applause",
  "Gunshot",
];

/** Get the standard GM name for a program number. */
export function gmProgramName(program: number): string {
  return GM_PROGRAM_NAMES[program] ?? `Program ${program}`;
}

/**
 * Single-drum unpitched percussion lookup.
 *
 * For percussion parts that play a single fixed drum/cymbal sound (e.g. a
 * standalone snare, bass drum, triangle, tambourine), returns the GM
 * percussion note number on channel 9. Returns `null` for parts that aren't
 * single-drum unpitched percussion (e.g. drum kits, pitched instruments).
 *
 * Maps a small fixed table of common single-drum part names to their GM
 * percussion numbers so the playback engine doesn't need to consult an
 * editor-side instrument catalog. Tolerates trailing instance numbers
 * ("Snare Drum 2" → snare drum) and case differences.
 *
 * Reference: GM percussion note assignments
 * https://www.midi.org/specifications-old/item/gm-level-1-sound-set
 */
const UNPITCHED_DRUM_TABLE: ReadonlyArray<{ readonly pattern: RegExp; readonly note: number }> = [
  // Order matters: longer / more specific patterns first.
  { pattern: /^bass\s*drum\b/i, note: 36 }, // Bass Drum 1
  { pattern: /^snare\s*drum\b/i, note: 38 }, // Acoustic Snare
  { pattern: /^crash\s*cymbal\b/i, note: 49 }, // Crash Cymbal 1
  { pattern: /^ride\s*cymbal\b/i, note: 51 }, // Ride Cymbal 1
  { pattern: /^hi[-\s]*hat\b/i, note: 42 }, // Closed Hi-Hat
  { pattern: /^triangle\b/i, note: 81 }, // Open Triangle
  { pattern: /^tambourine\b/i, note: 54 }, // Tambourine
  { pattern: /^cowbell\b/i, note: 56 }, // Cowbell
  { pattern: /^woodblock\b/i, note: 76 }, // Hi Wood Block
  { pattern: /^claves\b/i, note: 75 }, // Claves
  { pattern: /^tom(?:\s*\d+)?\b/i, note: 47 }, // Low-Mid Tom
];

/** Resolve the GM percussion note for a single-drum unpitched percussion part. */
export function unpitchedDrumForPartName(name: string): number | null {
  const stripped = name.replace(/\s+\d+$/, "").trim();
  for (const { pattern, note } of UNPITCHED_DRUM_TABLE) {
    if (pattern.test(stripped)) return note;
  }
  return null;
}
