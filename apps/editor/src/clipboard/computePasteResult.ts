import { measureBeats, walkSequenceEvents, type Score, type SequenceContent } from "@viritura/core";
import {
  resolveEventLocation,
  eventId as buildEventId,
  eventSuffix as buildEventSuffix,
  graceId,
} from "../score/ElementPath";
import type { SelectionRhythmicRange, SelectionState, SelectionTrackRhythmicRange } from "../store/selectionStore";
import { parseElementType } from "../score/elementTypes";
import { voiceIndexWithinStaff } from "./clipboardTrackMapping";
import type { CursorPosition } from "../store/noteInputStore";
import { applyPaste, type PasteResult } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";
import { advanceCursor } from "../commands/cursorCommands";
import { findPlacedAnnotationIds } from "./annotations";
import { mergeDestinationIntoPaste, pasteMergeWarnings } from "./pasteMerge";

interface PasteCursor extends CursorPosition {
  voice: number;
}

function sequenceIndexForCursor(score: Score, cursor: PasteCursor): number {
  const sequences = score.parts[cursor.partIndex]?.measures[cursor.measureIndex]?.sequences;
  if (!sequences) return cursor.voice;
  if (!sequences.some((sequence) => sequence.staff != null)) return cursor.voice;
  const staffNumber = (cursor.staffIndex ?? 0) + 1;
  const staffSequences = sequences
    .map((sequence, index) => ({ sequence, index }))
    .filter(({ sequence }) => sequence.staff === staffNumber);
  if (staffSequences[cursor.voice]) return staffSequences[cursor.voice]!.index;
  if (staffSequences.length > 0) return sequences.length + (cursor.voice - staffSequences.length);
  return cursor.voice;
}

function eventIndexAtBeat(content: readonly SequenceContent[], targetBeat: number): number {
  let beat = 0;
  for (let index = 0; index < content.length; index++) {
    const endBeat = beat + sequenceContentBeats(content[index]!);
    if (targetBeat < endBeat - 1e-9) return index;
    beat = endBeat;
  }
  return content.length;
}

interface PlacedSelectionEvent {
  elementId: string;
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  staff: number;
  beat: number;
  beats: number;
  inContainer?: boolean;
}

function placedRangeCorners(matches: PlacedSelectionEvent[]): { start: string; end: string } | null {
  const first = matches[0];
  const last = matches.at(-1);
  if (!first || !last) return null;
  const simultaneous = (a: PlacedSelectionEvent, b: PlacedSelectionEvent) =>
    a.measureIndex === b.measureIndex && Math.abs(a.beat - b.beat) < 1e-9;
  const firstOnsets = matches.filter((event) => simultaneous(event, first));
  const lastOnsets = matches.filter((event) => simultaneous(event, last));
  const breadth = (a: PlacedSelectionEvent, b: PlacedSelectionEvent) => [
    Math.abs(a.partIndex - b.partIndex),
    Number(a.sequenceIndex !== b.sequenceIndex),
    Math.abs(a.staff - b.staff),
  ];
  let start = first;
  let end = last;
  // Long notes have fewer onsets. Use opposite physical corners at the temporal
  // boundaries so a sustained lower voice is not excluded by two upper endpoints.
  for (const a of [firstOnsets[0]!, firstOnsets.at(-1)!]) {
    for (const b of [lastOnsets[0]!, lastOnsets.at(-1)!]) {
      const current = breadth(start, end);
      const candidate = breadth(a, b);
      const difference = candidate.map((value, index) => value - current[index]!).find((value) => value !== 0);
      if (difference !== undefined && difference > 0) {
        start = a;
        end = b;
      }
    }
  }
  return { start: start.elementId, end: end.elementId };
}

function collectPlacedGraceEvents(
  content: SequenceContent[],
  index: number,
  ids: ReadonlySet<string>,
  location: Omit<PlacedSelectionEvent, "elementId" | "beats">,
  matches: PlacedSelectionEvent[],
): void {
  const grace = content[index];
  const parentIndex = index === content.length - 1 ? index - 1 : index + 1;
  const parent = content[parentIndex];
  if (grace?.type !== "grace" || parent?.type !== "event") return;
  const parentSuffix = buildEventSuffix(parent.id, parentIndex, location.measureIndex, location.sequenceIndex);
  for (const [graceIndex, event] of grace.content.entries()) {
    if (!event.id || !ids.has(event.id)) continue;
    matches.push({
      ...location,
      beats: 0,
      inContainer: true,
      elementId: graceId(
        location.partIndex,
        location.measureIndex,
        location.sequenceIndex,
        parentSuffix,
        buildEventSuffix(event.id, graceIndex),
      ),
    });
  }
}

