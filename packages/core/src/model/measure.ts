import type { NoteValueBase } from "../enums";
import type {
  RhythmicPosition as RawRhythmicPosition,
  MeasureRhythmicPosition as RawMeasureRhythmicPosition,
  Beam as RawBeam,
  BeamHookDirection as RawBeamHookDirection,
  DynamicGroupType as RawDynamicGroupType,
  DynamicValue as RawDynamicValue,
  DynamicPrefix as RawDynamicPrefix,
  DynamicSuffix as RawDynamicSuffix,
  Ending as RawEnding,
  MultiStaffOrientation as RawMultiStaffOrientation,
  RelativeDynamicValue as RawRelativeDynamicValue,
  WedgeType as RawWedgeType,
} from "../raw";
import type { PositionedClef } from "./clef";
import type { Caesura, Sequence } from "./event";
import type { KeySignature } from "./key";
import type { TimeSignature } from "./time";
import type { Barline } from "./barline";
import type { Narrow } from "./_derive";

// ═══════════════════════════════════════════
// Rhythmic position
// ═══════════════════════════════════════════

/** Rhythmic position within a measure (as a fraction).
 *  Derived from MNX raw `rhythmic-position`, narrowing `fraction` from
 *  `number[]` to the well-formed `[numerator, denominator]` tuple the
 *  rest of the codebase expects. */
export type RhythmicPosition = Narrow<RawRhythmicPosition, { fraction: [number, number] }>;

/** Measure-qualified rhythmic position (MNX `measure-rhythmic-position`).
 *  Derived from MNX raw, narrowing the nested fraction. */
export type MeasureRhythmicPosition = Narrow<RawMeasureRhythmicPosition, { position: RhythmicPosition }>;

// ═══════════════════════════════════════════
// Beam definitions
// ═══════════════════════════════════════════

/** Direction of a beam hook (beamlet). Derived from MNX raw. */
export type BeamHookDirection = RawBeamHookDirection;

/** A beam group connecting two or more events (MNX beam object).
 *  Derived from MNX raw `beam`, with `beams` recursively narrowed so the
 *  type alias is self-referential rather than carrying the openapi indirection. */
export type Beam = Narrow<RawBeam, { beams?: Beam[] }>;

// ═══════════════════════════════════════════
// Repeat / Ending
// ═══════════════════════════════════════════

/** Repeat-start marker on a global measure (MNX repeatStart). */
export interface RepeatStart {
  times?: number;
}

/** Repeat-end marker on a global measure (MNX repeatEnd). */
export interface RepeatEnd {
  times?: number;
}

/** Volta bracket / alternate ending (MNX "ending").
 *  Derived from MNX raw, narrowing `numbers` to required (MNX spec
 *  marks it optional, but every consumer in the codebase treats voltas
 *  as having at least one pass number). */
export type Ending = Narrow<RawEnding, { numbers: number[] }>;

// ═══════════════════════════════════════════
// Direction types (tempo, dynamics, ottava, jumps)
// ═══════════════════════════════════════════

/** Note value for tempo markings (MNX note-value with base and optional dots). */
export interface TempoNoteValue {
  base: NoteValueBase;
  dots?: number;
}

/** A tempo marking at a rhythmic position (MNX tempos[]). */
export interface Tempo {
  bpm: number;
  value: TempoNoteValue;
  location?: RhythmicPosition;
  /** Optional text label (e.g. "Allegro"). Viritura extension (_x.viritura.text). */
  text?: string;
  /** Whether to show the metronome mark (♩ = 120). Defaults to true. Viritura extension. */
  showMetronomeMark?: boolean;
  /** Whether to show the text label. Defaults to true. Viritura extension. */
  showText?: boolean;
  /** Manual [dx, dy] offset in spatia (sp); +x right, +y up. Viritura extension. */
  manualOffset?: [number, number];
  /** Whether automatic collision avoidance may re-flow this marking. Unset/true
   *  = re-flow (default); false = pinned. Viritura extension. */
  avoidCollisions?: boolean;
}

/** Standard MNX dynamic-group discriminator. */
export type DynamicGroupType = RawDynamicGroupType;

/** Standard absolute dynamic values. */
export type DynamicValue = RawDynamicValue;

