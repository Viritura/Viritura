/**
 * InstrumentCatalog — comprehensive instrument database for score setup.
 *
 * Each entry defines everything needed to create MNX parts, layouts,
 * and scores: family grouping, clefs, transposition, MIDI program,
 * standard score ordering, and playable range.
 */

import type { Transposition } from "@viritura/core";

/** Instrument family for grouping and layout brackets. */
export type InstrumentFamily = "woodwinds" | "brass" | "percussion" | "keyboards" | "strings" | "voices" | "plucked";

/** Family display metadata. */
export const FAMILY_META: Record<InstrumentFamily, { label: string; order: number }> = {
  woodwinds: { label: "Woodwinds", order: 0 },
  brass: { label: "Brass", order: 1 },
  percussion: { label: "Percussion", order: 2 },
  keyboards: { label: "Keyboards", order: 3 },
  voices: { label: "Voices", order: 4 },
  plucked: { label: "Plucked Strings", order: 5 },
  strings: { label: "Strings", order: 6 },
};

/** Clef definition per staff (1-indexed). */
export interface ClefDef {
  sign: string;
  staffPosition: number;
  /** Optional SMuFL glyph override (e.g. "unpitchedPercussionClef1"). */
  glyph?: string;
}

/** Transposition interval (concert → written). */
interface TranspositionDef {
  /** Chromatic semitones (positive = instrument sounds lower than written). */
  halfSteps: number;
  /** Diatonic steps. */
  staffDistance?: number;
}

/** Full instrument definition in the catalog. */
export interface CatalogInstrument {
  /** Unique key (e.g., "flute", "bflat-clarinet"). */
  id: string;
  /** Display name shown in catalog (e.g., "Flute", "Clarinet in B♭"). */
  name: string;
  /** Abbreviated name for subsequent systems. */
  shortName: string;
  /** Base instrument name for MNX Part.name, without transposition key.
   *  When set, this is stored in MNX; the "in X" suffix is auto-derived.
   *  If not set, `name` is used as-is. */
  baseName?: string;
  /** Base short name for MNX Part.shortName (without transposition key). */
  baseShortName?: string;
  /** Instrument family. */
  family: InstrumentFamily;
  /** Number of staves (default 1, 2 for keyboards). */
  staves: number;
  /** Clefs per staff (1-indexed). */
  clefs: Record<number, ClefDef>;
  /** Transposition interval, if transposing instrument. */
  transposition?: TranspositionDef;
  /** General MIDI program number (0-based). */
  midiProgram: number;
  /** Standard score order within the family (lower = higher on page). */
  scoreOrder: number;
  /** Lowest sounding MIDI note. */
  rangeLow: number;
  /** Highest sounding MIDI note. */
  rangeHigh: number;
  /** Layout bracket symbol: "bracket" for orchestra sections, "brace" for keyboards. */
  bracketSymbol?: "bracket" | "brace";
  /** Line bracket grouping key within a family (e.g., "flute", "oboe").
   *  Instruments sharing the same subGroup get a nested line bracket in orchestral layouts. */
  subGroup?: string;
  /** Drum-kit components for unpitched percussion. When present, ScoreBuilder
   *  emits a Part.kit array and contributes Sound entries to global.sounds. */
  kit?: KitComponentDef[];
  /** For single-drum unpitched percussion (snare, bass drum, etc.): GM drum
   *  MIDI number. When set, the part is treated as a one-component kit:
   *  `addInstrumentToScore` synthesises `Part.kit` with a single entry on
   *  the middle line so the renderer, click-to-add input, and playback
   *  pipeline all behave the same as for the full drum kit. */
  unpitchedDrum?: number;
  /** Optional notehead shape for the synthesised single-drum kit entry.
   *  Defaults to "normal". Use "x" for cymbals/triangle. */
  unpitchedDrumNotehead?: "normal" | "x" | "diamond" | "circleX" | "slash" | "triangleUp" | "triangleDown";
}

