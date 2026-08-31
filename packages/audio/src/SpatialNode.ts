/**
 * SpatialNode — wraps a Web Audio PannerNode for 2D spatial positioning.
 *
 * Used primarily for spatial canvas visualization (position tracking).
 * Audio panning for SF2 parts is handled via MIDI CC10, not this node.
 *
 * Coordinates use a concert-hall-style system:
 *   X: left (-) to right (+), in meters
 *   Y: listener (0) to back of stage (+), in meters
 *   Listener at (0, 0) facing forward (toward positive Y, i.e. the stage)
 *
 * Reference: Web Audio API PannerNode
 * https://developer.mozilla.org/en-US/docs/Web/API/PannerNode
 */

export interface SpatialPosition {
  /** X position: negative = left, positive = right (meters). */
  x: number;
  /** Y position: 0 = listener, positive = further upstage (meters). */
  y: number;
}

export interface SpatialConfig {
  /** Distance model for volume attenuation. */
  distanceModel?: DistanceModelType;
  /** Reference distance — full volume at this range (meters). Default: 1. */
  refDistance?: number;
  /** Maximum distance for attenuation calculations. Default: 50. */
  maxDistance?: number;
  /** How quickly volume drops with distance beyond refDistance. Default: 1. */
  rolloffFactor?: number;
  /** Panning model. Default: "equalpower". */
  panningModel?: PanningModelType;
}

const DEFAULT_CONFIG: Required<SpatialConfig> = {
  distanceModel: "inverse",
  refDistance: 1,
  maxDistance: 50,
  rolloffFactor: 1,
  panningModel: "equalpower",
};

export class SpatialNode {
  readonly panner: PannerNode;
  private pos: SpatialPosition = { x: 0, y: 0 };

  constructor(ctx: AudioContext, config?: SpatialConfig) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.panner = ctx.createPanner();
    this.panner.panningModel = cfg.panningModel;
    this.panner.distanceModel = cfg.distanceModel;
    this.panner.refDistance = cfg.refDistance;
    this.panner.maxDistance = cfg.maxDistance;
    this.panner.rolloffFactor = cfg.rolloffFactor;

    // Omnidirectional source (sound radiates equally in all directions)
    this.panner.coneInnerAngle = 360;
    this.panner.coneOuterAngle = 360;
    this.panner.coneOuterGain = 1;

