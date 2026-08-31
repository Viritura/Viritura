/**
 * Single source of truth for "what colour represents this instrument
 * family in our UI".
 *
 * Consumers:
 *   - `PlayView` — spatial-audio spheres (one colour per part)
 *   - `RollView` — Synthesia-style note rectangles (one colour per part)
 *
 * Family is inferred from the part name with a regex sieve. This is the
 * same approach we used inline in PlayView; lifted out so the roll view
 * stays in sync. If we later promote family to a first-class field on
 * `Part` (or `Part._x.viritura.family`), this is the only place that
 * needs to learn how to read it.
 */

/** Family → colour mapping (regex tested against part name). */
const FAMILY_COLOR_MAP: readonly (readonly [RegExp, string])[] = [
  [/violin|viola|cello|contrabass(?!oon)|double bass|bass\b.*sec|harp/i, "#4a90d9"],
  [/flute|piccolo|oboe|clarinet|bassoon|english horn|contrabassoon/i, "#10b981"],
  [/trumpet|trombone|horn|tuba|brass/i, "#e8b339"],
  [/timpani|percussion|glockenspiel|xylophone|marimba|vibraphone|tubular|cymbal|drum/i, "#8b5cf6"],
  [/piano|celesta|organ|keyboard|harpsichord/i, "#ec4899"],
  [/choir|soprano|alto|tenor|baritone|bass voice|vocal|^bass$/i, "#06b6d4"],
];

const DEFAULT_FAMILY_COLOR = "#888";

/** Resolve a colour for a part given its display name. */
export function partFamilyColor(name: string | null | undefined): string {
  if (!name) return DEFAULT_FAMILY_COLOR;
  for (const [pattern, color] of FAMILY_COLOR_MAP) {
    if (pattern.test(name)) return color;
  }
  return DEFAULT_FAMILY_COLOR;
}
