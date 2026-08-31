/**
 * Build a small preview MNX document ("slice") from drum-kit editor rows.
 *
 * Rather than hand-drawing staves and glyphs, the editor renders this slice
 * through the real engraving engine (via `<ScoreView>`). The slice is a single
 * unpitched-percussion part with one measure containing one quarter-note hit
 * per kit component, laid out left-to-right in the same order the editor shows
 * its rows. The engine then draws the percussion clef, staff, ledger lines, and
 * each notehead at its correct staff position with its correct notehead shape.
 */

import type { KitComponentEdit } from "./types";

/** Components ordered the way they appear on the staff (top of staff first),
 *  which is also the left-to-right column order in the rendered slice. */
export function orderedSliceComponents(rows: readonly KitComponentEdit[]): KitComponentEdit[] {
  return [...rows].sort((a, b) => b.staffPosition - a.staffPosition);
}

/**
 * Page width for the slice. An explicit pageWidth makes the engine apply full
 * page margins (the staff's usable area shrinks to `pw - ~275`), so the width
 * must be `naturalContentWidth + margins` or the measure over-compresses (notes
 * collapse to ~10px gaps — the "busted" preset look). Measured: at sp=11 the
 * per-note gap is ~38.5px and the fixed margin+prefix overhead is ~345px, so
 * `345 + 40·n` yields natural-ish ~42px gaps (40 > 38.5 = mild stretch, never
 * compression). The big left margin is cropped away separately (see
 * DrumKitStaff's marginLeft), and a wide kit scrolls horizontally.
 */
export function slicePageWidth(componentCount: number): number {
  return Math.max(385, 345 + componentCount * 40);
}

/** The staff-space size (px) the slice is laid out at. */
export const SLICE_SPATIUM = 11;

/**
 * Build the preview MNX document for the given rows. When there are no
 * components, the measure carries a whole rest so the staff still renders
 * (and stays clickable for adding the first drum).
 */
export function buildKitSliceMnx(rows: readonly KitComponentEdit[]): object {
  const ordered = orderedSliceComponents(rows);

  const kit: Record<string, object> = {};
  const sounds: Record<string, object> = {};
  for (const c of ordered) {
    const soundId = `snd-${c.id}`;
    const comp: Record<string, unknown> = { name: c.name, sound: soundId, staffPosition: c.staffPosition };
    if (c.notehead !== "normal") comp._x = { viritura: { notehead: c.notehead } };
    kit[c.id] = comp;
    sounds[soundId] = { midiNumber: c.midiKey, name: c.name };
  }

  const content =
    ordered.length > 0
      ? ordered.map((c) => ({
          type: "event",
          // Explicit id = component id, so the engine tags this event's bbox
          // `…/{id}` (and its notehead `…/{id}/n0`). The overlay looks up the
          // selected component's note by id — never by positional x-index.
          id: c.id,
          duration: { base: "quarter" },
          kitNotes: [{ kitComponent: c.id }],
        }))
      : [{ type: "event", duration: { base: "whole" }, rest: {} }];

  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, barline: { type: "regular" } }], sounds },
    parts: [
      {
        id: "p1",
        name: "Kit",
        kit,
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: 0, glyph: "unpitchedPercussionClef1" } }],
            sequences: [{ content }],
          },
        ],
      },
    ],
  };
}
