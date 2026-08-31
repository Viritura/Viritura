import type { NoteValueBase, StemDirection } from "../enums";
import type {
  AccidentalEnclosure as RawAccidentalEnclosure,
  AccidentalDisplay as RawAccidentalDisplay,
  Written as RawWritten,
  Note as RawNote,
  Staccato as RawStaccato,
  Staccatissimo as RawStaccatissimo,
  Spiccato as RawSpiccato,
  Tenuto as RawTenuto,
  Accent as RawAccent,
  StrongAccent as RawStrongAccent,
  SoftAccent as RawSoftAccent,
  StressMarking as RawStress,
  UnstressMarking as RawUnstress,
  TremoloSingle as RawTremolo,
  BowDirection as RawBowDirection,
  Fermata as RawFermata,
  Arpeggio as RawArpeggio,
} from "../raw";
import type { Pitch } from "./pitch";
import type { KitNote, NoteheadShape } from "./kit";
import type { Narrow, HoistVendor } from "./_derive";

/**
 * Duration (MNX note value).
 */
export interface Duration {
  /** Base note value type */
  base: NoteValueBase;
  /** Number of augmentation dots */
  dots?: number;
}

/**
 * Tie reference (MNX `tie`). Derived directly from MNX raw — the decoded
 * shape is identical to the wire shape (target id, targetType enum, side,
 * lv flag, plus global-attrs).
 */
export type Tie = import("../raw").Tie;

/**
 * Accidental enclosure symbol (MNX accidental-enclosure-symbol).
 * Derived: MNX raw `accidental-enclosure-symbol` exactly.
 */
export type AccidentalEnclosureSymbol = RawAccidentalEnclosure["symbol"];

/**
 * Accidental enclosure (MNX accidental-enclosure). Derived from MNX raw.
 */
export type AccidentalEnclosure = RawAccidentalEnclosure;

/**
 * Accidental display control (MNX accidentalDisplay). Derived from MNX raw.
 */
export type AccidentalDisplay = RawAccidentalDisplay;

/**
 * Written pitch information for transposed scores (MNX `written`).
 * Derived from MNX raw.
 */
export type Written = RawWritten;

/**
 * A single note within an event (a chord can have multiple notes).
 * Derived from MNX raw `note`, with `pitch` narrowed to our `Pitch` type
 * (raw uses an open `octave: number`; we narrow to `Octave = 0..9`).
 *
 * `notehead` is a Viritura vendor extension (`_x.viritura.notehead`) — MNX has
 * no notehead field on `note` (W3C MNX issue #249). It overrides the default
 * notehead for a single pitched note (e.g. a diamond harmonic inside an
 * otherwise normal chord). Stored per-note because chords mix noteheads.
 */
export type Note = HoistVendor<Narrow<RawNote, { pitch: Pitch }>, { notehead?: NoteheadShape }>;

/** Staccato marking. Derived from MNX raw `staccato`. */
export type Staccato = RawStaccato;

/** Staccatissimo (wedge staccato) marking. Derived from MNX raw. */
export type Staccatissimo = RawStaccatissimo;

/** Staccatissimo wedge variant (Viritura extension; not in MNX spec). */
export interface StaccatissimoWedge {
  orient?: Orientation;
}

/** Spiccato marking (staccatissimo stroke, SMuFL U+E4AA). Derived from MNX raw. */
export type Spiccato = RawSpiccato;

/** Tenuto marking. Derived from MNX raw. */
export type Tenuto = RawTenuto;

/** Accent marking (MNX `accent`). Has only `orient` per MNX v15 spec. */
export type Accent = RawAccent;

/** Strong accent (marcato) marking. Derived from MNX raw. */
export type StrongAccent = RawStrongAccent;

/** Soft accent (Bartók accent) marking — a hairpin-like wedge (<>). Derived from MNX raw. */
export type SoftAccent = RawSoftAccent;

/** Stress marking. Derived from MNX raw `stress-marking`. */
export type Stress = RawStress;

/** Unstress marking. Derived from MNX raw `unstress-marking`. */
export type Unstress = RawUnstress;

/** Single-note tremolo marking (1–3 slashes on the stem). Derived from MNX raw `tremolo-single`. */
export type Tremolo = RawTremolo;

/**
 * Bow direction marking (MNX `bowDirection`). Derived from MNX raw.
 * `direction` (required): up = upbow (V), down = downbow (⊓).
 */
export type BowDirection = RawBowDirection;

/** Standard MNX breath-mark symbol type. */
export type BreathMarkSymbol = "comma" | "tick" | "upbow" | "salzedo" | "auto";

/** Breath mark — indicates a breathing point between notes. */
export interface BreathMark {
  /** Symbol style. Omitted and `auto` both leave the choice to the engraver. */
  symbol?: BreathMarkSymbol;
  orient?: Orientation;
}

/** Arpeggio marking — wavy line to the left of a chord.
 *  Derived from MNX raw `arpeggio` (note-level marking). The decoded
 *  model only uses `direction`; `arrow`, `position`, `span` live on the
 *  measure-level {@link PartMeasureArpeggio} instead. */
