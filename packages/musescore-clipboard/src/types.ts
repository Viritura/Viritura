import type { ChordSymbol, DynamicGroup, MeasureRepeat, SequenceContent, Transposition } from "@viritura/core";

export interface MuseScoreClipboardReadOptions {
  /** Strict by default; skip only known recovery boundaries. Raw harmony is diagnosed and retained in either mode. */
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

/** Concert-pitch harmony with transient source origins, never part-local score storage. */
export interface MuseScoreClipboardChordSymbol {
  /** Relative source part, not a physical staff or voice. Defaults to zero. */
  partOffset?: number;
  /** Zero-based physical staff offset from the copied range's top staff. */
  staffOffset?: number;
  /** One-based source staff within its part, for export routing when staffOffset is absent. */
  sourceStaff?: number;
  /** Relative source measure; without offset, only measure zero has unambiguous export timing. */
  measureOffset: number;
  /** Both root and slash bass are already sounding; do not apply destination transposition. */
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
  /** Discarded notation or retained unsupported raw harmony; never persisted in the score. */
  diagnostics?: MuseScoreClipboardDiagnostic[];
  /** Primary voice, in sounding pitch. Tracks take precedence when present. */
  content: SequenceContent[];
  /** Primary track's sounding-to-written transposition, not an instruction to alter sounding notes. */
  transposition?: Transposition;
  tracks?: MuseScoreClipboardTrack[];
  dynamics?: MuseScoreClipboardDynamic[];
  /**
   * Unmerged source occurrences. After locating destination measures, callers merge
   * by physical staffOffset (StaffList has no part boundaries), enable "show" on
   * every source-mapped part, and forward merge warnings through diagnostics.
   */
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
  /** May accompany non-null XML when unsupported harmony was preserved as raw text. */
  warning?: string;
}
