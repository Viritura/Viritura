import { isRest, type NoteEvent, type Score, type Sequence, type SequenceContent } from "@viritura/core";
import { beatPositionToFraction } from "../../app/timedAnnotationPosition";
import { decomposeDuration, generateEventId, sequenceContentBeats } from "../../commands/noteCommands";
import { ensureSequencePosition, splitSequenceAtBeat } from "../clipboardTrackPlacement";
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
  const startBeat = startSequence.content
    .slice(0, eventIndex)
    .reduce((sum, item) => sum + sequenceContentBeats(item), 0);
  const fragments = planPasteFragments(score, measureIndex, startBeat, content);
  const placedContent = new Set<SequenceContent>();

  for (const fragment of fragments) {
    ensurePasteMeasure(score, fragment.measureIndex);
    const measure = part.measures[fragment.measureIndex]!;
    const sequence = sequenceForStaffVoice(measure.sequences, staff, voice);
    ensureSequencePosition(sequence.content, fragment.beat);
    splitSequenceAtBeat(sequence.content, fragment.beat);
    const index = eventIndexAtBeat(sequence.content, fragment.beat);
    if (fragment.beats > 0) {
      delete sequence.fullMeasure;
      clearEventsInMeasure(sequence, index, fragment.beats);
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

function eventIndexAtBeat(content: SequenceContent[], beat: number): number {
  let onset = 0;
  for (const [index, item] of content.entries()) {
    if (onset >= beat - 1e-9) return index;
    onset += sequenceContentBeats(item);
  }
  return content.length;
}

function clearEventsInMeasure(sequence: Sequence, index: number, clearBudget: number): void {
  let remaining = clearBudget;
  while (index < sequence.content.length && remaining > 1e-9) {
    const item = sequence.content[index]!;
    const beats = sequenceContentBeats(item);
    if (beats <= remaining + 1e-9) {
      sequence.content.splice(index, 1);
      remaining -= beats;
    } else if (item.type === "space") {
      sequence.content.splice(index, 1, { type: "space", duration: beatPositionToFraction(beats - remaining) });
      return;
    } else {
      const rests: NoteEvent[] = decomposeDuration(beats - remaining).map((duration) => ({
        type: "event",
        id: generateEventId(),
        duration,
        rest: {},
      }));
      sequence.content.splice(index, 1, ...rests);
      return;
    }
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
