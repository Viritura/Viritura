/**
 * Time signature radial menu — items and resolver.
 */

import type { RadialMenuItem } from "@viritura/ui";
import type { TimeSignature } from "@viritura/core";
import { SMUFL } from "../components/palette/smuflGlyphs";
import { TIME_SIG_PALETTE_ITEMS } from "../components/palette/paletteItems";
import { TimeSigGlyph } from "../components/palette/GlyphRenderers";
import { parseTimeSignatureInput } from "../components/palette/timeSignatureInput";
import { keys } from "./types";

const TIME_SIG_SEARCH: Record<string, string[]> = {
  "4/4": ["common", "four four"],
  "3/4": ["waltz", "three four"],
  "2/4": ["march", "two four"],
  "2/2": ["cut", "alla breve", "two two"],
  "3/8": ["three eight"],
  "6/8": ["compound", "six eight"],
  "9/8": ["nine eight"],
  "12/8": ["twelve eight"],
  common: ["4/4", "C"],
  cut: ["2/2", "alla breve"],
  custom: ["other", "custom", "numerator", "denominator"],
};

export const TIME_SIGNATURE_ITEMS: RadialMenuItem[] = [
  ...TIME_SIG_PALETTE_ITEMS.map((p) => ({
    id: p.id,
    icon:
      p.time.display === "common" ? (
        SMUFL.timeSigCommon
      ) : p.time.display === "cut" ? (
        SMUFL.timeSigCut
      ) : (
        <TimeSigGlyph count={p.time.count} unit={p.time.unit} />
      ),
    label: p.label,
    ...keys(TIME_SIG_SEARCH, p.id),
  })),
  {
    id: "custom",
    icon: "n/d",
    label: "Custom…",
    expressionSeed: "5/8",
    ...keys(TIME_SIG_SEARCH, "custom"),
  },
];

export function renderTimeSignatureExpression(input: string): React.ReactNode | null {
  const time = parseTimeSignatureInput(input);
  return time ? (
    <span>
      {time.count}/{time.unit}
    </span>
  ) : null;
}

export function resolveTimeSignature(id: string): TimeSignature | null {
  const item = TIME_SIG_PALETTE_ITEMS.find((p) => p.id === id);
  return item
    ? { count: item.time.count, unit: item.time.unit, ...(item.time.display ? { display: item.time.display } : {}) }
    : null;
}
