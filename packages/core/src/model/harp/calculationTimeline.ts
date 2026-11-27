import { listInstrumentChanges } from "../instrumentChange";
import type { HarpPedalSetting, Score } from "../index";
import { harpPedalFractionFromNumber } from "./pedalAnalysis";
import { isHarpInstrumentAt } from "./pedalState";
import type { HarpSpellingChain } from "./tieChains";

export interface ManualAnchor {
  beat: number;
  measureIndex: number;
  setting: HarpPedalSetting;
}

export interface HarpSearchBoundary {
  beat: number;
  measureIndex: number;
  fraction: [number, number];
  harp: boolean;
  reset: boolean;
  anchor?: HarpPedalSetting;
  starts: HarpSpellingChain[];
  required: ReadonlySet<number>;
}

export function measurePositions(score: Score): { durations: number[]; offsets: number[] } {
  let time = { count: 4, unit: 4 };
  const durations: number[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const measure of score.global.measures) {
    if (measure.time) time = measure.time;
    offsets.push(offset);
    const duration = (time.count * 4) / time.unit;
    durations.push(duration);
    offset += duration;
  }
  return { durations, offsets };
}

export function canonicalBeat(beat: number): number {
  const [numerator, denominator] = harpPedalFractionFromNumber(beat);
  return numerator / denominator;
}

export function manualAnchors(
  part: Score["parts"][number],
  durations: readonly number[],
  offsets: readonly number[],
): ManualAnchor[] {
  return part.measures
    .flatMap((measure, measureIndex) =>
      (measure.harpPedals ?? [])
        .filter((setting) => setting.source !== "calculated")
        .map((setting) => ({
          beat: canonicalBeat(
            offsets[measureIndex]! +
              (setting.position.fraction[0] / setting.position.fraction[1]) * durations[measureIndex]!,
          ),
          measureIndex,
          setting,
        })),
    )
    .sort((left, right) => left.beat - right.beat);
}

function positionAtBeat(
  beat: number,
  durations: readonly number[],
  offsets: readonly number[],
): Pick<HarpSearchBoundary, "measureIndex" | "fraction"> {
  let measureIndex = offsets.length - 1;
  while (measureIndex > 0 && beat < offsets[measureIndex]!) measureIndex--;
  return {
    measureIndex,
    fraction: harpPedalFractionFromNumber((beat - offsets[measureIndex]!) / durations[measureIndex]!),
  };
}

export function harpSearchTimeline(
  score: Score,
  partIndex: number,
  chains: readonly HarpSpellingChain[],
): HarpSearchBoundary[] | string {
  const part = score.parts[partIndex]!;
  const { durations, offsets } = measurePositions(score);
  const positions = new Map<number, Pick<HarpSearchBoundary, "measureIndex" | "fraction">>();
  const anchors = new Map<number, HarpPedalSetting>();
  const addBeat = (beat: number, position?: Pick<HarpSearchBoundary, "measureIndex" | "fraction">) => {
    const value = canonicalBeat(beat);
    if (!positions.has(value)) positions.set(value, position ?? positionAtBeat(value, durations, offsets));
  };
  addBeat(0);
  for (const chain of chains) {
    for (const note of chain.notes) addBeat(note.beat, note);
    for (const interval of chain.intervals) {
      addBeat(interval.start);
      addBeat(interval.end);
    }
  }
  for (const anchor of manualAnchors(part, durations, offsets)) {
    if (!isHarpInstrumentAt(part, anchor.measureIndex, anchor.setting.position.fraction)) continue;
    if (anchors.has(anchor.beat)) return "Two manual harp pedal settings occupy the same score position.";
    addBeat(anchor.beat, { measureIndex: anchor.measureIndex, fraction: anchor.setting.position.fraction });
    anchors.set(anchor.beat, anchor.setting);
  }
  for (const change of listInstrumentChanges(part)) {
    addBeat(
      offsets[change.measureIndex]! + (change.position[0] / change.position[1]) * durations[change.measureIndex]!,
      { measureIndex: change.measureIndex, fraction: [...change.position] },
    );
  }
  let previouslyHarp = false;
  return [...positions.entries()]
    .sort(([left], [right]) => left - right)
    .map(([beat, position]) => {
      const harp = isHarpInstrumentAt(part, position.measureIndex, position.fraction);
      const boundary: HarpSearchBoundary = {
        beat,
        ...position,
        harp,
        reset: !harp || !previouslyHarp,
        anchor: anchors.get(beat),
        starts: chains.filter((chain) => canonicalBeat(chain.startBeat) === beat),
        required: new Set(
          chains
            .filter(
              (chain) =>
                chain.intervals.some(
                  (interval) => canonicalBeat(interval.start) <= beat && beat < canonicalBeat(interval.end),
                ) || chain.notes.some((note) => canonicalBeat(note.beat) === beat),
            )
            .map((chain) => chain.id),
        ),
      };
      previouslyHarp = harp;
      return boundary;
    });
}
