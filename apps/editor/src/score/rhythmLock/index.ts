import type { Duration, Score, Tuplet } from "@viritura/core";
import { isRest } from "@viritura/core";
import { durationToBeats, sequenceContentBeats } from "../../commands/noteCommands";
import { createTuplet } from "../../commands/tupletCommands";
import type { RhythmSource } from "../../store/noteInputStore";

const EPSILON = 1e-6;

export interface RhythmSlot {
  duration: Duration;
  isRest: boolean;
  realBeats: number;
  tuplet?: {
    container: Tuplet;
    startBeat: number;
    eventIndex: number;
  };
}

export type RhythmSlotResult = { kind: "slot"; slot: RhythmSlot } | { kind: "not-at-boundary" } | { kind: "exhausted" };

function sequenceForSource(score: Score, source: RhythmSource, measureIndex: number) {
  const sequences = score.parts[source.partIndex]?.measures[measureIndex]?.sequences;
  if (!sequences) return undefined;
  const hasStaffNumbers = sequences.some((sequence) => sequence.staff !== undefined);
  if (!hasStaffNumbers) return source.staffIndex === 0 ? sequences[source.voice - 1] : undefined;
  return sequences.filter((sequence) => sequence.staff === source.staffIndex + 1)[source.voice - 1];
}

function exact(value: number, target: number): boolean {
  return Math.abs(value - target) < EPSILON;
}

function findTupletSlot(tuplet: Tuplet, startBeat: number, beatPosition: number): RhythmSlotResult {
  const innerBeats = tuplet.inner.multiple * durationToBeats(tuplet.inner.duration);
  const outerBeats = tuplet.outer.multiple * durationToBeats(tuplet.outer.duration);
  const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
  let position = startBeat;
  for (let index = 0; index < tuplet.content.length; index++) {
    const item = tuplet.content[index]!;
    const realBeats = sequenceContentBeats(item) * scale;
    if (item.type === "event" && exact(position, beatPosition)) {
      return {
        kind: "slot",
        slot: {
          duration: item.duration,
          isRest: isRest(item),
          realBeats,
          tuplet: { container: tuplet, startBeat, eventIndex: index },
        },
      };
    }
    if (beatPosition > position + EPSILON && beatPosition < position + realBeats - EPSILON) {
      return { kind: "not-at-boundary" };
    }
    position += realBeats;
  }
  return { kind: "not-at-boundary" };
}

/** Resolve the selected source's metrical event at an exact score position. */
export function resolveRhythmSlot(
  score: Score,
  source: RhythmSource,
  measureIndex: number,
  beatPosition: number,
): RhythmSlotResult {
  const sequence = sequenceForSource(score, source, measureIndex);
  if (!sequence) return { kind: "exhausted" };

  let position = 0;
  for (const item of sequence.content) {
    const realBeats = sequenceContentBeats(item);
    if (item.type === "event" && exact(position, beatPosition)) {
      return { kind: "slot", slot: { duration: item.duration, isRest: isRest(item), realBeats } };
    }
    if (item.type === "tuplet" && beatPosition >= position - EPSILON && beatPosition < position + realBeats - EPSILON) {
      return findTupletSlot(item, position, beatPosition);
    }
    if (beatPosition > position + EPSILON && beatPosition < position + realBeats - EPSILON) {
      return { kind: "not-at-boundary" };
    }
    position += realBeats;
  }
  return { kind: "exhausted" };
}

export function rhythmSourceOptions(score: Score): { value: string; label: string; source: RhythmSource }[] {
  const options: { value: string; label: string; source: RhythmSource }[] = [];
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const part = score.parts[partIndex]!;
    const sequences = part.measures.flatMap((measure) => measure.sequences);
    if (sequences.length === 0) continue;
    const hasStaffNumbers = sequences.some((sequence) => sequence.staff !== undefined);
    const staffNumbers = hasStaffNumbers
      ? [...new Set(sequences.map((sequence) => sequence.staff ?? 1))].sort((a, b) => a - b)
      : [1];
    for (const staffNumber of staffNumbers) {
      const voices = hasStaffNumbers
        ? Math.max(
            ...part.measures.map(
              (measure) => measure.sequences.filter((sequence) => sequence.staff === staffNumber).length,
            ),
          )
        : Math.max(...part.measures.map((measure) => measure.sequences.length));
      for (let voice = 1; voice <= Math.min(4, voices); voice++) {
        const source: RhythmSource = { partIndex, staffIndex: staffNumber - 1, voice: voice as RhythmSource["voice"] };
        options.push({
          value: `${partIndex}:${staffNumber - 1}:${voice}`,
          label: `${part.name ?? `Part ${partIndex + 1}`} — Staff ${staffNumber}, Voice ${voice}`,
          source,
        });
      }
    }
  }
  return options;
}

/** Create a matching empty tuplet on a target timeline before its first locked slot is entered. */
export function mirrorTupletAt(
  score: Score,
  target: { partIndex: number; voice: number },
  measureIndex: number,
  tuplet: Tuplet,
  startBeat: number,
): void {
  const sequence = score.parts[target.partIndex]?.measures[measureIndex]?.sequences[target.voice];
  if (!sequence) return;

  let position = 0;
  for (const item of sequence.content) {
    if (item.type === "tuplet" && exact(position, startBeat)) return;
    position += sequenceContentBeats(item);
  }

  createTuplet(score, {
    measureIndex,
    partIndex: target.partIndex,
    voice: target.voice,
    beatPosition: startBeat,
    tupletNumber: tuplet.inner.multiple,
    outerMultiple: tuplet.outer.multiple,
    baseDuration: tuplet.inner.duration,
  });
  const created = score.parts[target.partIndex]?.measures[measureIndex]?.sequences[target.voice]?.content.find(
    (item, index, content) =>
      item.type === "tuplet" &&
      exact(
        content.slice(0, index).reduce((sum, prior) => sum + sequenceContentBeats(prior), 0),
        startBeat,
      ),
  );
  if (!created || created.type !== "tuplet") return;
  for (let index = 0; index < created.content.length; index++) {
    const sourceEvent = tuplet.content[index];
    if (sourceEvent?.type !== "event") continue;
    created.content[index] = { type: "event", duration: { ...sourceEvent.duration }, rest: {} };
  }
}
