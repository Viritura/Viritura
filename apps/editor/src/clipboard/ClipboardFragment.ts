import type { SequenceContent } from "@viritura/core";
import type { TimeSignature, KeySignature, Clef, Transposition, DynamicGroup } from "@viritura/core";

/** Internal marker to identify Viritura clipboard data in plain text */
export const VIRITURA_FRAGMENT_TYPE = "viritura/fragment" as const;

/** Current fragment format version */
export const FRAGMENT_VERSION = 2;

/**
 * A measure-level decoration captured at copy time. `measureOffset` is the
 * offset from the selection's first measure (0 = first measure of the copy).
 */
export interface CapturedDynamic {
  measureOffset: number;
  /** End-measure offset for a gradual group, relative to the selection start. */
  endMeasureOffset?: number;
  dynamic: DynamicGroup;
}

/**
 * A single track (one part+voice) of copied content.
 */
export interface ClipboardTrack {
  /** Relative part offset (0 = topmost copied part) */
  partOffset: number;
  /** Voice/sequence index within the part */
  voiceIndex: number;
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
  /** Multi-track content for cross-staff copy/paste (v2+). If present, takes precedence over `content`. */
  tracks?: ClipboardTrack[];
}
