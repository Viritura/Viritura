/**
 * NotationInspector metadata: section types, lookup, color swatches.
 *
 * Lives in a sibling file (not NotationInspector.tsx) so this module can be
 * imported by both NotationInspector and its sub-component files without
 * tripping the react-refresh/only-export-components rule.
 */
import type { SelectableElementType } from "../../score/elementTypes";

export const COLOR_SWATCHES: readonly string[] = ["#000000", "#ff0000", "#00aa00", "#0066ff", "#ff8800", "#8000ff"];

/** Inspector section names that can be auto-scrolled to. */
export type InspectorSection = "measure" | "event" | "note" | "tie" | "slur" | "markings" | "directions" | "layout";

const SECTION_BY_TYPE: Partial<Record<SelectableElementType, InspectorSection>> = {
  event: "event",
  rest: "event",
  note: "event",
  articulation: "markings",
  fermata: "markings",
  ornament: "markings",
  trill: "markings",
  fingering: "markings",
  arpeggio: "markings",
  tremolo: "markings",
  breath: "markings",
  dynamic: "directions",
  hairpin: "directions",
  pedal: "directions",
  ottava: "directions",
  expression: "directions",
  tempo: "directions",
  rehearsal: "directions",
  jump: "directions",
  volta: "directions",
  caesura: "directions",
  "chord-symbol": "directions",
  tie: "tie",
  slur: "slur",
  barline: "measure",
  clef: "measure",
  "key-signature": "measure",
  "time-signature": "measure",
  "measure-number": "measure",
  "measure-repeat": "measure",
  beam: "layout",
  tuplet: "layout",
  "grace-note": "layout",
};

/** Map a SelectableElementType to the inspector section it belongs to. */
export function sectionForElementType(type: SelectableElementType): InspectorSection | null {
  return SECTION_BY_TYPE[type] ?? null;
}