function collectPlacedSelectionEvents(
  content: SequenceContent[],
  ids: ReadonlySet<string>,
  location: Omit<PlacedSelectionEvent, "elementId" | "beat" | "beats">,
  matches: PlacedSelectionEvent[],
  startBeat = 0,
  scale = 1,
): void {
  let beat = startBeat;
  for (const [index, item] of content.entries()) {
    const beats = sequenceContentBeats(item);
    if (item.type === "event" && item.id && ids.has(item.id)) {
      const suffix = buildEventSuffix(item.id, index, location.measureIndex, location.sequenceIndex);
      matches.push({
        ...location,
        beat,
        beats: beats * scale,
        elementId: buildEventId(location.partIndex, location.measureIndex, location.sequenceIndex, suffix),
      });
    } else if (item.type === "tuplet" || item.type === "tremolo") {
      const innerBeats = item.content.reduce((sum, child) => sum + sequenceContentBeats(child), 0);
      collectPlacedSelectionEvents(
        item.content,
        ids,
        { ...location, inContainer: true },
        matches,
        beat,
        innerBeats > 0 ? (scale * beats) / innerBeats : scale,
      );
    } else if (item.type === "grace") {
      collectPlacedGraceEvents(content, index, ids, { ...location, beat }, matches);
    }
    beat += beats * scale;
  }
}

/** Find actual placed event IDs across all destination staves, preserving container structure. */
export function findPastedSelection(
  newScore: Score,
  pasteContent: SequenceContent[],
  _partIndex: number,
  measureIndex: number,
  _sequenceIndex: number,
): { start: string; end: string } | null {
  return findPlacedSelection(newScore, pasteContent, measureIndex).range;
}

function normalizePlacedStart(score: Score, start: SelectionRhythmicRange["start"]): SelectionRhythmicRange["start"] {
  let time = { count: 4, unit: 4 };
  for (let m = 0; m < score.global.measures.length; m++) {
    time = score.global.measures[m]?.time ?? time;
    if (m !== start.measureIndex) continue;
    const capacity = measureBeats(time);
    if (capacity <= 0 || start.beat < capacity - 1e-9) break;
    start = { measureIndex: m + 1, beat: Math.max(0, start.beat - capacity) };
  }
  return start;
}

function placedSelectionState(
  matches: PlacedSelectionEvent[],
  rhythmicRange: SelectionRhythmicRange,
  annotationIds: readonly string[],
): SelectionState {
  const first = matches[0]!;
  const { start, end } = rhythmicRange;
  const onlyEvent =
    matches.length === 1 &&
    annotationIds.length === 0 &&
    !first.inContainer &&
    rhythmicRange.tracks?.length === 1 &&
    start.measureIndex === first.measureIndex &&
    Math.abs(start.beat - first.beat) < 1e-9 &&
    end.measureIndex === first.measureIndex &&
    Math.abs(end.beat - first.beat - first.beats) < 1e-9;
  return onlyEvent
    ? { kind: "single", elementId: first.elementId, elementType: parseElementType(first.elementId) }
    : { kind: "multi", elementIds: [...matches.map((event) => event.elementId), ...annotationIds], rhythmicRange };
}

function before(a: SelectionRhythmicRange["start"], b: SelectionRhythmicRange["start"]): boolean {
  return a.measureIndex < b.measureIndex || (a.measureIndex === b.measureIndex && a.beat < b.beat - 1e-9);
}

function placedTrackRanges(
  score: Score,
  placed: Set<SequenceContent>,
  startMeasure: number,
): SelectionTrackRhythmicRange[] {
  const tracks = new Map<string, SelectionTrackRhythmicRange>();
  for (const [partIndex, part] of score.parts.entries()) {
    for (let measureIndex = startMeasure; measureIndex < part.measures.length; measureIndex++) {
      for (const [sequenceIndex, sequence] of part.measures[measureIndex]!.sequences.entries()) {
        const staff = sequence.staff ?? 1;
        const voice = voiceIndexWithinStaff(score, partIndex, measureIndex, sequenceIndex);
        const key = `${partIndex}/${staff}/${voice}`;
        let beat = 0;
        for (const item of sequence.content) {
          const beats = sequenceContentBeats(item);
          if (placed.has(item)) {
            tracks.set(key, {
              partIndex,
              staff,
              voice,
              start: tracks.get(key)?.start ?? { measureIndex, beat },
              end: { measureIndex, beat: beat + beats },
            });
          }
          beat += beats;
        }
      }
    }
  }
  return [...tracks.values()];
}

