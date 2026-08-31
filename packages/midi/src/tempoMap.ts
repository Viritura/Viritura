/**
 * Tempo map builder — walks global measures and produces a time-indexed
 * list of tempo changes for converting beat positions to absolute seconds.
 *
 * All BPM values stored in the tempo map are normalized to effective
 * quarter-note BPM. For example, "dotted quarter = 120" becomes
 * effective QPM = 120 × 1.5 = 180.
 */

import type { GlobalMeasure, TimeSignature } from "@viritura/core";
import { DURATION_BEATS } from "@viritura/core";
import type { TempoMapEntry } from "./types";
import type { HoldSchedule } from "./holds";
import { TempoModel, type TempoRegion, type TempoInsertion } from "./tempoModel";

type PlaybackGlobalMeasure = GlobalMeasure & { __playbackNominalTime?: TimeSignature };

function playbackNominalTime(gm: GlobalMeasure): TimeSignature | undefined {
  return (gm as PlaybackGlobalMeasure).__playbackNominalTime;
}

/** Default tempo when no tempo marking is specified. */
export const DEFAULT_BPM = 120;

/** Default time signature when none is specified. */
const DEFAULT_TIME: TimeSignature = { count: 4, unit: 4 };

/**
 * Compute beats in a measure from its time signature.
 * Returns the number of quarter-note beats.
 */
export function measureBeatsFromTime(ts: TimeSignature): number {
  return (ts.count * 4) / ts.unit;
}

/**
 * Compute the number of quarter-note beats for a tempo's note value.
 * A "dotted quarter" = 1.5 quarter-note beats.
 */
export function tempoNoteBeats(base: string, dots?: number): number {
  const baseBeats = DURATION_BEATS[base as keyof typeof DURATION_BEATS] ?? 1;
  if (!dots) return baseBeats;
  // Dot formula: total = base × (2 − 1/2^dots)
  return baseBeats * (2 - Math.pow(2, -dots));
}

/**
 * Convert a tempo marking to effective quarter-note BPM.
 * "dotted quarter = 120" → 120 × 1.5 = 180 effective QPM.
 */
export function effectiveQpm(bpm: number, tempoBase: string, tempoDots?: number): number {
  return bpm * tempoNoteBeats(tempoBase, tempoDots);
}

/**
 * Build a tempo map from the global measures of a score.
 *
 * Each entry records the absolute time at which a tempo change occurs,
 * plus the measure index and beat offset. The `bpm` field stores the
 * effective quarter-note BPM (normalized from whatever note value the
 * tempo marking references).
 *
 * The first entry always starts at time 0. If no tempo is specified,
 * the default of 120 QPM is used.
 *
 * When a `holds` schedule is supplied (one entry per expanded measure), the
 * extra time that fermatas/caesuras insert is added to the running clock at
 * the measure-start tempo, so every later measure's start time is pushed back
 * uniformly — keeping all parts aligned through the hold.
 *
 * @returns tempoMap entries and cumulative measure start times (in seconds).
 */
export function buildTempoMap(
  globalMeasures: readonly GlobalMeasure[],
  holds?: HoldSchedule,
): {
  tempoMap: TempoMapEntry[];
  measureStartTimes: number[];
} {
  const tempoMap: TempoMapEntry[] = [];
  const measureStartTimes: number[] = [];

  let currentQpm = DEFAULT_BPM;
  let currentSpq = 60 / currentQpm;
  let currentTime = { count: DEFAULT_TIME.count, unit: DEFAULT_TIME.unit };
  let absoluteTime = 0;
  let hasInitialTempo = false;

  for (let m = 0; m < globalMeasures.length; m++) {
    const gm = globalMeasures[m]!;
    const nominalTime = playbackNominalTime(gm) ?? gm.time;

    if (nominalTime) {
      currentTime = { count: nominalTime.count, unit: nominalTime.unit };
    }

    const mBeats = measureBeatsFromTime(gm.time ?? currentTime);
    measureStartTimes.push(absoluteTime);

    // Seconds-per-beat at the measure start — used for hold insertion so it
    // matches the timeline's within-measure event timing (which also uses the
    // measure-start tempo).
    const measureStartSpq = currentSpq;

    // Collect and sort tempo changes within this measure by beat position
    interface TempoChange {
      beatOffset: number;
      qpm: number;
    }
    const changes: TempoChange[] = [];

    if (gm.tempos && gm.tempos.length > 0) {
      for (const tempo of gm.tempos) {
        const beatOffset = tempo.location ? (tempo.location.fraction[0] / tempo.location.fraction[1]) * mBeats : 0;
        const qpm = effectiveQpm(tempo.bpm, tempo.value.base, tempo.value.dots);
        changes.push({ beatOffset, qpm });
      }
      changes.sort((a, b) => a.beatOffset - b.beatOffset);
    }

    // Walk through the measure, advancing time segment-by-segment
    let beatCursor = 0;
    for (const change of changes) {
      // Advance time from beatCursor to the change's beat offset at the current tempo
      if (change.beatOffset > beatCursor) {
        absoluteTime += (change.beatOffset - beatCursor) * currentSpq;
        beatCursor = change.beatOffset;
      }

      // Record the tempo change
      tempoMap.push({
        measureIndex: m,
        beatInMeasure: change.beatOffset,
        timeSeconds: absoluteTime,
        bpm: change.qpm,
      });

      if (m === 0 && change.beatOffset === 0) {
        hasInitialTempo = true;
      }

      currentQpm = change.qpm;
      currentSpq = 60 / currentQpm;
    }

    // Advance time for the remaining beats in the measure
    if (mBeats > beatCursor) {
      absoluteTime += (mBeats - beatCursor) * currentSpq;
    }

    // Insert fermata/caesura hold time for this measure (at the measure-start
    // tempo, matching the timeline's within-measure event shifting).
    const measureHolds = holds?.[m];
    if (measureHolds) {
      for (const hold of measureHolds) {
        absoluteTime += hold.extraBeats * measureStartSpq;
      }
    }
  }

  // Ensure there's always an initial tempo entry at time 0
  if (!hasInitialTempo) {
    tempoMap.unshift({
      measureIndex: 0,
      beatInMeasure: 0,
      timeSeconds: 0,
      bpm: DEFAULT_BPM,
    });
  }

  return { tempoMap, measureStartTimes };
}

