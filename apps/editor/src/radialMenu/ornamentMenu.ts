/**
 * Ornament radial menu — items, resolver, and selection type.
 */

import type { RadialMenuItem } from "@viritura/ui";
import type { OrnamentType, FermataSymbol } from "@viritura/core";
import { ORNAMENT_PALETTE_ITEMS } from "../components/palette/paletteItems";
import { keys } from "./types";

/** Resolved ornament selection — either a named ornament, trill, or fermata. */
export type OrnamentSelection =
  | { kind: "ornament"; ornament: OrnamentType }
  | { kind: "trill"; accidental?: -1 | 0 | 1 }
  | { kind: "fermata"; shape: FermataSymbol };

const ORNAMENT_SEARCH: Record<string, string[]> = {
  trill: ["tr", "shake"],
  turn: ["gruppetto"],
  invertedTurn: ["reversed turn"],
  mordent: ["lower mordent", "pralltriller"],
  invertedMordent: ["upper mordent", "praller"],
  trillMordent: ["trill+mordent"],
  delayedTurn: ["nachschlag"],
  schleifer: ["slide", "glissando"],
};

export const ORNAMENT_ITEMS: RadialMenuItem[] = ORNAMENT_PALETTE_ITEMS.map((p) => ({
  id: p.id,
  icon: p.glyph,
  label: p.label,
  ...keys(ORNAMENT_SEARCH, p.id),
}));

export function resolveOrnament(id: string): OrnamentSelection | null {
  const item = ORNAMENT_PALETTE_ITEMS.find((p) => p.id === id);
  if (!item) return null;
  if (item.kind === "trill") return { kind: "trill" };
  if (item.ornament) return { kind: "ornament", ornament: item.ornament };
  return null;
}