/** Structural prefix letter of an accent dynamic (`s`, `r`, or none). */
export type DynamicPrefix = RawDynamicPrefix;

/** Structural suffix letter of an accent dynamic (`z` or none). */
export type DynamicSuffix = RawDynamicSuffix;

/** Standard relative dynamic direction. */
export type RelativeDynamicValue = RawRelativeDynamicValue;

/** Standard gradual dynamic wedge direction. */
export type WedgeType = RawWedgeType;

/** Dynamic placement with support for the inter-staff gap. */
export type MultiStaffOrientation = RawMultiStaffOrientation;

/** Fields shared by all standard MNX dynamic groups. */
export interface DynamicGroupBase {
  /** Stable UUID-v7 identity used by editing, CRDT, and selection. */
  id: string;
  type: DynamicGroupType;
  position: RhythmicPosition;
  value?: DynamicValue;
  /** Accent-only: level that persists after the attack (the `p` of `fp`). */
  residualValue?: DynamicValue;
  /** Accent-only structural prefix. Absent means the `s` of `sfz`. */
  accentPrefix?: DynamicPrefix;
  /** Accent-only structural suffix. Absent means the `z` of `sfz`. */
  accentSuffix?: DynamicSuffix;
  end?: MeasureRhythmicPosition;
  glyphs?: string[];
  orient?: MultiStaffOrientation;
  prefix?: string;
  relativeValue?: RelativeDynamicValue;
  staff?: number;
  /** Gradual-only: staff on which a diagonal cross-staff hairpin ends. */
  staffEnd?: number;
  suffix?: string;
  /** Id of the preceding group this one continues, so both engrave at one
   *  shared vertical position. */
  visuallyContinues?: string;
  voice?: string;
  wedgeType?: WedgeType;
  /** Manual [dx, dy] offset in spatia (sp); +x right, +y up. Viritura extension. */
  manualOffset?: [number, number];
  /** Whether automatic collision avoidance may re-flow this group. Unset/true
   *  = re-flow (default); false = pinned. Viritura extension. */
  avoidCollisions?: boolean;
}

/** An absolute, persistent dynamic level. */
export type ImmediateDynamicGroup = DynamicGroupBase & {
  type: "immediate";
  value: DynamicValue;
};

/** A crescendo or diminuendo span. */
export type GradualDynamicGroup = DynamicGroupBase & {
  type: "gradual";
  end: MeasureRhythmicPosition;
  wedgeType: WedgeType;
};

/** A persistent relative level change. */
export type RelativeDynamicGroup = DynamicGroupBase & {
  type: "relative";
  relativeValue: RelativeDynamicValue;
};

/** A temporary onset emphasis. */
export type AccentDynamicGroup = DynamicGroupBase & {
  type: "accent";
  value: DynamicValue;
};

/** A standard MNX dynamic group. */
export type DynamicGroup = ImmediateDynamicGroup | GradualDynamicGroup | RelativeDynamicGroup | AccentDynamicGroup;

/** An ottava marking (8va, 15ma, etc.) spanning from a position to an end position. */
export interface Ottava {
  position: RhythmicPosition;
  end: MeasureRhythmicPosition;
  value: number;
  /** Vertical orientation (MNX `orient`, above/below/auto). */
  orient?: import("./event").Orientation;
  staff?: number;
  voice?: string;
}

/** Piano pedal type. */
export type PedalType = "sustain" | "sostenuto" | "una-corda";

/** Piano pedal line style. */
export type PedalLineStyle = "text" | "bracket";

/** A piano pedal marking spanning from a position to an end position. */
export interface Pedal {
  type: PedalType;
  position: RhythmicPosition;
  end: MeasureRhythmicPosition;
  style?: PedalLineStyle;
  staff?: number;
  voice?: string;
}

/** Placement of a text expression (above or below the staff). */
export type ExpressionPlacement = "below" | "above";

