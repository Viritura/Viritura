import type { GlobalMeasure, RhythmicPosition } from "@viritura/core";

export interface PlayedMeasureSpan {
  measureIndex: number;
  startBeat: number;
  endBeat: number;
  measureBeats: number;
}

export function beatInPlayedSpan(beat: number, span: PlayedMeasureSpan | undefined): boolean {
  return (
    span === undefined ||
    (beat >= span.startBeat - 1e-9 &&
      (beat < span.endBeat - 1e-9 || (span.endBeat === span.measureBeats && Math.abs(beat - span.endBeat) < 1e-9)))
  );
}

export function playedSpansContinue(span: PlayedMeasureSpan, next: PlayedMeasureSpan | undefined): boolean {
  return (
    next !== undefined &&
    span.endBeat === span.measureBeats &&
    next.startBeat === 0 &&
    next.measureIndex === span.measureIndex + 1
  );
}

export class NavigationError extends Error {
  constructor(
    message: string,
    readonly pointers: readonly string[],
  ) {
    super(`${message} (${pointers.join(", ")})`);
    this.name = "NavigationError";
  }
}

const EPS = 1e-9;
const MAX_SPANS = 100_000;

interface Destination {
  measureIndex: number;
  beat: number;
}

function locationBeat(position: RhythmicPosition, length: number, pointer: string): number {
  const [numerator, denominator] = position.fraction;
  const beat = (numerator * 4) / denominator;
  if (!Number.isFinite(beat) || denominator <= 0 || beat < 0 || beat > length + EPS) {
    throw new NavigationError("Navigation location is outside its measure", [pointer]);
  }
  return Math.min(beat, length);
}

function resolveDestinations(measures: readonly GlobalMeasure[], measureLengths: readonly number[]) {
  const destinations = (kind: "segno" | "coda" | "fine"): Destination[] =>
    measures.flatMap((measure, measureIndex) => {
      const marker = measure[kind];
      return marker
        ? [
            {
              measureIndex,
              beat: locationBeat(
                marker.location,
                measureLengths[measureIndex]!,
                `/global/measures/${measureIndex}/${kind}/location`,
              ),
            },
          ]
        : [];
    });
  const markers = { segno: destinations("segno"), coda: destinations("coda"), fine: destinations("fine") };
  const required = (kind: keyof typeof markers, source: number): Destination => {
    const found = markers[kind];
    if (found.length !== 1) {
      throw new NavigationError(`Navigation requires exactly one ${kind} destination`, [
        `/global/measures/${source}/jump`,
        ...found.map(({ measureIndex }) => `/global/measures/${measureIndex}/${kind}`),
      ]);
    }
    return found[0]!;
  };
  for (let index = 0; index < measures.length; index++) {
    const jump = measures[index]?.jump;
    if (!jump) continue;
    const type: string = jump.type;
    locationBeat(jump.location, measureLengths[index]!, `/global/measures/${index}/jump/location`);
    if (["segno", "dsAlFine", "dsAlCoda"].includes(type)) required("segno", index);
    if (["dcAlFine", "dsAlFine"].includes(type)) required("fine", index);
    if (["dcAlCoda", "dsAlCoda", "toCoda"].includes(type)) required("coda", index);
    if (
      ["dcAlCoda", "dsAlCoda"].includes(type) &&
      !measures.some((measure) => String(measure.jump?.type) === "toCoda")
    ) {
      throw new NavigationError("Al Coda requires an explicit To Coda instruction", [`/global/measures/${index}/jump`]);
    }
    if (!["dc", "dcAlCoda", "dcAlFine", "segno", "dsAlFine", "dsAlCoda", "toCoda"].includes(type)) {
      throw new NavigationError(`Unsupported jump type: ${type}`, [`/global/measures/${index}/jump/type`]);
    }
  }
  return { markers, required };
}

interface ReplayState {
  fineArmed: boolean;
  codaArmed: boolean;
  replay: boolean;
  orderIndex: number;
}

function nextInstruction(
  measure: GlobalMeasure,
  cursor: Destination,
  length: number,
  state: ReplayState,
  fine: Destination | undefined,
  taken: ReadonlySet<number>,
  initialOrder: readonly number[],
) {
  const index = cursor.measureIndex;
  const jump = measure.jump;
  const type = jump ? String(jump.type) : "";
  const jumpBeat = jump ? locationBeat(jump.location, length, `/global/measures/${index}/jump/location`) : Infinity;
  const fineBeat = state.fineArmed && fine?.measureIndex === index ? fine.beat : Infinity;
  const jumpActive =
    jump !== undefined &&
    !taken.has(index) &&
    jumpBeat >= cursor.beat - EPS &&
    (type !== "toCoda" || state.codaArmed) &&
    (state.replay || initialOrder.lastIndexOf(index) === state.orderIndex);
  const stop = fineBeat >= cursor.beat - EPS ? Math.min(length, fineBeat) : length;
  const endBeat = jumpActive ? Math.min(stop, jumpBeat) : stop;
  return {
    type,
    jumpActive,
    jumpBeat,
    fineReached: fineBeat >= cursor.beat - EPS && fineBeat <= endBeat + EPS,
    endBeat,
  };
}

export function compileNavigation(
  measures: readonly GlobalMeasure[],
  initialOrder: readonly number[],
  measureLengths: readonly number[],
): PlayedMeasureSpan[] {
  const { markers, required } = resolveDestinations(measures, measureLengths);
  const result: PlayedMeasureSpan[] = [];
  const taken = new Set<number>();
  const state: ReplayState = { fineArmed: false, codaArmed: false, replay: false, orderIndex: 0 };
  let cursor: Destination = { measureIndex: initialOrder[0] ?? 0, beat: 0 };
  let transitions = 0;
  while (cursor.measureIndex < measures.length && (state.replay || state.orderIndex < initialOrder.length)) {
    if (++transitions > MAX_SPANS) {
      throw new NavigationError("Navigation exceeds the safe playback traversal limit", ["/global/measures"]);
    }
    const index = cursor.measureIndex;
    const measure = measures[index]!;
    const length = measureLengths[index]!;
    const { type, jumpActive, jumpBeat, fineReached, endBeat } = nextInstruction(
      measure,
      cursor,
      length,
      state,
      markers.fine[0],
      taken,
      initialOrder,
    );
    if (endBeat > cursor.beat + EPS) {
      result.push({ measureIndex: index, startBeat: cursor.beat, endBeat, measureBeats: length });
    }
    if (state.fineArmed && fineReached) {
      state.fineArmed = false;
      break;
    }
    if (jumpActive && jumpBeat <= endBeat + EPS) {
      taken.add(index);
      state.replay = true;
      if (type === "toCoda") {
        state.codaArmed = false;
        cursor = required("coda", index);
      } else {
        state.fineArmed = type === "dcAlFine" || type === "dsAlFine";
        state.codaArmed = type === "dcAlCoda" || type === "dsAlCoda";
        cursor = ["segno", "dsAlFine", "dsAlCoda"].includes(type)
          ? required("segno", index)
          : { measureIndex: 0, beat: 0 };
      }
      continue;
    }
    state.orderIndex++;
    cursor = { measureIndex: state.replay ? index + 1 : (initialOrder[state.orderIndex] ?? measures.length), beat: 0 };
  }
  if (state.fineArmed || state.codaArmed) {
    throw new NavigationError("The armed Fine or To Coda instruction is not reachable on replay", ["/global/measures"]);
  }
  return result;
}
