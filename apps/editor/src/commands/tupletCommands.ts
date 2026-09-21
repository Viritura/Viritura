import type { Score, Duration, NoteEvent, Tuplet, SequenceContent, TupletDuration } from "@viritura/core";
import { isRest, measureBeats } from "@viritura/core";
import type { EventLocation } from "../score/ElementPath";
import {
  durationToBeats,
  beatsToDuration,
  generateEventId,
  sequenceContentBeats,
  decomposeDuration,
  createRest,
} from "./noteCommands";

// ═══════════════════════════════════════════
// Tuplet ratio helpers
// ═══════════════════════════════════════════

/**
 * Get the standard outer multiple for a given tuplet number N.
 * Returns M where "N in the time of M" is the standard ratio.
 */
export function getTupletOuterMultiple(n: number): number {
  switch (n) {
    case 2:
      return 3; // duplet: 2 in time of 3
    case 3:
      return 2; // triplet: 3 in time of 2
    case 4:
      return 3; // quadruplet: 4 in time of 3
    case 5:
      return 4; // quintuplet: 5 in time of 4
    case 6:
      return 4; // sextuplet: 6 in time of 4
    case 7:
      return 4; // septuplet: 7 in time of 4
    case 8:
      return 6; // 8-tuplet: 8 in time of 6
    case 9:
      return 8; // 9-tuplet: 9 in time of 8
    default: {
      // Next lower power of 2
      let p = 1;
      while (p * 2 < n) p *= 2;
      return p;
    }
  }
}

export interface TupletRatio {
  inner: number;
  outer: number;
}

/** Parse a user-facing `notes:time` ratio such as `3:2`. */
export function parseTupletRatio(value: string): TupletRatio | null {
  const match = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(value);
  if (!match) return null;
  const inner = Number(match[1]);
  const outer = Number(match[2]);
  if (
    !Number.isInteger(inner) ||
    !Number.isInteger(outer) ||
    inner < 2 ||
    inner > 32 ||
    outer < 1 ||
    outer > 32 ||
    inner === outer
  ) {
    return null;
  }
  return { inner, outer };
}

/**
 * Compute the total real beats a tuplet occupies.
 */
export function tupletTotalBeats(outer: TupletDuration): number {
  return outer.multiple * durationToBeats(outer.duration);
}

// ═══════════════════════════════════════════
// Create tuplet — note input mode
// ═══════════════════════════════════════════

export interface CreateTupletParams {
  measureIndex: number;
  partIndex: number;
  voice: number;
  /** Beat position in the measure where the tuplet starts */
  beatPosition: number;
  /** N: how many events inside the tuplet */
  tupletNumber: number;
  /** M in N:M. Defaults to the conventional value for N. */
  outerMultiple?: number;
  /** Base duration for each sub-event (e.g., "eighth" for a triplet of eighths) */
  baseDuration: Duration;
}

// ═══════════════════════════════════════════
// Create tuplet — internal helpers
// ═══════════════════════════════════════════

function makeRestEvent(duration: Duration): NoteEvent {
  return { type: "event", id: generateEventId(), duration, rest: {} };
}

function makeRestsForDuration(beats: number): NoteEvent[] {
  return decomposeDuration(beats).map((d) => makeRestEvent(d));
}

function buildTuplet(tupletNumber: number, outerMultiple: number, baseDuration: Duration): Tuplet {
  const innerRests: NoteEvent[] = [];
  for (let i = 0; i < tupletNumber; i++) {
    innerRests.push(makeRestEvent({ ...baseDuration }));
  }
  return {
    type: "tuplet",
    inner: { multiple: tupletNumber, duration: { ...baseDuration } },
    outer: {
      multiple: outerMultiple,
      duration: { ...baseDuration },
    },
    content: innerRests,
  };
}

interface TargetLocation {
  targetIdx: number;
  targetBeatStart: number;
}

function findTargetByBeat(content: readonly SequenceContent[], beatPosition: number): TargetLocation | null {
  let pos = 0;
  for (let i = 0; i < content.length; i++) {
    const ev = content[i]!;
    const evBeats = sequenceContentBeats(ev);
    if (beatPosition >= pos - 1e-9 && beatPosition < pos + evBeats - 1e-9) {
      return { targetIdx: i, targetBeatStart: pos };
    }
    pos += evBeats;
  }
  return null;
}

