/**
 * Clef radial menu — items and resolver.
 */

import type { RadialMenuItem } from "@viritura/ui";
import type { Clef } from "@viritura/core";
import { CLEF_PALETTE_ITEMS } from "../components/palette/paletteItems";
import { ClefGlyph } from "../components/palette/GlyphRenderers";
import { keys } from "./types";

const CLEF_SEARCH: Record<string, string[]> = {
  treble: ["G", "violin", "soprano"],
  bass: ["F", "cello", "tuba"],
  alto: ["C", "viola"],
  tenor: ["C", "trombone"],
  percussion: ["drum", "unpitched", "perc"],
};

export const CLEF_ITEMS: RadialMenuItem[] = CLEF_PALETTE_ITEMS.map((p) => ({
  id: p.id,
  icon: (
    <ClefGlyph
      sign={p.clef.sign}
      staffPosition={p.clef.staffPosition}
      octave={p.clef.octave}
      glyphOverride={p.clef.glyph}
    />
  ),
  label: p.shortLabel,
  ...keys(CLEF_SEARCH, p.id),
}));

export function resolveClef(id: string): Clef | null {
  const item = CLEF_PALETTE_ITEMS.find((p) => p.id === id);
  if (!item) return null;
  const clef: Clef = { sign: item.clef.sign, staffPosition: item.clef.staffPosition };
  if (item.clef.octave !== undefined) clef.octave = item.clef.octave;
  if (item.clef.glyph !== undefined) clef.glyph = item.clef.glyph;
  return clef;
}
