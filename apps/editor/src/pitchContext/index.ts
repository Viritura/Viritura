import { resolveActiveInstrument, type Score, type Transposition } from "@viritura/core";

/** The written-display interval at a musical position, not the part's initial interval. */
export function resolveDisplayTransposition(
  score: Score,
  partIndex: number,
  measureIndex = 0,
  position: readonly [number, number] = [0, 1],
  scoreIndex = 0,
): Transposition | undefined {
  const part = score.parts[partIndex];
  if (!part) return undefined;
  const { transposition } = resolveActiveInstrument(part, measureIndex, position);
  return score.scores?.[scoreIndex]?.useWritten || transposition?.prefersWrittenPitches ? transposition : undefined;
}

/** Circle-of-fifths spelling of the displayed key, including the active enharmonic flip. */
export function resolveDisplayKeyFifths(concertFifths: number, transposition: Transposition | undefined): number {
  if (!transposition) return concertFifths;
  const { halfSteps, staffDistance } = transposition.interval;
  let fifths = concertFifths + 7 * halfSteps - 12 * staffDistance;
  while (fifths > 7) fifths -= 12;
  while (fifths < -7) fifths += 12;
  const flipAt = transposition.keyFifthsFlipAt;
  if (flipAt !== undefined && Math.abs(fifths) > Math.abs(flipAt)) {
    fifths += fifths > 0 ? -12 : 12;
  }
  return fifths;
}
