// ─── MNX document output types (rolling schema revision 19) ──────────

import type { DynamicGroup } from "@viritura/core";

export interface MnxDocument {
  mnx: { version: number };
  global: MnxGlobal;
  parts: MnxPart[];
  layouts?: MnxSystemLayout[];
  scores?: MnxScore[];
}

export interface MnxGlobal {
  measures: MnxGlobalMeasure[];
  lyrics?: MnxLyricsGlobal;
  /** Registry of named GM-MIDI sound entries, keyed by sound id. Referenced
   *  by `MnxKitComponent.sound` for percussion playback routing. */
  sounds?: Record<string, MnxSound>;
}

/** A GM MIDI sound entry (MNX `sound`). */
export interface MnxSound {
  name?: string;
  midiNumber?: number;
}

interface MnxLyricsGlobal {
  lineMetadata?: Record<string, { label?: string; lang?: string }>;
  lineOrder?: string[];
}

export interface MnxGlobalMeasure {
  id?: string;
  number?: number;
  time?: { count: number; unit: number; display?: string };
  key?: { fifths: number };
  barline?: { type: string };
  repeatStart?: Record<string, unknown>;
  repeatEnd?: { times?: number };
  ending?: MnxEnding;
  tempos?: MnxTempo[];
  segno?: { location: MnxRhythmicPosition };
  fine?: { location: MnxRhythmicPosition };
  jump?: { type: string; location: MnxRhythmicPosition };
}

export interface MnxEnding {
  duration: number;
  numbers?: number[];
  open?: boolean;
}

export interface MnxTempo {
  bpm: number;
  value: MnxDuration;
  location?: MnxRhythmicPosition;
  _x?: { viritura: Record<string, unknown> };
}

export interface MnxRhythmicPosition {
  fraction: [number, number];
  graceIndex?: number;
}

export interface MnxPart {
  id: string;
  name?: string;
  shortName?: string;
  staves?: number;
  transposition?: MnxTransposition;
  /** Drum-kit components for unpitched percussion parts, keyed by component
   *  id. Present only when the part is percussion (events use `kitNotes`). */
  kit?: Record<string, MnxKitComponent>;
  measures: MnxPartMeasure[];
}

/** A single drum/percussion instrument on a staff (MNX `kit-component`). */
export interface MnxKitComponent {
  staffPosition: number;
  sound?: string;
  name?: string;
  _x?: { viritura: { notehead?: string } };
}

/** A drum-hit "note" within an event (MNX `kit-note`): no pitch, references a
 *  kit-component on the part's kit. */
export interface MnxKitNote {
  kitComponent: string;
  staff?: number;
  ties?: MnxTie[];
}

export interface MnxTransposition {
  interval: { halfSteps: number; staffDistance: number };
  keyFifthsFlipAt?: number;
  prefersWrittenPitches?: boolean;
}

export interface MnxPartMeasure {
  clefs?: MnxPositionedClef[];
  dynamics?: MnxDynamic[];
  sequences?: MnxSequence[];
  beams?: MnxBeam[];
  ottavas?: MnxOttava[];
}

export interface MnxPositionedClef {
  clef: MnxClef;
  position?: MnxRhythmicPosition;
  staff?: number;
}

export interface MnxClef {
  sign: string;
  staffPosition: number;
  octave?: number;
  glyph?: string;
}

export type MnxDynamic = DynamicGroup;

export interface MnxOttava {
  value: number; // 1, -1, 2, -2
  position: MnxRhythmicPosition;
  end: { measure: string; position: MnxRhythmicPosition };
  staff?: number;
}

export interface MnxBeam {
  events: string[];
  beams?: MnxBeam[];
  hookDirection?: string;
}

export interface MnxSequence {
  content: MnxSequenceContent[];
  voice?: string;
  staff?: number;
  orient?: string;
}

export type MnxSequenceContent = MnxEvent | MnxGraceEvent | MnxTuplet | MnxSpace | MnxMultiNoteTremolo;

export interface MnxEvent {
  type?: undefined; // discriminator: events don't have type
  duration: MnxDuration;
  id?: string;
  notes?: MnxNote[];
  /** Drum-kit hits (MNX `kitNotes`) — present instead of `notes` on
   *  unpitched-percussion parts. */
  kitNotes?: MnxKitNote[];
  rest?: MnxRest;
  slurs?: MnxSlur[];
  markings?: MnxEventMarkings;
  /** Native MNX fermata (event-level since v15). */
  fermata?: {
    symbol?: string;
    duration?: string;
    orient?: "above" | "below" | "auto";
    pointing?: "up" | "down" | "auto";
  };
  lyrics?: MnxEventLyrics;
  staff?: number;
  stemDirection?: string;
}