/** Minimal kit-component descriptor used to generate Part.kit + global.sounds. */
export interface KitComponentDef {
  /** Stable ID referenced from kit-notes (e.g., "kick", "snare"). */
  id: string;
  /** Human-readable name shown in the Kit Inspector. */
  name: string;
  /** GM percussion MIDI note number (channel 10, 0-based key 35..81 typical). */
  midiNumber: number;
  /** Staff position in half-spaces from center line; +above / -below. */
  staffPosition: number;
  /** Optional Viritura notehead-shape vendor extension. */
  notehead?: "normal" | "x" | "diamond" | "circleX" | "slash" | "triangleUp" | "triangleDown";
  /** Optional GS drum-kit program used to borrow this hit from another kit. */
  drumKit?: number;
}

// ─── Instrument catalog data ───────────────────────────────────────
// (Catalog table split into instrumentCatalogData.ts +
// instrumentCatalogDataExtras.ts to keep this module under the lint
// max-lines threshold.)
import { INSTRUMENT_CATALOG_PRIMARY } from "./instrumentCatalogData";
import { INSTRUMENT_CATALOG_EXTRAS } from "./instrumentCatalogDataExtras";

export const INSTRUMENT_CATALOG: CatalogInstrument[] = [...INSTRUMENT_CATALOG_PRIMARY, ...INSTRUMENT_CATALOG_EXTRAS];

/** Look up a catalog instrument by ID. */
export function getCatalogInstrument(id: string): CatalogInstrument | undefined {
  return INSTRUMENT_CATALOG.find((i) => i.id === id);
}

/**
 * A transposition is a *pure octave* when written and sounding pitches share
 * the same note letter and pitch class, differing only by whole octaves
 * (halfSteps = 12k, staffDistance = 7k for the same nonzero k).
 */
function isPureOctaveTransposition(halfSteps: number, staffDistance: number): boolean {
  return halfSteps !== 0 && halfSteps * 7 === staffDistance * 12;
}

/**
 * Build the MNX `Part.transposition` from a catalog instrument's transposition
 * definition.
 *
 * Pure-octave transposers — piccolo / xylophone / glockenspiel (8va/15ma up),
 * contrabassoon / double bass / guitar family (8vb down) — are conventionally
 * notated at written pitch even in a concert-pitch score; writing them at
 * sounding pitch would bury them in ledger lines. They are flagged
 * `prefersWrittenPitches` so the engine keeps them written regardless of the
 * score's `useWritten` mode. This mirrors the MusicXML import rule.
 */
export function buildPartTransposition(def: TranspositionDef): Transposition {
  const staffDistance = def.staffDistance ?? 0;
  const transposition: Transposition = {
    interval: { halfSteps: def.halfSteps, staffDistance },
  };
  if (isPureOctaveTransposition(def.halfSteps, staffDistance)) {
    transposition.prefersWrittenPitches = true;
  }
  return transposition;
}

/** Look up a catalog instrument by display name. Tolerates numbered parts
 *  (e.g. "Snare Drum 2" matches the "snare-drum" entry) and the optional
 *  baseName / "in X" suffix used for transposing instruments. */
function getCatalogInstrumentByName(name: string): CatalogInstrument | undefined {
  const stripped = name.replace(/\s+\d+$/, "").trim();
  const lower = stripped.toLowerCase();
  return INSTRUMENT_CATALOG.find((i) => {
    if (i.name.toLowerCase() === lower) return true;
    if (i.baseName && i.baseName.toLowerCase() === lower) return true;
    return false;
  });
}

/** Get all instruments in a family, ordered by scoreOrder. */
export function getInstrumentsByFamily(family: InstrumentFamily): CatalogInstrument[] {
  return INSTRUMENT_CATALOG.filter((i) => i.family === family).sort((a, b) => a.scoreOrder - b.scoreOrder);
}

/** Get all families that have instruments in the catalog. */
export function getFamiliesInOrder(): {
  family: InstrumentFamily;
  label: string;
}[] {
  const families = new Set(INSTRUMENT_CATALOG.map((i) => i.family));
  return [...families]
    .sort((a, b) => FAMILY_META[a].order - FAMILY_META[b].order)
    .map((f) => ({ family: f, label: FAMILY_META[f].label }));
}

