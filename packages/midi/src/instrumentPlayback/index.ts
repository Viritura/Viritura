import {
  initialInstrumentState,
  listInstrumentChanges,
  type InstrumentDefinition,
  type Part,
  type Score,
} from "@viritura/core";
import type { MidiEvent, TimelineDiagnostic } from "../types";
import type { TempoModel } from "../tempoModel";

export interface PlaybackInstrument {
  /** The initial sound retains the authored sound-profile assignment. */
  key: string;
  part: Part;
}

function instrumentPart(part: Part, instrument: InstrumentDefinition | undefined): Part {
  if (!instrument) return part;
  return {
    ...part,
    name: instrument.name ?? part.name,
    _x: {
      ...part._x,
      viritura: {
        ...part._x?.viritura,
        instrumentId: instrument.instrumentId,
        midiProgram: instrument.midiProgram,
        initialInstrument: undefined,
        instruments: undefined,
      },
    },
  };
}

/** Resolve timbres, never transposing the score's already-sounding pitches. */
export function playbackInstruments(part: Part): PlaybackInstrument[] {
  const initial = initialInstrumentState(part);
  if (initial.instrumentKey !== undefined && !initial.instrument) {
    throw new Error(`Unknown initial instrument "${initial.instrumentKey}" in "${part.name}".`);
  }
  const result: PlaybackInstrument[] = [{ key: "initial", part: instrumentPart(part, initial.instrument) }];
  const seen = new Set<string>();
  for (const located of listInstrumentChanges(part)) {
    const [numerator, denominator] = located.position;
    if (denominator <= 0 || numerator < 0) throw new Error(`Invalid instrument-change position in "${part.name}".`);
    const key = located.change.instrument;
    if (key === undefined || seen.has(key)) continue;
    if (!located.state.instrument) throw new Error(`Unknown instrument "${key}" in "${part.name}".`);
    seen.add(key);
    result.push({ key: `instrument:${key}`, part: instrumentPart(part, located.state.instrument) });
  }
  return result;
}

/** Collision-free route for a timbre within an independently controlled lane. */
export function instrumentSamplerKey(lane: string | number, instrument: string): string {
  return JSON.stringify([lane, instrument]);
}

export function playbackInstrumentKeyAt(part: Part, measureIndex: number, beatOffset = 0): string {
  let key = "initial";
  for (const located of listInstrumentChanges(part)) {
    if (located.measureIndex > measureIndex) break;
    if (located.measureIndex === measureIndex && (located.position[0] / located.position[1]) * 4 > beatOffset) break;
    if (located.change.instrument !== undefined) key = `instrument:${located.change.instrument}`;
  }
  return key;
}

export interface InstrumentPlaybackTiming {
  model: TempoModel;
  measureStartBeats: readonly number[];
  measureOrder: readonly number[];
}

export type InstrumentPrograms = ReadonlyMap<number, ReadonlyMap<string, number>>;

interface InstrumentBoundary {
  beat: number;
  time: number;
  key: string;
  program: number | undefined;
}

function boundariesForPart(
  part: Part,
  timing: InstrumentPlaybackTiming,
  programs: ReadonlyMap<string, number> | undefined,
  initialProgram: number | undefined,
): InstrumentBoundary[] {
  const instruments = playbackInstruments(part);
  const definitions = new Map(instruments.map((instrument) => [instrument.key, instrument.part]));
  const changes = listInstrumentChanges(part).filter((located) => located.change.instrument !== undefined);
  const boundaries: InstrumentBoundary[] = [];
  const add = (beat: number, key: string) => {
    const program =
      programs?.get(key) ??
      (key === "initial" ? initialProgram : undefined) ??
      definitions.get(key)?._x?.viritura?.midiProgram;
    boundaries.push({
      beat,
      time: timing.model.timeAtBeat(beat),
      key,
      program:
        typeof program === "number" && Number.isInteger(program) && program >= 0 && program <= 127
          ? program
          : undefined,
    });
  };
  timing.measureOrder.forEach((measureIndex, expandedIndex) => {
    const start = timing.measureStartBeats[expandedIndex]!;
    // Resolve against written order, not the previously performed bar: repeats
    // and jumps restore the instrument that is active at their destination.
    add(start, playbackInstrumentKeyAt(part, measureIndex));
    for (const located of changes) {
      if (located.measureIndex !== measureIndex || located.position[0] === 0) continue;
      const [numerator, denominator] = located.position;
      if (denominator <= 0 || numerator < 0) throw new Error(`Invalid instrument-change position in "${part.name}".`);
      add(start + (numerator / denominator) * 4, `instrument:${located.change.instrument!}`);
    }
  });
  return boundaries;
}

