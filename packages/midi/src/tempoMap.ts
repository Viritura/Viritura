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
import { compileTempoRamps } from "./tempoRamps";

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
 * Anchor times and measure starts use the continuous tempo model, including
 * ramps and fermata/caesura holds. The array records explicit BPM anchors, not
 * samples of ramp curves; continuous queries must use the model.
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
  const timing = buildTempoModel(globalMeasures, holds);
  return { tempoMap: tempoMapEntries(globalMeasures, timing), measureStartTimes: timing.measureStartTimes };
}

export function tempoMapEntries(globalMeasures: readonly GlobalMeasure[], timing: TempoBuild): TempoMapEntry[] {
  const { model, measureStartBeats } = timing;
  const tempoMap: TempoMapEntry[] = [];
  globalMeasures.forEach((measure, measureIndex) => {
    for (const tempo of [...(measure.tempos ?? [])].sort((a, b) => tempoBeat(a) - tempoBeat(b))) {
      if (tempo.bpm === undefined) continue;
      const beatInMeasure = tempoBeat(tempo);
      const beat = measureStartBeats[measureIndex]! + beatInMeasure;
      tempoMap.push({
        measureIndex,
        beatInMeasure,
        timeSeconds: beat === 0 ? 0 : model.timeAtBeat(beat),
        bpm: model.bpmAtBeat(beat),
      });
    }
  });
  if (!tempoMap.some((entry) => entry.measureIndex === 0 && entry.beatInMeasure === 0)) {
    tempoMap.unshift({
      measureIndex: 0,
      beatInMeasure: 0,
      timeSeconds: 0,
      bpm: model.bpmAtBeat(0),
    });
  }

  return tempoMap;
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
  /** End of the final measure on the same beat axis, including inherited meters. */
  totalBeats: number;
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
  let regions: TempoRegion[] = [];
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
      const sorted = [...gm.tempos].sort((a, b) => tempoBeat(a) - tempoBeat(b));
      for (const tempo of sorted) {
        if (tempo.bpm === undefined) continue;
        const startBeat = cumBeats + tempoBeat(tempo);
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

  regions = compileTempoRamps(regions, gradualDecls, globalMeasures, measureStartBeats, cumBeats);

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
  return { model, measureStartTimes, measureStartBeats, totalBeats: cumBeats };
}

/** A rhythmic-position fraction (of a whole note) → quarter-note beats. */
function posBeats(frac: readonly [number, number]): number {
  if (!frac || frac[1] === 0) return 0;
  return (frac[0] / frac[1]) * 4;
}

/** Global-measure tempo's beat offset within its measure (0 if unlocated). */
function tempoBeat(tempo: NonNullable<GlobalMeasure["tempos"]>[number]): number {
  return tempo.location ? posBeats(tempo.location.fraction) : 0;
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
