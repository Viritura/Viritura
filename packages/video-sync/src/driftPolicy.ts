/**
 * Drift policy — how hard to correct when the picture falls behind or runs
 * ahead of the transport.
 *
 * Kept pure and separate from the synchronizer so the thresholds can be
 * reasoned about (and tested) without a media element. The policy answers one
 * question: given a signed drift in seconds, do nothing, nudge the playback
 * rate, or hard-seek?
 *
 * The three-band shape is deliberate:
 *
 *  - **Hold.** Browser video presentation is quantized to frame boundaries, so
 *    a sub-frame disagreement is not an error and "correcting" it would mean
 *    permanently jittering the rate.
 *  - **Nudge.** A moderate, sustained drift is best absorbed by running the
 *    picture slightly fast or slow. It is invisible to the eye, whereas a seek
 *    is a visible jump.
 *  - **Seek.** A large drift means an event the rate cannot absorb in
 *    reasonable time — a tab suspension, a stall, a score edit that moved the
 *    timeline. Re-anchor immediately.
 *
 * Thresholds are provisional and documented as such in `docs/plans/video-sync.md`:
 * they are starting points to be calibrated against measurements on real media,
 * not claims of frame accuracy.
 */

/** Tunable drift thresholds, all in seconds unless noted. */
export interface DriftPolicyOptions {
  /** Drift below this is ignored (roughly one frame at 30 fps). */
  holdToleranceSeconds: number;
  /** Drift at or above this triggers a hard seek. */
  hardSeekToleranceSeconds: number;
  /** Maximum deviation from 1.0 applied while nudging (0.1 = +/-10%). */
  maxRateDeviation: number;
  /**
   * Consecutive out-of-tolerance samples required before nudging. Guards
   * against reacting to a single noisy `currentTime` read.
   */
  sustainedSamplesBeforeNudge: number;
}

export const DEFAULT_DRIFT_POLICY: DriftPolicyOptions = {
  holdToleranceSeconds: 0.034,
  hardSeekToleranceSeconds: 0.5,
  maxRateDeviation: 0.1,
  sustainedSamplesBeforeNudge: 3,
};

/** What the synchronizer should do about the current drift. */
export type DriftCorrection =
  | { kind: "hold" }
  | { kind: "nudge"; playbackRate: number }
  | { kind: "seek"; reason: "drift" };

/** Inputs to a single drift decision. */
export interface DriftSample {
  /**
   * Signed drift in seconds: `expectedMediaTime - actualMediaTime`.
   * Positive means the picture is *behind* and must speed up.
   */
  driftSeconds: number;
  /** How many consecutive samples (including this one) were out of tolerance. */
  consecutiveOutOfTolerance: number;
}

/**
 * Decide how to correct the current drift.
 *
 * The nudge rate is proportional to the drift within the nudge band, so a small
 * disagreement gets a small correction that decays as the picture catches up,
 * rather than a fixed rate that overshoots and oscillates.
 */
export function decideCorrection(
  sample: DriftSample,
  options: DriftPolicyOptions = DEFAULT_DRIFT_POLICY,
): DriftCorrection {
  const magnitude = Math.abs(sample.driftSeconds);

  if (magnitude >= options.hardSeekToleranceSeconds) {
    return { kind: "seek", reason: "drift" };
  }
  if (magnitude < options.holdToleranceSeconds) {
    return { kind: "hold" };
  }
  if (sample.consecutiveOutOfTolerance < options.sustainedSamplesBeforeNudge) {
    return { kind: "hold" };
  }

  // Scale the correction across the nudge band [hold, hardSeek).
  const band = options.hardSeekToleranceSeconds - options.holdToleranceSeconds;
  const position = band > 0 ? (magnitude - options.holdToleranceSeconds) / band : 1;
  const deviation = options.maxRateDeviation * Math.min(1, Math.max(0, position));
  const direction = sample.driftSeconds > 0 ? 1 : -1;
  return { kind: "nudge", playbackRate: 1 + direction * deviation };
}

/** Whether a drift magnitude counts as out of tolerance. */
export function isOutOfTolerance(driftSeconds: number, options: DriftPolicyOptions = DEFAULT_DRIFT_POLICY): boolean {
  return Math.abs(driftSeconds) >= options.holdToleranceSeconds;
}
