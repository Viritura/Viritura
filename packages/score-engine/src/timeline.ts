/**
 * Public timeline + beat-mapping types for @viritura/score-engine.
 *
 * The timeline is the audio engine's input: a deterministic, layout-
 * independent representation of "what plays when". The engine doesn't
 * know about audio, samples, or MIDI hardware — that's the audio
 * package's job. Keeping these types audio-free is what lets the
 * playback engine be swapped without touching the renderer.
 */

/** Symbolic dynamic markings as written in the score. */
export type DynamicMark = "ppp" | "pp" | "p" | "mp" | "mf" | "f" | "ff" | "fff";

/** A single timed event in the score (note or rest). */
export interface TimedEvent {
  /** Stable part identifier from the source MNX. */
  partId: string;
  /** Global beat position from the start of the (expanded) score. */
  beat: number;
  /** Duration in beats (quarter-note = 1). */
  durationBeats: number;
  /** Absolute time in seconds from the start of the score. */
  timeSeconds: number;
  /** MIDI note number (0–127). Omit for rests. */
  midiPitch?: number;
  /** True for rests. */
  isRest: boolean;
  /** Symbolic dynamic if explicitly marked at this event. */
  dynamic?: DynamicMark;
  /** Stable event ID from the source MNX (when the source assigned one). */
  eventId?: string;
}

/** Beat → BPM transition for tempo automation. */
export interface TempoSegment {
  /** Global beat where this tempo takes effect. */
  beat: number;
  /** Absolute time in seconds when this tempo takes effect. */
  timeSeconds: number;
  /** Tempo in beats per minute (quarter-note = 1 beat). */
  bpm: number;
}

/**
 * The complete playback timeline derived from MNX.
 *
 * Layout-independent: two scores with identical music but different
 * page breaks produce identical timelines. This is what makes the
 * timeline safe to ship to a server-side audio renderer.
 */
export interface Timeline {
  /** Total length of the (expanded) score in beats. */
  totalBeats: number;
  /** Total length of the (expanded) score in seconds. */
  totalSeconds: number;
  /** Stable part IDs, in score order. */
  partIds: readonly string[];
  /** All note + rest events, sorted by `beat`. */
  events: readonly TimedEvent[];
  /** Tempo automation. */
  tempoMap: readonly TempoSegment[];
}

/** Options for `engine.timeline()`. */
export interface TimelineOptions {
  /**
   * Whether to expand DC/DS/repeat directions when computing the
   * timeline. Default `"expand"`. Use `"ignore"` to get a one-pass
   * timeline matching the visual measure order.
   */
  repeatExpansion?: "expand" | "ignore";
}

/** Result of `engine.beatToCanvas()` — where on the rendered canvas a beat lives. */
export interface CanvasBeatPosition {
  /** Zero-based page index. */
  page: number;
  /** X coordinate in display-list (pre-zoom) space. */
  x: number;
  /** Y coordinate of the top of the staff. */
  y: number;
  /** Height of the staff at this position. */
  height: number;
}

/** Result of `engine.canvasToBeat()` — what beat a canvas hit corresponds to. */
export interface CanvasBeatHit {
  /** Global beat position from the start of the score. */
  beat: number;
  /** Stable part identifier the click landed in. */
  partId: string;
}