/** A text expression or direction at a rhythmic position (e.g. "dolce", "rit.", "a tempo"). */
export interface TextExpression {
  /** The expression text (e.g. "dolce", "espressivo", "rit.") */
  text: string;
  /** Rhythmic position within the measure */
  position: RhythmicPosition;
  /** Placement above or below the staff (default: below) */
  placement?: ExpressionPlacement;
  /** Optional staff number */
  staff?: number;
  /** Optional voice name */
  voice?: string;
  /** Manual [dx, dy] offset in spatia (sp), applied after automatic placement.
   *  Positive dx = right, positive dy = up. */
  manualOffset?: [number, number];
  /** Whether automatic collision avoidance may re-flow this expression outward
   *  to clear other directions. Unset/true = re-flow (default). false = pinned:
   *  stays exactly where placed; others flow around it. */
  avoidCollisions?: boolean;
}

/** A segno marker on a global measure (MNX segno). */
export interface Segno {
  location: RhythmicPosition;
  glyph?: string;
  color?: string;
}

/** A fine marker on a global measure (MNX fine). */
export interface Fine {
  location: RhythmicPosition;
  color?: string;
}

/** A coda marker on a global measure (Viritura extension). */
export interface Coda {
  location: RhythmicPosition;
  glyph?: string;
  color?: string;
}

/**
 * Jump type — domain union of MNX (`segno`, `dsalfine`) and the
 * Viritura vendor extension (`dsalcoda`, `dcalcoda`). Cannot alias the
 * raw enum directly because the model collapses both wire enums into
 * one rendering surface.
 */
export type JumpType = "segno" | "dsalfine" | "dsalcoda" | "dcalcoda";

/** A jump direction on a global measure (MNX jump). */
export interface Jump {
  type: JumpType;
  location: RhythmicPosition;
}

/** Gradual-tempo classification (cosmetic; BPM direction is authoritative). */
export type GradualTempoKind = "rit" | "accel";

/**
 * A gradual tempo change (ritardando / accelerando) playback curve on a global
 * measure (Viritura extension). The tempo ramps linearly in BPM from the active
 * tempo at `position` (or `startBpm` if given) to `endBpm` at `end`. Playback
 * data only — the printed "rit."/"accel." text is an ordinary text-expression.
 */
export interface GradualTempo {
  /** Start position within this measure. */
  position: RhythmicPosition;
  /** End position (may reference a later measure). */
  end: MeasureRhythmicPosition;
  /** Quarter-note BPM reached at the end of the ramp. */
  endBpm: number;
  /** Optional start BPM (quarter-note). Defaults to the tempo active at `position`. */
  startBpm?: number;
  /** Optional classification. Cosmetic; the BPM direction determines behavior. */
  kind?: GradualTempoKind;
}

/** Rehearsal mark display style. */
export type RehearsalMarkStyle = "boxed" | "circled" | "plain";

/** A rehearsal mark on a global measure (Viritura extension). */
export interface RehearsalMark {
  text: string;
  style?: RehearsalMarkStyle;
  /** Manual [dx, dy] offset in spatia (sp); +x right, +y up. Viritura extension. */
  manualOffset?: [number, number];
  /** Whether automatic collision avoidance may re-flow this mark. Unset/true =
   *  re-flow (default); false = pinned. Viritura extension. */
  avoidCollisions?: boolean;
}

// ═══════════════════════════════════════════
// Chord symbols
// ═══════════════════════════════════════════

/** Chord quality — aliased to the Viritura vendor `chord-quality` schema. */
export type ChordQuality = import("../raw/raw-viritura").ChordQuality;

/** Root or bass note of a chord (step + optional alteration). */
export interface ChordRoot {
  step: string;
  alter?: number;
}

/** A chord symbol above the staff (e.g., "Cmaj7", "Dm", "G7", "F#dim"). */
export interface ChordSymbol {
  position: RhythmicPosition;
  root: ChordRoot;
  quality: ChordQuality;
  bass?: ChordRoot;
  extension?: number;
  textOverride?: string;
}

// ═══════════════════════════════════════════
// Measures
// ═══════════════════════════════════════════

/**
 * A global measure — score-wide properties shared across all parts (MNX "global.measures[n]").
 */