/**
 * Result of {@link buildTempoModel}: a continuous {@link TempoModel} plus the
 * per-measure coordinate arrays the timeline needs to convert measure-relative
 * beats to the model's GLOBAL beat axis.
 */
export interface TempoBuild {
  /** Continuous, sub-bar-resolved beat↔time map (the single source of timing). */
  model: TempoModel;
  /** Absolute start time (seconds) of each expanded measure. */
  measureStartTimes: number[];
  /** Global quarter-note beat at each expanded measure's start (hold-free axis;
   *  holds are time insertions, not beats). Add a measure-relative beat offset
   *  to get the global beat for `model.timeAtBeat`. */
  measureStartBeats: number[];
}

/**
 * Build the continuous {@link TempoModel} for an expanded measure list.
 *
 * Tempo regions come from each measure's `tempos[]`, placed at their real
 * sub-bar beat (so a mid-bar tempo change takes effect mid-bar — the per-bar
 * model could not express this). A tempo with no later change holds constant
 * to the next region. Fermata/caesura holds become point time-insertions at
 * their (global) beat, so every later event — at any nesting depth — shifts
 * uniformly through the gap via `model.timeAtBeat`.
 *
 * `measureStartBeats[i]` is the cumulative global beat at measure `i`'s start;
 * `measureStartTimes[i] = model.timeAtBeat(measureStartBeats[i])`.
 */