export type Arpeggio = Pick<RawArpeggio, "direction">;

/** Arpeggio direction. */
export type ArpeggioDirection = RawArpeggio["direction"];

/** Caesura style variants. */
export type CaesuraStyle = "normal" | "thick" | "short" | "curved";

/** A caesura (break) marking on an event (Viritura extension). */
export interface Caesura {
  /** Style variant (default: "normal"). */
  style?: CaesuraStyle;
}

/** Fermata visual symbol (MNX `fermata-symbol`). Derived from MNX raw. */
export type FermataSymbol = NonNullable<RawFermata["symbol"]>;

/** Fermata pause duration (MNX `fermata-duration`). Derived from MNX raw. */
export type FermataDuration = NonNullable<RawFermata["duration"]>;

/** Symbol orientation (MNX `orientation` — above/below/auto). */
export type Orientation = NonNullable<RawStaccato["orient"]>;

/** Up/down/auto direction (MNX `up-down-auto`). */
export type UpDownAuto = NonNullable<RawStrongAccent["pointing"]>;

/** Up/down direction (MNX `up-down`). */
export type UpDown = RawBowDirection["direction"];

/** Fermata (hold) marking on a note or rest. Derived from MNX raw. */
export type Fermata = RawFermata;

/** Trill ornament marking. */
export interface Trill {
  /** Accidental alteration: -1 = flat, 0 = natural, 1 = sharp */
  accidental?: number;
}

/** Ornament type variants — aliased to the Viritura vendor `ornament-type` schema. */
export type OrnamentType = import("../raw/raw-viritura").OrnamentType;

/** Fingering annotation — a digit (0–5) placed near a notehead. */
export interface Fingering {
  /** Finger number: 0 (thumb in some traditions), 1–5. */
  finger: number;
}

/**
 * Event markings — articulations and other note-level annotations (MNX markings).
 */
export interface Markings {
  staccato?: Staccato;
  staccatissimo?: Staccatissimo;
  staccatissimoWedge?: StaccatissimoWedge;
  spiccato?: Spiccato;
  accent?: Accent;
  tenuto?: Tenuto;
  strongAccent?: StrongAccent;
  softAccent?: SoftAccent;
  stress?: Stress;
  unstress?: Unstress;
  tremolo?: Tremolo;
  breath?: BreathMark;
  /** Bow direction marking (MNX `bowDirection`). */
  bowDirection?: BowDirection;
  trill?: Trill;
  ornaments?: OrnamentType[];
  arpeggio?: Arpeggio;
  /** Caesura (break) marking (Viritura extension). */
  caesura?: Caesura;
  /** Fingering annotations (digits placed near noteheads). */
  fingerings?: Fingering[];
}

/**
 * MNX "space" element — a rhythmic gap that advances time without rendering.
 */
export interface Space {
  type: "space";
  /** Duration as a fraction [numerator, denominator] */
  duration: [number, number];
}

/** Syllable type for a lyric (MNX event-lyric-line-type). */
export type LyricLineType = "start" | "middle" | "end" | "whole";

/** A single lyric line entry on an event (MNX event-lyric-line). */
export interface LyricLine {
  /** The syllable text */
  text: string;
  /** Syllable type indicating word continuation */
  type?: LyricLineType;
}

/**
 * Lyrics attached to an event (MNX lyrics).
 * The lines map keys are lyric line IDs (e.g., "1", "2" for verse numbers).
 */
export interface Lyrics {
  lines?: Record<string, LyricLine>;
}

/** Slur line type (MNX lineType). */
export type SlurLineType = "solid" | "dashed" | "dotted";

/** Slur side (MNX side / sideEnd). */
export type SlurSide = "up" | "down";

/**
 * Per-slur shape override stored in `_x.viritura.shape`.
 *
 * Each field is a `[dx, dy]` delta in spatia (sp) applied on top of the
 * engine-computed bezier point. Used by engrave-mode handle drags so user
 * edits compose with automatic collision avoidance.
 */
export interface SlurShape {
  /** Start endpoint (p0) delta in sp. */
  p0?: [number, number];
  /** First control point (p1) delta in sp. */
  p1?: [number, number];
  /** Second control point (p2) delta in sp. */
  p2?: [number, number];
  /** End endpoint (p3) delta in sp. */
  p3?: [number, number];
}

/** Slur reference (MNX slur). */
export interface Slur {
  target: string;
  side?: SlurSide;
  sideEnd?: SlurSide;
  lineType?: SlurLineType;
  startNote?: string;
  endNote?: string;
  /** Viritura vendor extension: per-handle bezier overrides for engrave mode. */
  shape?: SlurShape;
}

/** Glissando line style. */
export type GlissandoStyle = "straight" | "wavy";

/** Glissando line connecting two notes at different pitches. */
export interface Glissando {
  target: string;
  style?: GlissandoStyle;
  text?: string;
}

/**
 * An event is a single rhythmic moment: a note, chord, or rest.
 * This is the fundamental unit of content in a sequence.
 */