export interface MnxRest {
  staffPosition?: number;
}

export interface MnxGraceEvent {
  type: "grace";
  content: MnxEvent[];
  graceType?: string; // makeTime, stealFollowing, stealPrevious
  slash?: boolean;
}

export interface MnxTuplet {
  type: "tuplet";
  inner: MnxNoteValueQuantity;
  outer: MnxNoteValueQuantity;
  content: MnxSequenceContent[];
  bracket?: string; // yes, no, auto
  showNumber?: string; // noNumber, inner, both
  showValue?: string;
  orient?: string;
  staff?: number;
}

export interface MnxNoteValueQuantity {
  duration: MnxDuration;
  multiple: number;
}

/**
 * Multi-note (two-note) tremolo container. Wraps exactly the events that
 * alternate rapidly; `outer` is the total notated duration the tremolo
 * occupies (its metric footprint), while each content event keeps its own
 * written value. Mirrors MNX `type: "tremolo"`.
 */
export interface MnxMultiNoteTremolo {
  type: "tremolo";
  content: MnxEvent[];
  marks: number;
  outer: MnxNoteValueQuantity;
  individualDuration?: MnxDuration;
}

export interface MnxSpace {
  type: "space";
  duration: [number, number];
}

export interface MnxDuration {
  base: string;
  dots?: number;
}

export interface MnxSlur {
  target?: string;
  startNote?: string;
  endNote?: string;
  side?: string;
  lineType?: string;
}

export interface MnxEventMarkings {
  accent?: Record<string, unknown>;
  strongAccent?: { pointing?: string };
  softAccent?: Record<string, unknown>;
  staccato?: Record<string, unknown>;
  staccatissimo?: Record<string, unknown>;
  tenuto?: Record<string, unknown>;
  spiccato?: Record<string, unknown>;
  stress?: Record<string, unknown>;
  unstress?: Record<string, unknown>;
  breath?: Record<string, unknown>;
  tremolo?: { marks: number };
  // Vendor extensions for features not in MNX spec
  _x?: { viritura: Record<string, unknown> };
}

export interface MnxEventLyrics {
  lines?: Record<string, { text: string; type?: string }>;
}

export interface MnxNote {
  pitch?: MnxPitch;
  accidentalDisplay?: { show: boolean };
  id?: string;
  ties?: MnxTie[];
  staff?: number;
  /** Raw MusicXML `<notehead>` token (e.g. "x", "diamond"), preserved for
   *  percussion conversion. MNX has no notehead on a note; only kit-components
   *  carry it (via `_x.viritura.notehead`), so this is consumed there. */
  notehead?: string;
}

export interface MnxTie {
  target?: string;
  targetType?: string;
  lv?: boolean;
}

export interface MnxPitch {
  step: string;
  octave: number;
  alter?: number;
}

// ─── Layout types ────────────────────────────────────────────────────

export interface MnxSystemLayout {
  id: string;
  content: MnxLayoutContent[];
}

export type MnxLayoutContent = MnxLayoutGroup | MnxLayoutStaff;

export interface MnxLayoutGroup {
  type: "group";
  content: MnxLayoutContent[];
  symbol?: string;
  barlineStyle?: string;
  label?: string;
}

export interface MnxLayoutStaff {
  type: "staff";
  sources: { part: string; staff?: number }[];
  label?: string;
  labelref?: string;
}

export interface MnxScore {
  name: string;
  layout?: string;
  /** When true, transposing parts render written (transposed) pitch rather
   *  than concert pitch — used for individual player parts. */
  useWritten?: boolean;
  /** Consolidated rests for individual player parts: runs of consecutive
   *  empty measures collapsed into a single multimeasure rest. `start` is the
   *  global measure id where the run begins; `duration` is the measure count. */
  multimeasureRests?: { start: string; duration: number }[];
  pages?: { systems: { measure: string; layout?: string }[] }[];
}

// ─── Internal types ──────────────────────────────────────────────────

export interface PartInfo {
  id: string;
  name: string;
  abbreviation: string;
  staves: number;
  /** MusicXML `<instrument-sound>` standard-sound id (e.g. `wood.wood-block`),
   *  used to route unpitched percussion to a General MIDI drum sound. */
  instrumentSound?: string;
}

export interface GroupInfo {
  symbol: string;
  name: string | null;
  barline: string;
  startIndex: number;
  endIndex: number;
}
