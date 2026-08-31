/**
 * Tempo model — a continuous, sub-bar-resolved map between musical position
 * (global quarter-note beats) and wall-clock time (seconds).
 *
 * Why this exists: the original tempo handling resolved tempo only at measure
 * granularity (one BPM per bar, applied linearly), so a tempo change mid-bar,
 * a rit./accel., or a fermata-as-tempo-dip could not be expressed. This model
 * integrates a piecewise tempo curve at arbitrary beat resolution, which is
 * exactly what MIDI tempo meta-events express and what a studio click track
 * needs.
 *
 * The model is two layers:
 *
 *  1. **Tempo regions** — a sorted, contiguous list of `[startBeat, endBeat)`
 *     spans, each with a start and end tempo (BPM of a quarter note). Within a
 *     region the tempo varies LINEARLY IN BPM over beats: a constant region has
 *     `startBpm === endBpm`; a rit./accel. is a ramp. Linear-in-BPM is the
 *     conventional reading of a gradual tempo change and integrates to a clean,
 *     invertible closed form (logarithmic time, exponential inverse).
 *
 *  2. **Point insertions** — instantaneous time gaps at a beat that DO NOT
 *     advance musical position (a caesura / grand pause is pure silence). These
 *     shift all later time without consuming beats.
 *
 * A fermata is modelled as a flat tempo DIP region (a constant region at a
 * slower tempo over the held span), NOT an insertion — so concurrent notes
 * underneath stretch correctly and following notes shift with zero "bleed".
 * (The fermata wiring lives in the hold layer; this module just integrates
 * whatever regions it is given.)
 */

/** Seconds-per-beat ↔ BPM helpers (quarter-note BPM). */
const bpmToSpb = (bpm: number): number => 60 / bpm;

/** Slopes below this (BPM per beat) are treated as constant to avoid blowups. */
const RAMP_EPS = 1e-6;

/** A contiguous tempo region in global quarter-note beats. */
export interface TempoRegion {
  /** Global quarter-note beat where this region starts (inclusive). */
  startBeat: number;
  /** Global quarter-note beat where this region ends (exclusive). The final
   *  region uses `Infinity`. */
  endBeat: number;
  /** Quarter-note BPM at `startBeat`. */
  startBpm: number;
  /** Quarter-note BPM at `endBeat`. Equal to `startBpm` for a constant region;
   *  different for a rit. (slower → smaller BPM) or accel. (faster). */
  endBpm: number;
}

/** An instantaneous time gap at a beat that does not advance musical position. */
export interface TempoInsertion {
  /** Global quarter-note beat at which the gap is inserted. */
  beat: number;
  /** Seconds of silence inserted. */
  seconds: number;
}

/** A precomputed knot: cumulative time at a region boundary (post-insertions). */
interface Knot {
  beat: number;
  /** Cumulative time at `beat`, just AFTER any insertion at this beat. */
  time: number;
  /** BPM at `beat` (region start tempo). */
  bpm: number;
  /** BPM slope (per beat) within the region starting here; 0 if constant. */
  slope: number;
  /** Seconds inserted exactly at this beat (point hold), already folded into
   *  `time`; needed so the inverse maps the gap interval back to this beat. */
  insertBefore: number;
}

/**
 * Integrate the time advanced over `[b0, b]` within a single linear-BPM region.
 * Linear in BPM: `bpm(x) = bpm0 + slope·(x − b0)`. Time is `∫ 60/bpm dx`:
 *  - constant (slope≈0): `60·(b−b0)/bpm0`
 *  - ramp: `(60/slope)·ln(bpm(b)/bpm0)`
 */
function integrateTime(b0: number, b: number, bpm0: number, slope: number): number {
  const db = b - b0;
  if (Math.abs(slope) < RAMP_EPS) return bpmToSpb(bpm0) * db;
  const bpmB = bpm0 + slope * db;
  return (60 / slope) * Math.log(bpmB / bpm0);
}

/**
 * Invert {@link integrateTime}: given elapsed seconds `dt` from `b0`, return the
 * beat reached. The inverse of the closed forms above.
 */
function inverseBeat(dt: number, bpm0: number, slope: number): number {
  if (Math.abs(slope) < RAMP_EPS) return (dt * bpm0) / 60;
  // dt = (60/slope)·ln(bpm/bpm0) → bpm = bpm0·exp(dt·slope/60); db = (bpm−bpm0)/slope
  const bpmAt = bpm0 * Math.exp((dt * slope) / 60);
  return (bpmAt - bpm0) / slope;
}

/**
 * A continuous tempo map. Construct via {@link TempoModel.build}.
 *
 * All public queries are O(log n) over the region/knot list.
 */
export class TempoModel {
  private readonly knots: readonly Knot[];

  private constructor(knots: readonly Knot[]) {
    this.knots = knots;
  }