export interface GlobalMeasure {
  /** Unique ID */
  id?: string;
  /** Custom measure number override (MNX measure-number).
   *  When set, overrides the default sequential numbering. */
  number?: number;
  /** Time signature (only if changed at this measure) */
  time?: TimeSignature;
  /** Key signature (only if changed at this measure) */
  key?: KeySignature;
  /** Barline at end of measure */
  barline?: Barline;
  /** Repeat start marker */
  repeatStart?: RepeatStart;
  /** Repeat end marker */
  repeatEnd?: RepeatEnd;
  /** Volta bracket / alternate ending */
  ending?: Ending;
  /** Tempo markings in this measure */
  tempos?: Tempo[];
  /** Segno marker */
  segno?: Segno;
  /** Fine marker */
  fine?: Fine;
  /** Jump direction */
  jump?: Jump;
  /** Rehearsal mark (Viritura extension) */
  rehearsalMark?: RehearsalMark;
  /** Coda marker (Viritura extension) */
  coda?: Coda;
  /** Caesura (break) marker (Viritura extension) */
  caesura?: Caesura;
  /** Gradual tempo change (rit./accel.) playback curve (Viritura extension) */
  gradualTempo?: GradualTempo;
}

/**
 * A part-specific measure — the content for one part in one measure (MNX "parts[n].measures[m]").
 */
export interface PartMeasure {
  /** Clefs active in this measure */
  clefs?: PositionedClef[];
  /** Voices (sequences) in this measure */
  sequences: Sequence[];
  /** Arpeggio markings in this measure (MNX `arpeggios[]`) */
  arpeggios?: PartMeasureArpeggio[];
  /** Non-arpeggio bracket markings in this measure (MNX `nonArpeggios[]`) */
  nonArpeggios?: NonArpeggio[];
  /** Beams in this measure */
  beams?: Beam[];
  /** Standard dynamic groups in this measure, including gradual hairpins. */
  dynamics?: DynamicGroup[];
  /** Ottava markings in this measure */
  ottavas?: Ottava[];
  /** Piano pedal markings in this measure */
  pedals?: Pedal[];
  /** Chord symbols above the staff */
  chordSymbols?: ChordSymbol[];
  /** Text expressions in this measure (e.g. "dolce", "rit.", "a tempo") */
  expressions?: TextExpression[];
  /** Simile marking: repeat the previous N measures (MNX `measureRepeat`). */
  measureRepeat?: MeasureRepeat;
  /** User-specified condensing override for this measure (Viritura extension).
   *  Values: "unison", "solo1", "solo2", "amalgamate", "divisi" */
  condensingOverride?: string;
}

/**
 * A counter printed with a measure-repeat sign so players can track which
 * iteration they are on.
 */
export interface MeasureRepeatCounter {
  count: number;
  orient?: MultiStaffOrientation;
}

/** MNX `yes-no-auto` override for a measure-repeat span number. */
export type MeasureRepeatDisplayNumber = "yes" | "no" | "auto";

/**
 * A simile marking: "repeat all music in the previous N measures".
 *
 * Only the first bar of a multi-bar repeat carries this; the bars it covers
 * encode nothing. The covered sequences are normally empty, but MNX permits
 * both the sign and notated content in the same bar.
 */
export interface MeasureRepeat {
  /** Number of measures to repeat. */
  number: number;
  counter?: MeasureRepeatCounter;
  /** Whether to print the repeat count above the sign. Unset and `auto` let
   *  the engraver decide by convention. */
  displayNumber?: MeasureRepeatDisplayNumber;
  /** Vertical origin of the glyph on the staff; unset means centred. */
  staffPosition?: number;
}

export interface IdPair {
  start: string;
  end: string;
}

export interface PartMeasureArpeggio {
  position: RhythmicPosition;
  span: IdPair;
  direction?: "up" | "down" | "auto";
  arrow?: boolean;
  id?: string;
}

export interface NonArpeggio {
  position: RhythmicPosition;
  span: IdPair;
  id?: string;
}

/**
 * Resolved measure: combines global + part-specific data for rendering.
 * This is what the layout engine and renderer work with.
 */
export interface ResolvedMeasure {
  /** Measure index (0-based) */
  index: number;
  /** Global properties */
  global: GlobalMeasure;
  /** Part-specific content */
  part: PartMeasure;
  /** Active time signature at this measure (inherited from previous if not set here) */
  activeTime: TimeSignature;
  /** Active key signature at this measure */
  activeKey: KeySignature;
}