// ─── Player ────────────────────────────────────────────────────────

/** A player in the score setup — wraps a catalog instrument with instance numbering. */
export interface Player {
  /** UUID for drag-and-drop / React keying. */
  uid: string;
  /** Reference to catalog instrument ID. */
  instrumentId: string;
  /** Base instrument name for MNX Part.name (e.g., "Clarinet", "Horn").
   *  Transposition and numbering are derived at display time. */
  displayName: string;
  /** Base short name for MNX Part.shortName (e.g., "Cl.", "Hn."). */
  displayShortName: string;
  /** When true, the user has manually edited displayName / displayShortName
   *  and renumberPlayers() will leave them alone. */
  userRenamed?: boolean;
  /** The full part name was explicitly overridden by the user. */
  nameOverridden?: boolean;
  /** The abbreviated part name was explicitly overridden by the user. */
  shortNameOverridden?: boolean;
  /** Customized percussion map. Undefined means use the catalog default. */
  kit?: KitComponentDef[];
}

/** Generate a RFC-4122-ish UUID (good enough for keying). */
function uid(): string {
  return crypto.randomUUID();
}

/**
 * Create a Player from a catalog instrument.
 * Uses baseName (without transposition key) for the display name.
 * Call `renumberPlayers()` after adding/removing to update display names.
 */
export function createPlayer(instrumentId: string): Player {
  const inst = getCatalogInstrument(instrumentId);
  if (!inst) {
    throw new Error(`Unknown instrument: ${instrumentId}`);
  }
  return {
    uid: uid(),
    instrumentId,
    displayName: inst.baseName ?? inst.name,
    displayShortName: inst.baseShortName ?? inst.shortName,
  };
}

/**
 * Re-derive display names from the catalog, adding numbering when
 * multiple players share the same instrument ID.
 */
export function renumberPlayers(players: Player[]): Player[] {
  // Count occurrences of each instrument ID
  const counts = new Map<string, number>();
  for (const p of players) {
    counts.set(p.instrumentId, (counts.get(p.instrumentId) ?? 0) + 1);
  }

  // Track per-instrument running index
  const indices = new Map<string, number>();

  return players.map((p) => {
    const inst = getCatalogInstrument(p.instrumentId);
    if (!inst) return p;
    // Preserve legacy user-edited names verbatim.
    if (p.userRenamed && p.nameOverridden === undefined && p.shortNameOverridden === undefined) return p;
    const baseName = inst.name;
    const baseShort = inst.shortName;
    const total = counts.get(p.instrumentId) ?? 1;
    const idx = (indices.get(p.instrumentId) ?? 0) + 1;
    indices.set(p.instrumentId, idx);

    const automaticName = total > 1 ? `${baseName} ${idx}` : baseName;
    const automaticShortName = total > 1 ? `${baseShort} ${idx}` : baseShort;
    return {
      ...p,
      displayName: p.nameOverridden ? p.displayName : automaticName,
      displayShortName: p.shortNameOverridden ? p.displayShortName : automaticShortName,
    };
  });
}

// ─── Ensemble Templates ────────────────────────────────────────────

export interface EnsembleTemplate {
  id: string;
  name: string;
  description: string;
  category: EnsembleCategory;
  /** Array of [instrumentId, count] tuples. */
  instruments: [string, number][];
}

export type EnsembleCategory = "solo" | "chamber" | "vocal" | "jazz" | "large-ensemble";

export const ENSEMBLE_CATEGORIES: readonly { id: EnsembleCategory; label: string }[] = [
  { id: "solo", label: "Solo" },
  { id: "chamber", label: "Chamber Ensembles" },
  { id: "vocal", label: "Vocal Ensembles" },
  { id: "jazz", label: "Jazz" },
  { id: "large-ensemble", label: "Orchestras & Bands" },
];

