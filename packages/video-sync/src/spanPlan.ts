/**
 * Planning the bars between two hits.
 *
 * `fitSpan` searches for tempi; this describes the other half of the workflow,
 * and it is the half a composer actually thinks in. The hits fix the span. The
 * composer then says what the music *is* across it — four bars of 4/4 and a
 * closing 3/4, say — and the tempo is whatever makes that land. Tempo is an
 * outcome, not an input.
 *
 * That inversion matters because meter is a musical decision and tempo is
 * mostly an arithmetic one. Asking a composer to nudge a BPM until a bar line
 * happens to touch a cut is backwards; asking them to decide the meter and be
 * told what it costs in frames is the way the job is done on paper.
 *
 * A plan is a list of runs rather than a list of bars, because that is how the
 * decision is described out loud, and because it keeps the editable surface
 * small: change a count, change a meter, add a run.
 */

import { beatsPerBar, exactTempo } from "./fitSpan";
import type { TimeSignature } from "./cueTypes";

/** A run of consecutive bars sharing a meter. */
export interface PlanSegment {
  readonly meter: TimeSignature;
  readonly bars: number;
}

/** What the composer says the music is, between two picture events. */
export interface SpanPlan {
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly segments: readonly PlanSegment[];
}

/** What that plan costs, once the tempo is derived from it. */
export interface SpanSolution {
  /** Total quarter-note beats across the span. */
  readonly beats: number;
  /** Tempo that would land the span exactly. */
  readonly exactBpm: number;
  /** Tempo written to MNX. */
  readonly bpm: number;
  /** Signed: positive runs long, negative runs short. */
  readonly errorSeconds: number;
  readonly errorFrames: number;
  /** Total bars in the plan. */
  readonly bars: number;
}

/** Seconds a span of `beats` quarter notes occupies at `bpm`. */
function spanSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

export function planBeats(plan: SpanPlan): number {
  return plan.segments.reduce((total, segment) => total + beatsPerBar(segment.meter) * segment.bars, 0);
}

export function planBars(plan: SpanPlan): number {
  return plan.segments.reduce((total, segment) => total + segment.bars, 0);
}

/**
 * Derive the fractional tempo a plan implies. Returns `null` for a plan with no
 * bars, which is a state the editor passes through while the composer is
 * building one.
 */
export function solvePlan(plan: SpanPlan, frameRate: number): SpanSolution | null {
  const beats = planBeats(plan);
  const seconds = plan.toSeconds - plan.fromSeconds;
  if (beats <= 0 || seconds <= 0) return null;

  const exact = exactTempo(beats, seconds);
  const bpm = exact;
  const errorSeconds = spanSeconds(beats, bpm) - seconds;
  return {
    beats,
    exactBpm: exact,
    bpm,
    errorSeconds,
    errorFrames: errorSeconds * frameRate,
    bars: planBars(plan),
  };
}

/**
 * A plan to start from.
 *
 * Chooses the bar count whose implied tempo sits closest to what the composer
 * would write anyway, so the first thing they see is plausible music rather
 * than an arbitrary division of the span. They then adjust it, which is the
 * point of the panel.
 */
export function suggestPlan(
  fromSeconds: number,
  toSeconds: number,
  options: { readonly meter: TimeSignature; readonly preferredBpm: number },
): SpanPlan {
  const seconds = toSeconds - fromSeconds;
  const barBeats = beatsPerBar(options.meter);
  const idealBars = (seconds * options.preferredBpm) / (60 * barBeats);
  const bars = Math.max(1, Math.round(idealBars));
  return { fromSeconds, toSeconds, segments: [{ meter: options.meter, bars }] };
}

/** Replace the bar count of one run, dropping runs that fall to zero. */
export function setSegmentBars(plan: SpanPlan, index: number, bars: number): SpanPlan {
  const next = plan.segments
    .map((segment, i) => (i === index ? { ...segment, bars: Math.max(0, Math.round(bars)) } : segment))
    .filter((segment) => segment.bars > 0);
  return { ...plan, segments: next };
}

/** Replace the meter of one run. */
export function setSegmentMeter(plan: SpanPlan, index: number, meter: TimeSignature): SpanPlan {
  return {
    ...plan,
    segments: plan.segments.map((segment, i) => (i === index ? { ...segment, meter } : segment)),
  };
}

/**
 * Split a run so a new meter can start partway through it.
 *
 * This is the gesture behind "put the 3/4 at bar three": the composer is not
 * adding a run so much as saying the meter changes here. The split point is
 * clamped rather than rejected, so dragging to the very edge of a run leaves
 * both sides intact instead of doing nothing.
 */
export function splitSegment(plan: SpanPlan, index: number, afterBars: number): SpanPlan {
  const segment = plan.segments[index];
  if (!segment || segment.bars < 2) return plan;
  const head = Math.max(1, Math.min(segment.bars - 1, Math.round(afterBars)));
  const segments = [...plan.segments];
  segments.splice(index, 1, { meter: segment.meter, bars: head }, { meter: segment.meter, bars: segment.bars - head });
  return { ...plan, segments };
}

export function removeSegment(plan: SpanPlan, index: number): SpanPlan {
  return { ...plan, segments: plan.segments.filter((_, i) => i !== index) };
}

/**
 * Merge adjacent runs that share a meter.
 *
 * Editing naturally produces `4/4 x2, 4/4 x1`, which is the same music written
 * confusingly. Normalising keeps the panel readable and keeps two plans that
 * describe identical music comparable.
 */
export function normalizePlan(plan: SpanPlan): SpanPlan {
  const segments: PlanSegment[] = [];
  for (const segment of plan.segments) {
    if (segment.bars <= 0) continue;
    const last = segments[segments.length - 1];
    if (last && last.meter.count === segment.meter.count && last.meter.unit === segment.meter.unit) {
      segments[segments.length - 1] = { meter: last.meter, bars: last.bars + segment.bars };
    } else {
      segments.push(segment);
    }
  }
  return { ...plan, segments };
}

/**
 * The meter of each bar in order.
 *
 * What the apply step writes into the score, and what the timeline draws.
 */
export function planMeters(plan: SpanPlan): TimeSignature[] {
  const meters: TimeSignature[] = [];
  for (const segment of plan.segments) {
    for (let bar = 0; bar < segment.bars; bar += 1) meters.push(segment.meter);
  }
  return meters;
}