export interface NoteEvent {
  type: "event";
  /** Unique ID */
  id?: string;
  /** Duration of this event */
  duration: Duration;
  /** Notes in this event (empty/undefined = rest) */
  notes?: Note[];
  /** Drum kit hits in this event (MNX `kitNotes`). Only on percussion parts. */
  kitNotes?: KitNote[];
  /** If present, this is a rest. staffPosition overrides default vertical position. */
  rest?: { staffPosition?: number };
  /** Cross-staff override: render this event on the specified staff number (1-indexed) */
  staff?: number;
  /** Stem direction override */
  stemDirection?: StemDirection;
  /** Vertical orientation (MNX `orient`, above/below/auto). Forces stem direction. */
  orient?: Orientation;
  /** Slurs starting from this event */
  slurs?: Slur[];
  /** Glissando lines starting from this event */
  glissandos?: Glissando[];
  /** Articulation markings */
  markings?: Markings;
  /** Native MNX fermata (event-level since v15). */
  fermata?: Fermata;
  /** Lyrics attached to this event */
  lyrics?: Lyrics;
}

/** Grace note type — how the grace notes affect timing (MNX grace-type). */
export type GraceType = "makeTime" | "stealFollowing" | "stealPrevious";

/** A grace note container (MNX grace). */
export interface Grace {
  type: "grace";
  /** The events within this grace note group */
  content: NoteEvent[];
  /** How the grace notes affect timing */
  graceType?: GraceType;
  /** Whether to display a slash through the flag/beam */
  slash?: boolean;
  /** Optional rendering color (MNX `color`, e.g. "#ff0000"). */
  color?: string;
}

/** Duration specification for a tuplet (inner or outer). */
export interface TupletDuration {
  duration: Duration;
  multiple: number;
}

/** MNX `yes-no-auto` for tuplet bracket display. */
export type TupletBracket = "yes" | "no" | "auto";

/** MNX `tuplet-display-setting` for showNumber / showValue. */
export type TupletDisplaySetting = "noNumber" | "inner" | "both";

/** A tuplet container (MNX tuplet). */
export interface Tuplet {
  type: "tuplet";
  /** Inner duration: what the content actually spans */
  inner: TupletDuration;
  /** Outer duration: the notated duration the tuplet replaces */
  outer: TupletDuration;
  /** The events (or nested tuplets) within this tuplet */
  content: SequenceContent[];
  /** Whether to show the tuplet bracket (MNX `bracket`). Default: auto. */
  bracket?: TupletBracket;
  /** Which number(s) to display (MNX `showNumber`). Default: inner. */
  showNumber?: TupletDisplaySetting;
  /** Which note value(s) to display (MNX `showValue`). Default: absent. */
  showValue?: TupletDisplaySetting;
  /** Vertical orientation (MNX `orient`, above/below/auto). */
  orient?: Orientation;
  /** Cross-staff tuplet: render on the specified staff number (1-indexed). */
  staff?: number;
}

/** Multi-note tremolo container (MNX tremolo). */
export interface MultiNoteTremolo {
  type: "tremolo";
  /** The two events in this tremolo */
  content: NoteEvent[];
  /** Number of tremolo slashes (1, 2, or 3) */
  marks: number;
  /** Outer duration: the total notated duration the tremolo occupies */
  outer: TupletDuration;
  /** Individual note duration override (MNX individual-duration). */
  individualDuration?: Duration;
}

/**
 * Visual duration for a full-measure rest (MNX fullMeasure).
 */
export interface FullMeasure {
  /** The visual duration to display (e.g., whole rest) */
  visualDuration: Duration;
  /** Explicit staff position override (MNX staffPosition). 0 = middle line, positive = up. */
  staffPosition?: number;
}

/**
 * A sequence is a single voice within a measure (MNX "sequence").
 * Multiple sequences in one measure = multiple voices.
 */
export interface Sequence {
  /** Content items (events, tuplets, grace notes, spaces) */
  content: SequenceContent[];
  /** Full-measure rest indicator */
  fullMeasure?: FullMeasure;
  /** Staff number for this sequence (1-indexed; used in grand staff / organ parts) */
  staff?: number;
  /** Voice name for this sequence (MNX voice identifier) */
  voice?: string;
  /** Vertical orientation (MNX `orient`, above/below/auto). Forces stem direction
   *  for all events in this sequence. */
  orient?: Orientation;
}

/**
 * Content within a sequence — discriminated union of all content types.
 */
export type SequenceContent = NoteEvent | Tuplet | Grace | MultiNoteTremolo | Space;

/**
 * Type guard: narrow SequenceContent to NoteEvent.
 */
export function isNoteEvent(item: SequenceContent): item is NoteEvent {
  return item.type === "event";
}

/**
 * Helper: is this event a rest?
 */
export function isRest(event: NoteEvent): boolean {
  if (event.rest !== undefined) return true;
  const hasNotes = event.notes && event.notes.length > 0;
  const hasKitNotes = event.kitNotes && event.kitNotes.length > 0;
  return !hasNotes && !hasKitNotes;
}
