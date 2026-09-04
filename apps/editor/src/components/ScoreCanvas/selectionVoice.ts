import type { Score } from "@viritura/core";

/** Resolve a model sequence index to its zero-based voice index on that staff. */
export function selectionVoiceIndex(score: Score | null, elementId: string | undefined): number | undefined {
  if (!score || !elementId) return undefined;
  const match = elementId.match(/^p(\d+)\/m(\d+)\/s(\d+)(?:\/|$)/);
  if (!match) return undefined;

  const partIndex = Number.parseInt(match[1]!, 10);
  const measureIndex = Number.parseInt(match[2]!, 10);
  const sequenceIndex = Number.parseInt(match[3]!, 10);
  const sequences = score.parts[partIndex]?.measures[measureIndex]?.sequences;
  const sequence = sequences?.[sequenceIndex];
  if (!sequences || !sequence) return undefined;

  const staff = sequence.staff ?? 1;
  return sequences.slice(0, sequenceIndex).filter((candidate) => (candidate.staff ?? 1) === staff).length;
}
