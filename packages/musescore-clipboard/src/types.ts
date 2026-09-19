import type { ChordSymbol, DynamicGroup, MeasureRepeat, SequenceContent, Transposition } from "@viritura/core";

export interface MuseScoreClipboardReadOptions {
  /** Strict by default. Skip only unsupported notation with known recovery boundaries. */
  unsupported?: "skip" | "error";
}

export interface MuseScoreClipboardDiagnostic {
  code: "unsupported-content";
  message: string;
  path?: string;
  sourceTime?: string;
}

/**
 * A dynamic on the copied timeline. Offsets are exact [numerator, denominator]
 * whole-note fractions, not beats or ticks.
 */
export interface MuseScoreClipboardDynamic {
  /** Relative source part; distinct from physical staff and voice. Defaults to the owning track's part. */
  partOffset?: number;
  /** Zero-based physical staff offset from the copied range's top staff, across part boundaries. */
  staffOffset?: number;
  /** Relative source measure; without offset, only measure zero has unambiguous export timing. */
  measureOffset: number;
  /** Gradual endpoint measure relative to the copied range's first measure. */
  endMeasureOffset?: number;
  dynamic: DynamicGroup;
  /** Onset from the copied range's start, independent of source measure boundaries. */
  offset?: [number, number];
  /** Gradual endpoint on the same whole-note timeline as offset. */
  endOffset?: [number, number];
}

/** Harmony with part/staff ownership and exact whole-note-fraction timing. */
export interface MuseScoreClipboardChordSymbol {
  /** Relative source part, not a physical staff or voice. Defaults to zero. */
  partOffset?: number;
  /** Zero-based physical staff offset from the copied range's top staff. */
  staffOffset?: number;
  /** Relative source measure; without offset, only measure zero has unambiguous export timing. */
  measureOffset: number;
  chordSymbol: ChordSymbol;
  /** [Numerator, denominator] whole notes from the copied range's start. */
  offset?: [number, number];
}

/** One voice on one physical staff; parts may contain multiple physical staves. */
export interface MuseScoreClipboardTrack {
  /** Zero-based relative source part, used for annotation ownership and legacy staff fallback. */
  partOffset: number;
  /** Zero-based voice on the physical staff (0–3), not an editor sequence index. */
  voiceIndex: number;
  /** Zero-based physical staff across parts; takes precedence over partOffset. */
  staffOffset?: number;
  /** One-based original staff within its source part, used only to resolve annotation ownership. */
  sourceStaff?: number;
  /** Exact whole-note-fraction delay from the copied range's start, not a rest. */
  leadIn?: [number, number];
  /** Sounding-pitch notation, with IDs identifying any complete ties within the copied range. */
  content: SequenceContent[];
  /** Sounding-to-written interval; never transpose the stored sounding pitches again on import. */
  transposition?: Transposition;
  dynamics?: MuseScoreClipboardDynamic[];
}

/** Decoded notation only; assigning destination locations and clipboard IO belong to callers. */
export interface MuseScoreClipboardData {
  /** Notation discarded during opt-in best-effort import; never persisted in the score. */
  diagnostics?: MuseScoreClipboardDiagnostic[];
  /** Primary voice, in sounding pitch. Tracks take precedence when present. */
  content: SequenceContent[];
  /** Primary track's sounding-to-written transposition, not an instruction to alter sounding notes. */
  transposition?: Transposition;
  tracks?: MuseScoreClipboardTrack[];
  dynamics?: MuseScoreClipboardDynamic[];
  chordSymbols?: MuseScoreClipboardChordSymbol[];
}

/** Notation to encode; no editor selection, absolute score location, or cut state is required. */
export interface MuseScoreClipboardWriteInput {
  /** Primary voice, in sounding pitch. Tracks take precedence when nonempty. */
  events: SequenceContent[];
  /** Primary track's sounding-to-written interval. */
  transposition?: Transposition;
  tracks?: MuseScoreClipboardTrack[];
  dynamics?: MuseScoreClipboardDynamic[];
  chordSymbols?: MuseScoreClipboardChordSymbol[];
  /** Unsupported notation retained for explicit rejection rather than silently exporting incomplete music. */
  measureRepeats?: readonly { repeat: MeasureRepeat }[];
}

/** A null XML result leaves callers free to preserve their own lossless clipboard format. */
export interface MuseScoreClipboardWriteResult {
  xml: string | null;
  warning?: string;
}
