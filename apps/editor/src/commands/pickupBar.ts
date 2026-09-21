import type { Duration, GlobalMeasure, PartMeasure, Score, TimeSignature } from "@viritura/core";
import { generateId, measureBeats } from "@viritura/core";
import { decomposeDuration, generateEventId } from "./noteCommands";

export interface PickupDuration {
  numerator: number;
  denominator: number;
}

export type PickupBarResult = { score: Score; error: null } | { score: null; error: string };

export function parsePickupDuration(input: string): PickupDuration | null {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(input.trim());
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator < 1 || denominator < 1) {
    return null;
  }
  return { numerator, denominator };
}

export function createPickupBar(score: Score, duration: PickupDuration, openingTime?: TimeSignature): PickupBarResult {
  const first = score.global.measures[0];
  if (!first) return { score: null, error: "A pickup bar requires an opening measure." };
  if (first.number === 0) return { score: null, error: "This score already begins with a pickup bar." };

  const time = openingTime ?? first.time ?? { count: 4, unit: 4 };
  const pickupBeats = (duration.numerator * 4) / duration.denominator;
  const meterBeats = measureBeats(time);
  if (!Number.isFinite(pickupBeats) || pickupBeats <= 0 || pickupBeats >= meterBeats) {
    return {
      score: null,
      error: `Pickup duration must be greater than zero and shorter than ${time.count}/${time.unit}.`,
    };
  }

  const pickupGlobal = pickupGlobalMeasure(first, time);
  const shiftedFirst = shiftedFirstGlobalMeasure(first);
  return {
    error: null,
    score: {
      ...score,
      global: { ...score.global, measures: [pickupGlobal, shiftedFirst, ...score.global.measures.slice(1)] },
      parts: score.parts.map((part) => ({
        ...part,
        measures: [
          pickupPartMeasure(part.measures[0], pickupBeats),
          shiftedFirstPartMeasure(part.measures[0]),
          ...part.measures.slice(1),
        ],
      })),
    },
  };
}

function pickupGlobalMeasure(first: GlobalMeasure, time: TimeSignature): GlobalMeasure {
  const {
    id: _id,
    number: _number,
    barline: _barline,
    repeatStart: _repeatStart,
    repeatEnd: _repeatEnd,
    ending: _ending,
    ...openingContext
  } = first;
  return { ...openingContext, id: generateId(), number: 0, time };
}

function shiftedFirstGlobalMeasure(first: GlobalMeasure): GlobalMeasure {
  const {
    time: _time,
    key: _key,
    tempos: _tempos,
    segno: _segno,
    fine: _fine,
    jump: _jump,
    rehearsalMark: _rehearsalMark,
    coda: _coda,
    caesura: _caesura,
    gradualTempo: _gradualTempo,
    chordSymbols: _chordSymbols,
    ...remaining
  } = first;
  return { ...remaining, number: 1 };
}

function pickupPartMeasure(first: PartMeasure | undefined, pickupBeats: number): PartMeasure {
  const restDurations = decomposeDuration(pickupBeats);
  const {
    clefs,
    dynamics,
    ottavas,
    pedals,
    chordSymbols,
    expressions,
    staffConfigs,
    groupingDisplayOverrides,
    staffMeters,
  } = first ?? { sequences: [] };
  return {
    ...(clefs ? { clefs } : {}),
    ...(dynamics ? { dynamics } : {}),
    ...(ottavas ? { ottavas } : {}),
    ...(pedals ? { pedals } : {}),
    ...(chordSymbols ? { chordSymbols } : {}),
    ...(expressions ? { expressions } : {}),
    ...(staffConfigs ? { staffConfigs } : {}),
    ...(groupingDisplayOverrides ? { groupingDisplayOverrides } : {}),
    ...(staffMeters ? { staffMeters } : {}),
    sequences: [{ content: restDurations.map(createRest) }],
  };
}

function shiftedFirstPartMeasure(first: PartMeasure | undefined): PartMeasure {
  if (!first) return { sequences: [] };
  const {
    clefs: _clefs,
    dynamics: _dynamics,
    ottavas: _ottavas,
    pedals: _pedals,
    chordSymbols: _chordSymbols,
    expressions: _expressions,
    staffConfigs: _staffConfigs,
    groupingDisplayOverrides: _groupingDisplayOverrides,
    staffMeters: _staffMeters,
    ...remaining
  } = first;
  return remaining;
}

function createRest(duration: Duration) {
  return { type: "event" as const, id: generateEventId(), duration, rest: {} };
}