function appendTupletAtEnd(sequence: { content: SequenceContent[] }, beatPosition: number, tuplet: Tuplet): void {
  const totalBeats = sequence.content.reduce((sum, ev) => sum + sequenceContentBeats(ev), 0);
  const gap = beatPosition - totalBeats;
  if (gap > 1e-9) {
    sequence.content.push(...makeRestsForDuration(gap));
  }
  sequence.content.push(tuplet);
}

function spliceTupletReplacingRests(
  sequence: { content: SequenceContent[] },
  loc: TargetLocation,
  tuplet: Tuplet,
  totalTupletBeats: number,
  beatPosition: number,
): void {
  const { targetIdx, targetBeatStart } = loc;
  const targetEvent = sequence.content[targetIdx]!;
  if (targetEvent.type !== "event" || !isRest(targetEvent)) {
    throw new Error("Cannot create tuplet: position is not a rest");
  }
  const offsetInTarget = beatPosition - targetBeatStart;
  const noteEndBeat = targetBeatStart + offsetInTarget + totalTupletBeats;

  // Consume rests that the tuplet covers
  let consumeEnd = targetIdx;
  let consumedEndBeat = targetBeatStart + sequenceContentBeats(targetEvent);

  while (consumedEndBeat < noteEndBeat - 1e-9 && consumeEnd + 1 < sequence.content.length) {
    const nextEv = sequence.content[consumeEnd + 1]!;
    if (nextEv.type !== "event" || !isRest(nextEv)) break;
    consumeEnd++;
    consumedEndBeat += sequenceContentBeats(nextEv);
  }

  const newContent: SequenceContent[] = [];
  if (offsetInTarget > 1e-9) newContent.push(...makeRestsForDuration(offsetInTarget));
  newContent.push(tuplet);
  const postBeats = consumedEndBeat - noteEndBeat;
  if (postBeats > 1e-9) newContent.push(...makeRestsForDuration(postBeats));

  sequence.content.splice(targetIdx, consumeEnd - targetIdx + 1, ...newContent);
}

/**
 * Create a tuplet at the given beat position.
 * The tuplet contains N rests of baseDuration, occupying M × baseDuration in real time.
 * Replaces existing content (rests) at the insertion point.
 *
 * Mutates the score in place and returns it.
 */
export function createTuplet(score: Score, params: CreateTupletParams): Score {
  const { measureIndex, partIndex, voice, beatPosition, tupletNumber, baseDuration } = params;
  const outerMultiple = params.outerMultiple ?? getTupletOuterMultiple(tupletNumber);

  if (tupletNumber < 2 || tupletNumber > 32 || outerMultiple < 1 || outerMultiple > 32) {
    throw new Error(`Invalid tuplet number: ${tupletNumber}`);
  }
  if (!Number.isFinite(beatPosition) || beatPosition < 0) {
    throw new Error(`Invalid tuplet beat position: ${beatPosition}`);
  }

  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);

  const partMeasure = part.measures[measureIndex];
  if (!partMeasure) throw new Error(`Measure ${measureIndex} not found`);

  while (partMeasure.sequences.length <= voice) {
    partMeasure.sequences.push({ content: [] });
  }

  const sequence = partMeasure.sequences[voice]!;
  const tuplet = buildTuplet(tupletNumber, outerMultiple, baseDuration);
  const totalTupletBeats = outerMultiple * durationToBeats(baseDuration);
  let time = { count: 4, unit: 4 };
  for (let index = 0; index <= measureIndex; index++) {
    if (score.global.measures[index]?.time) time = score.global.measures[index]!.time!;
  }
  if (beatPosition + totalTupletBeats > measureBeats(time) + 1e-9) {
    throw new Error("Tuplet does not fit before the end of the measure");
  }

  const target = findTargetByBeat(sequence.content, beatPosition);
  if (!target) {
    appendTupletAtEnd(sequence, beatPosition, tuplet);
  } else {
    spliceTupletReplacingRests(sequence, target, tuplet, totalTupletBeats, beatPosition);
  }

  if (sequence.fullMeasure) {
    delete sequence.fullMeasure;
  }

  return score;
}

// ═══════════════════════════════════════════
// Create tuplet from selected event
// ═══════════════════════════════════════════

export interface CreateTupletFromEventParams {
  measureIndex: number;
  partIndex: number;
  voice: number;
  eventIndex: number;
  tupletNumber: number;
  /** M in N:M. Defaults to the conventional value for N. */
  outerMultiple?: number;
}

