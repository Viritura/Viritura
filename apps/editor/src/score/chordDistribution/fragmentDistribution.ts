import {
  isRest,
  pitchToMidi,
  type Note,
  type NoteEvent,
  type SequenceContent,
  type TimeSignature,
} from "@viritura/core";
import { createRest, decomposeDuration, decomposeRestsAtPosition, generateEventId } from "../../commands/noteCommands";
import type { CapturedDynamic, ClipboardFragment, ClipboardTrack } from "../../clipboard/ClipboardFragment";
import type { PasteResult } from "../../commands/clipboardCommands";
import { allocateTopDown, pitchKey, sortByPitchDescending } from "./allocation";
import { meteredRhythm, type RhythmContext, type SoundingNote } from "./beatGrid";
import { cloneNoteForChord } from "./chordMerge";
import { FragmentDistributionError } from "./distributionError";
import { applyCarriedNotation, carriedNotation } from "./eventNotation";
import { dynamicsForTarget, mergedDynamics } from "./trackDynamics";
import { buildSegments, segmentsMaxSimultaneity, type DistributionSegment } from "./tupletSegments";

export { FragmentDistributionError };

type TieCarry = Map<string, Note>;

function leadInBeats(track: ClipboardTrack): number {
  const [numerator, denominator] = track.leadIn ?? [0, 1];
  return (numerator / denominator) * 4;
}

function notationTracks(content: SequenceContent[], tracks: ClipboardTrack[] | undefined): ClipboardTrack[] {
  if (tracks?.length) return tracks;
  return [{ partOffset: 0, staffOffset: 0, voiceIndex: 0, content }];
}

function distributionSegments(
  content: SequenceContent[],
  tracks: ClipboardTrack[] | undefined,
  timeSignature: TimeSignature,
): { segments: DistributionSegment[]; tracks: ClipboardTrack[] } {
  const sources = notationTracks(content, tracks);
  if (sources.some((track) => track.voiceIndex > 0)) {
    throw new FragmentDistributionError(
      "Nothing was redistributed: the copied music contains more than one voice on a staff. Multi-voice distribution is not supported yet.",
    );
  }
  const segments = buildSegments(
    sources.map((track) => ({ content: track.content, leadInBeats: leadInBeats(track) })),
    meteredRhythm(timeSignature),
  );
  return { segments, tracks: sources };
}

function emitRests(beat: number, beats: number, rhythm: RhythmContext): NoteEvent[] {
  const durations = rhythm.metered
    ? decomposeRestsAtPosition(beats, rhythm.startBeat + beat, rhythm.timeSignature)
    : decomposeDuration(beats);
  return durations.map((duration) => createRest(duration));
}

function emitChord(beats: number, assigned: readonly SoundingNote[], carry: TieCarry): NoteEvent[] {
  const durations = decomposeDuration(beats);
  const events: NoteEvent[] = [];
  const emittedKeys = new Set(assigned.map((entry) => pitchKey(entry.pitch)));
  const stacked = [...assigned].sort((left, right) => pitchToMidi(left.pitch) - pitchToMidi(right.pitch));
  // A note tied into this slot was already articulated where it began, so its
  // markings must not be restated here.
  const carried = carriedNotation(stacked.filter((entry) => !entry.continuation).map((entry) => entry.event));

  for (const [pieceIndex, duration] of durations.entries()) {
    const notes = stacked.map((entry) => {
      const note = cloneNoteForChord(entry.note);
      const key = pitchKey(entry.pitch);
      const previous = carry.get(key);
      if (previous && (pieceIndex > 0 || entry.continuation)) previous.ties = [{ target: note.id! }];
      carry.set(key, note);
      return note;
    });
    const event: NoteEvent = { type: "event", id: generateEventId(), duration, notes };
    if (pieceIndex === 0) applyCarriedNotation(event, carried);
    events.push(event);
  }

  for (const key of [...carry.keys()]) {
    if (!emittedKeys.has(key)) carry.delete(key);
  }
  return events;
}

function writePlainSegment(
  segment: Extract<DistributionSegment, { kind: "plain" }>,
  targetCount: number,
  content: readonly SequenceContent[][],
  carries: readonly TieCarry[],
): void {
  for (const slot of segment.grid.slots) {
    const allocations = allocateTopDown(sortByPitchDescending(slot.notes), targetCount);
    for (let targetIndex = 0; targetIndex < targetCount; targetIndex++) {
      const assigned = allocations[targetIndex]!;
      if (assigned.length === 0) {
        carries[targetIndex]!.clear();
        content[targetIndex]!.push(...emitRests(slot.beat, slot.beats, segment.rhythm));
      } else {
        content[targetIndex]!.push(...emitChord(slot.beats, assigned, carries[targetIndex]!));
      }
    }
  }
}