/**
 * IDs describe the complete placement; the rhythmic range also retains spaces
 * that have no selectable IDs. Two onset corners cannot describe interior voices.
 */
export function findPlacedSelection(
  newScore: Score,
  pasteContent: SequenceContent[],
  measureIndex: number,
  startBeat?: number,
  annotationIds: readonly string[] = [],
): { range: { start: string; end: string } | null; selection: SelectionState | null } {
  const ids = new Set<string>();
  for (const { event } of walkSequenceEvents(pasteContent)) {
    if (event.id) ids.add(event.id);
  }
  if (ids.size === 0) {
    const selection: SelectionState | null =
      annotationIds.length === 1
        ? { kind: "single", elementId: annotationIds[0]!, elementType: parseElementType(annotationIds[0]!) }
        : annotationIds.length > 1
          ? { kind: "multi", elementIds: [...annotationIds] }
          : null;
    return { range: null, selection };
  }

  const matches: PlacedSelectionEvent[] = [];
  const tracks = placedTrackRanges(newScore, new Set(pasteContent), measureIndex);
  let start: SelectionRhythmicRange["start"] | undefined =
    startBeat === undefined ? undefined : { measureIndex, beat: startBeat };
  let end: SelectionRhythmicRange["end"] | undefined;
  for (const track of tracks) {
    if (!start || before(track.start, start)) start = track.start;
    if (!end || before(end, track.end)) end = track.end;
  }
  for (const [partIndex, part] of newScore.parts.entries()) {
    for (let m = measureIndex; m < part.measures.length; m++) {
      for (const [sequenceIndex, sequence] of part.measures[m]!.sequences.entries()) {
        collectPlacedSelectionEvents(
          sequence.content,
          ids,
          { partIndex, measureIndex: m, sequenceIndex, staff: sequence.staff ?? 1 },
          matches,
        );
      }
    }
  }

  matches.sort((a, b) => {
    const beatOrder = Math.abs(a.beat - b.beat) > 1e-9 ? a.beat - b.beat : 0;
    return (
      a.measureIndex - b.measureIndex ||
      beatOrder ||
      a.partIndex - b.partIndex ||
      a.staff - b.staff ||
      a.sequenceIndex - b.sequenceIndex
    );
  });
  const range = placedRangeCorners(matches);
  if (!range) return { range, selection: null };
  const first = matches[0]!;
  start ??= { measureIndex: first.measureIndex, beat: first.beat };
  for (const match of matches) {
    const itemEnd = { measureIndex: match.measureIndex, beat: match.beat + match.beats };
    if (!end || before(end, itemEnd)) end = itemEnd;
  }
  const selection = placedSelectionState(
    matches,
    { start: normalizePlacedStart(newScore, start), end: end!, tracks },
    annotationIds,
  );
  return { range, selection };
}

/**
 * Resolve the (part, measure, sequence, event) anchor for a paste based on the
 * current selection. Returns null when the selection can't anchor a paste.
 */
