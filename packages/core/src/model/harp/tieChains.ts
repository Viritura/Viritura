import type { Note, Score } from "../index";
import { walkSequenceEvents } from "../sequenceWalk";
import type { HarpPedalSpellingEdit } from "./calculator";
import { harpPedalSpellingMidi, harpPitchSpellings, type HarpPedalNote } from "./pedalAnalysis";
import { isHarpInstrumentAt } from "./pedalState";

export interface HarpSpellingChoice {
  pitch: HarpPedalNote["pitch"];
  edits: HarpPedalSpellingEdit[];
  editKeys: string[];
}

export interface HarpSpellingChain {
  id: number;
  notes: HarpPedalNote[];
  choices: HarpSpellingChoice[];
  intervals: { start: number; end: number }[];
  startBeat: number;
  lastAttackBeat: number;
  endBeat: number;
}

interface TieEdge {
  source: number;
  target: number;
  crossJump: boolean;
}

interface ChainMusic {
  chains: HarpSpellingChain[];
  baselineNotes: HarpPedalNote[];
}

export type HarpTieResult = { music: ChainMusic; error?: never } | { music?: never; error: string };

function noteKey(note: Pick<HarpPedalNote, "eventId" | "noteIndex">): string {
  return `${note.eventId}:${note.noteIndex}`;
}

function samePitch(left: HarpPedalNote["pitch"], right: HarpPedalNote["pitch"]): boolean {
  return left.step === right.step && left.alter === right.alter && left.octave === right.octave;
}

function authoredNotes(score: Score, partIndex: number): Map<string, Note> {
  const result = new Map<string, Note>();
  for (const measure of score.parts[partIndex]!.measures) {
    for (const sequence of measure.sequences) {
      for (const { event } of walkSequenceEvents(sequence.content)) {
        event.notes?.forEach((note, noteIndex) => {
          result.set(noteKey({ eventId: event.id!, noteIndex }), note);
        });
      }
    }
  }
  return result;
}

function tieEdges(notes: readonly HarpPedalNote[], authored: ReadonlyMap<string, Note>): TieEdge[] | string {
  const byId = new Map<string, number>();
  for (const [index, note] of notes.entries()) {
    const id = authored.get(noteKey(note))?.id;
    if (!id) continue;
    if (byId.has(id)) return `Duplicate note ID "${id}" prevents harp tie calculation.`;
    byId.set(id, index);
  }
  const edges: TieEdge[] = [];
  for (const [source, note] of notes.entries()) {
    for (const tie of authored.get(noteKey(note))?.ties ?? []) {
      if (tie.lv) continue;
      const target = tie.target === undefined ? undefined : byId.get(tie.target);
      if (target === undefined) return `The tie from "${note.eventId}" has no valid target note.`;
      const targetNote = notes[target]!;
      if (harpPedalSpellingMidi(note.pitch) !== harpPedalSpellingMidi(targetNote.pitch)) {
        return `The tie from "${note.eventId}" connects different sounding pitches.`;
      }
      if (source === target || (tie.targetType !== "crossJump" && targetNote.beat < note.beat)) {
        return `The tie from "${note.eventId}" does not have a forward target.`;
      }
      edges.push({ source, target, crossJump: tie.targetType === "crossJump" });
    }
  }
  return edges;
}

function connectedNotes(count: number, edges: readonly TieEdge[]): number[][] {
  const parent = Array.from({ length: count }, (_, index) => index);
  function root(index: number): number {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  }
  for (const edge of edges) parent[root(edge.target)] = root(edge.source);
  const groups = new Map<number, number[]>();
  for (let index = 0; index < count; index++) {
    const key = root(index);
    const members = groups.get(key) ?? [];
    members.push(index);
    groups.set(key, members);
  }
  return [...groups.values()].sort((left, right) => left[0]! - right[0]!);
}

function soundingIntervals(
  members: readonly number[],
  notes: readonly HarpPedalNote[],
  edges: readonly TieEdge[],
): HarpSpellingChain["intervals"] {
  const memberSet = new Set(members);
  const intervals = members.map((index) => {
    const note = notes[index]!;
    return { start: note.beat, end: note.beat + note.durationBeats };
  });
  for (const edge of edges) {
    if (edge.crossJump || !memberSet.has(edge.source)) continue;
    const source = notes[edge.source]!;
    const target = notes[edge.target]!;
    intervals.push({ start: source.beat, end: target.beat + target.durationBeats });
  }
  intervals.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: HarpSpellingChain["intervals"] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function spellingChoices(
  members: readonly number[],
  notes: readonly HarpPedalNote[],
  inScope: readonly boolean[],
): HarpSpellingChoice[] {
  const pitches = harpPitchSpellings(harpPedalSpellingMidi(notes[members[0]!]!.pitch));
  return pitches
    .filter((pitch) => members.every((index) => inScope[index] || samePitch(notes[index]!.pitch, pitch)))
    .map((pitch) => {
      const changed = members.filter((index) => !samePitch(notes[index]!.pitch, pitch));
      return {
        pitch,
        edits: changed.map((index) => {
          const note = notes[index]!;
          return { eventId: note.eventId, noteIndex: note.noteIndex, pitch: { ...pitch } };
        }),
        editKeys: changed.map(
          (index) => `${String(index).padStart(10, "0")}:${pitch.step}:${pitch.alter}:${pitch.octave}`,
        ),
      };
    });
}

/** A cross-jump tie shares spelling, but does not hold a string through unplayed written measures. */
export function buildHarpTieChains(score: Score, partIndex: number, notes: readonly HarpPedalNote[]): HarpTieResult {
  const part = score.parts[partIndex]!;
  const inScope = notes.map((note) => isHarpInstrumentAt(part, note.measureIndex, note.fraction));
  const edges = tieEdges(notes, authoredNotes(score, partIndex));
  if (typeof edges === "string") return { error: edges };
  const chains: HarpSpellingChain[] = [];
  const baselineNotes: HarpPedalNote[] = [];
  for (const members of connectedNotes(notes.length, edges)) {
    const activeMembers = members.filter((index) => inScope[index]);
    if (!activeMembers.length) continue;
    const chainNotes = members.map((index) => notes[index]!);
    const intervals = soundingIntervals(members, notes, edges);
    const choices = spellingChoices(members, notes, inScope);
    if (!choices.length) {
      return { error: `No exact harp-string spelling is available for the notes tied to "${chainNotes[0]!.eventId}".` };
    }
    const activeNotes = activeMembers.map((index) => notes[index]!);
    chains.push({
      id: chains.length,
      notes: activeNotes,
      choices,
      intervals,
      startBeat: Math.min(...activeNotes.map((note) => note.beat)),
      lastAttackBeat: Math.max(...activeNotes.map((note) => note.beat)),
      endBeat: Math.max(...intervals.map((interval) => interval.end)),
    });
    if (!choices.some((choice) => choice.edits.length === 0)) continue;
    for (const note of activeNotes) {
      const interval = intervals.find((span) => span.start <= note.beat && note.beat <= span.end)!;
      baselineNotes.push({ ...note, durationBeats: interval.end - note.beat });
    }
  }
  return { music: { chains, baselineNotes } };
}
