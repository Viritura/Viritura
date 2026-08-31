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

import type { Part } from "@viritura/core";

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
