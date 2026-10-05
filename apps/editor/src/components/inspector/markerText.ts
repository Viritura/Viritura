import type { GlobalMeasure, MarkerTextPlacement } from "@viritura/core";
import type { InheritedTextStyle } from "./TextContentEditor";

/** Navigation instructions engrave in italic; authored runs inherit that slant. */
export const MARKER_TEXT_INHERITED_STYLE: InheritedTextStyle = { fontStyle: "italic" };

/** Navigation markers that may own authored text. */
export type NavigationMarkerKind = "segno" | "coda" | "fine" | "jump";

interface MarkerDefinition {
  title: string;
  /** What the placement is relative to: a glyph symbol or a generated label. */
  noun: "symbol" | "label";
  placeholder: string;
  /** "To Coda" conventionally precedes its sign; other instructions follow. */
  defaultPlacement: MarkerTextPlacement;
}

export const MARKER_DEFINITIONS: Record<NavigationMarkerKind, MarkerDefinition> = {
  segno: { title: "Segno", noun: "symbol", placeholder: "e.g. from here", defaultPlacement: "after" },
  coda: { title: "Coda", noun: "symbol", placeholder: "e.g. To Coda", defaultPlacement: "before" },
  fine: { title: "Fine", noun: "label", placeholder: "e.g. last time only", defaultPlacement: "after" },
  jump: { title: "Jump", noun: "label", placeholder: "e.g. with repeats", defaultPlacement: "after" },
};

export function navigationMarkerKind(elementType: string | undefined): NavigationMarkerKind | null {
  return elementType === "segno" || elementType === "coda" || elementType === "fine" || elementType === "jump"
    ? elementType
    : null;
}

export function navigationMarker(measure: GlobalMeasure | undefined, kind: NavigationMarkerKind) {
  return measure?.[kind];
}
