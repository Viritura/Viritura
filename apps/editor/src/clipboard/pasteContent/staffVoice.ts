import type { Sequence } from "@viritura/core";

export function sequenceForStaffVoice(sequences: Sequence[], staff: number, voice: number): Sequence {
  if (!Number.isInteger(staff) || staff < 1 || !Number.isInteger(voice) || voice < 0) {
    throw new Error("The clipboard destination staff and voice must be valid.");
  }
  const matching = sequences.filter((sequence) => (sequence.staff ?? 1) === staff);
  while (matching.length <= voice) {
    const sequence: Sequence = { content: [], staff };
    sequences.push(sequence);
    matching.push(sequence);
  }
  return matching[voice]!;
}
