import type { Pitch, Clef, KeySignature } from "@viritura/core";
import type { Step } from "@viritura/core";
import { clefReferencePitch, clefLineFromBottom, pitchFromDiatonic } from "@viritura/core";

/**
 * Sharp order on the circle of fifths.
 * fifths = 1 → F#, fifths = 2 → F#, C#, etc.
 */
const SHARP_ORDER: readonly Step[] = ["F", "C", "G", "D", "A", "E", "B"];

/**
 * Flat order on the circle of fifths.
 * fifths = -1 → Bb, fifths = -2 → Bb, Eb, etc.
 */
const FLAT_ORDER: readonly Step[] = ["B", "E", "A", "D", "G", "C", "F"];

/**
 * Get the default accidental for a given step based on a key signature.
 * Returns 1 for sharp, -1 for flat, or undefined for natural.
 */
export function keySignatureAlter(key: KeySignature, step: Step): number | undefined {
  if (key.fifths > 0) {
    const sharps = SHARP_ORDER.slice(0, key.fifths);
    if (sharps.includes(step)) return 1;
  } else if (key.fifths < 0) {
    const flats = FLAT_ORDER.slice(0, -key.fifths);
    if (flats.includes(step)) return -1;
  }
  return undefined;
}

/**
 * Convert a canvas Y coordinate to a staff position (in half-spaces from
 * the top staff line). This matches the Rust engine's `pos_from_top` coordinate.
 *
 * @param canvasY - The Y coordinate on the canvas (pixels).
 * @param staffTop - The Y coordinate of the top staff line (pixels).
 * @param spatium - The staff space size (distance between adjacent staff lines, pixels).
 * @returns The staff position snapped to the nearest half-space.
 */
export function staffPositionFromY(canvasY: number, staffTop: number, spatium: number): number {
  return Math.round((canvasY - staffTop) / (spatium / 2));
}

/**
 * Convert a staff position (half-spaces from top line) to a diatonic position,
 * using the active clef. This is the exact inverse of the Rust engine's
 * pitch→position mapping in measure.rs.
 *
 * Rust forward: pos_from_top = (4 - clef_line) * 2 - (diatonic - clef_ref)
 * Inverse:      diatonic = clef_ref + (4 - clef_line) * 2 - pos_from_top
 */
export function diatonicFromStaffPosition(staffPosition: number, clef: Clef): number {
  const clefRef = clefReferencePitch(clef);
  const clefLine = clefLineFromBottom(clef);
  return clefRef + (4 - clefLine) * 2 - staffPosition;
}

/**
 * Convert a canvas Y coordinate to a musical Pitch.
 *
 * Steps:
 * 1. Snap Y to nearest staff position (half-space from top line).
 * 2. Map staff position → diatonic position using clef.
 * 3. Apply key signature defaults (sharps/flats).
 * 4. Apply optional accidental override from toolbar.
 *
 * @param canvasY - The Y coordinate on the canvas.
 * @param staffTop - The Y coordinate of the top staff line.
 * @param spatium - The staff space size (pixels).
 * @param clef - The active clef at this position.
 * @param key - The active key signature.
 * @param accidentalOverride - Optional accidental from the toolbar
 *   (1 = sharp, -1 = flat, 0 = natural, 2 = double-sharp, -2 = double-flat).
 * @returns The computed Pitch { step, octave, alter? }.
 */
export function pitchFromPosition(
  canvasY: number,
  staffTop: number,
  spatium: number,
  clef: Clef,
  key: KeySignature,
  accidentalOverride?: number,
): Pitch {
  const staffPos = staffPositionFromY(canvasY, staffTop, spatium);
  const diatonic = diatonicFromStaffPosition(staffPos, clef);
  const pitch = pitchFromDiatonic(diatonic);

  // Determine alteration: toolbar override takes priority, then key sig default
  let alter: number | undefined;
  if (accidentalOverride !== undefined) {
    alter = accidentalOverride === 0 ? undefined : accidentalOverride;
  } else {
    alter = keySignatureAlter(key, pitch.step);
  }

  if (alter !== undefined) {
    return { ...pitch, alter };
  }
  return pitch;
}
