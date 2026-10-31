/**
 * The timing facts every part of the Picture activity works from.
 *
 * The timeline and the solve panel both need the score's bars in picture time,
 * the markers, and the playhead position. Deriving those facts twice would risk
 * the panel and canvas disagreeing, which is exactly the kind of discrepancy
 * that ends in the wrong bars being rewritten.
 *
 * Everything here comes from the playback timeline's own tempo model, so what
 * is drawn, what is solved, and what is played are the same numbers.
 */

import { useMemo } from "react";
import type { Score } from "@viritura/core";
import { generateTimeline, NavigationError } from "@viritura/midi";
import { usePlaybackState } from "@viritura/playback";
import {
  fps,
  frameRateById,
  resolveBars,
  resolveHits,
  useVideoSyncState,
  type TimelineBar,
  type TimelineHit,
} from "@viritura/video-sync";

export interface PictureTiming {
  readonly error: string | null;
  readonly bars: readonly TimelineBar[];
  readonly hits: readonly TimelineHit[];
  /** Length of the picture, falling back to the score's own length. */
  readonly durationSeconds: number;
  /** Playhead in picture time, or null when the transport has no position. */
  readonly playheadSeconds: number | null;
  /** Frames per second, as a float, for tick labelling and tolerances. */
  readonly frameRate: number;
  readonly pictureOffsetSeconds: number;
}

export function usePictureTiming(score: Score | null): PictureTiming {
  const state = useVideoSyncState();
  const playback = usePlaybackState();
  const frameRate = fps(frameRateById(state.frameRateId));

  const { tempo, error } = useMemo(() => {
    if (!score || score.global.measures.length === 0) return { tempo: null, error: null };
    try {
      const timeline = generateTimeline(score);
      return {
        tempo: {
          measureStartTimes: timeline.measureStartTimes,
          durationSeconds: timeline.duration,
          expandedMeasureToOriginal: timeline.expandedMeasureToOriginal,
        },
        error: null,
      };
    } catch (cause) {
      if (!(cause instanceof NavigationError)) throw cause;
      return { tempo: null, error: cause.message };
    }
  }, [score]);

  const bars = useMemo(
    () => (score && tempo ? resolveBars(score, tempo, state.pictureOffsetSeconds) : []),
    [score, tempo, state.pictureOffsetSeconds],
  );
  const hits = useMemo(() => resolveHits(state.hitPoints), [state.hitPoints]);

  // Prefer the picture's own length; fall back to the score's so the timeline is
  // still useful before anything is attached.
  const durationSeconds = state.mediaDurationSeconds ?? tempo?.durationSeconds ?? 0;

  const playheadSeconds = playback.playheadPosition
    ? playback.playheadPosition.timeSeconds + state.pictureOffsetSeconds
    : null;

  return {
    error,
    bars,
    hits,
    durationSeconds,
    playheadSeconds,
    frameRate,
    pictureOffsetSeconds: state.pictureOffsetSeconds,
  };
}
