/**
 * Repeat / tremolo radial menu — repeat barlines, markers, and tremolos.
 */

import React from "react";
import type { RadialMenuItem } from "@viritura/ui";
import { SMUFL } from "../components/palette/smuflGlyphs";
import { BarlineGlyph } from "../components/palette/GlyphRenderers";

export const REPEAT_ITEMS: RadialMenuItem[] = [
  {
    id: "repeat-start",
    icon: React.createElement(BarlineGlyph, { glyph: SMUFL.repeatLeft }),
    label: "Repeat Start",
    searchKeys: ["begin", "open"],
  },
  {
    id: "repeat-end",
    icon: React.createElement(BarlineGlyph, { glyph: SMUFL.repeatRight }),
    label: "Repeat End",
    searchKeys: ["close", "final"],
  },
  {
    id: "repeat-both",
    icon: React.createElement(BarlineGlyph, { glyph: SMUFL.repeatRightLeft }),
    label: "Repeat Both",
    searchKeys: ["double", "end start"],
  },
  { id: "segno", icon: SMUFL.segno, label: "Segno", searchKeys: ["sign", "dal"] },
  { id: "coda", icon: SMUFL.coda, label: "Coda", searchKeys: ["tail"] },
  { id: "fine", label: "Fine", searchKeys: ["end"] },
  { id: "tremolo-1", icon: SMUFL.tremoloSingle1, label: "Tremolo 1", searchKeys: ["single", "one slash"] },
  { id: "tremolo-2", icon: SMUFL.tremoloSingle2, label: "Tremolo 2", searchKeys: ["two slash"] },
  { id: "tremolo-3", icon: SMUFL.tremoloSingle3, label: "Tremolo 3", searchKeys: ["three slash"] },
];

export type RepeatSelection =
  | { kind: "repeat-start" }
  | { kind: "repeat-end" }
  | { kind: "repeat-both" }
  | { kind: "segno" }
  | { kind: "coda" }
  | { kind: "fine" }
  | { kind: "tremolo"; marks: 1 | 2 | 3 };

export function resolveRepeat(id: string): RepeatSelection | null {
  switch (id) {
    case "repeat-start":
      return { kind: "repeat-start" };
    case "repeat-end":
      return { kind: "repeat-end" };
    case "repeat-both":
      return { kind: "repeat-both" };
    case "segno":
      return { kind: "segno" };
    case "coda":
      return { kind: "coda" };
    case "fine":
      return { kind: "fine" };
    case "tremolo-1":
      return { kind: "tremolo", marks: 1 };
    case "tremolo-2":
      return { kind: "tremolo", marks: 2 };
    case "tremolo-3":
      return { kind: "tremolo", marks: 3 };
    default:
      return null;
  }
}
