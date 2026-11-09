import {
  remapScoreLyricExtenderTargets,
  type NoteEvent,
  type Score,
  type Sequence,
  type SequenceContent,
  type Space,
  type TimeSignature,
} from "@viritura/core";
import { generateEventId, getEffectiveTimeSignature, sequenceContentBeats } from "../../commands/noteCommands";
import {
  addWholeFractions,
  compareWholeFractions,
  contentWholeFraction,
  exactRestDurations,
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
  targetRemap: Map<string, string> = new Map(),
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
  const fragments = planPasteFragments(score, measureIndex, startBeat, content, destinationPrefix, targetRemap);
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
      clearEventsInMeasure(sequence, index, clearBudget, getEffectiveTimeSignature(score, fragment.measureIndex));
    }
    sequence.content.splice(index, 0, ...fragment.content);
    for (const item of fragment.content) placedContent.add(item);
  }
  remapScoreLyricExtenderTargets(score, targetRemap);
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

function clearEventsInMeasure(
  sequence: Sequence,
  index: number,
  clearBudget: Space["duration"],
  time: TimeSignature,
): void {
  const restStart = addWholeFractions(contentDuration(sequence.content.slice(0, index)), clearBudget);
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
    const rests: NoteEvent[] = exactRestDurations(remainder, restStart, time).map((duration) => ({
      type: "event",
      id: generateEventId(),
      duration,
      rest: {},
    }));
    sequence.content.splice(index, 1, ...rests);
    return;
  }
}
