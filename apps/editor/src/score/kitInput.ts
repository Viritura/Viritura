/**
 * Helpers for mapping note-input gestures (staff position clicks) onto MNX
 * kit components for unpitched-percussion parts.
 *
 * Percussion staves don't carry pitch — instead, each vertical position on
 * the staff is bound to a specific drum (via `Part.kit[id].staffPosition`).
 * When the user clicks a position on a percussion staff, we need to map the
 * click to the nearest kit component ID so that the resulting NoteEvent uses
 * `kitNotes: [{ kitComponent }]` instead of pitched `notes`.
 */

import type { Part, Pitch } from "@viritura/core";
import { diatonicPosition } from "@viritura/core";

/** True if this part is unpitched percussion (has a populated kit dict). */
export function isPercussionPart(part: Part | undefined): boolean {
  return !!part && !!part.kit && Object.keys(part.kit).length > 0;
}

/**
 * Find the kit-component ID whose MNX staffPosition is closest to the given
 * position. MNX staffPosition is measured in half-spaces from the center
 * line (0 = middle line, +N = above, -N = below).
 *
 * Returns null if the part has no kit.
 */
export function kitComponentFromStaffPosition(part: Part, mnxStaffPos: number): string | null {
  const kit = part.kit;
  if (!kit) return null;
  const entries = Object.entries(kit);
  if (entries.length === 0) return null;

  let bestId: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [id, comp] of entries) {
    const pos = comp.staffPosition ?? 0;
    const d = Math.abs(pos - mnxStaffPos);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * IDs of every kit component sharing the staff line *nearest* to `mnxStaffPos`,
 * in kit-dict (insertion) order. Length > 1 only when multiple instruments are
 * notated on the same line, distinguished by notehead (e.g. a snare and a
 * side-stick both on the middle line). Note entry uses this to cycle through
 * those instruments on repeated entry, with no mode or pre-selection — the
 * first element is what {@link kitComponentFromStaffPosition} places.
 */
export function kitComponentsAtStaffPosition(part: Part, mnxStaffPos: number): string[] {
  const kit = part.kit;
  if (!kit) return [];
  const entries = Object.entries(kit);
  if (entries.length === 0) return [];

  // The nearest line, then everything sitting exactly on it.
  let bestPos = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [, comp] of entries) {
    const pos = comp.staffPosition ?? 0;
    const d = Math.abs(pos - mnxStaffPos);
    if (d < bestDist) {
      bestDist = d;
      bestPos = pos;
    }
  }
  return entries.filter(([, c]) => (c.staffPosition ?? 0) === bestPos).map(([id]) => id);
}

/**
 * Convert pos-from-top (the unit returned by `staffPositionFromY`) to MNX
 * center-relative staffPosition for a 5-line staff. Top line = 0, middle = 4,
 * bottom = 8, so MNX center-relative = `4 - posFromTop`.
 */
export function mnxStaffPositionFromPosFromTop(posFromTop: number): number {
  return 4 - posFromTop;
}

/**
 * Diatonic position of B4 — the note sitting on a treble staff's middle line.
 * Percussion staff positions are measured from that same middle line, so this
 * is the origin that makes letter entry read as treble clef.
 */
const TREBLE_MIDDLE_LINE_DIATONIC = 34;

/**
 * MNX staff position for a written pitch, read as if the staff carried a
 * treble clef.
 *
 * Unpitched-percussion staves use a clef declared as `{sign:"G",
 * staffPosition:0}` so the percussion glyph renders centered, but that same
 * `staffPosition` is what the engine takes as the *pitch* reference — which
 * would put G4, not B4, on the middle line and shift every typed letter down a
 * third. Percussion has no real pitch, so letter entry resolves its line
 * through treble reading instead, matching both engraving convention and the
 * editor's own `defaultPitchForClef` (which already centers a percussion staff
 * on B4).
 *
 * B4 → 0 (middle line), G4 → -2, E4 → -4 (bottom line), F5 → +4 (top line).
 */
export function trebleStaffPositionForPitch(pitch: Pitch): number {
  return diatonicPosition(pitch) - TREBLE_MIDDLE_LINE_DIATONIC;
}

/**
 * Resolve the kit component a typed letter should enter on a percussion part,
 * reading the staff as treble. Returns null when the part has no kit.
 */
export function kitComponentForPitch(part: Part, pitch: Pitch): string | null {
  return kitComponentFromStaffPosition(part, trebleStaffPositionForPitch(pitch));
}

/**
 * Resolve the GM percussion MIDI number for a kit component on a part.
 * Used by preview-note playback to play the actual drum sample when
 * entering notes on a percussion staff.
 */
export function midiNumberForKitComponent(
  part: Part,
  globalSounds: Record<string, { midiNumber?: number }> | undefined,
  kitComponentId: string,
): number | null {
  const comp = part.kit?.[kitComponentId];
  if (!comp) return null;
  const soundId = comp.sound;
  if (!soundId) return null;
  const sound = globalSounds?.[soundId];
  if (!sound || typeof sound.midiNumber !== "number") return null;
  return sound.midiNumber;
}

/**
 * Inverse of {@link midiNumberForKitComponent}: the kit component a performed
 * MIDI number refers to.
 *
 * A drum pad transmits the GM percussion number of the drum it represents (38
 * for an acoustic snare), not a pitch. Reading that as a pitch would notate a
 * snare hit as D2 and then play whatever GM percussion sits on D2's chromatic
 * number, so percussion MIDI entry matches on the mapped number instead.
 *
 * Exact matches only — a pad that isn't in the kit returns null rather than
 * snapping to the nearest drum, since GM percussion numbering is categorical
 * and "nearest number" carries no musical meaning.
 */
export function kitComponentForMidiNumber(
  part: Part,
  globalSounds: Record<string, { midiNumber?: number }> | undefined,
  midiNumber: number,
): string | null {
  const kit = part.kit;
  if (!kit) return null;
  for (const id of Object.keys(kit)) {
    if (midiNumberForKitComponent(part, globalSounds, id) === midiNumber) return id;
  }
  return null;
}
