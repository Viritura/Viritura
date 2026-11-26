import { plainTextContent, type GlobalMeasure, type Score } from "@viritura/core";
import type { PlaybackTiming } from "@viritura/midi/timing";
import type { ClickSessionProgram } from "@viritura/playback/click";

/** One occurrence in the performed order, including repeats and jumps. */
export interface ClickBar {
  readonly measureIndex: number;
  readonly number: number;
  readonly rehearsal?: string;
  readonly rehearsalContext?: string;
  /** Visible tempo text such as "Allegro"; gradual-change wording is excluded. */
  readonly tempoName?: string;
  /** Whether the first named tempo begins after the bar's downbeat. */
  readonly tempoNameWithinBar?: boolean;
  readonly visit: number;
  readonly visitCount: number;
  readonly startable: boolean;
}

export interface ClickDialProps {
  readonly bars: readonly ClickBar[];
  readonly index: number;
  readonly enabled: boolean;
  readonly onSelect: (index: number) => void;
  readonly onSettlingChange: (settling: boolean) => void;
}

export interface ClickDialEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly detail?: string;
  /** Short marks (rehearsal letters, bar numbers) render large; free text renders compact. */
  readonly kind?: "mark" | "text";
  readonly startable: boolean;
}

const GRADUAL_TEMPO_TEXT = /^(?:(?:poco|molto|più|piu|sempre)\s+)*(?:rit|rall|accel|string|allarg|slentando)/i;

/** Named tempo changes navigate like rehearsal marks; bare metronome marks and gradual changes do not. */
function namedTempo(measure: GlobalMeasure): { name: string; withinBar: boolean } | undefined {
  const named = (measure.tempos ?? []).flatMap((tempo) => {
    if (!tempo.text || tempo.showText === false) return [];
    const name = plainTextContent(tempo.text).trim();
    if (!name || GRADUAL_TEMPO_TEXT.test(name)) return [];
    const [numerator = 0] = tempo.location?.fraction ?? [];
    return [{ name, withinBar: numerator > 0 }];
  });
  if (!named.length) return undefined;
  return { name: named.map((tempo) => tempo.name).join(" / "), withinBar: named[0]!.withinBar };
}

export function collectClickBars(score: Score, timing: PlaybackTiming): ClickBar[] {
  let latestMark: { text: string; index: number } | undefined;
  const authored = score.global.measures.map((measure, index) => {
    const rehearsal = measure.rehearsalMark ? plainTextContent(measure.rehearsalMark.text).trim() : "";
    if (rehearsal) latestMark = { text: rehearsal, index };
    const distance = latestMark ? index - latestMark.index : 0;
    const rehearsalContext = latestMark
      ? `${latestMark.text}${distance ? ` + ${distance} ${distance === 1 ? "bar" : "bars"}` : ""}`
      : undefined;
    const tempo = namedTempo(measure);
    return {
      number: measure.number ?? index + 1,
      rehearsal: rehearsal || undefined,
      rehearsalContext,
      tempoName: tempo?.name,
      tempoNameWithinBar: tempo?.withinBar || undefined,
    };
  });
  const counts = new Map<number, number>();
  const seen = new Map<number, number>();
  for (const index of timing.expandedMeasureToOriginal) counts.set(index, (counts.get(index) ?? 0) + 1);
  return timing.expandedMeasureToOriginal.map((measureIndex, index) => {
    const source = authored[measureIndex];
    if (!source) throw new RangeError(`Playback references missing measure ${measureIndex + 1}`);
    const visit = (seen.get(measureIndex) ?? 0) + 1;
    seen.set(measureIndex, visit);
    return {
      ...source,
      measureIndex,
      visit,
      visitCount: counts.get(measureIndex)!,
      startable: (timing.playedSpans?.[index]?.startBeat ?? 0) < 1e-9,
    };
  });
}

