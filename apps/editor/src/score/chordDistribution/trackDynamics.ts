/**
 * Dynamics routing for chord distribution.
 *
 * A dynamic belongs to the music, not to the staff that happened to carry it.
 * Exploding a chord across four staves has to mark all four `ff`, or the
 * exploded lines play at different volumes than the chord did. Reducing is the
 * mirror image: every source staff's dynamics collapse onto the one
 * destination, and duplicates have to be dropped or the reduction stacks four
 * identical hairpins on top of each other.
 *
 * Where sources disagree at the same moment, the topmost staff wins — the same
 * rule `eventNotation` uses for articulations, and what an engraver expects
 * from a reduction.
 */

import type { CapturedDynamic, ClipboardTrack } from "../../clipboard/ClipboardFragment";

function positionKey(captured: CapturedDynamic): string {
  const at = captured.offset ?? captured.dynamic.position.fraction;
  return `${captured.measureOffset}:${at[0]}/${at[1]}:${captured.dynamic.type}`;
}

/** Collapse every source track's dynamics into one topmost-wins timeline. */
export function mergedDynamics(
  sources: readonly ClipboardTrack[],
  fragmentDynamics: readonly CapturedDynamic[] | undefined,
): CapturedDynamic[] {
  const merged = new Map<string, CapturedDynamic>();
  for (const captured of [...sources.flatMap((track) => track.dynamics ?? []), ...(fragmentDynamics ?? [])]) {
    const key = positionKey(captured);
    if (!merged.has(key)) merged.set(key, captured);
  }
  return [...merged.values()];
}

/**
 * Re-anchor merged dynamics onto a destination track. Paste re-stamps the real
 * staff from the destination, but the annotation origin is resolved from these
 * coordinates first, so they must agree with the track that carries them.
 */
export function dynamicsForTarget(
  merged: readonly CapturedDynamic[],
  targetIndex: number,
): CapturedDynamic[] | undefined {
  if (merged.length === 0) return undefined;
  return merged.map((captured) => ({
    ...structuredClone(captured),
    partOffset: 0,
    staffOffset: targetIndex,
    dynamic: { ...structuredClone(captured.dynamic), staff: targetIndex + 1 },
  }));
}
