/**
 * Fitting bars to picture.
 *
 * A composer spots a cue by marking what the music has to land on, then works
 * out the bars, meters and tempi that get there. This module is that second
 * step.
 *
 * For a span of `d` seconds containing `b` quarter-note beats the exact tempo is
 * `b * 60 / d`. MNX permits fractional BPM, so each musical structure can use
 * that exact tempo. Fitting remains a search over bar count and meter, ranked by
 * proximity to the requested tempo and a preference for uniform bars.
 *
 * Two properties matter for correctness:
 *
 * Musical plausibility is part of the ranking: distance from the requested
 * tempo and a preference for uniform bars choose between exact candidates.
 */

import type { SpanFit, SpanFitCandidate, SpanFitRequest, TimeSignature } from "./cueTypes";

/** Quarter-note beats in one bar of the given meter. */
export function beatsPerBar(time: TimeSignature): number {
  return (time.count * 4) / time.unit;
}

/** Seconds a span of `beats` quarter notes occupies at `bpm`. */
function spanSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/**
 * Tempo that would place `beats` exactly across `seconds`.
 *
 * Reported alongside every fit so callers can compare the derived tempo with
 * any later authoring adjustment.
 */
export function exactTempo(beats: number, seconds: number): number {
  return (beats * 60) / seconds;
}

/**
 * How much a candidate is penalised for being musically awkward.
 *
 * Deliberately small relative to timing error measured in frames: it breaks ties
 * between near-equal fits rather than overriding accuracy.
 */
function awkwardness(candidate: { bpm: number; tailBars: number }, request: SpanFitRequest): number {
  const target = request.preferredBpm ?? midpoint(request.minBpm, request.maxBpm);
  // A tenth of a frame per BPM away from what the composer asked for.
  const tempoDrift = Math.abs(candidate.bpm - target) * 0.1;
  // A closing bar in a different meter is a real device, but not free.
  const tailCost = candidate.tailBars > 0 ? 3 : 0;
  return tempoDrift + tailCost;
}

function midpoint(lo: number, hi: number): number {
  return (lo + hi) / 2;
}

/**
 * Search bar counts and meters for the best ways to fill a span.
 *
 * Returns candidates ranked by frame error first and musical plausibility
 * second, best first. An empty result means the span cannot be filled within the
 * requested constraints — usually too narrow a tempo range for its duration.
 */
export function fitSpan(request: SpanFitRequest): SpanFit {
  const { seconds, meters, minBars, maxBars, minBpm, maxBpm, frameRate } = request;
  const frame = 1 / frameRate;
  const candidates: SpanFitCandidate[] = [];

  for (const meter of meters) {
    const barBeats = beatsPerBar(meter);
    // A closing bar in another meter buys finer granularity than whole bars of
    // the main meter allow, which is how an odd span length gets absorbed
    // without distorting the tempo.
    const tails: (TimeSignature | undefined)[] = [undefined, ...(request.tailMeters ?? [])];

    for (let bars = minBars; bars <= maxBars; bars++) {
      for (const tail of tails) {
        const beats = barBeats * bars + (tail ? beatsPerBar(tail) : 0);
        if (beats <= 0) continue;

        const ideal = exactTempo(beats, seconds);
        if (ideal < minBpm || ideal > maxBpm) continue;

        const errorSeconds = spanSeconds(beats, ideal) - seconds;
        candidates.push({
          bars,
          meter,
          tailMeter: tail,
          bpm: ideal,
          beats,
          exactBpm: ideal,
          errorSeconds,
          errorFrames: errorSeconds / frame,
        });
      }
    }
  }

  const ranked = dedupe(candidates).sort((a, b) => cost(a, request) - cost(b, request));
  return { request, candidates: ranked, best: ranked[0] };
}

/** Frame error plus a small musical penalty; lower is better. */
function cost(candidate: SpanFitCandidate, request: SpanFitRequest): number {
  return (
    Math.abs(candidate.errorFrames) +
    awkwardness({ bpm: candidate.bpm, tailBars: candidate.tailMeter ? 1 : 0 }, request)
  );
}

/** Collapse candidates that describe the same music (floor and ceil can agree). */
function dedupe(candidates: SpanFitCandidate[]): SpanFitCandidate[] {
  const seen = new Map<string, SpanFitCandidate>();
  for (const candidate of candidates) {
    const tail = candidate.tailMeter ? `${candidate.tailMeter.count}/${candidate.tailMeter.unit}` : "-";
    const key = `${candidate.bars}:${candidate.meter.count}/${candidate.meter.unit}:${tail}:${candidate.bpm}`;
    if (!seen.has(key)) seen.set(key, candidate);
  }
  return [...seen.values()];
}