export function describeClickBar(bar: ClickBar): string {
  const visit = bar.visitCount > 1 ? `, visit ${bar.visit} of ${bar.visitCount}` : "";
  const partial = bar.startable ? "" : ", partial visit";
  return `Bar ${bar.number}${visit}${partial}`;
}

/** Rehearsal marks and named tempo changes share the upper track and the Previous/Next shortcuts. */
export function isClickLandmark(bar: ClickBar): boolean {
  return Boolean(bar.rehearsal || bar.tempoName);
}

function nearestStartable(
  bars: readonly ClickBar[],
  currentIndex: number,
  matches: (bar: ClickBar) => boolean,
): number | undefined {
  let nearest: number | undefined;
  for (const [index, bar] of bars.entries()) {
    if (!bar.startable || !matches(bar)) continue;
    if (nearest === undefined || Math.abs(index - currentIndex) < Math.abs(nearest - currentIndex)) nearest = index;
  }
  return nearest;
}

/** A score tap preserves repeat context and only selects full-bar visits. */
export function clickBarForMeasure(
  bars: readonly ClickBar[],
  measureIndex: number,
  currentIndex: number,
): number | undefined {
  return nearestStartable(bars, currentIndex, (bar) => bar.measureIndex === measureIndex);
}

/** Direct bar entry matches the printed bar number and, like a score tap, keeps the nearest repeat pass. */
export function clickBarForNumber(bars: readonly ClickBar[], number: number, currentIndex: number): number | undefined {
  return nearestStartable(bars, currentIndex, (bar) => bar.number === number);
}

/** The nearest startable landmark strictly before (-1) or after (1) the selected bar. */
export function adjacentClickLandmark(
  bars: readonly ClickBar[],
  currentIndex: number,
  direction: -1 | 1,
): number | undefined {
  for (let index = currentIndex + direction; index >= 0 && index < bars.length; index += direction) {
    const bar = bars[index]!;
    if (bar.startable && isClickLandmark(bar)) return index;
  }
  return undefined;
}

/** Map the UI clock to the performed visit without scheduling audio on the UI thread. */
export function clickBarAtTime(
  timing: PlaybackTiming,
  program: ClickSessionProgram,
  elapsed: number,
  tempoPercent: number,
): number {
  const start = program.startTimelineMeasure;
  if (elapsed < program.countoffSeconds) return start;
  const sourceTime = timing.measureStartTimes[start]! + ((elapsed - program.countoffSeconds) * tempoPercent) / 100;
  let low = start;
  let high = timing.measureStartTimes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timing.measureStartTimes[middle]! <= sourceTime) low = middle + 1;
    else high = middle;
  }
  return Math.max(start, low - 1);
}

export function clickStartPosition(timing: PlaybackTiming, index: number): { measureIndex: number; beat: number } {
  return {
    measureIndex: timing.expandedMeasureToOriginal[index]!,
    beat: timing.playedSpans?.[index]?.startBeat ?? 0,
  };
}

/** Project the audio clock onto written notation, including partial jump destinations. */
export function clickScorePosition(
  timing: PlaybackTiming,
  program: ClickSessionProgram,
  elapsed: number,
  tempoPercent: number,
): { measureIndex: number; beat: number } {
  if (elapsed < program.countoffSeconds) return clickStartPosition(timing, program.startTimelineMeasure);
  const index = clickBarAtTime(timing, program, elapsed, tempoPercent);
  const sourceTime =
    timing.measureStartTimes[program.startTimelineMeasure]! +
    (Math.max(0, elapsed - program.countoffSeconds) * tempoPercent) / 100;
  const span = timing.playedSpans?.[index];
  const beat = (span?.startBeat ?? 0) + timing.model.beatAtTime(sourceTime) - timing.measureStartBeats[index]!;
  return {
    measureIndex: timing.expandedMeasureToOriginal[index]!,
    beat: Math.max(span?.startBeat ?? 0, Math.min(span?.endBeat ?? Infinity, beat)),
  };
}
