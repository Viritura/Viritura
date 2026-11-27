import type { ClickProgramEvent } from "@viritura/audio";
import {
  clickSettingAt,
  compileClickSettings,
  measureTempoInstructions,
  resolveClickGrouping,
  resolveMeter,
  type ClickSetting,
  type MeasureClickSetting,
  type GlobalMeasure,
  type TimeSignature,
} from "@viritura/core";
import type { MidiTimeline, PlayedMeasureSpan } from "@viritura/midi";

/** Tempo and meter structure needed to compile a click session program. */
export interface ClickSessionSource extends Pick<
  MidiTimeline,
  | "model"
  | "duration"
  | "measureStartBeats"
  | "measureTimeSignatures"
  | "playedSpans"
  | "expandedMeasureToOriginal"
  | "fermataHolds"
> {
  /** Written tempo instructions, before repeat/jump expansion, for persisted subdivisions. */
  readonly globalMeasures?: readonly GlobalMeasure[];
}

/** Click resolution from a score measure onward (until the next rule). */
export interface ClickResolutionRule {
  /** 0-based score measure index where this resolution takes effect. */
  readonly fromMeasure: number;
  /** Clicks per metronome beat: 0 = silent, 1 = beats only, 2 = halves, 3 = triplets, … */
  readonly subdivision: number;
}

export interface ClickSessionOptions {
  /** 0-based score measure to start at (its first performance). Default 0. */
  readonly startMeasure?: number;
  /** 0-based performed measure occurrence, for explicitly selecting a repeat or jump visit. */
  readonly startTimelineMeasure?: number;
  /** Session tempo as a percentage of the written tempo. Default 100. */
  readonly tempoPercent?: number;
  /** Prepend synthetic clicks in the start bar's meter and tempo. Default true. */
  readonly countoff?: boolean;
  /** Number of countoff bars. Default 1. */
  readonly countoffBars?: 1 | 2;
  readonly resolutions?: readonly ClickResolutionRule[];
}

export interface ClickSessionProgram {
  readonly duration: number;
  /** Clicks in program seconds; program time 0 is the first countoff click. */
  readonly events: ClickProgramEvent[];
  /** Number of countoff clicks before the start bar ("4 clicks free"). */
  readonly countoffClicks: number;
  /** Program time at which the start bar's downbeat sounds. */
  readonly countoffSeconds: number;
  /** Effective quarter-note BPM at the start bar after the tempo percentage. */
  readonly startBpm: number;
  /** Index into the performed (repeat-expanded) measure order where the take begins. */
  readonly startTimelineMeasure: number;
}

const MAX_SUBDIVISION = 12;

/**
 * Compile a click-only session program. The countoff uses fresh bars in the
 * start bar's meter and tempo (never a replay of the previous bar), and every
 * score click is timed through the continuous tempo model so ramps, sub-bar
 * tempo changes, and holds stay exact. The tempo percentage scales elapsed time
 * uniformly, preserving every relative tempo relationship in the score.
 */
export function buildClickSessionProgram(
  source: ClickSessionSource,
  options: ClickSessionOptions = {},
): ClickSessionProgram {
  const { model, measureStartBeats, measureTimeSignatures, playedSpans, expandedMeasureToOriginal } = source;
  const tempoPercent = options.tempoPercent ?? 100;
  if (!Number.isFinite(tempoPercent) || tempoPercent <= 0) throw new RangeError("Tempo percentage must be positive");
  const countoffBars = options.countoffBars ?? 1;
  if (countoffBars !== 1 && countoffBars !== 2) throw new RangeError("Countoff must be 1 or 2 bars");
  const startIndex = resolveStartIndex(expandedMeasureToOriginal, options);
  const startMeasure = expandedMeasureToOriginal[startIndex]!;
  const resolutions = sortedResolutions(options.resolutions ?? []);
  const tempoResolutions = compileClickSettings(
    (source.globalMeasures ?? []).map((measure) => ({
      time: measure.time,
      instructions: measureTempoInstructions(measure),
    })),
  );
  const startSpan = playedSpans?.[startIndex];
  const startResolution = measureResolution(tempoResolutions, resolutions, startMeasure);
  const startSetting = clickSettingAt(startResolution, startSpan?.startBeat ?? 0);

  const scale = 100 / tempoPercent;
  const startBeat = measureStartBeats[startIndex]!;
  const startTime = model.timeAtBeat(startBeat);
  const quarterSeconds = model.spbAtBeat(startBeat) * scale;
  const countoff =
    (options.countoff ?? true)
      ? countoffBar(measureTimeSignatures[startIndex]!, quarterSeconds, startSetting, countoffBars)
      : { events: [], seconds: 0, clicks: 0 };
  const events: ClickProgramEvent[] = countoff.events;
  const countoffClicks = countoff.clicks;
  const timeAtBeat = (globalBeat: number) => countoff.seconds + (model.timeAtBeat(globalBeat) - startTime) * scale;

  for (let index = startIndex; index < measureStartBeats.length; index++) {
    const measureBeat = measureStartBeats[index];
    const meter = measureTimeSignatures[index];
    if (measureBeat === undefined || !meter) continue;
    const resolution = measureResolution(tempoResolutions, resolutions, expandedMeasureToOriginal[index] ?? 0);
    pushMeasureClicks(events, {
      measureBeat,
      meter,
      span: playedSpans?.[index],
      subdivision: resolution.subdivision,
      grouping: resolution.grouping,
      changes: resolution.changes,
      timeAtBeat,
    });
  }
  pushFermataClicks(events, {
    source,
    startBeat,
    startTime,
    scale,
    countoffSeconds: countoff.seconds,
    resolutions,
    tempoResolutions,
  });
  events.sort((a, b) => a.time - b.time);

  return {
    duration: countoff.seconds + (source.duration - startTime) * scale,
    events,
    countoffClicks,
    countoffSeconds: countoff.seconds,
    startBpm: 60 / quarterSeconds,
    startTimelineMeasure: startIndex,
  };
}

