import { CHORDS_PART_ID, voiceChordSymbol, type Score } from "@viritura/core";
import type { TempoBuild } from "../tempoMap";
import type { MidiEvent } from "../types";

/** Runtime routing metadata only; never insert this lane into score.parts. */
export interface ChordPlaybackPart {
  id: typeof CHORDS_PART_ID;
  partIndex: number;
  name: "Chords";
}

/** Unsupported symbols and NC still require a visible, independently routed lane. */
export function getChordPlaybackPart(score: Score): ChordPlaybackPart | undefined {
  return score.global.measures.some((measure) => (measure.chordSymbols?.length ?? 0) > 0)
    ? { id: CHORDS_PART_ID, partIndex: score.parts.length, name: "Chords" }
    : undefined;
}

interface ChordChange {
  beat: number;
  pitches: readonly number[];
}

interface ChordMeasure {
  carry: readonly number[];
  changes: readonly ChordChange[];
}

export interface ChordPlaybackProgram {
  part: ChordPlaybackPart;
  measures: readonly ChordMeasure[];
}

export interface ChordPlaybackNote {
  id: string;
  pitch: number;
  startTime: number;
  duration: number;
}

/** Resolve harmony in written order, before repeats can change the carried state. */
export function compileChordPlayback(score: Score, includeGlobalChords = true): ChordPlaybackProgram | undefined {
  if (!includeGlobalChords) return undefined;
  const part = getChordPlaybackPart(score);
  if (!part) return undefined;
  let carry: readonly number[] = [];
  const measures = score.global.measures.map((measure): ChordMeasure => {
    const changes = (measure.chordSymbols ?? [])
      .map((chord): ChordChange => {
        const voicing = voiceChordSymbol(chord);
        return {
          beat: (chord.position.fraction[0] / chord.position.fraction[1]) * 4,
          pitches: [...voicing.leftHand, ...voicing.rightHand],
        };
      })
      .sort((a, b) => a.beat - b.beat);
    const result = { carry, changes };
    if (changes.length > 0) carry = changes[changes.length - 1]!.pitches;
    return result;
  });
  return { part, measures };
}

/** Continuous measures sustain; jumps release and restore the destination's written harmony. */
export function realizeChordPlayback(
  program: ChordPlaybackProgram,
  measureOrder: readonly number[],
  timing: TempoBuild,
): ChordPlaybackNote[] {
  const notes: ChordPlaybackNote[] = [];
  let pitches: readonly number[] = [];
  let startBeat = 0;
  let occurrence = 0;
  const finish = (endBeat: number): void => {
    if (endBeat <= startBeat) return;
    const startTime = timing.model.timeAtBeat(startBeat);
    const duration = timing.model.timeAtBeat(endBeat) - startTime;
    for (const pitch of pitches) {
      notes.push({ id: `${CHORDS_PART_ID}:${occurrence}:${pitch}`, pitch, startTime, duration });
    }
    occurrence++;
  };
  for (let expandedIndex = 0; expandedIndex < measureOrder.length; expandedIndex++) {
    const originalIndex = measureOrder[expandedIndex]!;
    const measure = program.measures[originalIndex]!;
    const measureStart = timing.measureStartBeats[expandedIndex]!;
    if (expandedIndex === 0 || originalIndex !== measureOrder[expandedIndex - 1]! + 1) {
      finish(measureStart);
      pitches = measure.carry;
      startBeat = measureStart;
    }
    for (const change of measure.changes) {
      const beat = measureStart + change.beat;
      finish(beat);
      pitches = change.pitches;
      startBeat = beat;
    }
  }
  finish(timing.totalBeats);
  return notes;
}

export function chordMidiEvents(
  program: ChordPlaybackProgram,
  measureOrder: readonly number[],
  timing: TempoBuild,
): MidiEvent[] {
  return realizeChordPlayback(program, measureOrder, timing).flatMap((note): MidiEvent[] => {
    const routing = {
      partIndex: program.part.partIndex,
      playbackLaneId: program.part.id,
      channel: 0,
      midiNote: note.pitch,
    };
    return [
      { ...routing, type: "noteOn", time: note.startTime, velocity: 80 },
      { ...routing, type: "noteOff", time: note.startTime + note.duration, velocity: 0 },
    ];
  });
}
