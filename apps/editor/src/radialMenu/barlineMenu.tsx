/**
 * Barline radial menu — items, resolver, and the "+n add measures" expression.
 */

import { type CSSProperties, type ReactNode } from "react";
import type { RadialMenuItem } from "@viritura/ui";
import type { Barline } from "@viritura/core";
import { BARLINE_PALETTE_ITEMS } from "../components/palette/paletteItems";
import { BarlineGlyph } from "../components/palette/GlyphRenderers";
import { keys } from "./types";

const BARLINE_SEARCH: Record<string, string[]> = {
  regular: ["single", "normal", "thin"],
  double: ["thin-thin"],
  final: ["end", "thin-thick"],
  heavy: ["thick"],
  dashed: ["dotted"],
};

export const BARLINE_ITEMS: RadialMenuItem[] = BARLINE_PALETTE_ITEMS.map((p) => ({
  id: p.id,
  icon: <BarlineGlyph glyph={p.glyph} />,
  label: p.label,
  ...keys(BARLINE_SEARCH, p.id),
}));

export function resolveBarline(id: string): Barline | null {
  const item = BARLINE_PALETTE_ITEMS.find((p) => p.id === id);
  return item ? { type: item.barline.type } : null;
}

// ═══════════════════════════════════════════
// Expression — add measures (Dorico-style "+n")
// ═══════════════════════════════════════════

const ADD_MEASURES_RE = /^\+\s*(\d{1,3})$/;

const ADD_MEASURES_PREVIEW_STYLE: CSSProperties = {
  fontSize: "1.2em",
  fontWeight: "var(--type-heading-weight)",
};

/**
 * Parse a typed "+n" string (e.g. "+4") into a measure count. Returns null
 * when the input is not a valid add-measures expression.
 */
export function parseAddMeasures(input: string): number | null {
  const m = ADD_MEASURES_RE.exec(input.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (n < 1 || n > 999) return null;
  return n;
}

/**
 * Render the center-hub preview when the user types "+n" to append measures.
 */
export function renderAddMeasuresExpression(input: string): ReactNode | null {
  const count = parseAddMeasures(input);
  if (count === null) return null;
  return (
    <span style={ADD_MEASURES_PREVIEW_STYLE}>
      +{count} {count === 1 ? "bar" : "bars"}
    </span>
  );
}