/**
 * Replace an existing event with a tuplet of the same total duration.
 * The event's duration is divided into N equal sub-events.
 *
 * For example, replacing a half note with a triplet (N=3, outer=2):
 *   baseDuration = quarter (half / 2), content = 3 quarter rests.
 *
 * Mutates the score in place and returns it.
 */
export function createTupletFromEvent(score: Score, params: CreateTupletFromEventParams): Score {
  const { measureIndex, partIndex, voice, eventIndex, tupletNumber } = params;
  const outerMultiple = params.outerMultiple ?? getTupletOuterMultiple(tupletNumber);

  if (tupletNumber < 2 || tupletNumber > 32 || outerMultiple < 1 || outerMultiple > 32) {
    throw new Error(`Invalid tuplet number: ${tupletNumber}`);
  }

  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);

  const partMeasure = part.measures[measureIndex];
  if (!partMeasure) throw new Error(`Measure ${measureIndex} not found`);

  const sequence = partMeasure.sequences[voice];
  if (!sequence) throw new Error(`Voice ${voice} not found`);

  const event = sequence.content[eventIndex];
  if (!event || event.type !== "event") {
    throw new Error("Target must be a note event");
  }

  const totalBeats = durationToBeats(event.duration);
  const subBeats = totalBeats / outerMultiple;
  const baseDuration = beatsToDuration(subBeats);
  if (!baseDuration) {
    throw new Error("Duration cannot be evenly divided for this tuplet ratio");
  }

  // Build the tuplet content: N rests (or preserve the original as first event)
  const innerContent: NoteEvent[] = [];

  if (!isRest(event)) {
    // Preserve the original note as the first event in the tuplet
    innerContent.push({
      ...event,
      id: event.id ?? generateEventId(),
      duration: { ...baseDuration },
    });
    // Fill remaining slots with rests
    for (let i = 1; i < tupletNumber; i++) {
      innerContent.push({
        type: "event",
        id: generateEventId(),
        duration: { ...baseDuration },
        rest: {},
      });
    }
  } else {
    // All rests
    for (let i = 0; i < tupletNumber; i++) {
      innerContent.push({
        type: "event",
        id: generateEventId(),
        duration: { ...baseDuration },
        rest: {},
      });
    }
  }

  const tuplet: Tuplet = {
    type: "tuplet",
    inner: { multiple: tupletNumber, duration: baseDuration },
    outer: { multiple: outerMultiple, duration: baseDuration },
    content: innerContent,
  };

  // Replace the event with the tuplet
  sequence.content[eventIndex] = tuplet;

  if (sequence.fullMeasure) {
    delete sequence.fullMeasure;
  }

  return score;
}

export interface RemoveTupletParams {
  measureIndex: number;
  partIndex: number;
  voice: number;
  /** Zero-based ordinal among tuplets in the sequence, as used by bracket selection IDs. */
  tupletOrdinal: number;
}

/**
 * Remove a selected tuplet bracket and restore its pre-tuplet base value.
 *
 * A tuplet made from a rest becomes one regular rest spanning its outer
 * duration. A tuplet made from one selected note restores that note across the
 * same duration. Tuplets containing several sounded events cannot be flattened
 * without changing their rhythm, so this operation leaves them unchanged.
 */
export function removeTuplet(score: Score, params: RemoveTupletParams): boolean {
  const sequence = score.parts[params.partIndex]?.measures[params.measureIndex]?.sequences[params.voice];
  if (!sequence) return false;

  let tupletIndex = -1;
  let ordinal = -1;
  for (let index = 0; index < sequence.content.length; index++) {
    if (sequence.content[index]?.type !== "tuplet") continue;
    ordinal++;
    if (ordinal === params.tupletOrdinal) {
      tupletIndex = index;
      break;
    }
  }
  if (tupletIndex === -1) return false;

  const tuplet = sequence.content[tupletIndex];
  if (!tuplet || tuplet.type !== "tuplet" || tuplet.span) return false;
  const duration = beatsToDuration(sequenceContentBeats(tuplet));
  if (!duration) return false;

  const soundedEvents = tuplet.content.filter((item): item is NoteEvent => item.type === "event" && !isRest(item));
  if (soundedEvents.length > 1) return false;

  const restored = soundedEvents[0] ? { ...soundedEvents[0], duration } : createRest(duration);
  sequence.content.splice(tupletIndex, 1, restored);
  return true;
}