export const ENSEMBLE_TEMPLATES: EnsembleTemplate[] = [
  {
    id: "solo-piano",
    name: "Solo Piano",
    description: "Single piano",
    category: "solo",
    instruments: [["piano", 1]],
  },
  {
    id: "string-quartet",
    name: "String Quartet",
    description: "Violin I, Violin II, Viola, Cello",
    category: "chamber",
    instruments: [
      ["violin", 2],
      ["viola", 1],
      ["cello", 1],
    ],
  },
  {
    id: "string-orchestra",
    name: "String Orchestra",
    description: "Violin I, Violin II, Viola, Cello, Double Bass",
    category: "large-ensemble",
    instruments: [
      ["violin", 2],
      ["viola", 1],
      ["cello", 1],
      ["double-bass", 1],
    ],
  },
  {
    id: "wind-quintet",
    name: "Wind Quintet",
    description: "Flute, Oboe, Clarinet, Horn, Bassoon",
    category: "chamber",
    instruments: [
      ["flute", 1],
      ["oboe", 1],
      ["bflat-clarinet", 1],
      ["horn", 1],
      ["bassoon", 1],
    ],
  },
  {
    id: "brass-quintet",
    name: "Brass Quintet",
    description: "2 Trumpets, Horn, Trombone, Tuba",
    category: "chamber",
    instruments: [
      ["trumpet", 2],
      ["horn", 1],
      ["trombone", 1],
      ["tuba", 1],
    ],
  },
  {
    id: "jazz-combo",
    name: "Jazz Combo",
    description: "Alto Sax, Trumpet, Piano, Bass Guitar, Drums",
    category: "jazz",
    instruments: [
      ["alto-sax", 1],
      ["trumpet", 1],
      ["piano", 1],
      ["bass-guitar", 1],
      ["drum-kit", 1],
    ],
  },
  {
    id: "satb-choir",
    name: "SATB Choir",
    description: "Soprano, Alto, Tenor, Bass",
    category: "vocal",
    instruments: [
      ["soprano", 1],
      ["alto-voice", 1],
      ["tenor-voice", 1],
      ["bass-voice", 1],
    ],
  },
  {
    id: "satb-piano",
    name: "SATB + Piano",
    description: "Soprano, Alto, Tenor, Bass with piano accompaniment",
    category: "vocal",
    instruments: [
      ["soprano", 1],
      ["alto-voice", 1],
      ["tenor-voice", 1],
      ["bass-voice", 1],
      ["piano", 1],
    ],
  },
  {
    id: "classical-orchestra",
    name: "Classical Orchestra",
    description: "2222 / 2200 / Timp / Strings",
    category: "large-ensemble",
    instruments: [
      ["flute", 2],
      ["oboe", 2],
      ["bflat-clarinet", 2],
      ["bassoon", 2],
      ["horn", 2],
      ["trumpet", 2],
      ["timpani", 1],
      ["violin", 2],
      ["viola", 1],
      ["cello", 1],
      ["double-bass", 1],
    ],
  },
  {
    id: "romantic-orchestra",
    name: "Romantic Orchestra",
    description:
      "Picc, 2Fl, 2Ob, EH, 2Cl, BCl, 2Bsn, CBsn / 4Hn, 3Tpt, 3Tbn, Tba / Timp, Snare, Cymbals, Triangle / Hp / Strings",
    category: "large-ensemble",
    instruments: [
      ["piccolo", 1],
      ["flute", 2],
      ["oboe", 2],
      ["english-horn", 1],
      ["bflat-clarinet", 2],
      ["bass-clarinet", 1],
      ["bassoon", 2],
      ["contrabassoon", 1],
      ["horn", 4],
      ["trumpet", 3],
      ["trombone", 3],
      ["tuba", 1],
      ["timpani", 1],
      ["snare-drum", 1],
      ["cymbals", 1],
      ["triangle", 1],
      ["harp", 1],
      ["violin", 2],
      ["viola", 1],
      ["cello", 1],
      ["double-bass", 1],
    ],
  },
  {
    id: "concert-band",
    name: "Concert Band",
    description:
      "Picc, 2Fl, 2Ob, 3Cl, BCl, 2Bsn / 2ASax, TSax, BSax / 3Tpt, 4Hn, 3Tbn, Euph, Tba / Timp, Snare, Bass Drum, Cymbals",
    category: "large-ensemble",
    instruments: [
      ["piccolo", 1],
      ["flute", 2],
      ["oboe", 2],
      ["bflat-clarinet", 3],
      ["bass-clarinet", 1],
      ["bassoon", 2],
      ["alto-sax", 2],
      ["tenor-sax", 1],
      ["baritone-sax", 1],
      ["trumpet", 3],
      ["horn", 4],
      ["trombone", 3],
      ["euphonium", 1],
      ["tuba", 1],
      ["timpani", 1],
      ["snare-drum", 1],
      ["bass-drum", 1],
      ["cymbals", 1],
    ],
  },
  {
    id: "piano-trio",
    name: "Piano Trio",
    description: "Violin, Cello, Piano",
    category: "chamber",
    instruments: [
      ["violin", 1],
      ["cello", 1],
      ["piano", 1],
    ],
  },
  {
    id: "piano-quintet",
    name: "Piano Quintet",
    description: "2 Violins, Viola, Cello, Piano",
    category: "chamber",
    instruments: [
      ["violin", 2],
      ["viola", 1],
      ["cello", 1],
      ["piano", 1],
    ],
  },
];