interface FermataClickContext {
  readonly source: ClickSessionSource;
  readonly startBeat: number;
  readonly startTime: number;
  readonly scale: number;
  readonly countoffSeconds: number;
  readonly resolutions: readonly ClickResolutionRule[];
  readonly tempoResolutions: readonly MeasureClickSetting[];
}

function pushFermataClicks(events: ClickProgramEvent[], context: FermataClickContext): void {
  const { source, startBeat, startTime, scale, countoffSeconds, resolutions, tempoResolutions } = context;
  const { model, measureStartBeats, measureTimeSignatures, playedSpans, expandedMeasureToOriginal } = source;
  const holdOffsets = new Map<number, number>();
  for (const hold of source.fermataHolds ?? []) {
    if (hold.beat <= startBeat) continue;
    const offset = holdOffsets.get(hold.beat) ?? 0;
    const seconds = hold.extraBeats * model.spbAtBeat(hold.beat);
    holdOffsets.set(hold.beat, offset + seconds);
    if (hold.clickBehavior !== "keepClicking") continue;
    const index = measureStartBeats.findLastIndex((beat) => beat < hold.beat - 1e-9);
    const meter = measureTimeSignatures[index];
    if (!meter) throw new Error("Fermata click hold has no active meter.");
    const tempoIndex = measureStartBeats.findLastIndex((beat) => beat <= hold.beat + 1e-9);
    const tempoBeat = hold.beat - measureStartBeats[tempoIndex]! + (playedSpans?.[tempoIndex]?.startBeat ?? 0);
    const resolution = measureResolution(tempoResolutions, resolutions, expandedMeasureToOriginal[tempoIndex]!);
    const setting = clickSettingAt(resolution, tempoBeat);
    if (setting.subdivision === 0) continue;
    const localBeat = hold.beat - measureStartBeats[index]! + (playedSpans?.[index]?.startBeat ?? 0);
    const pulses = holdPulses(
      setting,
      setting.grouping ? measureTimeSignatures[tempoIndex]! : meter,
      setting.grouping ? tempoBeat : localBeat,
    );
    const gapStart = model.timeAtBeat(hold.beat, "release") + offset;
    const gapEnd = gapStart + seconds;
    let time = gapStart;
    for (let step = 0; time < gapEnd - 1e-9; step++) {
      const pulse = pulses[step % pulses.length]!;
      events.push({
        time: countoffSeconds + (time - startTime) * scale,
        level: pulse.level,
      });
      time += pulse.quarters * model.spbAtBeat(hold.beat);
    }
  }
}

function holdPulses(
  setting: ClickSetting,
  meter: TimeSignature,
  atBeat: number,
): { quarters: number; level: ClickProgramEvent["level"] }[] {
  const meterBoundaries = resolveMeter(meter).beatBoundaries;
  const boundaries = setting.grouping
    ? resolveClickGrouping(meter, setting.subdivision, setting.grouping)
    : meterBoundaries;
  const index = Math.max(
    0,
    Math.min(
      boundaries.length - 2,
      boundaries.findLastIndex((beat) => beat < atBeat - 1e-9),
    ),
  );
  if (!setting.grouping) {
    const quarters = (boundaries[index + 1]! - boundaries[index]!) / setting.subdivision;
    return Array.from({ length: setting.subdivision }, (_, step) => ({
      quarters,
      level: step === 0 ? "beat" : "subdivision",
    }));
  }
  return setting.grouping.map((_, step) => {
    const pulse = (index + step) % setting.grouping!.length;
    return {
      quarters: boundaries[pulse + 1]! - boundaries[pulse]!,
      level: meterBoundaries.some((beat) => Math.abs(beat - boundaries[pulse]!) < 1e-9) ? "beat" : "subdivision",
    };
  });
}

function resolveStartIndex(measureOrder: readonly number[], options: ClickSessionOptions): number {
  if (options.startTimelineMeasure !== undefined) {
    if (options.startMeasure !== undefined) throw new RangeError("Choose either a score measure or a performed visit");
    const index = options.startTimelineMeasure;
    if (!Number.isInteger(index) || index < 0 || index >= measureOrder.length) {
      throw new RangeError("Performed measure visit is out of range");
    }
    return index;
  }
  const measure = options.startMeasure ?? 0;
  const index = measureOrder.indexOf(measure);
  if (index < 0) throw new RangeError(`Measure ${measure + 1} is never performed`);
  return index;
}