/**
 * Stamp note destinations before audio look-ahead scheduling. Releases retain
 * their attack's destination even when a tie/legato tail crosses a change.
 * CC envelopes target the lane facade and reach every preloaded timbre.
 */
export function applyInstrumentPlayback(
  score: Score,
  events: MidiEvent[],
  timing: InstrumentPlaybackTiming,
  programs?: InstrumentPrograms,
  initialPrograms?: readonly number[],
): TimelineDiagnostic[] {
  const diagnostics: TimelineDiagnostic[] = [];
  score.parts.forEach((part, partIndex) => {
    const instruments = playbackInstruments(part);
    if (instruments.length === 1) return;
    const boundaries = boundariesForPart(part, timing, programs?.get(partIndex), initialPrograms?.[partIndex]);
    const partEvents = events.filter((event) => event.partIndex === partIndex);
    const lanes = new Set(partEvents.flatMap((event) => (event.playbackLaneId ? [event.playbackLaneId] : [])));
    if (lanes.size === 0) lanes.add(`part:${partIndex}`);
    const missingPrograms = [
      ...new Set(boundaries.filter((boundary) => boundary.program === undefined).map((boundary) => boundary.key)),
    ];
    if (missingPrograms.length > 0) {
      diagnostics.push({
        code: "instrument-program-unavailable",
        message: `Physical MIDI cannot select ${missingPrograms.join(", ")} in "${part.name}"; provide resolved instrumentPrograms or a MIDI program fallback.`,
        playbackLaneIds: [...lanes],
      });
    }
    // Legacy part-wide technique events must address every scoped lane, not a
    // phantom extra lane with no corresponding notes.
    for (const event of [...partEvents]) {
      if (event.playbackLaneId) continue;
      const [first, ...others] = lanes;
      event.playbackLaneId = first!;
      for (const lane of others) {
        const scoped = { ...event, playbackLaneId: lane };
        events.push(scoped);
        partEvents.push(scoped);
      }
    }
    const attackDelays = new Map<string, number>();
    const attackKey = (event: MidiEvent) =>
      JSON.stringify([event.playbackLaneId, event.channel, event.midiNote, event.scoreBeat, event.scoreEventId]);
    for (const event of partEvents) {
      if (event.type === "controlChange" && event.cc !== 74 && event.cc !== 71) continue;
      const beat = event.scoreBeat ?? timing.model.beatAtTime(event.time);
      let instrument = "initial";
      let instrumentStart = 0;
      for (const boundary of boundaries) {
        if (boundary.beat > beat + 1e-9) break;
        instrument = boundary.key;
        instrumentStart = boundary.time;
      }
      if (event.type === "noteOn") {
        // Humanization must not move an attack into the preceding timbre region.
        const delay = Math.max(0, instrumentStart - event.time);
        attackDelays.set(attackKey(event), delay);
        event.time = Math.max(event.time, instrumentStart);
      }
      event.playbackInstrumentKey = instrument;
    }
    for (const event of partEvents) {
      if (event.type === "noteOff") event.time += attackDelays.get(attackKey(event)) ?? 0;
    }
    for (const lane of lanes) {
      let previous: string | undefined;
      for (const boundary of boundaries) {
        if (boundary.key === previous) continue;
        previous = boundary.key;
        events.push({
          type: "programChange",
          time: boundary.time,
          scoreBeat: boundary.beat,
          midiNote: 0,
          velocity: 0,
          partIndex,
          playbackLaneId: lane,
          channel: partEvents.find((event) => event.playbackLaneId === lane)?.channel ?? 0,
          playbackInstrumentKey: boundary.key,
          instrumentChange: true,
          program: boundary.program,
        });
      }
    }
  });
  return diagnostics;
}