/**
 * Expand an ensemble template into a list of Players
 * with proper numbering, sorted in score order.
 */
export function expandTemplate(templateId: string): Player[] {
  const tmpl = ENSEMBLE_TEMPLATES.find((t) => t.id === templateId);
  if (!tmpl) return [];

  const players: Player[] = [];
  for (const [instrumentId, count] of tmpl.instruments) {
    for (let i = 0; i < count; i++) {
      players.push(createPlayer(instrumentId));
    }
  }
  return renumberPlayers(players);
}

/**
 * Mutate a parsed score in place, filling in `_x.viritura.instrumentId` /
 * `midiProgram` / `family` on every part that doesn't already have them.
 *
 * Match strategy:
 *   1. Existing `_x.viritura.instrumentId` — never overwritten.
 *   2. Exact / case-insensitive name match against `INSTRUMENT_CATALOG`
 *      (catalog `name`, `baseName`, with trailing numbering tolerated).
 *   3. Transposition match (halfSteps + staves) when the name was ambiguous.
 *
 * Used at score-load time so MusicXML imports, hand-edited MNX, and legacy
 * Viritura files inherit the audio-engine reliability the wizard already
 * gives newly-created scores.
 */
export function enrichInstrumentIdentities<
  T extends {
    parts: Array<{
      name: string;
      staves?: number;
      transposition?: { interval: { halfSteps: number } };
      _x?: { viritura?: { instrumentId?: string; midiProgram?: number; family?: string } };
    }>;
  },
>(score: T): number {
  let filled = 0;
  for (const part of score.parts) {
    if (part._x?.viritura?.instrumentId) continue;
    const inst =
      getCatalogInstrumentByName(part.name) ??
      // Fallback: name-or-baseName + transposition + staves
      INSTRUMENT_CATALOG.find((i) => {
        const partHs = part.transposition?.interval?.halfSteps;
        const partSt = part.staves ?? 1;
        const matchesT = partHs === undefined ? !i.transposition : i.transposition?.halfSteps === partHs;
        const matchesS = i.staves === partSt;
        const matchesN =
          i.name.toLowerCase() === part.name.toLowerCase() ||
          (i.baseName && i.baseName.toLowerCase() === part.name.toLowerCase());
        return matchesT && matchesS && matchesN;
      });
    if (!inst) continue;
    const ext = part._x?.viritura ?? {};
    ext.instrumentId = inst.id;
    if (ext.midiProgram === undefined) ext.midiProgram = inst.midiProgram;
    if (ext.family === undefined) ext.family = inst.family;
    part._x = { viritura: ext };
    filled++;
  }
  return filled;
}
