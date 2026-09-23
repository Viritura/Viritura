import {
  measureBeats,
  pitchToMidi,
  type Note,
  type NoteEvent,
  type SequenceContent,
  type TimeSignature,
} from "@viritura/core";
import { createRest, decomposeDuration, decomposeRestsAtPosition, generateEventId } from "../../commands/noteCommands";
import type { ClipboardFragment, ClipboardTrack } from "../../clipboard/ClipboardFragment";
import type { PasteResult } from "../../commands/clipboardCommands";
import { allocateTopDown, pitchKey, sortByPitchDescending } from "./allocation";
import { buildBeatGrid, maxSimultaneity, type BeatGrid, type SoundingNote } from "./beatGrid";
import { cloneNoteForChord } from "./chordMerge";

/** A clipboard fragment cannot be distributed without dropping authored notation. */
export class FragmentDistributionError extends Error {}

type TieCarry = Map<string, Note>;

function leadInBeats(track: ClipboardTrack): number {
  const [numerator, denominator] = track.leadIn ?? [0, 1];
  return (numerator / denominator) * 4;
}

function notationTracks(content: SequenceContent[], tracks: ClipboardTrack[] | undefined): ClipboardTrack[] {
  if (tracks?.length) return tracks;
  return [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, content }];
}

function distributionGrid(
  content: SequenceContent[],
  tracks: ClipboardTrack[] | undefined,
  timeSignature: TimeSignature,
): { grid: BeatGrid; tracks: ClipboardTrack[] } {
  const sources = notationTracks(content, tracks);
  if (sources.some((track) => track.voiceIndex > 0)) {
    throw new FragmentDistributionError(
      "Nothing was redistributed: the copied music contains more than one voice on a staff. Multi-voice distribution is not supported yet.",
    );
  }
  const grid = buildBeatGrid(
    sources.map((track) => ({ content: track.content, leadInBeats: leadInBeats(track) })),
    timeSignature,
  );
  if (!grid) {
    throw new FragmentDistributionError(
      "Nothing was redistributed: tuplets, tremolos, and grace notes are not supported yet.",
    );
  }
  return { grid, tracks: sources };
}

function emitRests(beat: number, beats: number, timeSignature: TimeSignature): NoteEvent[] {
  const capacity = measureBeats(timeSignature);
  const position = capacity > 0 ? beat % capacity : beat;
  return decomposeRestsAtPosition(beats, position, timeSignature).map((duration) => createRest(duration));
}

function emitChord(beats: number, assigned: readonly SoundingNote[], carry: TieCarry): NoteEvent[] {
  const durations = decomposeDuration(beats);
  const events: NoteEvent[] = [];
  const emittedKeys = new Set(assigned.map((entry) => pitchKey(entry.pitch)));
  const stacked = [...assigned].sort((left, right) => pitchToMidi(left.pitch) - pitchToMidi(right.pitch));

  for (const [pieceIndex, duration] of durations.entries()) {
    const notes = stacked.map((entry) => {
      const note = cloneNoteForChord(entry.note);
      const key = pitchKey(entry.pitch);
      const previous = carry.get(key);
      if (previous && (pieceIndex > 0 || entry.continuation)) previous.ties = [{ target: note.id! }];
      carry.set(key, note);
      return note;
    });
    events.push({ type: "event", id: generateEventId(), duration, notes });
  }

  for (const key of [...carry.keys()]) {
    if (!emittedKeys.has(key)) carry.delete(key);
  }
  return events;
}

function writeTracks(
  grid: BeatGrid,
  sources: readonly ClipboardTrack[],
  targetCount: number,
  timeSignature: TimeSignature,
): ClipboardTrack[] {
  const content: SequenceContent[][] = Array.from({ length: targetCount }, () => []);
  const carries: TieCarry[] = Array.from({ length: targetCount }, () => new Map());

  for (const slot of grid.slots) {
    const allocations = allocateTopDown(sortByPitchDescending(slot.notes), targetCount);
    for (let targetIndex = 0; targetIndex < targetCount; targetIndex++) {
      const assigned = allocations[targetIndex]!;
      if (assigned.length === 0) {
        carries[targetIndex]!.clear();
        content[targetIndex]!.push(...emitRests(slot.beat, slot.beats, timeSignature));
      } else {
        content[targetIndex]!.push(...emitChord(slot.beats, assigned, carries[targetIndex]!));
      }
    }
  }

  const template = sources[0]!;
  return content.map((trackContent, targetIndex) => ({
    ...structuredClone(sources[targetIndex] ?? template),
    partOffset: 0,
    staffOffset: targetIndex,
    voiceIndex: 0,
    leadIn: undefined,
    content: trackContent,
    dynamics: targetIndex === 0 ? structuredClone(template.dynamics) : undefined,
  }));
}

function transformedTracks(
  content: SequenceContent[],
  tracks: ClipboardTrack[] | undefined,
  timeSignature: TimeSignature,
  targetCount: number | "maximum",
): ClipboardTrack[] {
  const source = distributionGrid(content, tracks, timeSignature);
  const count = targetCount === "maximum" ? Math.max(1, maxSimultaneity(source.grid)) : targetCount;
  if (!Number.isInteger(count) || count < 1) {
    throw new FragmentDistributionError("Nothing was redistributed: the destination has no usable staves.");
  }
  return writeTracks(source.grid, source.tracks, count, timeSignature);
}

function transformedFragment(fragment: ClipboardFragment, targetCount: number | "maximum"): ClipboardFragment {
  const tracks = transformedTracks(fragment.content, fragment.tracks, fragment.timeSignature, targetCount);
  return { ...structuredClone(fragment), content: tracks[0]!.content, tracks };
}

/** Merge every copied track into a single chordal destination track. */
export function reduceFragment(fragment: ClipboardFragment): ClipboardFragment {
  return transformedFragment(fragment, 1);
}

/** Fan copied pitches top-down across the requested number of destination tracks. */
export function explodeFragment(fragment: ClipboardFragment, count?: number): ClipboardFragment {
  return transformedFragment(fragment, count ?? "maximum");
}

function transformedPasteResult(paste: PasteResult, targetCount: number | "maximum"): PasteResult {
  if (!paste.sourceTimeSignature) {
    throw new FragmentDistributionError("Nothing was redistributed: the copied music has no time-signature context.");
  }
  const tracks = transformedTracks(paste.content, paste.tracks, paste.sourceTimeSignature, targetCount);
  return { ...paste, content: tracks[0]!.content, tracks };
}

/** Preserve non-notation paste metadata while applying the Reduce transform. */
export function reducePasteResult(paste: PasteResult): PasteResult {
  return transformedPasteResult(paste, 1);
}

/** Preserve non-notation paste metadata while applying the Explode transform. */
export function explodePasteResult(paste: PasteResult, count?: number): PasteResult {
  return transformedPasteResult(paste, count ?? "maximum");
}