export interface CreateTupletFromRangeParams {
  locations: readonly EventLocation[];
  tupletNumber: number;
  /** M in N:M. Defaults to the conventional value for N. */
  outerMultiple?: number;
}

interface TupletRangeFragment {
  measureIndex: number;
  startIndex: number;
  endIndex: number;
  content: NoteEvent[];
}

function collectTupletRangeFragments(score: Score, locations: readonly EventLocation[]): TupletRangeFragment[] {
  if (locations.length < 2) {
    throw new Error("Select a contiguous range of notes and rests across a barline");
  }

  const ordered = [...locations].sort(
    (a, b) => a.measureIndex - b.measureIndex || a.sequenceIndex - b.sequenceIndex || a.eventIndex - b.eventIndex,
  );
  const first = ordered[0]!;
  if (ordered.some((loc) => loc.partIndex !== first.partIndex || loc.sequenceIndex !== first.sequenceIndex)) {
    throw new Error("Cross-barline tuplets must stay in one part and voice");
  }
  if (ordered.some((loc) => loc.tupletIndex !== undefined)) {
    throw new Error("Nested cross-barline tuplets are not supported");
  }
  const last = ordered.at(-1)!;
  if (first.measureIndex === last.measureIndex) {
    throw new Error("Select notes and rests on both sides of a barline");
  }

  const fragments: TupletRangeFragment[] = [];
  for (let measureIndex = first.measureIndex; measureIndex <= last.measureIndex; measureIndex++) {
    const sequence = score.parts[first.partIndex]?.measures[measureIndex]?.sequences[first.sequenceIndex];
    if (!sequence) throw new Error("The selected voice is missing from one of the measures");
    const startIndex = measureIndex === first.measureIndex ? first.eventIndex : 0;
    const endIndex = measureIndex === last.measureIndex ? last.eventIndex : sequence.content.length - 1;
    const content = sequence.content.slice(startIndex, endIndex + 1);
    if (content.length === 0 || content.some((item) => item.type !== "event")) {
      throw new Error("Cross-barline tuplets can only contain unnested notes and rests");
    }
    fragments.push({ measureIndex, startIndex, endIndex, content: content as NoteEvent[] });
  }
  return fragments;
}

/**
 * Wrap a contiguous event range spanning measures as one linked tuplet.
 * Existing events and their measure ownership are preserved.
 */
export function createTupletFromRange(score: Score, params: CreateTupletFromRangeParams): Score {
  const { locations, tupletNumber } = params;
  const outerMultiple = params.outerMultiple ?? getTupletOuterMultiple(tupletNumber);
  if (tupletNumber < 2 || tupletNumber > 32 || outerMultiple < 1 || outerMultiple > 32) {
    throw new Error(`Invalid tuplet number: ${tupletNumber}`);
  }

  const fragments = collectTupletRangeFragments(score, locations);
  const totalInnerBeats = fragments.reduce(
    (total, fragment) => total + fragment.content.reduce((sum, event) => sum + durationToBeats(event.duration), 0),
    0,
  );
  const baseDuration = beatsToDuration(totalInnerBeats / tupletNumber);
  if (!baseDuration) {
    throw new Error(
      `${tupletNumber}:${outerMultiple} does not evenly fit the selected note values (${totalInnerBeats} beats)`,
    );
  }

  const first = locations[0]!;
  const spanId = generateEventId();
  for (let index = 0; index < fragments.length; index++) {
    const fragment = fragments[index]!;
    const measure = score.parts[first.partIndex]!.measures[fragment.measureIndex]!;
    const sequence = measure.sequences[first.sequenceIndex]!;
    const tuplet: Tuplet = {
      type: "tuplet",
      inner: { multiple: tupletNumber, duration: { ...baseDuration } },
      outer: { multiple: outerMultiple, duration: { ...baseDuration } },
      content: fragment.content,
      span: {
        id: spanId,
        type: index === 0 ? "start" : index === fragments.length - 1 ? "stop" : "continue",
      },
    };
    sequence.content.splice(fragment.startIndex, fragment.endIndex - fragment.startIndex + 1, tuplet);
    if (sequence.fullMeasure) delete sequence.fullMeasure;
  }

  return score;
}