  /**
   * Build a model from tempo regions and point insertions.
   *
   * `regions` need not be pre-sorted or gapless; they are sorted by `startBeat`
   * and gaps are filled by extending the previous tempo (a held constant). The
   * first region's start tempo applies from beat 0. `insertions` are point gaps
   * (caesuras) keyed by beat.
   */
  static build(regions: readonly TempoRegion[], insertions: readonly TempoInsertion[] = []): TempoModel {
    const sorted = [...regions].sort((a, b) => a.startBeat - b.startBeat);
    const insByBeat = new Map<number, number>();
    for (const ins of insertions) {
      if (ins.seconds > 0) insByBeat.set(ins.beat, (insByBeat.get(ins.beat) ?? 0) + ins.seconds);
    }

    // Collect boundary beats: every region start + every insertion beat.
    const boundarySet = new Set<number>([0]);
    for (const r of sorted) boundarySet.add(r.startBeat);
    for (const ins of insByBeat.keys()) boundarySet.add(ins);
    const boundaries = [...boundarySet].sort((a, b) => a - b);

    // Resolve the tempo (bpm + slope) active at a given beat from the regions.
    const tempoAt = (beat: number): { bpm: number; slope: number } => {
      let active: TempoRegion | undefined;
      for (const r of sorted) {
        if (r.startBeat <= beat + 1e-9) active = r;
        else break;
      }
      if (!active) {
        // Before the first region: use the first region's start tempo, or 120.
        const first = sorted[0];
        return { bpm: first ? first.startBpm : 120, slope: 0 };
      }
      const span = active.endBeat - active.startBeat;
      const slope = span > 0 && Number.isFinite(span) ? (active.endBpm - active.startBpm) / span : 0;
      const bpmAtBeat = active.startBpm + slope * (beat - active.startBeat);
      return { bpm: bpmAtBeat, slope };
    };

    const knots: Knot[] = [];
    let time = 0;
    let prevBeat = boundaries[0]!;
    let prev = tempoAt(prevBeat);
    // First knot (with any insertion at beat 0).
    const ins0 = insByBeat.get(prevBeat) ?? 0;
    time += ins0;
    knots.push({ beat: prevBeat, time, bpm: prev.bpm, slope: prev.slope, insertBefore: ins0 });

    for (let i = 1; i < boundaries.length; i++) {
      const beat = boundaries[i]!;
      // Advance time across [prevBeat, beat) using the tempo active at prevBeat.
      time += integrateTime(prevBeat, beat, prev.bpm, prev.slope);
      const ins = insByBeat.get(beat) ?? 0;
      time += ins;
      const t = tempoAt(beat);
      knots.push({ beat, time, bpm: t.bpm, slope: t.slope, insertBefore: ins });
      prevBeat = beat;
      prev = t;
    }

    return new TempoModel(knots);
  }

  /** Index of the last knot whose beat ≤ `beat`. */
  private knotIndexForBeat(beat: number): number {
    const k = this.knots;
    let lo = 0;
    let hi = k.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (k[mid]!.beat <= beat + 1e-9) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  /** Index of the last knot whose time ≤ `time`. */
  private knotIndexForTime(time: number): number {
    const k = this.knots;
    let lo = 0;
    let hi = k.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (k[mid]!.time <= time + 1e-9) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  /**
   * Absolute time (seconds) at a global quarter-note beat.
   *
   * `endpoint` selects how a point insertion EXACTLY at `beat` is treated:
   *  - `"onset"` (default): time AFTER the insertion — what an event STARTING at
   *    `beat` wants (it begins once the gap is over).
   *  - `"release"`: time BEFORE the insertion — what a note ENDING at `beat`
   *    wants (a caesura/gap at the release point isn't part of the note).
   */
  timeAtBeat(beat: number, endpoint: "onset" | "release" = "onset"): number {
    const i = this.knotIndexForBeat(beat);
    const knot = this.knots[i]!;
    const base = knot.time + integrateTime(knot.beat, beat, knot.bpm, knot.slope);
    if (endpoint === "release" && Math.abs(knot.beat - beat) < 1e-9) {
      // `knot.time` already folds in `insertBefore`; back it out for a release.
      return base - knot.insertBefore;
    }
    return base;
  }

  /**
   * Seconds elapsed over `[beat, beat + beats)` — a note/event DURATION. The end
   * uses release semantics so a point insertion (caesura) exactly at the release
   * beat is not absorbed into the note's sounding length.
   */
  secondsForBeats(beat: number, beats: number): number {
    return this.timeAtBeat(beat + beats, "release") - this.timeAtBeat(beat);
  }

  /**
   * Global quarter-note beat at an absolute time (inverse of {@link timeAtBeat}).
   * Within a point-insertion gap, returns the insertion's beat (position is
   * frozen during a caesura).
   */
  beatAtTime(time: number): number {
    const i = this.knotIndexForTime(time);
    const knot = this.knots[i]!;
    const next = this.knots[i + 1];
    if (next) {
      // The music for this knot runs until just before the NEXT knot's point
      // insertion; the interval [musicEnd, next.time) is that insertion's gap,
      // during which position is frozen at next.beat (a caesura holds time).
      const musicEnd = next.time - next.insertBefore;
      if (time >= musicEnd - 1e-9) return next.beat;
    }
    return knot.beat + inverseBeat(time - knot.time, knot.bpm, knot.slope);
  }

  /** Seconds-per-quarter-note beat at a global beat. */
  spbAtBeat(beat: number): number {
    const i = this.knotIndexForBeat(beat);
    const knot = this.knots[i]!;
    const bpmHere = knot.bpm + knot.slope * (beat - knot.beat);
    return bpmToSpb(bpmHere);
  }

  /** Quarter-note BPM at a global beat. */
  bpmAtBeat(beat: number): number {
    return 60 / this.spbAtBeat(beat);
  }

  /**
   * Generate click times (seconds) for a metronome / studio click track over
   * `[startBeat, endBeat)`. `clickBeats` are the beat positions to click,
   * expressed as offsets within each "grid step" — but for the common case
   * callers pass a flat list of global beat positions and we just map them.
   * Returns the absolute time of every beat in `beats`.
   */
  clickTimes(beats: readonly number[]): number[] {
    return beats.map((b) => this.timeAtBeat(b));
  }
}
