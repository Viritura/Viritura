/**
 * Compact transposition badge for the New Score wizard's player rows.
 *
 * The catalog stores a part's transposition as `halfSteps` using the
 * concert→written convention where **positive = the instrument sounds lower
 * than written** (e.g. B♭ clarinet = +2, English Horn / Horn in F = +7, bass
 * clarinet = +14; piccolo sounds higher = −12). The badge shows the
 * instrument's transposition "key" — the pitch that sounds when a C is written.
 */

/** Pitch-class index (0 = C) → display name, using flats (standard for keys). */
const PITCH_CLASS_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"] as const;

/**
 * Format a compact transposition label from a `halfSteps` interval.
 *
 * - `0` → empty string (non-transposing).
 * - Whole-octave displacement (no key change) → `"−1 oct"` / `"+1 oct"`.
 * - Otherwise → the instrument's key (the pitch sounding for a written C),
 *   computed as `(−halfSteps) mod 12`. This is derived rather than looked up so
 *   it stays correct for every interval instead of a hand-maintained table.
 */
export function formatTranspositionLabel(halfSteps: number): string {
  if (halfSteps === 0) return "";
  // Pure octave displacement: same pitch class, just a register shift.
  if (halfSteps % 12 === 0) {
    const oct = halfSteps / 12;
    return oct > 0 ? `−${oct} oct` : `+${-oct} oct`;
  }
  // Key = the pitch that sounds when C is written. Positive halfSteps sounds
  // lower, so the sounding pitch class is (−halfSteps) mod 12.
  const pc = (((-halfSteps % 12) + 12) % 12) as number;
  return PITCH_CLASS_NAMES[pc] ?? `${halfSteps > 0 ? "−" : "+"}${Math.abs(halfSteps)} ST`;
}
