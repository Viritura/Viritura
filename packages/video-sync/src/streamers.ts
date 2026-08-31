/**
 * Streamers and punches.
 *
 * These are the oldest tool in this whole workflow and they are still the best
 * one: a vertical line sweeps across the picture and arrives at the frame the
 * music has to land on, and a circle flashes on that frame to confirm it. A
 * conductor watching them can hit a cue to the frame without hearing a click,
 * which is why they survived the transition from grease pencil on the print to
 * software and have never been replaced.
 *
 * The conventions here are the film ones, not invented:
 *
 *   - A **streamer** is a line travelling left to right, reaching the right
 *     edge exactly on the hit. Traditionally scribed on the print as a diagonal
 *     scratch; its length was measured in feet of film, and two seconds is the
 *     usual default.
 *   - A **punch** is a hole punched through two frames at the hit itself, seen
 *     as a white flash. Two frames because one is too easy to miss and three
 *     reads as a smear.
 *   - **Warning punches** precede the streamer at whole-second intervals, so a
 *     conductor knows a cue is coming before the line appears.
 *
 * All state is derived from the current time rather than scheduled, so
 * scrubbing, looping and stepping backwards all behave correctly without any
 * cleanup — which a timer-based implementation would get wrong the first time
 * someone dragged the playhead.
 */

import type { TimelineHit } from "./timelineTypes";

/** Default streamer length. Two seconds is the film convention. */
export const DEFAULT_STREAMER_SECONDS = 2;

/** Frames a punch stays lit. */
const PUNCH_FRAMES = 2;

/** How long before a streamer its warning punches appear, in seconds. */
const WARNING_OFFSETS = [3, 2, 1] as const;

export interface StreamerOptions {
  readonly streamerSeconds?: number;
  readonly frameRate: number;
  /** Whether warning punches are shown ahead of each streamer. */
  readonly warnings?: boolean;
}

/** A streamer currently crossing the frame. */
export interface ActiveStreamer {
  readonly hitId: string;
  readonly label?: string;
  /** 0 at the left edge, 1 arriving at the hit. */
  readonly progress: number;
}

export interface StreamerState {
  readonly streamers: readonly ActiveStreamer[];
  /** True on the frames a punch is lit. */
  readonly punch: boolean;
  /** True on the frames a warning punch is lit. */
  readonly warning: boolean;
}

const EMPTY: StreamerState = { streamers: [], punch: false, warning: false };

/**
 * What should be on screen at this picture time.
 *
 * Only locked hits produce cues: an unlocked hit is a note to self about the
 * film, not a moment the music is committed to, and flashing the podium for one
 * would train the conductor to distrust the whole system.
 */
export function streamerState(
  pictureSeconds: number,
  hits: readonly TimelineHit[],
  options: StreamerOptions,
): StreamerState {
  const { frameRate } = options;
  if (!Number.isFinite(pictureSeconds) || frameRate <= 0) return EMPTY;

  const length = options.streamerSeconds ?? DEFAULT_STREAMER_SECONDS;
  const punchWindow = PUNCH_FRAMES / frameRate;
  const streamers: ActiveStreamer[] = [];
  let punch = false;
  let warning = false;

  for (const hit of hits) {
    if (!hit.locked) continue;
    const until = hit.pictureSeconds - pictureSeconds;

    if (until >= 0 && until <= length) {
      streamers.push({
        hitId: hit.id,
        ...(hit.label === undefined ? {} : { label: hit.label }),
        progress: 1 - until / length,
      });
    }

    // The punch straddles the hit rather than following it: the conductor is
    // aiming at the frame, so the flash has to be on it, not after it.
    if (Math.abs(until) < punchWindow) punch = true;

    if (options.warnings !== false) {
      for (const offset of WARNING_OFFSETS) {
        if (Math.abs(until - (length + offset)) < punchWindow) warning = true;
      }
    }
  }

  return { streamers, punch, warning };
}

/**
 * Where a streamer's line sits, as a fraction of the frame's width.
 *
 * Trivial today, but named because the mapping is a decision: the line arrives
 * at the right edge on the hit, which is the direction film streamers were
 * always scribed and therefore the direction conductors read.
 */
export function streamerX(progress: number): number {
  return Math.min(1, Math.max(0, progress));
}
