/**
 * Breath mark / fermata radial menu — items, resolver, and selection type.
 */

import type { RadialMenuItem } from "@viritura/ui";
import type { BreathMarkSymbol, FermataSymbol } from "@viritura/core";
import { SMUFL } from "../components/palette/smuflGlyphs";
import { keys } from "./types";

/** Resolved breath/fermata selection. */
export type BreathFermataSelection =
  | { kind: "breath"; symbol: BreathMarkSymbol }
  | { kind: "fermata"; shape: FermataSymbol }
  | { kind: "caesura" };

interface BreathFermataItem {
  id: string;
  label: string;
  glyph: string;
  resolved: BreathFermataSelection;
}

const ITEMS: BreathFermataItem[] = [
  {
    id: "breath-comma",
    label: "Breath (comma)",
    glyph: SMUFL.breathMarkComma,
    resolved: { kind: "breath", symbol: "comma" },
  },
  {
    id: "breath-tick",
    label: "Breath (tick)",
    glyph: SMUFL.breathMarkTick,
    resolved: { kind: "breath", symbol: "tick" },
  },
  {
    id: "breath-upbow",
    label: "Breath (upbow)",
    glyph: SMUFL.breathMarkUpbow,
    resolved: { kind: "breath", symbol: "upbow" },
  },
  {
    id: "breath-salzedo",
    label: "Breath (Salzedo)",
    glyph: SMUFL.breathMarkSalzedo,
    resolved: { kind: "breath", symbol: "salzedo" },
  },
  { id: "caesura", label: "Caesura", glyph: SMUFL.caesura, resolved: { kind: "caesura" } },
  {
    id: "fermata-normal",
    label: "Fermata (normal)",
    glyph: SMUFL.fermataAbove,
    resolved: { kind: "fermata", shape: "normal" },
  },
  {
    id: "fermata-double-angled",
    label: "Fermata (very short)",
    glyph: SMUFL.fermataVeryShortAbove,
    resolved: { kind: "fermata", shape: "doubleAngled" },
  },
  {
    id: "fermata-angled",
    label: "Fermata (short)",
    glyph: SMUFL.fermataShortAbove,
    resolved: { kind: "fermata", shape: "angled" },
  },
  {
    id: "fermata-square",
    label: "Fermata (long)",
    glyph: SMUFL.fermataLongAbove,
    resolved: { kind: "fermata", shape: "square" },
  },
  {
    id: "fermata-double-square",
    label: "Fermata (very long)",
    glyph: SMUFL.fermataVeryLongAbove,
    resolved: { kind: "fermata", shape: "doubleSquare" },
  },
  {
    id: "fermata-double-dot",
    label: "Fermata (long, Henze)",
    glyph: SMUFL.fermataLongHenzeAbove,
    resolved: { kind: "fermata", shape: "doubleDot" },
  },
];

const SEARCH: Record<string, string[]> = {
  "breath-comma": ["comma", "breath", "pause"],
  "breath-tick": ["tick", "breath", "v"],
  caesura: ["railroad", "tram", "tracks", "pause"],
  "fermata-normal": ["hold", "bird's eye", "corona"],
  "fermata-double-angled": ["very short hold"],
  "fermata-angled": ["short hold", "angled", "breve"],
  "fermata-square": ["long hold", "square", "box", "lunga"],
  "fermata-double-square": ["very long hold"],
  "fermata-double-dot": ["long Henze", "double dot"],
};

function toRadial(items: BreathFermataItem[]): RadialMenuItem[] {
  return items.map((item) => ({
    id: item.id,
    icon: item.glyph,
    label: item.label,
    ...keys(SEARCH, item.id),
  }));
}

export const BREATH_FERMATA_ITEMS: RadialMenuItem[] = toRadial(ITEMS);

export function resolveBreathFermata(id: string): BreathFermataSelection | null {
  const item = ITEMS.find((i) => i.id === id);
  return item?.resolved ?? null;
}
