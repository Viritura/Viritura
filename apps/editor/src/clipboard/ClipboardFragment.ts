import type { ChordSymbol, GlobalLyrics, MeasureRepeat, SequenceContent } from "@viritura/core";
import type { TimeSignature, KeySignature, Clef, Transposition, DynamicGroup } from "@viritura/core";

/** Internal marker to identify Viritura clipboard data in plain text */
export const VIRITURA_FRAGMENT_TYPE = "viritura/fragment" as const;

/** Current fragment format version */
export const FRAGMENT_VERSION = 5;

type WholeNoteFraction = [number, number];

/**
 * A measure-level decoration captured at copy time. `measureOffset` is the
 * offset from the selection's first measure (0 = first measure of the copy).
 */
export interface CapturedDynamic {
  /** Relative source part for structural multi-part clipboard fragments. */
  partOffset?: number;
  /** Physical staff relative to the selection anchor, independent of source part layout. */
  staffOffset?: number;
  measureOffset: number;
  /** End-measure offset for a gradual group, relative to the selection start. */
  endMeasureOffset?: number;
  dynamic: DynamicGroup;
  /** Absolute delay from the fragment start, used when source measure boundaries are unavailable. */
  offset?: WholeNoteFraction;
  /** Gradual-dynamic endpoint on the same timeline as offset. */
  endOffset?: WholeNoteFraction;
}

export interface CapturedChordSymbol {
  /** Relative destination part for native Viritura fragments. */
  partOffset?: number;
  /** Physical staff relative to the selection anchor, independent of source part layout. */
  staffOffset?: number;
  measureOffset: number;
  chordSymbol: ChordSymbol;
  /** Absolute delay from the fragment start, independent of source measure boundaries. */
  offset?: WholeNoteFraction;
}

export interface CapturedMeasureRepeat {
  partOffset: number;
  measureOffset: number;
  repeat: MeasureRepeat;
}

/**
 * A single track (one part+voice) of copied content.
 */
export interface ClipboardTrack {
  /** Relative part offset (0 = topmost copied part) */
  partOffset: number;
  /** Voice/sequence index within the part */
  voiceIndex: number;
  /** Relative physical staff, independent of Viritura's part/sequence layout. */
  staffOffset?: number;
  /** Original one-based staff within the source part; never a destination staff. */
  sourceStaff?: number;
  /** Delay before this voice begins; unlike a rest, destination content before it is retained. */
  leadIn?: WholeNoteFraction;
  /** The copied events for this track */
  content: SequenceContent[];
  /**
   * Active clef at the source location for this track's part.
   * Stored so preview can show the exact clef (including 8vb/8va ottava)
   * instead of inferring from pitch alone.
   */
  clef?: Clef;
  /**
   * Source part's transposition interval. Stored notes are sounding pitch;
   * preview must apply this transposition to show written pitch correctly
   * (e.g. contrabassoon notated an octave above its sounding pitch).
   */
  transposition?: Transposition;
  /**
   * Dynamics belonging to this track's source part, filtered to those
   * falling within the captured beat range. Positions are kept in the
   * source measure's coordinate system; paste reapplies them with the
   * appropriate measure / beat offset.
   */
  dynamics?: CapturedDynamic[];
}

/**
 * A clipboard fragment containing score content.
 * Serialized as JSON and stored on the system clipboard.
 *
 * Version 2 adds multi-track support for cross-staff copy/paste.
 * Version 3 adds structural measure repeats and part-relative dynamics.
 * Version 4 adds metadata for lyric lines referenced by copied events.
 * Version 5 adds chord symbols and physical-staff/voice timing metadata.
 * Version 1 fragments (flat `content` array) are still supported on read.
 */
export interface ClipboardFragment {
  /** Fragment type marker */
  type: typeof VIRITURA_FRAGMENT_TYPE;
  /** Format version for forward compatibility */
  version: number;
  /** Time signature context (from the source measure) */
  timeSignature: TimeSignature;
  /** Key signature context (from the source measure) */
  keySignature: KeySignature;
  /** The copied score content (single-track, for backward compat with v1) */
  content: SequenceContent[];
  /**
   * Active clef at the source location (primary/first track).
   * Stored so preview can show the exact clef (including 8vb/8va ottava)
   * instead of inferring from pitch alone. Absent in v1 fragments.
   */
  clef?: Clef;
  /**
   * Source part's transposition (primary track). Stored notes are sounding
   * pitch; preview applies this so transposing instruments display at their
   * written pitch (e.g. contrabassoon up an octave from concert pitch).
   */
  transposition?: Transposition;
  /**
   * Dynamics in the primary track's spanned measures, filtered to those
   * inside the captured beat range. See `CapturedDynamic`.
   */
  dynamics?: CapturedDynamic[];
  /** Harmony annotations captured relative to the fragment start. */
  chordSymbols?: CapturedChordSymbol[];
  /** Measure-repeat structures captured relative to the fragment's first part and measure. */
  measureRepeats?: CapturedMeasureRepeat[];
  /** Multi-track content for cross-staff copy/paste (v2+). If present, takes precedence over `content`. */
  tracks?: ClipboardTrack[];
  /** Metadata and ordering for lyric lines referenced by copied events. */
  lyrics?: GlobalLyrics;
}
