import { initialInstrumentState, listInstrumentChanges, type ActiveInstrumentState } from "../instrumentChange";
import type { Part } from "../part";
import type { HarpPedalSetting } from "./index";

type Fraction = readonly [number, number];

function comparePositions(a: Fraction, b: Fraction): number {
  const difference = BigInt(a[0]) * BigInt(b[1]) - BigInt(b[0]) * BigInt(a[1]);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function isHarp(part: Part, state: ActiveInstrumentState): boolean {
  const instrumentId =
    state.instrumentKey === undefined ? part._x?.viritura?.instrumentId : state.instrument?.instrumentId;
  return instrumentId === "pluck.harp";
}

interface HarpSegment {
  startMeasure: number;
  startPosition: Fraction;
}

function harpSegmentAt(part: Part, measureIndex: number, position: Fraction): HarpSegment | undefined {
  if (!Number.isInteger(measureIndex) || !part.measures[measureIndex] || position[1] <= 0) return undefined;
  let active = isHarp(part, initialInstrumentState(part));
  let segment: HarpSegment | undefined = active ? { startMeasure: 0, startPosition: [0, 1] } : undefined;
  for (const change of listInstrumentChanges(part)) {
    if (
      change.measureIndex > measureIndex ||
      (change.measureIndex === measureIndex && comparePositions(change.position, position) > 0)
    )
      break;
    const next = isHarp(part, change.state);
    if (next && !active) segment = { startMeasure: change.measureIndex, startPosition: change.position };
    if (!next) segment = undefined;
    active = next;
  }
  return segment;
}

/** Whether the active semantic instrument is a concert pedal harp. */
export function isHarpInstrumentAt(part: Part, measureIndex: number, position: Fraction = [0, 1]): boolean {
  return harpSegmentAt(part, measureIndex, position) !== undefined;
}

/** The latest full snapshot in the current harp segment, or undefined when its state is unknown. */
export function resolveHarpPedalState(
  part: Part,
  measureIndex: number,
  position: Fraction = [0, 1],
): HarpPedalSetting | undefined {
  const segment = harpSegmentAt(part, measureIndex, position);
  if (!segment) return undefined;
  let latest: HarpPedalSetting | undefined;
  let latestMeasure = -1;
  for (let index = segment.startMeasure; index <= measureIndex; index++) {
    for (const setting of part.measures[index]?.harpPedals ?? []) {
      const fraction = setting.position.fraction;
      if (index === segment.startMeasure && comparePositions(fraction, segment.startPosition) < 0) continue;
      if (index === measureIndex && comparePositions(fraction, position) > 0) continue;
      if (
        index > latestMeasure ||
        (index === latestMeasure && latest && comparePositions(fraction, latest.position.fraction) > 0)
      ) {
        latest = setting;
        latestMeasure = index;
      }
    }
  }
  return latest;
}
