/**
 * Resolving a score's bars into picture time.
 *
 * The one rule this feature has held from the start is that `TempoModel` is the
 * only thing that converts musical position to time. This module is the single
 * place that reads it for the timeline, turning bars into picture-time spans by
 * adding the picture offset — so the canvas never does timing arithmetic and can
 * never drift from playback.
 */

import type { GlobalMeasure, Score } from "@viritura/core";
import type { TimelineBar, TimelineHit } from "./timelineTypes";
import type { HitPoint } from "./types";

/** The subset of a built tempo model this module needs. */
export interface TempoLookup {
  /** Absolute score time (seconds) at each measure's start. */
  readonly measureStartTimes: readonly number[];
  /** Total score duration in seconds. */
  readonly durationSeconds: number;
}

/**
 * Convert the score's bars into picture-time spans.
 *
 * `pictureOffsetSeconds` is the media time that lines up with score time zero,
 * so picture time is score time plus the offset. Meter and tempo are attached
 * only where they change, matching how they are engraved and letting the
 * renderer weight those bar lines.
 */
export function resolveBars(score: Score, tempo: TempoLookup, pictureOffsetSeconds: number): TimelineBar[] {
  const measures = score.global.measures;
  const bars: TimelineBar[] = [];

  let previousMeter: { count: number; unit: number } | undefined;
  let previousBpm: number | undefined;

  for (let index = 0; index < measures.length; index++) {
    const measure = measures[index]!;
    const start = tempo.measureStartTimes[index];
    if (start === undefined) break;
    const end = tempo.measureStartTimes[index + 1] ?? tempo.durationSeconds;

    const meter = measure.time ? { count: measure.time.count, unit: measure.time.unit } : undefined;
    const bpm = firstTempoBpm(measure);

    const bar: TimelineBar = {
      number: index + 1,
      startSeconds: start + pictureOffsetSeconds,
      endSeconds: end + pictureOffsetSeconds,
      // Only surface a change, so the renderer can weight structural bar lines.
      ...(meter && !sameMeter(meter, previousMeter) ? { meter } : {}),
      ...(bpm !== undefined && bpm !== previousBpm ? { bpm } : {}),
    };
    bars.push(bar);

    if (meter) previousMeter = meter;
    if (bpm !== undefined) previousBpm = bpm;
  }
  return bars;
}

function sameMeter(a: { count: number; unit: number }, b: { count: number; unit: number } | undefined): boolean {
  return b !== undefined && a.count === b.count && a.unit === b.unit;
}

/**
 * Tempo at a measure's start.
 *
 * A measure may carry several tempo marks at different sub-bar positions; only
 * one starting at the downbeat belongs on the bar line.
 */
function firstTempoBpm(measure: GlobalMeasure): number | undefined {
  const tempos = measure.tempos;
  if (!tempos?.length) return undefined;
  const atStart = tempos.find((tempo) => {
    const fraction = tempo.location?.fraction;
    return fraction === undefined || fraction[0] === 0;
  });
  return atStart?.bpm;
}

/** Hit points in draw order, with `locked` defaulted. */
export function resolveHits(hitPoints: readonly HitPoint[] | undefined): TimelineHit[] {
  if (!hitPoints?.length) return [];
  return [...hitPoints]
    .sort((a, b) => a.pictureSeconds - b.pictureSeconds)
    .map((hit) => ({
      id: hit.id,
      pictureSeconds: hit.pictureSeconds,
      ...(hit.label === undefined ? {} : { label: hit.label }),
      locked: hit.locked !== false,
    }));
}

/**
 * The span a picture time falls in, bounded by the surrounding locked hits.
 *
 * Spans are what the solver works on: two locked hits fix a duration, and the
 * music between them has to fill it. The clip's start and end act as bounds so
 * the first and last spans are solvable too.
 */
