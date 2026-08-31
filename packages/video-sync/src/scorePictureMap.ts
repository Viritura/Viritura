/**
 * Score time <-> media time mapping.
 *
 * The score and the picture are two independent coordinate systems joined by a
 * single scalar, the *picture offset*: the media time that corresponds to score
 * time zero.
 *
 *     mediaTime = scoreTime + pictureOffset
 *     scoreTime = mediaTime - pictureOffset
 *
 * Everything tempo-related is deliberately absent. Score time already comes out
 * of `@viritura/midi`'s continuous tempo model, which integrates fixed and
 * gradual tempo changes, meter changes, fermata/caesura insertions, and repeat
 * expansion. Re-deriving any of that here would create a second timing source
 * that could disagree with what the user hears — the one failure mode that
 * makes video sync feel broken.
 *
 * These functions are pure and DOM-free so the mapping can be unit-tested
 * against tempo fixtures without a media element.
 */

/** Result of mapping a score time onto the picture. */
export interface MediaPlacement {
  /** Media time in seconds, clamped into `[0, duration]`. */
  mediaTime: number;
  /**
   * True when the requested score time falls outside the picture — before the
   * first frame or past the last one. The UI shows "outside picture" rather
   * than pretending the clamped frame is correct.
   */
  outsidePicture: boolean;
}

/** Inputs shared by the mapping helpers. */
export interface PictureMapping {
  /** Media time (seconds) at score time zero. */
  pictureOffsetSeconds: number;
  /** Media duration in seconds. Non-finite/absent disables clamping. */
  mediaDurationSeconds?: number;
}

/** Unclamped media time for a score time. */
export function mediaTimeForScoreTime(scoreTimeSeconds: number, mapping: PictureMapping): number {
  return scoreTimeSeconds + mapping.pictureOffsetSeconds;
}

/** Unclamped score time for a media time. */
export function scoreTimeForMediaTime(mediaTimeSeconds: number, mapping: PictureMapping): number {
  return mediaTimeSeconds - mapping.pictureOffsetSeconds;
}

/**
 * Map a score time onto the picture, clamped to the media's extent.
 *
 * Clamping matters at both ends. A count-in produces negative score time, which
 * maps before the first frame whenever the offset is small; and a score that
 * outlives the cut keeps playing after the last frame. In both cases the video
 * should park on the boundary frame rather than seek out of range, which some
 * browsers answer with a hard error or an unstable `currentTime`.
 */
export function placeScoreTime(scoreTimeSeconds: number, mapping: PictureMapping): MediaPlacement {
  const raw = mediaTimeForScoreTime(scoreTimeSeconds, mapping);
  const duration = mapping.mediaDurationSeconds;
  const hasDuration = typeof duration === "number" && Number.isFinite(duration) && duration > 0;

  if (raw < 0) {
    return { mediaTime: 0, outsidePicture: true };
  }
  if (hasDuration && raw > duration) {
    return { mediaTime: duration, outsidePicture: true };
  }
  return { mediaTime: raw, outsidePicture: false };
}

/**
 * The picture offset that puts `mediaTimeSeconds` at `scoreTimeSeconds`.
 *
 * This is what "align picture to the playhead" needs: the user parks the score
 * on a musical moment, scrubs the picture to the frame it should hit, and the
 * offset falls out of the two positions.
 */
export function offsetAligning(scoreTimeSeconds: number, mediaTimeSeconds: number): number {
  return mediaTimeSeconds - scoreTimeSeconds;
}

/** Whether a score time has any picture to show under the given mapping. */
export function hasPictureAt(scoreTimeSeconds: number, mapping: PictureMapping): boolean {
  return !placeScoreTime(scoreTimeSeconds, mapping).outsidePicture;
}
