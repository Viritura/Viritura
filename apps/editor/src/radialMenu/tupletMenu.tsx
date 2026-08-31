/**
 * Tuplet radial menu — items, expression parser, and preview.
 *
 * Common tuplets are shown as pie wedges. Custom ratios can be typed
 * in the search field (e.g. "5:3", "7:4") and submitted with Enter.
 */

import React, { type CSSProperties } from "react";
import type { RadialMenuItem } from "@viritura/ui";
import { parseTupletRatio as parseCommandTupletRatio } from "../commands/tupletCommands";

const TUPLET_NUM_STYLE: CSSProperties = { fontSize: "1.1em", fontWeight: "var(--type-heading-weight)" };
const TUPLET_PREVIEW_STYLE: CSSProperties = {
  fontSize: "1.4em",
  fontWeight: "var(--type-heading-weight)",
  fontFamily: "var(--font-mono, monospace)",
};

// ═══════════════════════════════════════════
// Standard tuplet items
// ═══════════════════════════════════════════

interface TupletDef {
  id: string;
  num: number;
  outer: number;
  label: string;
  searchKeys: string[];
}

const TUPLET_DEFS: TupletDef[] = [
  { id: "2", num: 2, outer: 3, label: "Duplet (2:3)", searchKeys: ["duplet", "two three"] },
  { id: "3", num: 3, outer: 2, label: "Triplet (3:2)", searchKeys: ["triplet", "three two"] },
  { id: "4", num: 4, outer: 3, label: "Quadruplet (4:3)", searchKeys: ["quadruplet", "four three"] },
  { id: "5", num: 5, outer: 4, label: "Quintuplet (5:4)", searchKeys: ["quintuplet", "five four"] },
  { id: "6", num: 6, outer: 4, label: "Sextuplet (6:4)", searchKeys: ["sextuplet", "six four"] },
  { id: "7", num: 7, outer: 4, label: "Septuplet (7:4)", searchKeys: ["septuplet", "seven four"] },
  { id: "8", num: 8, outer: 6, label: "Octuplet (8:6)", searchKeys: ["octuplet", "eight six"] },
  { id: "9", num: 9, outer: 8, label: "Nonuplet (9:8)", searchKeys: ["nonuplet", "nine eight"] },
];

export const TUPLET_ITEMS: RadialMenuItem[] = TUPLET_DEFS.map((d) => ({
  id: d.id,
  icon: (
    <span style={TUPLET_NUM_STYLE}>
      {d.num}:{d.outer}
    </span>
  ),
  label: d.label,
  searchKeys: [d.id, `${d.num}:${d.outer}`, ...d.searchKeys],
}));

// ═══════════════════════════════════════════
// Expression — custom ratio input (e.g. "5:3")
// ═══════════════════════════════════════════

/**
 * Parse a typed ratio string (e.g. "5:3") into { num, outer }.
 * Returns null if the input is not a valid ratio.
 */
export function parseTupletRatio(input: string): { num: number; outer: number } | null {
  const ratio = parseCommandTupletRatio(input);
  return ratio ? { num: ratio.inner, outer: ratio.outer } : null;
}

/**
 * Render expression preview for the radial menu center hub.
 * Shows a preview when the user types a custom ratio like "5:3".
 */
export function renderTupletExpression(input: string): React.ReactNode | null {
  const ratio = parseTupletRatio(input);
  if (!ratio) return null;
  return (
    <span style={TUPLET_PREVIEW_STYLE}>
      {ratio.num}:{ratio.outer}
    </span>
  );
}

/**
 * Resolve a tuplet item ID (from wedge selection) to { num, outer }.
 */
export function resolveTuplet(id: string): { num: number; outer: number } | null {
  const def = TUPLET_DEFS.find((d) => d.id === id);
  return def ? { num: def.num, outer: def.outer } : null;
}