export function spanAt(
  seconds: number,
  hits: readonly TimelineHit[],
  durationSeconds: number,
): { fromSeconds: number; toSeconds: number; fromHitId?: string; toHitId?: string } | null {
  const locked = hits.filter((hit) => hit.locked);
  if (locked.length === 0) return null;

  let fromSeconds = 0;
  let toSeconds = durationSeconds;
  let fromHitId: string | undefined;
  let toHitId: string | undefined;

  for (const hit of locked) {
    if (hit.pictureSeconds <= seconds) {
      fromSeconds = hit.pictureSeconds;
      fromHitId = hit.id;
    } else {
      toSeconds = hit.pictureSeconds;
      toHitId = hit.id;
      break;
    }
  }
  if (toSeconds <= fromSeconds) return null;
  return {
    fromSeconds,
    toSeconds,
    ...(fromHitId === undefined ? {} : { fromHitId }),
    ...(toHitId === undefined ? {} : { toHitId }),
  };
}

export interface TimelineMarkerInterval {
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly fromMarkerId: string;
  readonly toMarkerId: string;
  readonly fromMarkerNumber: number;
  readonly toMarkerNumber: number;
  readonly fromLabel?: string;
  readonly toLabel?: string;
}

/** Consecutive locked-marker intervals available to the tempo solver. */
export function markerIntervals(hits: readonly TimelineHit[]): TimelineMarkerInterval[] {
  const locked = hits.map((hit, index) => ({ hit, markerNumber: index + 1 })).filter(({ hit }) => hit.locked);
  const intervals: TimelineMarkerInterval[] = [];
  for (let index = 0; index < locked.length - 1; index++) {
    const from = locked[index]!;
    const to = locked[index + 1]!;
    if (to.hit.pictureSeconds <= from.hit.pictureSeconds) continue;
    intervals.push({
      fromSeconds: from.hit.pictureSeconds,
      toSeconds: to.hit.pictureSeconds,
      fromMarkerId: from.hit.id,
      toMarkerId: to.hit.id,
      fromMarkerNumber: from.markerNumber,
      toMarkerNumber: to.markerNumber,
      ...(from.hit.label === undefined ? {} : { fromLabel: from.hit.label }),
      ...(to.hit.label === undefined ? {} : { toLabel: to.hit.label }),
    });
  }
  return intervals;
}

/** Select the marker interval containing a picture time. */
export function markerIntervalAt(
  seconds: number,
  intervals: readonly TimelineMarkerInterval[],
): TimelineMarkerInterval | null {
  return intervals.find((interval) => seconds >= interval.fromSeconds && seconds < interval.toSeconds) ?? null;
}

/**
 * Where a span sits in the score.
 *
 * A span is fixed in picture time; the bars under it are whatever the current
 * tempo map puts there. The start bar is the one whose downbeat is nearest the
 * span's start rather than the one containing it, because a hit half a bar late
 * almost always means the composer intends the *next* downbeat to land on it.
 */
export function barSpanFor(
  bars: readonly TimelineBar[],
  fromSeconds: number,
  toSeconds: number,
): { startIndex: number; barCount: number } | null {
  if (bars.length === 0) return null;
  const startIndex = nearestDownbeatIndex(bars, fromSeconds);
  const endIndex = nearestDownbeatIndex(bars, toSeconds);
  // A span shorter than one bar still occupies one: there is no such thing as
  // planning zero bars of music between two hits.
  return { startIndex, barCount: Math.max(1, endIndex - startIndex) };
}

function nearestDownbeatIndex(bars: readonly TimelineBar[], seconds: number): number {
  let best = 0;
  let bestDistance = Infinity;
  bars.forEach((bar, index) => {
    const distance = Math.abs(bar.startSeconds - seconds);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  // The end of the last bar is a legitimate boundary — a span can finish the
  // score — so it competes with every downbeat.
  const last = bars[bars.length - 1]!;
  if (Math.abs(last.endSeconds - seconds) < bestDistance) return bars.length;
  return best;
}

/** Hit nearest a picture time, within a tolerance. Used for click selection. */ export function hitNear(
  seconds: number,
  hits: readonly TimelineHit[],
  toleranceSeconds: number,
): TimelineHit | undefined {
  let best: TimelineHit | undefined;
  let bestDistance = toleranceSeconds;
  for (const hit of hits) {
    const distance = Math.abs(hit.pictureSeconds - seconds);
    if (distance <= bestDistance) {
      best = hit;
      bestDistance = distance;
    }
  }
  return best;
}
