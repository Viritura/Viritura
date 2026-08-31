import type { Pitch } from "@viritura/core";
import { diatonicPosition } from "@viritura/core";
import type { Step, Octave } from "@viritura/core";
import type { Clef } from "@viritura/core";

const STEP_INDEX: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

/**
 * Choose the octave for `newStep` that places it at or above `refPitch`.
 * Used for chord building: Shift+letter always stacks upward.
 * - C4 + Shift+E → E4 (third above)
 * - C4 + Shift+B → B4 (seventh above)
 * - C4 + Shift+C → C5 (octave above, since unison is a duplicate)
 *
 * Clamps result to valid octave range [0, 9].
 */
export function aboveOctave(newStep: Step, refPitch: Pitch): Octave {
  const refPos = diatonicPosition(refPitch);
  const newStepIdx = STEP_INDEX[newStep]!;

  // Try same octave first
  const sameOctPos = refPitch.octave * 7 + newStepIdx;
  if (sameOctPos > refPos) {
    return Math.max(0, Math.min(9, refPitch.octave)) as Octave;
  }
  // Otherwise go one octave up
  return Math.max(0, Math.min(9, refPitch.octave + 1)) as Octave;
}

/**
 * Choose the octave for `newStep` that is closest (diatonically) to `prevPitch`.
 * Uses the "nearest within a 4th" rule matching standard practice:
 * - B4 → C ⇒ C5 (up a half step)
 * - A5 → G ⇒ G5 (down a step)
 * - C4 → G ⇒ G3 (down a 4th, not up a 5th)
 *
 * Clamps result to valid octave range [0, 9].
 */
export function closestOctave(newStep: Step, prevPitch: Pitch): Octave {
  const prevPos = diatonicPosition(prevPitch);
  const newStepIdx = STEP_INDEX[newStep]!;

  // Try the same octave as prevPitch, then ±1, and pick the closest
  const candidates = [prevPitch.octave - 1, prevPitch.octave, prevPitch.octave + 1];
  let bestOctave = prevPitch.octave;
  let bestDist = Infinity;

  for (const oct of candidates) {
    if (oct < 0 || oct > 9) continue;
    const pos = oct * 7 + newStepIdx;
    const dist = Math.abs(pos - prevPos);
    if (dist < bestDist) {
      bestDist = dist;
      bestOctave = oct as Octave;
    }
  }

  return Math.max(0, Math.min(9, bestOctave)) as Octave;
}

/** Default starting octave when no previous pitch exists. */
export const DEFAULT_OCTAVE: Octave = 5;

/**
 * Return a sensible center-of-staff default pitch for a given clef.
 * Used when switching staves so octave memory resets to the new staff's range.
 *
 * Accounts for:
 * - Clef sign (G/F/C) → determines base pitch
 * - Clef octave transposition (e.g., treble 8vb → shifts down 1 octave)
 * - Optional ottava shift at cursor (e.g., under 8va → shifts up 1 octave)
 *
 * Base pitches (center of staff, no offsets):
 * - G (treble): B4
 * - F (bass):   D3
 * - C (alto):   B3
 */
export function defaultPitchForClef(clef: Clef, ottavaShift = 0): Pitch {
  const offset = (clef.octave ?? 0) + ottavaShift;
  const clamp = (oct: number) => Math.max(0, Math.min(9, oct)) as Octave;
  switch (clef.sign) {
    case "F":
      return { step: "D", octave: clamp(3 + offset) };
    case "C":
      return { step: "B", octave: clamp(3 + offset) };
    case "G":
    default:
      return { step: "B", octave: clamp(4 + offset) };
  }
}