function resolvePasteAnchor(
  score: Score,
  selection: SelectionState,
  cursor?: PasteCursor,
): { partIndex: number; measureIndex: number; sequenceIndex: number; eventIndex: number } | null {
  if (cursor) {
    const sequenceIndex = sequenceIndexForCursor(score, cursor);
    const content = score.parts[cursor.partIndex]?.measures[cursor.measureIndex]?.sequences[sequenceIndex]?.content;
    if (content) {
      return {
        partIndex: cursor.partIndex,
        measureIndex: cursor.measureIndex,
        sequenceIndex,
        eventIndex: eventIndexAtBeat(content, cursor.beatPosition),
      };
    }
  }
  if (selection.kind === "single") {
    const loc = resolveEventLocation(selection.elementId, score);
    if (loc) {
      return {
        partIndex: loc.partIndex,
        measureIndex: loc.measureIndex,
        sequenceIndex: loc.sequenceIndex,
        // Clipboard tuplets are indivisible rhythmic units. An inner event's
        // index is relative to the tuplet content, not the top-level sequence.
        eventIndex: loc.tupletIndex ?? loc.eventIndex,
      };
    }
    const segments = selection.elementId.split("/");
    const pMatch = segments[0]?.match(/^p(\d+)$/);
    const mMatch = segments[1]?.match(/^m(\d+)$/);
    const sMatch = segments[2]?.match(/^s(\d+)$/);
    if (!pMatch || !mMatch) return null;
    const partIndex = parseInt(pMatch[1]!, 10);
    const measureIndex = parseInt(mMatch[1]!, 10);
    return {
      partIndex,
      measureIndex,
      sequenceIndex: sMatch
        ? parseInt(sMatch[1]!, 10)
        : sequenceIndexForStaff(score, partIndex, measureIndex, selection.measureAnchor?.localStaffIndex),
      eventIndex: 0,
    };
  }
  if (selection.kind === "measure") {
    return {
      partIndex: selection.startPartIndex,
      measureIndex: selection.startMeasure,
      sequenceIndex: sequenceIndexForStaff(
        score,
        selection.startPartIndex,
        selection.startMeasure,
        selection.startLocalStaffIndex,
      ),
      eventIndex: 0,
    };
  }

  function sequenceIndexForStaff(
    score: Score,
    partIndex: number,
    measureIndex: number,
    localStaffIndex: number | undefined,
  ): number {
    if (localStaffIndex === undefined) return 0;
    const sequences = score.parts[partIndex]?.measures[measureIndex]?.sequences;
    if (!sequences) return 0;
    const staffNumber = localStaffIndex + 1;
    const sequenceIndex = sequences.findIndex((sequence) => (sequence.staff ?? 1) === staffNumber);
    return sequenceIndex >= 0 ? sequenceIndex : 0;
  }
  return null;
}

/**
 * Apply a paste at the anchor derived from the current selection. Returns the
 * new score and complete placed selection (with a legacy range), or null if
 * the selection can't anchor a paste.
 *
 * With `options.merge`, destination chords absorb the pasted pitches instead of
 * being replaced — the manual counterpart to a staff reduction.
 */
export function computePasteResult(
  score: Score,
  selection: SelectionState,
  paste: PasteResult,
  cursor?: PasteCursor,
  options?: { merge?: boolean },
): {
  newScore: Score;
  range: { start: string; end: string } | null;
  selection: SelectionState | null;
  cursorAfterPaste?: CursorPosition;
  warnings: string[];
} | null {
  const anchor = resolvePasteAnchor(score, selection, cursor);
  if (!anchor) return null;
  const placedContent: SequenceContent[] = [];
  const warnings: string[] = [];
  const newScore = applyPaste(
    score,
    paste,
    anchor.partIndex,
    anchor.measureIndex,
    anchor.sequenceIndex,
    anchor.eventIndex,
    placedContent,
    undefined,
    (message) => warnings.push(message),
  );
  if (options?.merge) {
    warnings.push(...pasteMergeWarnings(mergeDestinationIntoPaste(score, newScore, placedContent)));
  }
  const startBeat =
    score.parts[anchor.partIndex]?.measures[anchor.measureIndex]?.sequences[anchor.sequenceIndex]?.content
      .slice(0, anchor.eventIndex)
      .reduce((sum, item) => sum + sequenceContentBeats(item), 0) ?? 0;
  const annotationIds = findPlacedAnnotationIds(score, newScore, paste, {
    partIndex: anchor.partIndex,
    measureIndex: anchor.measureIndex,
    staffIndex:
      (score.parts[anchor.partIndex]?.measures[anchor.measureIndex]?.sequences[anchor.sequenceIndex]?.staff ?? 1) - 1,
    beat: startBeat,
  });
  const placed = findPlacedSelection(newScore, placedContent, anchor.measureIndex, startBeat, annotationIds);
  const pastedBeats = paste.content.reduce((beats, item) => beats + sequenceContentBeats(item), 0);
  const cursorAfterPaste = cursor && pastedBeats > 0 ? advanceCursor(newScore, cursor, pastedBeats) : undefined;
  return { newScore, ...placed, cursorAfterPaste, warnings: [...new Set(warnings)] };
}