export function buildTempoModel(globalMeasures: readonly GlobalMeasure[], holds?: HoldSchedule): TempoBuild {
  const regions: TempoRegion[] = [];
  const measureStartBeats: number[] = [];

  let cumBeats = 0;
  let currentTime: TimeSignature = { count: DEFAULT_TIME.count, unit: DEFAULT_TIME.unit };

  // Collected gradual-tempo (rit./accel.) ramps, resolved to global beats after
  // the full measureStartBeats axis is known (the ramp end may cross bar lines).
  const gradualDecls: { declIdx: number; gt: NonNullable<GlobalMeasure["gradualTempo"]>; startBeat: number }[] = [];

  // Pass 1: measure start beats + constant tempo regions from each `tempos[]`.
  // Gradual tempos are collected here and resolved into ramp regions below.
  for (let m = 0; m < globalMeasures.length; m++) {
    const gm = globalMeasures[m]!;
    const nominalTime = playbackNominalTime(gm) ?? gm.time;
    if (nominalTime) currentTime = { count: nominalTime.count, unit: nominalTime.unit };
    const mBeats = measureBeatsFromTime(gm.time ?? currentTime);
    measureStartBeats.push(cumBeats);

    if (gm.tempos && gm.tempos.length > 0) {
      const sorted = [...gm.tempos].sort((a, b) => tempoBeat(a, mBeats) - tempoBeat(b, mBeats));
      for (const tempo of sorted) {
        const startBeat = cumBeats + tempoBeat(tempo, mBeats);
        const qpm = effectiveQpm(tempo.bpm, tempo.value.base, tempo.value.dots);
        regions.push({ startBeat, endBeat: Infinity, startBpm: qpm, endBpm: qpm });
      }
    }
    if (gm.gradualTempo) {
      gradualDecls.push({
        declIdx: m,
        gt: gm.gradualTempo,
        startBeat: cumBeats + posBeats(gm.gradualTempo.position.fraction),
      });
    }
    cumBeats += mBeats;
  }

  // Default region from beat 0 if the score opens without a tempo.
  if (regions.length === 0 || regions.every((r) => r.startBeat > 1e-9)) {
    regions.unshift({ startBeat: 0, endBeat: Infinity, startBpm: DEFAULT_BPM, endBpm: DEFAULT_BPM });
  }

  // Resolve gradual-tempo ramps. `startBpm` defaults to the tempo active at the
  // ramp's start (read from a constant-only model so the ramp begins
  // continuously). A linear-in-BPM ramp region replaces the constant tempo over
  // [start, end); a trailing constant anchor at `end` holds `endBpm` afterwards
  // unless a real tempo ("a tempo") already starts there.
  if (gradualDecls.length > 0) {
    const idToIdx = buildMeasureIdToIndex(globalMeasures);
    const constModel = TempoModel.build(regions);
    for (const { declIdx, gt, startBeat } of gradualDecls) {
      const endBeat = resolveGradualEndBeat(gt.end, declIdx, globalMeasures, measureStartBeats, idToIdx);
      if (endBeat === undefined || endBeat <= startBeat + 1e-9) continue;
      const startBpm = gt.startBpm ?? constModel.bpmAtBeat(startBeat);
      regions.push({ startBeat, endBeat, startBpm, endBpm: gt.endBpm });
      const hasAnchorAtEnd = regions.some((r) => Math.abs(r.startBeat - endBeat) < 1e-9);
      if (!hasAnchorAtEnd) {
        regions.push({ startBeat: endBeat, endBeat: Infinity, startBpm: gt.endBpm, endBpm: gt.endBpm });
      }
    }
  }

  // Close each region at the next region's start (constant regions are
  // contiguous; ramp regions land exactly on the boundary we inserted at their
  // end; the final region stays open at Infinity).
  regions.sort((a, b) => a.startBeat - b.startBeat);
  for (let i = 0; i < regions.length - 1; i++) {
    regions[i]!.endBeat = regions[i + 1]!.startBeat;
  }

  // Insertions (fermata/caesura gaps). Seconds use the tempo at the measure
  // start (matching the legacy hold seconds), computed from a regions-only model.
  const regionsModel = TempoModel.build(regions);
  const insertions: TempoInsertion[] = [];
  if (holds) {
    for (let m = 0; m < holds.length; m++) {
      const measureHolds = holds[m];
      if (!measureHolds || measureHolds.length === 0) continue;
      const startBeat = measureStartBeats[m]!;
      const spb = regionsModel.spbAtBeat(startBeat);
      for (const hold of measureHolds) {
        insertions.push({ beat: startBeat + hold.atBeat, seconds: hold.extraBeats * spb });
      }
    }
  }

  const model = insertions.length > 0 ? TempoModel.build(regions, insertions) : regionsModel;
  const measureStartTimes = measureStartBeats.map((b) => model.timeAtBeat(b));
  return { model, measureStartTimes, measureStartBeats };
}

/** A rhythmic-position fraction (of a whole note) → quarter-note beats. */
function posBeats(frac: readonly [number, number]): number {
  if (!frac || frac[1] === 0) return 0;
  return (frac[0] / frac[1]) * 4;
}

/** Map every global-measure id → its index (for gradual-tempo end resolution). */
function buildMeasureIdToIndex(globalMeasures: readonly GlobalMeasure[]): Map<string, number> {
  const m = new Map<string, number>();
  globalMeasures.forEach((gm, i) => {
    if (gm.id && !m.has(gm.id)) m.set(gm.id, i);
  });
  return m;
}

/** Resolve a gradual-tempo end (measure id + position) to a global beat. */
function resolveGradualEndBeat(
  end: NonNullable<GlobalMeasure["gradualTempo"]>["end"],
  fromIdx: number,
  globalMeasures: readonly GlobalMeasure[],
  measureStartBeats: readonly number[],
  idToIdx: ReadonlyMap<string, number>,
): number | undefined {
  let idx = idToIdx.get(end.measure);
  if (idx === undefined) {
    const parsed = Number.parseInt(end.measure, 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed < globalMeasures.length) idx = parsed;
  }
  if (idx === undefined) idx = fromIdx; // same-measure ramp fallback
  const start = measureStartBeats[idx];
  if (start === undefined) return undefined;
  return start + posBeats(end.position.fraction);
}

/** Global-measure tempo's beat offset within its measure (0 if unlocated). */
function tempoBeat(tempo: NonNullable<GlobalMeasure["tempos"]>[number], mBeats: number): number {
  return tempo.location ? (tempo.location.fraction[0] / tempo.location.fraction[1]) * mBeats : 0;
}

/**
 * Look up the seconds-per-quarter-note at a given absolute time.
 */
export function spqAtTime(tempoMap: readonly TempoMapEntry[], time: number): number {
  let activeQpm = DEFAULT_BPM;
  for (const entry of tempoMap) {
    if (entry.timeSeconds <= time + 1e-9) {
      activeQpm = entry.bpm;
    } else {
      break;
    }
  }
  return 60 / activeQpm;
}
