import { Metronome, type ClickProgramEvent } from "@viritura/audio";
import type { MidiTimeline, PlayedMeasureSpan } from "@viritura/midi";

/** Tempo and meter structure needed to compile a recording click program. */
export type RecordingClickSource = Pick<
  MidiTimeline,
  "model" | "measureStartBeats" | "measureTimeSignatures" | "playedSpans" | "expandedMeasureToOriginal"
>;

/** Click resolution from a score measure onward (until the next rule). */
export interface ClickResolutionRule {
  /** 0-based score measure index where this resolution takes effect. */
  readonly fromMeasure: number;
  /** Clicks per metronome beat: 1 = beats only, 2 = halves, 3 = triplets, … */
  readonly subdivision: number;
}

export interface RecordingClickOptions {
  /** 0-based score measure to start at (its first performance). Default 0. */
  readonly startMeasure?: number;
  /** Session tempo as a percentage of the written tempo. Default 100. */
  readonly tempoPercent?: number;
  /** Prepend one synthetic bar of clicks in the start bar's meter and tempo. Default true. */
  readonly countoff?: boolean;
  readonly resolutions?: readonly ClickResolutionRule[];
}

export interface RecordingClickProgram {
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
 * Compile a click-only recording program. The countoff is a fresh bar in the
 * start bar's meter and tempo (never a replay of the previous bar), and every
 * score click is timed through the continuous tempo model so ramps, sub-bar
 * tempo changes, and holds stay exact. The tempo percentage scales elapsed time
 * uniformly, preserving every relative tempo relationship in the score.
 */
export function buildRecordingClickProgram(
  source: RecordingClickSource,
  options: RecordingClickOptions = {},
): RecordingClickProgram {
  const { model, measureStartBeats, measureTimeSignatures, playedSpans, expandedMeasureToOriginal } = source;
  const tempoPercent = options.tempoPercent ?? 100;
  if (!Number.isFinite(tempoPercent) || tempoPercent <= 0) throw new RangeError("Tempo percentage must be positive");
  const startMeasure = options.startMeasure ?? 0;
  const startIndex = expandedMeasureToOriginal.indexOf(startMeasure);
  if (startIndex < 0) throw new RangeError(`Measure ${startMeasure + 1} is never performed`);
  const resolutions = sortedResolutions(options.resolutions ?? []);

  const scale = 100 / tempoPercent;
  const startBeat = measureStartBeats[startIndex]!;
  const startTime = model.timeAtBeat(startBeat);
  const quarterSeconds = model.spbAtBeat(startBeat) * scale;
  const countoff =
    (options.countoff ?? true)
      ? countoffBar(measureTimeSignatures[startIndex]!, quarterSeconds)
      : { events: [], seconds: 0 };
  const events: ClickProgramEvent[] = countoff.events;
  const countoffClicks = events.length;
  const timeAtBeat = (globalBeat: number) => countoff.seconds + (model.timeAtBeat(globalBeat) - startTime) * scale;

  for (let index = startIndex; index < measureStartBeats.length; index++) {
    const measureBeat = measureStartBeats[index];
    const meter = measureTimeSignatures[index];
    if (measureBeat === undefined || !meter) continue;
    const subdivision = resolutionAt(resolutions, expandedMeasureToOriginal[index] ?? 0);
    pushMeasureClicks(events, { measureBeat, meter, span: playedSpans?.[index], subdivision, timeAtBeat });
  }

  return {
    events,
    countoffClicks,
    countoffSeconds: countoff.seconds,
    startBpm: 60 / quarterSeconds,
    startTimelineMeasure: startIndex,
  };
}

interface Meter {
  readonly count: number;
  readonly unit: number;
}

/** One synthetic bar of beat clicks (accented downbeat) at a fixed quarter-note length. */
function countoffBar(meter: Meter, quarterSeconds: number): { events: ClickProgramEvent[]; seconds: number } {
  const events = Metronome.getBeatsForMeasure(meter.count, meter.unit).map((beat): ClickProgramEvent => ({
    time: beat.position * (4 / meter.unit) * quarterSeconds,
    level: beat.accented ? "accent" : "beat",
  }));
  return { events, seconds: meter.count * (4 / meter.unit) * quarterSeconds };
}

interface MeasureClickGrid {
  readonly measureBeat: number;
  readonly meter: Meter;
  readonly span: PlayedMeasureSpan | undefined;
  readonly subdivision: number;
  readonly timeAtBeat: (globalBeat: number) => number;
}

function pushMeasureClicks(events: ClickProgramEvent[], grid: MeasureClickGrid): void {
  const { measureBeat, meter, span, subdivision, timeAtBeat } = grid;
  const beatQuarters = (Metronome.isCompoundMeter(meter.count, meter.unit) ? 3 : 1) * (4 / meter.unit);
  for (const beat of Metronome.getBeatsForMeasure(meter.count, meter.unit)) {
    const beatStart = beat.position * (4 / meter.unit);
    for (let step = 0; step < subdivision; step++) {
      const sourceBeat = beatStart + (step * beatQuarters) / subdivision;
      if (span && (sourceBeat < span.startBeat || sourceBeat >= span.endBeat)) continue;
      events.push({
        time: timeAtBeat(measureBeat + sourceBeat - (span?.startBeat ?? 0)),
        level: step > 0 ? "subdivision" : beat.accented ? "accent" : "beat",
      });
    }
  }
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