/** Synthetic bars of beat clicks with an accented downbeat in each bar. */
function countoffBar(
  meter: TimeSignature,
  quarterSeconds: number,
  setting: ClickSetting,
  bars: 1 | 2,
): { events: ClickProgramEvent[]; seconds: number; clicks: number } {
  const events: ClickProgramEvent[] = [];
  if (setting.subdivision === 0) return { events, seconds: 0, clicks: 0 };
  const barBeats = meter.count * (4 / meter.unit);
  for (let bar = 0; bar < bars; bar++) {
    pushMeasureClicks(events, {
      meter,
      measureBeat: bar * barBeats,
      span: undefined,
      ...setting,
      timeAtBeat: (beat) => beat * quarterSeconds,
    });
  }
  return {
    events,
    seconds: bars * barBeats * quarterSeconds,
    clicks: events.length,
  };
}

interface MeasureClickGrid {
  readonly measureBeat: number;
  readonly meter: TimeSignature;
  readonly span: PlayedMeasureSpan | undefined;
  readonly subdivision: number;
  readonly grouping?: readonly number[];
  readonly changes?: MeasureClickSetting["changes"];
  readonly timeAtBeat: (globalBeat: number) => number;
}

function pushMeasureClicks(events: ClickProgramEvent[], grid: MeasureClickGrid): void {
  const { meter, subdivision, grouping, changes = [] } = grid;
  const { beatBoundaries } = resolveMeter(meter);
  const barEnd = beatBoundaries[beatBoundaries.length - 1]!;
  const boundaries = [
    0,
    ...changes.filter((change) => change.atBeat > 0 && change.atBeat < barEnd).map((change) => change.atBeat),
    barEnd,
  ];
  for (let segment = 0; segment < boundaries.length - 1; segment++) {
    const segmentStart = boundaries[segment]!;
    const segmentEnd = boundaries[segment + 1]!;
    const active = clickSettingAt({ subdivision, grouping, changes }, segmentStart);
    if (active.subdivision === 0) continue;
    if (active.grouping) {
      const pulses = resolveClickGrouping(meter, active.subdivision, active.grouping);
      for (const sourceBeat of pulses.slice(0, -1)) {
        if (sourceBeat < segmentStart - 1e-9 || sourceBeat >= segmentEnd - 1e-9) continue;
        const level =
          sourceBeat === 0
            ? "accent"
            : beatBoundaries.some((beat) => Math.abs(beat - sourceBeat) < 1e-9)
              ? "beat"
              : "subdivision";
        pushClickAt(events, grid, sourceBeat, level);
      }
      continue;
    }
    for (let index = 0; index < beatBoundaries.length - 1; index++) {
      const beatStart = beatBoundaries[index]!;
      const beatEnd = beatBoundaries[index + 1]!;
      const start = Math.max(beatStart, segmentStart);
      const end = Math.min(beatEnd, segmentEnd);
      for (let step = 0; step < active.subdivision; step++) {
        const sourceBeat = start + (step * (beatEnd - beatStart)) / active.subdivision;
        if (sourceBeat >= end - 1e-9) break;
        pushClickAt(events, grid, sourceBeat, sourceBeat > beatStart ? "subdivision" : index === 0 ? "accent" : "beat");
      }
    }
  }
}

function pushClickAt(
  events: ClickProgramEvent[],
  grid: MeasureClickGrid,
  sourceBeat: number,
  level: ClickProgramEvent["level"],
): void {
  const { span } = grid;
  if (span && (sourceBeat < span.startBeat || sourceBeat >= span.endBeat)) return;
  events.push({
    time: grid.timeAtBeat(grid.measureBeat + sourceBeat - (span?.startBeat ?? 0)),
    level,
  });
}

function measureResolution(
  tempos: readonly MeasureClickSetting[],
  rules: readonly ClickResolutionRule[],
  measure: number,
): MeasureClickSetting {
  if (rules.some((rule) => rule.fromMeasure <= measure)) {
    return { subdivision: resolutionAt(rules, measure), changes: [] };
  }
  return tempos[measure] ?? { subdivision: 1, changes: [] };
}

function sortedResolutions(rules: readonly ClickResolutionRule[]): ClickResolutionRule[] {
  for (const rule of rules) {
    if (!Number.isInteger(rule.subdivision) || rule.subdivision < 0 || rule.subdivision > MAX_SUBDIVISION) {
      throw new RangeError(`Click subdivision must be an integer from 0 to ${MAX_SUBDIVISION}`);
    }
  }
  return [...rules].sort((a, b) => a.fromMeasure - b.fromMeasure);
}

function resolutionAt(rules: readonly ClickResolutionRule[], measure: number): number {
  let subdivision = 1;
  for (const rule of rules) {
    if (rule.fromMeasure > measure) break;
    subdivision = rule.subdivision;
  }
  return subdivision;
}
