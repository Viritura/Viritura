/**
 * Types for spotting and fitting music to picture.
 *
 * Kept apart from the runtime contracts in `types.ts` because these describe the
 * cue's structure rather than the mechanics of driving a media element.
 */

/** A time signature, in the same shape MNX uses. */
export interface TimeSignature {
  readonly count: number;
  readonly unit: number;
}

/** What the composer asks of one span between two picture events. */
export interface SpanFitRequest {
  /** Length of the span in seconds, taken from the picture. */
  readonly seconds: number;
  /** Meters the bulk of the span may use, in preference order. */
  readonly meters: readonly TimeSignature[];
  /** Meters allowed for a single closing bar, for absorbing an awkward length. */
  readonly tailMeters?: readonly TimeSignature[];
  readonly minBars: number;
  readonly maxBars: number;
  readonly minBpm: number;
  readonly maxBpm: number;
  /** Tempo the composer would write if timing were not a constraint. */
  readonly preferredBpm?: number;
  /** Frames per second of the picture, so error can be reported in frames. */
  readonly frameRate: number;
}

/** One way of filling a span. */
export interface SpanFitCandidate {
  readonly bars: number;
  readonly meter: TimeSignature;
  /** Meter of a single closing bar, when one is used. */
  readonly tailMeter?: TimeSignature;
  /** Fractional tempo that fills the span exactly. */
  readonly bpm: number;
  /** Total quarter-note beats across the span. */
  readonly beats: number;
  /** Unadjusted tempo derived from the span. */
  readonly exactBpm: number;
  /** Signed: positive runs long, negative runs short. */
  readonly errorSeconds: number;
  readonly errorFrames: number;
}

/** Ranked ways of filling one span. */
export interface SpanFit {
  readonly request: SpanFitRequest;
  /** Best first. Empty when the constraints admit no solution. */
  readonly candidates: readonly SpanFitCandidate[];
  readonly best?: SpanFitCandidate;
}
