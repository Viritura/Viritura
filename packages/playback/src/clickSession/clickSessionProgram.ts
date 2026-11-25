import type { ClickProgramEvent } from "@viritura/audio";
import { measureTempoInstructions, resolveMeter, type GlobalMeasure, type TimeSignature } from "@viritura/core";
import type { MidiTimeline, PlayedMeasureSpan } from "@viritura/midi";

/** Tempo and meter structure needed to compile a click session program. */
export interface ClickSessionSource extends Pick<
  MidiTimeline,
  "model" | "duration" | "measureStartBeats" | "measureTimeSignatures" | "playedSpans" | "expandedMeasureToOriginal"
> {
  /** Written tempo instructions, before repeat/jump expansion, for persisted subdivisions. */
  readonly globalMeasures?: readonly GlobalMeasure[];
}

/** Click resolution from a score measure onward (until the next rule). */
export interface ClickResolutionRule {
  /** 0-based score measure index where this resolution takes effect. */
  readonly fromMeasure: number;
  /** Clicks per metronome beat: 1 = beats only, 2 = halves, 3 = triplets, … */
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
  const tempoResolutions = compileTempoResolutions(source.globalMeasures ?? []);
  const startSpan = playedSpans?.[startIndex];
  const startResolution = measureResolution(tempoResolutions, resolutions, startMeasure);
  const startSubdivision = subdivisionAt(startResolution, startSpan?.startBeat ?? 0);

  const scale = 100 / tempoPercent;
  const startBeat = measureStartBeats[startIndex]!;
  const startTime = model.timeAtBeat(startBeat);
  const quarterSeconds = model.spbAtBeat(startBeat) * scale;
  const countoff =
    (options.countoff ?? true)
      ? countoffBar(measureTimeSignatures[startIndex]!, quarterSeconds, startSubdivision, countoffBars)
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
      changes: resolution.changes,
      timeAtBeat,
    });
  }

  return {
    duration: countoff.seconds + (source.duration - startTime) * scale,
    events,
    countoffClicks,
    countoffSeconds: countoff.seconds,
    startBpm: 60 / quarterSeconds,
    startTimelineMeasure: startIndex,
  };
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
  subdivision: number,
  bars: 1 | 2,
): { events: ClickProgramEvent[]; seconds: number; clicks: number } {
  const events: ClickProgramEvent[] = [];
  const barBeats = meter.count * (4 / meter.unit);
  for (let bar = 0; bar < bars; bar++) {
    pushMeasureClicks(events, {
      meter,
      measureBeat: bar * barBeats,
      span: undefined,
      subdivision,
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
  readonly changes?: readonly SubdivisionChange[];
  readonly timeAtBeat: (globalBeat: number) => number;
}

function pushMeasureClicks(events: ClickProgramEvent[], grid: MeasureClickGrid): void {
  const { measureBeat, meter, span, subdivision, changes = [], timeAtBeat } = grid;
  const { beatBoundaries } = resolveMeter(meter);
  for (let index = 0; index < beatBoundaries.length - 1; index++) {
    const beatStart = beatBoundaries[index]!;
    const beatQuarters = beatBoundaries[index + 1]! - beatStart;
    const beatEnd = beatStart + beatQuarters;
    const boundaries = [
      beatStart,
      ...new Set(
        changes.filter((change) => change.atBeat > beatStart && change.atBeat < beatEnd).map((change) => change.atBeat),
      ),
      beatEnd,
    ];
    for (let segment = 0; segment < boundaries.length - 1; segment++) {
      const segmentStart = boundaries[segment]!;
      const segmentEnd = boundaries[segment + 1]!;
      const active = subdivisionAt({ subdivision, changes }, segmentStart);
      for (let step = 0; step < active; step++) {
        const sourceBeat = segmentStart + (step * beatQuarters) / active;
        if (sourceBeat >= segmentEnd - 1e-9) break;
        if (span && (sourceBeat < span.startBeat || sourceBeat >= span.endBeat)) continue;
        events.push({
          time: timeAtBeat(measureBeat + sourceBeat - (span?.startBeat ?? 0)),
          level: sourceBeat > beatStart ? "subdivision" : index === 0 ? "accent" : "beat",
        });
      }
    }
  }
}

interface SubdivisionChange {
  readonly atBeat: number;
  readonly subdivision: number;
}

interface MeasureResolution {
  readonly subdivision: number;
  readonly changes: readonly SubdivisionChange[];
}

/**
 * Each tempo instruction sets the click subdivision until the next one;
 * omission means 1, so a subdivision never carries into the next tempo.
 */
function compileTempoResolutions(measures: readonly GlobalMeasure[]): MeasureResolution[] {
  let subdivision = 1;
  return measures.map((measure) => {
    const byPosition = new Map<number, { subdivision: number; explicit: boolean }>();
    for (const tempo of measureTempoInstructions(measure)) {
      const value = tempo.clickSubdivision;
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 5)) {
        throw new RangeError("Tempo click subdivision must be an integer from 1 to 5.");
      }
      const fraction = tempo.location?.fraction ?? [0, 1];
      const atBeat = (fraction[0]! / fraction[1]!) * 4;
      // Co-located instructions: the last explicit setting wins over defaults.
      if (value !== undefined) byPosition.set(atBeat, { subdivision: value, explicit: true });
      else if (!byPosition.get(atBeat)?.explicit) byPosition.set(atBeat, { subdivision: 1, explicit: false });
    }
    const changes = [...byPosition]
      .map(([atBeat, entry]) => ({ atBeat, subdivision: entry.subdivision }))
      .sort((a, b) => a.atBeat - b.atBeat);
    const result = { subdivision, changes };
    subdivision = subdivisionAt(result, Infinity);
    return result;
  });
}

function measureResolution(
  tempos: readonly MeasureResolution[],
  rules: readonly ClickResolutionRule[],
  measure: number,
): MeasureResolution {
  if (rules.some((rule) => rule.fromMeasure <= measure)) {
    return { subdivision: resolutionAt(rules, measure), changes: [] };
  }
  return tempos[measure] ?? { subdivision: 1, changes: [] };
}

function subdivisionAt(resolution: MeasureResolution, beat: number): number {
  let subdivision = resolution.subdivision;
  for (const change of resolution.changes) {
    if (change.atBeat > beat) break;
    subdivision = change.subdivision;
  }
  return subdivision;
}

function sortedResolutions(rules: readonly ClickResolutionRule[]): ClickResolutionRule[] {
  for (const rule of rules) {
    if (!Number.isInteger(rule.subdivision) || rule.subdivision < 1 || rule.subdivision > MAX_SUBDIVISION) {
      throw new RangeError(`Click subdivision must be an integer from 1 to ${MAX_SUBDIVISION}`);
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