    // Initial position at origin
    this.setPosition(0, 0);
  }

  /** Set the 2D position of this sound source. Z is always 0 (flat plane). */
  setPosition(x: number, y: number): void {
    this.pos = { x, y };
    this.panner.positionX.value = x;
    this.panner.positionY.value = 0; // height = 0 (flat)
    this.panner.positionZ.value = -y; // Web Audio Z is "into screen" = our Y (forward)
  }

  /** Get the current 2D position. */
  getPosition(): SpatialPosition {
    return { ...this.pos };
  }

  /** Connect an audio source to this spatial node. */
  connectInput(source: AudioNode): void {
    source.connect(this.panner);
  }

  /** Connect this spatial node's output to a destination. */
  connectOutput(destination: AudioNode): void {
    this.panner.connect(destination);
  }

  /** Disconnect from all outputs. */
  disconnect(): void {
    try {
      this.panner.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

/**
 * Set the AudioListener's 2D position and facing direction.
 * The listener faces toward negative Y (toward the stage).
 */
export function setListenerPosition(ctx: AudioContext, x: number, y: number): void {
  const listener = ctx.listener;
  // Position
  if (listener.positionX) {
    listener.positionX.value = x;
    listener.positionY.value = 0;
    listener.positionZ.value = -y;
  }
  // Facing forward (toward stage = negative Z in Web Audio, since Z = -Y)
  if (listener.forwardX) {
    listener.forwardX.value = 0;
    listener.forwardY.value = 0;
    listener.forwardZ.value = -1; // facing into -Z = our +Y (forward toward stage)
  }
  // Up direction
  if (listener.upX) {
    listener.upX.value = 0;
    listener.upY.value = 1; // Y is up in Web Audio
    listener.upZ.value = 0;
  }
}

// ═══════════════════════════════════════════
// Orchestral seating presets
// ═══════════════════════════════════════════

/**
 * Standard orchestral seating layout (American/modern).
 * Positions in meters relative to conductor (0, 0).
 * Positive X = right, negative X = left.
 * Positive Y = back (farther from audience), negative Y = front.
 */
export const ORCHESTRAL_POSITIONS: Record<string, SpatialPosition> = {
  // Strings — spread arc, positions per user layout
  violin: { x: -2, y: 1 },
  violins: { x: -2, y: 1 },
  "violin i": { x: -2, y: 1 },
  "violin ii": { x: -1, y: 3 },
  viola: { x: 1, y: 3 },
  cello: { x: 2, y: 1 },
  contrabass: { x: 4, y: 1 },
  "double bass": { x: 4, y: 1 },

  // Woodwinds — centered grid, bases 1m apart to match SECTION_SPREAD
  //   Front row: Flute (left)  |  Oboe (right)
  //   Back row:  Clarinet (left) | Bassoon (right)
  // Auxiliary winds are positioned dynamically by getOrchestraPositions()
  // relative to the outermost principal player in their section.
  flute: { x: -0.5, y: 6 },
  piccolo: { x: -0.5, y: 6 }, // dynamic: left of last flute
  oboe: { x: 0.5, y: 6 },
  "english horn": { x: 0.5, y: 6 }, // dynamic: right of last oboe
  clarinet: { x: -0.5, y: 7 },
  "bass clarinet": { x: -0.5, y: 7 }, // dynamic: left of last clarinet
  bassoon: { x: 0.5, y: 7 },
  contrabassoon: { x: 0.5, y: 7 }, // dynamic: right of last bassoon

  // Brass — aligned behind winds, spreading outward
  // Horn 1 behind Clarinet 1, spreads left. Trumpet 1 behind Bassoon 1, spreads right.
  "french horn": { x: -0.5, y: 8 },
  horn: { x: -0.5, y: 8 },
  trumpet: { x: 0.5, y: 8 },
  trombone: { x: 3.5, y: 8 },
  "bass trombone": { x: 3.5, y: 8 }, // dynamic: right of last trombone
  tuba: { x: 6.5, y: 8 },

  // Percussion (far back)
  timpani: { x: 0, y: 10 },
  glockenspiel: { x: 0, y: 10.5 },
  xylophone: { x: 0.5, y: 10.5 },
  vibraphone: { x: -0.5, y: 10.5 },
  marimba: { x: 1, y: 10.5 },
  "tubular bells": { x: 2, y: 10.5 },

  // Keys (left side, front-ish)
  piano: { x: -5, y: 4 },
  celesta: { x: -4, y: 7 },
  organ: { x: 0, y: 12 },

  // Harp (left side)
  harp: { x: -5, y: 6 },

  // Choir (far back, wide)
  soprano: { x: -3, y: 11 },
  alto: { x: -1, y: 11 },
  tenor: { x: 1, y: 11 },
  baritone: { x: 2, y: 11 },
  bass: { x: 3, y: 11 },
  "bass voice": { x: 3, y: 11 },
  choir: { x: 0, y: 11 },
};

/** Default listener position (origin). */
export const DEFAULT_LISTENER_POSITION: SpatialPosition = { x: 0, y: 1 };

/**
 * Resolve a part name to an orchestral position.
 * Uses fuzzy matching similar to the instrument mapper.
 */
export function getOrchestraPosition(partName: string): SpatialPosition {
  const lower = partName.toLowerCase().trim();

  // Exact match
  const exact = ORCHESTRAL_POSITIONS[lower];
  if (exact) return exact;

  // Strip suffixes (numbers, roman numerals, transposition markers)
  const stripped = lower
    .replace(/\s+in\s+[a-g][b#♭♯]?\s*$/i, "")
    .replace(/^[a-g][b#♭♯]?\s+/i, "")
    .replace(/\s+[ivxlcdm]+\.?\s*$/i, "")
    .replace(/\s+\d+\.?\s*$/, "")
    .trim();

  const strippedMatch = ORCHESTRAL_POSITIONS[stripped];
  if (strippedMatch) return strippedMatch;

  // Substring match (longest key first)
  const sortedKeys = Object.keys(ORCHESTRAL_POSITIONS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key) || stripped.includes(key)) {
      const pos = ORCHESTRAL_POSITIONS[key];
      if (pos) return pos;
    }
  }

  // Default: center stage
  return { x: 0, y: 0 };
}

/** Horizontal spacing (meters) between same-instrument players. */
const SECTION_SPREAD = 1.0;

/**
 * Predefined positions by rank for string sections.
 * When multiple parts share the same canonical name (e.g. two "Violin" parts),
 * these positions override the default X-only spread to give each part a
 * distinct (x, y) position instead of overlapping.
 */
const STRING_RANK_POSITIONS: Record<string, SpatialPosition[]> = {
  violin: [
    { x: -2, y: 1 },
    { x: -1, y: 3 },
  ],
  violins: [
    { x: -2, y: 1 },
    { x: -1, y: 3 },
  ],
};

/**
 * Maps variant instrument names to their canonical family name.
 * Instruments in the same family are grouped together for spreading.
 */
const INSTRUMENT_FAMILIES: Record<string, string> = {
  "alto trombone": "trombone",
  "tenor trombone": "trombone",
  "bass trombone": "trombone",
};

/**
 * Auxiliary wind instruments and which principal they sit next to.
 * "side" is where the auxiliary goes relative to the outermost principal:
 *   "away" = further from x=0 (same direction principals spread)
 */
const AUXILIARY_WINDS: Record<string, { principal: string }> = {
  piccolo: { principal: "flute" },
  "english horn": { principal: "oboe" },
  "bass clarinet": { principal: "clarinet" },
  contrabassoon: { principal: "bassoon" },
};

/**
 * Resolve orchestral positions for a list of part names, spreading
 * duplicate instruments horizontally so they don't overlap.
 *
 * Within a group of same-instrument parts (e.g. Flute 1, Flute 2, Flute 3),
 * the lead player (first in score order) is positioned closest to x=0
 * and subsequent players spread outward from center — away from x=0.
 *
 * Auxiliary winds (piccolo, english horn, bass clarinet, contrabassoon) are
 * placed just beyond the outermost principal of their parent section.
 *
 * @returns Array of positions, one per input part name.
 */
export function getOrchestraPositions(partNames: string[]): SpatialPosition[] {
  const { basePositions, canonicals, hasOwnEntry, groups } = resolveBasePositions(partNames);
  const result = basePositions.map((p) => ({ ...p }));
  spreadPrincipalGroups(result, basePositions, groups, hasOwnEntry);
  positionAuxiliaryWinds(result, canonicals, groups);
  spreadDuplicateAuxiliaries(result, groups);
  return result;
}

interface PartBaseInfo {
  basePositions: SpatialPosition[];
  canonicals: string[];
  hasOwnEntry: boolean[];
  groups: Map<string, number[]>;
}

function resolveBasePositions(partNames: string[]): PartBaseInfo {
  const basePositions: SpatialPosition[] = [];
  const canonicals: string[] = [];
  const hasOwnEntry: boolean[] = [];
  const groups = new Map<string, number[]>();

  for (let i = 0; i < partNames.length; i++) {
    const name = partNames[i]!;
    basePositions.push(getOrchestraPosition(name));

    const lower = name.toLowerCase().trim();
    const strippedName = lower
      .replace(/\s+in\s+[a-g][b#♭♯]?\s*$/i, "")
      .replace(/^[a-g][b#♭♯]?\s+/i, "")
      .replace(/\s+[ivxlcdm]+\.?\s*$/i, "")
      .replace(/\s+\d+\.?\s*$/, "")
      .trim();
    hasOwnEntry.push(lower in ORCHESTRAL_POSITIONS && lower !== strippedName);

    const canonical = INSTRUMENT_FAMILIES[strippedName] ?? strippedName;
    canonicals.push(canonical);
    const group = groups.get(canonical);
    if (group) group.push(i);
    else groups.set(canonical, [i]);
  }

  return { basePositions, canonicals, hasOwnEntry, groups };
}

function spreadStringRanks(
  result: SpatialPosition[],
  spreadable: number[],
  rankPositions: readonly SpatialPosition[],
): void {
  for (let rank = 0; rank < spreadable.length; rank++) {
    const idx = spreadable[rank]!;
    const pos = rankPositions[rank];
    if (pos) {
      result[idx]!.x = pos.x;
      result[idx]!.y = pos.y;
    } else {
      const lastKnown = rankPositions[rankPositions.length - 1]!;
      const sign = lastKnown.x >= 0 ? 1 : -1;
      result[idx]!.x = lastKnown.x + sign * (rank - rankPositions.length + 1) * SECTION_SPREAD;
      result[idx]!.y = lastKnown.y;
    }
  }
}

function spreadPrincipalGroups(
  result: SpatialPosition[],
  basePositions: SpatialPosition[],
  groups: Map<string, number[]>,
  hasOwnEntry: boolean[],
): void {
  for (const [canonical, indices] of groups) {
    if (AUXILIARY_WINDS[canonical]) continue;

    const spreadable = indices.filter((i) => !hasOwnEntry[i]);
    if (spreadable.length <= 1) continue;

    const rankPositions = STRING_RANK_POSITIONS[canonical];
    if (rankPositions) {
      spreadStringRanks(result, spreadable, rankPositions);
      continue;
    }

    const baseX = basePositions[spreadable[0]!]!.x;
    const sign = baseX >= 0 ? 1 : -1;
    for (let rank = 0; rank < spreadable.length; rank++) {
      const idx = spreadable[rank]!;
      result[idx]!.x = baseX + sign * rank * SECTION_SPREAD;
    }
  }
}

function positionAuxiliaryWinds(result: SpatialPosition[], canonicals: string[], groups: Map<string, number[]>): void {
  for (let i = 0; i < canonicals.length; i++) {
    const canonical = canonicals[i]!;
    const aux = AUXILIARY_WINDS[canonical];
    if (!aux) continue;

    const principalGroup = groups.get(aux.principal);
    if (principalGroup && principalGroup.length > 0) {
      const lastPrincipalIdx = principalGroup[principalGroup.length - 1]!;
      const lastPrincipalPos = result[lastPrincipalIdx]!;
      const sign = lastPrincipalPos.x >= 0 ? 1 : -1;
      result[i]!.x = lastPrincipalPos.x + sign * SECTION_SPREAD;
      result[i]!.y = lastPrincipalPos.y;
    }
  }
}

function spreadDuplicateAuxiliaries(result: SpatialPosition[], groups: Map<string, number[]>): void {
  for (const [canonical, indices] of groups) {
    if (!AUXILIARY_WINDS[canonical]) continue;
    if (indices.length <= 1) continue;

    const baseX = result[indices[0]!]!.x;
    const sign = baseX >= 0 ? 1 : -1;
    for (let rank = 1; rank < indices.length; rank++) {
      const idx = indices[rank]!;
      result[idx]!.x = baseX + sign * rank * SECTION_SPREAD;
    }
  }
}

// ═══════════════════════════════════════════
// Instrument projection (acoustic power)
// ═══════════════════════════════════════════

/**
 * Per-family refDistance modelling acoustic projection power.
 * Higher refDistance = "no attenuation until this range," simulating
 * how loud instruments carry farther before dropping off.
 *
 * Inverse-distance formula: gain = refDistance / (refDistance + rolloff × (d − refDistance))
 *
 * Typical effective gains at orchestral positions (listener at 0,0):
 *   Strings  (refD 1, ~1.5m) → 0.67    Brass  (refD 6, ~8m) → 0.75
 *   Winds    (refD 3, ~6m)   → 0.50    Perc   (refD 6, ~10m) → 0.60
 */
const FAMILY_PROJECTION: [RegExp, number][] = [
  // Brass — high acoustic power, projects strongly
  [/trumpet|trombone|horn|tuba|brass|cornet|flugelhorn|euphonium/i, 6],
  // Percussion — high acoustic power
  [
    /timpani|glockenspiel|xylophone|vibraphone|marimba|tubular|percussion|snare|bass drum|cymbal|triangle|tam[- ]?tam|gong/i,
    6,
  ],
  // Organ — massive projection
  [/organ/i, 8],
  // Choir — strong vocal projection
  [/soprano|alto|tenor|baritone|bass voice|choir|chorus/i, 5],
  // Woodwinds — moderate projection
  [/flute|piccolo|oboe|clarinet|bassoon|english horn|contrabassoon|recorder|saxophone/i, 3],
  // Piano / Harp / Celesta — moderate
  [/piano|harp|celesta|harpsichord/i, 2],
  // Double bass / contrabass — low-frequency carries well; sits at far edge
  // of the string arc, so give it a higher floor than the rest of the
  // strings or it disappears next to the cellos. Tuned to sit at/just-below
  // cello loudness at default listener position (cello d=2 prox 0.50,
  // contrabass d=4 prox 0.50).
  [/contrabass(?!oon)|double bass/i, 2],
  // Strings — lowest projection (but closest to audience)
  [/violin|viola|cello|contrabass|double bass/i, 1],
];

/**
 * Return the refDistance for a given instrument name, modelling how far
 * that instrument's sound carries before distance attenuation kicks in.
 */
export function getInstrumentProjection(partName: string): number {
  for (const [pattern, refDist] of FAMILY_PROJECTION) {
    if (pattern.test(partName)) return refDist;
  }
  return 1; // default: no special projection
}

// ═══════════════════════════════════════════
// Instrument section classification
// ═══════════════════════════════════════════

/** Orchestra section keys for grouping instruments that share a synth. */
export type OrchestraSection = "strings" | "woodwinds" | "brass" | "percussion" | "keys" | "voices" | "other";

const SECTION_PATTERNS: [RegExp, OrchestraSection][] = [
  [/violin|viola|cello|contrabass(?!oon)|double bass/i, "strings"],
  [/flute|piccolo|oboe|clarinet|bassoon|english horn|contrabassoon|recorder|saxophone/i, "woodwinds"],
  [/trumpet|trombone|horn|tuba|brass|cornet|flugelhorn|euphonium/i, "brass"],
  [
    /timpani|glockenspiel|xylophone|vibraphone|marimba|tubular|percussion|snare|bass drum|cymbal|triangle|tam[- ]?tam|gong|drum kit|drums?\b|tambourine/i,
    "percussion",
  ],
  [/piano|celesta|harpsichord|organ|harp/i, "keys"],
  [/soprano|alto|tenor|baritone|bass voice|choir|chorus/i, "voices"],
];

/** Classify an instrument name into an orchestra section. */
export function getInstrumentSection(partName: string): OrchestraSection {
  for (const [pattern, section] of SECTION_PATTERNS) {
    if (pattern.test(partName)) return section;
  }
  return "other";
}