function isSilent(content: readonly SequenceContent[]): boolean {
  return content.every((item) => item.type === "event" && isRest(item));
}

function writeTupletSegment(
  segment: Extract<DistributionSegment, { kind: "tuplet" }>,
  targetCount: number,
  content: readonly SequenceContent[][],
  rhythm: RhythmContext,
  startBeat: number,
): void {
  const shares = writeSegments(segment.inner, targetCount, segment.innerRhythm);
  const { content: _interior, ...shape } = segment.template;
  for (let targetIndex = 0; targetIndex < targetCount; targetIndex++) {
    const share = shares[targetIndex]!;
    // A tuplet whose every slot fell silent is notated as a plain rest across
    // the span it occupied, not as a bracket over rests.
    if (isSilent(share)) {
      content[targetIndex]!.push(...emitRests(startBeat, segment.outerBeats, rhythm));
      continue;
    }
    content[targetIndex]!.push({ ...structuredClone(shape), content: share });
  }
}

function writeSegments(
  segments: readonly DistributionSegment[],
  targetCount: number,
  rhythm: RhythmContext,
): SequenceContent[][] {
  const content: SequenceContent[][] = Array.from({ length: targetCount }, () => []);
  const carries: TieCarry[] = Array.from({ length: targetCount }, () => new Map());
  let beat = 0;

  for (const segment of segments) {
    if (segment.kind === "plain") {
      writePlainSegment(segment, targetCount, content, carries);
      beat += segment.grid.duration;
      continue;
    }
    // A tuplet bracket ends every grid-derived tie chain: its interior is a
    // separate timeline and nothing the grid tracked sustains across it.
    for (const carry of carries) carry.clear();
    writeTupletSegment(segment, targetCount, content, rhythm, beat);
    beat += segment.outerBeats;
  }
  return content;
}

function writeTracks(
  segments: readonly DistributionSegment[],
  sources: readonly ClipboardTrack[],
  targetCount: number,
  timeSignature: TimeSignature,
  fragmentDynamics: readonly CapturedDynamic[] | undefined,
): ClipboardTrack[] {
  const content = writeSegments(segments, targetCount, meteredRhythm(timeSignature));
  const merged = mergedDynamics(sources, fragmentDynamics);
  const template = sources[0]!;

  return content.map((trackContent, targetIndex) => ({
    ...structuredClone(sources[targetIndex] ?? template),
    partOffset: 0,
    staffOffset: targetIndex,
    // Redistributed staves are their own annotation origin; inheriting a source
    // staff would make paste resolve every track's annotations ambiguously.
    sourceStaff: targetIndex + 1,
    voiceIndex: 0,
    leadIn: undefined,
    content: trackContent,
    dynamics: dynamicsForTarget(merged, targetIndex),
  }));
}

function transformedTracks(
  content: SequenceContent[],
  tracks: ClipboardTrack[] | undefined,
  timeSignature: TimeSignature,
  targetCount: number | "maximum",
  fragmentDynamics: readonly CapturedDynamic[] | undefined,
): ClipboardTrack[] {
  const source = distributionSegments(content, tracks, timeSignature);
  const count = targetCount === "maximum" ? Math.max(1, segmentsMaxSimultaneity(source.segments)) : targetCount;
  if (!Number.isInteger(count) || count < 1) {
    throw new FragmentDistributionError("Nothing was redistributed: the destination has no usable staves.");
  }
  return writeTracks(source.segments, source.tracks, count, timeSignature, fragmentDynamics);
}

function transformedFragment(fragment: ClipboardFragment, targetCount: number | "maximum"): ClipboardFragment {
  const tracks = transformedTracks(
    fragment.content,
    fragment.tracks,
    fragment.timeSignature,
    targetCount,
    fragment.dynamics,
  );
  // Every dynamic now rides a destination track, so a surviving fragment-level
  // copy would be pasted a second time.
  return { ...structuredClone(fragment), content: tracks[0]!.content, tracks, dynamics: undefined };
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
  const tracks = transformedTracks(paste.content, paste.tracks, paste.sourceTimeSignature, targetCount, paste.dynamics);
  return { ...paste, content: tracks[0]!.content, tracks, dynamics: undefined };
}

/** Preserve non-notation paste metadata while applying the Reduce transform. */
export function reducePasteResult(paste: PasteResult): PasteResult {
  return transformedPasteResult(paste, 1);
}

/** Preserve non-notation paste metadata while applying the Explode transform. */
export function explodePasteResult(paste: PasteResult, count?: number): PasteResult {
  return transformedPasteResult(paste, count ?? "maximum");
}
