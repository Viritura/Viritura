import { isRest, type NoteEvent, type Score, type Sequence, type SequenceContent, type Space } from "@viritura/core";
import { decomposeDuration, generateEventId, sequenceContentBeats } from "../../commands/noteCommands";
import {
  addWholeFractions,
  compareWholeFractions,
  contentWholeFraction,
  subtractWholeFractions,
} from "../clipboardTrackPlacement";
import { planPasteFragments } from "./rhythmicFragments";
import { sequenceForStaffVoice } from "./staffVoice";

/** Place by stable staff/voice and return the surviving inserted fragments, including continuations. */
export function pasteTrackIntoScore(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  eventIndex: number,
  content: SequenceContent[],
): SequenceContent[] {
  const part = score.parts[partIndex];
  const startMeasure = part?.measures[measureIndex];
  const startSequence = startMeasure?.sequences[sequenceIndex];
  if (!part || !startMeasure || !startSequence || content.length === 0) return [];
  const staff = startSequence.staff ?? 1;
  const voice = startMeasure.sequences
    .slice(0, sequenceIndex)
    .filter((sequence) => (sequence.staff ?? 1) === staff).length;
  const destinationPrefix = startSequence.content.slice(0, eventIndex);
  const startBeat = destinationPrefix.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
  const fragments = planPasteFragments(score, measureIndex, startBeat, content, destinationPrefix);
  const placedContent = new Set<SequenceContent>();

  for (const fragment of fragments) {
    ensurePasteMeasure(score, fragment.measureIndex);
    const measure = part.measures[fragment.measureIndex]!;
    const sequence = sequenceForStaffVoice(measure.sequences, staff, voice);
    // The planner starts at the supplied boundary; continuations start at zero.
    // Reuse that index rather than rounding past an adjacent tiny space.
    const index = fragment.measureIndex === measureIndex ? destinationPrefix.length : 0;
    const clearBudget = contentDuration(fragment.content);
    if (clearBudget[0] > 0) {
      delete sequence.fullMeasure;
      clearEventsInMeasure(sequence, index, clearBudget);
    }
    sequence.content.splice(index, 0, ...fragment.content);
    for (const item of fragment.content) placedContent.add(item);
    mergeRests(sequence, placedContent);
  }
  return [...placedContent];
}

export function ensurePasteMeasure(score: Score, measureIndex: number): void {
  while (score.global.measures.length <= measureIndex) score.global.measures.push({});
  for (const part of score.parts) {
    while (part.measures.length <= measureIndex) part.measures.push({ sequences: [{ content: [] }] });
  }
}

function contentDuration(content: readonly SequenceContent[]): Space["duration"] {
  return content.reduce<Space["duration"]>((sum, item) => addWholeFractions(sum, contentWholeFraction(item)), [0, 1]);
}

function clearEventsInMeasure(sequence: Sequence, index: number, clearBudget: Space["duration"]): void {
  let remaining = clearBudget;
  while (index < sequence.content.length && remaining[0] > 0) {
    const item = sequence.content[index]!;
    const beats = contentWholeFraction(item);
    if (compareWholeFractions(beats, remaining) <= 0) {
      sequence.content.splice(index, 1);
      remaining = subtractWholeFractions(remaining, beats);
      continue;
    }
    const remainder = subtractWholeFractions(beats, remaining);
    if (item.type === "space") {
      sequence.content.splice(index, 1, { type: "space", duration: remainder });
      return;
    }
    const rests: NoteEvent[] = decomposeDuration((remainder[0] / remainder[1]) * 4).map((duration) => ({
      type: "event",
      id: generateEventId(),
      duration,
      rest: {},
    }));
    if (compareWholeFractions(contentDuration(rests), remainder) !== 0) {
      throw new Error("Cannot represent the destination remainder exactly as rests.");
    }
    sequence.content.splice(index, 1, ...rests);
    return;
  }
}

function mergeRests(sequence: Sequence, placedContent: Set<SequenceContent>): void {
  let index = 0;
  while (index < sequence.content.length - 1) {
    const current = sequence.content[index]!;
    const next = sequence.content[index + 1]!;
    // Preserve the pasted interval: merging across its boundaries would either
    // discard a pasted ID or select untouched destination rests.
    const sameOrigin = placedContent.has(current) === placedContent.has(next);
    if (sameOrigin && current.type === "event" && next.type === "event" && isRest(current) && isRest(next)) {
      const durations = decomposeDuration(sequenceContentBeats(current) + sequenceContentBeats(next));
      if (durations.length === 1) {
        current.duration = durations[0]!;
        sequence.content.splice(index + 1, 1);
        placedContent.delete(next);
        continue;
      }
    }
    index++;
  }
}
