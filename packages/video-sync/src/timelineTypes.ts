/**
 * Timeline types.
 *
 * The canvas draws two rulers against each other: picture time, which is fixed,
 * and musical time, which stretches as the tempo map changes. Both are supplied
 * as already-resolved arrays so the renderer never touches the tempo model
 * itself — that stays the single source of timing, converted once by the caller.
 */

/** A window onto picture time. */
export interface TimelineViewport {
  /** Picture time at the left edge, in seconds. */
  readonly startSeconds: number;
  /** Scale: seconds of picture per pixel. Larger means zoomed out. */
  readonly secondsPerPixel: number;
}

/** One bar, already resolved to picture time. */
export interface TimelineBar {
  /** 1-based bar number as engraved. */
  readonly number: number;
  /** Picture time of this bar's downbeat. */
  readonly startSeconds: number;
  /** Picture time where the bar ends (the next downbeat). */
  readonly endSeconds: number;
  /** Meter, when it changes here. Absent means it carries forward. */
  readonly meter?: { readonly count: number; readonly unit: number };
  /** Tempo starting at this bar, when it changes here. */
  readonly bpm?: number;
}

/** A spotted moment, resolved for drawing. */
export interface TimelineHit {
  readonly id: string;
  readonly pictureSeconds: number;
  readonly label?: string;
  /** Whether the solver must land a downbeat here. */
  readonly locked: boolean;
}

/** Everything the canvas needs for one frame. */
export interface TimelineScene {
  readonly viewport: TimelineViewport;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly devicePixelRatio: number;
  /** Length of the picture, for the fit control and end-of-clip shading. */
  readonly durationSeconds: number;
  readonly bars: readonly TimelineBar[];
  readonly hits: readonly TimelineHit[];
  /** Playhead in picture time, or null when the transport is outside the clip. */
  readonly playheadSeconds: number | null;
  /** Frames per second, for tick labelling and the zoom floor. */
  readonly frameRate: number;
  /** Hit currently selected, drawn emphasised. */
  readonly selectedHitId?: string | null;
  /** Span between two hits currently selected, drawn as a band. */
  readonly selectedSpan?: { readonly fromSeconds: number; readonly toSeconds: number } | null;
  /** Filmstrip thumbnails, when available. */
  readonly thumbnails?: readonly TimelineThumbnail[];
  /** Picture-audio peaks, when decoded. */
  readonly waveform?: TimelineWaveform | null;
}

/**
 * One tile of the filmstrip.
 *
 * Tiles are whole frames laid edge to edge — `widthPx` is one frame at the
 * lane's height and the spacing between consecutive tiles is exactly that, so
 * the strip has no gaps and no overlap at any zoom. Zooming out omits frames
 * rather than squeezing them.
 */
export interface TimelineThumbnail {
  /** Picture time at the tile's left edge. */
  readonly pictureSeconds: number;
  readonly image: CanvasImageSource;
  /** Display width of the tile, in CSS pixels. */
  readonly widthPx: number;
}

/**
 * Picture-audio peaks.
 *
 * Stored as min/max pairs per bucket rather than raw samples: a 150-second clip
 * is millions of samples, and a waveform only ever needs the envelope of
 * whatever falls under each pixel column.
 */
export interface TimelineWaveform {
  /** Seconds of audio each bucket covers. */
  readonly secondsPerBucket: number;
  /** Interleaved min/max in -1..1, two entries per bucket. */
  readonly peaks: Float32Array;
}
