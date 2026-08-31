/**
 * Menu registry — maps RadialMenuCategory to items, titles, and options.
 *
 * Each category's data lives in its own module (clefMenu, dynamicMenu, etc.).
 * This file is the single entry point for category → config lookups.
 */

import React from "react";
import type { RadialMenuItem } from "@viritura/ui";
import type { RadialMenuCategory } from "./types";

import { CLEF_ITEMS } from "./clefMenu";
import { BARLINE_ITEMS, renderAddMeasuresExpression } from "./barlineMenu";
import { TIME_SIGNATURE_ITEMS, renderTimeSignatureExpression } from "./timeSignatureMenu";
import { KEY_SIGNATURE_ITEMS } from "./keySignatureMenu";
import { DYNAMIC_ITEMS, renderDynamicExpression } from "./dynamicMenu";
import { ORNAMENT_ITEMS } from "./ornamentMenu";
import { TUPLET_ITEMS, renderTupletExpression } from "./tupletMenu";
import { BREATH_FERMATA_ITEMS } from "./breathFermataMenu";
import { FINGERING_ITEMS } from "./fingeringMenu";
import { REPEAT_ITEMS } from "./repeatMenu";
import { ARTICULATION_ITEMS as ARTIC_MENU_ITEMS } from "./articulationMenu";

export function getMenuItems(category: RadialMenuCategory): RadialMenuItem[] {
  switch (category) {
    case "clef":
      return CLEF_ITEMS;
    case "barline":
      return BARLINE_ITEMS;
    case "time-signature":
      return TIME_SIGNATURE_ITEMS;
    case "key-signature":
      return KEY_SIGNATURE_ITEMS;
    case "dynamic":
      return DYNAMIC_ITEMS;
    case "ornament":
      return ORNAMENT_ITEMS;
    case "tuplet":
      return TUPLET_ITEMS;
    case "breath-fermata":
      return BREATH_FERMATA_ITEMS;
    case "fingering":
      return FINGERING_ITEMS;
    case "repeat":
      return REPEAT_ITEMS;
    case "articulation":
      return ARTIC_MENU_ITEMS;
  }
}

export function getMenuTitle(category: RadialMenuCategory): string {
  switch (category) {
    case "clef":
      return "Clef";
    case "barline":
      return "Bars";
    case "time-signature":
      return "Time";
    case "key-signature":
      return "Key";
    case "dynamic":
      return "Dyn.";
    case "ornament":
      return "Orn.";
    case "tuplet":
      return "Tuplet";
    case "breath-fermata":
      return "Breath";
    case "fingering":
      return "Finger";
    case "repeat":
      return "Repeat";
    case "articulation":
      return "Artic.";
  }
}

/** Max items per page — key sigs use 9 so sharps/flats split evenly. */
export function getMenuMaxItems(category: RadialMenuCategory): number {
  switch (category) {
    case "key-signature":
      return 9;
    case "repeat":
      return 9;
    case "articulation":
      return 9;
    default:
      return 8;
  }
}

/** Override for the first page only (fewer items = high-priority subset). */
export function getMenuFirstPageMaxItems(category: RadialMenuCategory): number | undefined {
  switch (category) {
    case "clef":
      return 5;
    default:
      return undefined;
  }
}

/** Start alignment at 12 o'clock.
 *  - "center": first item centered (default for most categories)
 *  - "start": first item edge at 12 (dynamics: soft right, loud left) */
export function getMenuStartAlign(category: RadialMenuCategory): "center" | "start" {
  switch (category) {
    case "dynamic":
      return "start";
    default:
      return "center";
  }
}

/** Expression builder renderer — only dynamics supports compound expressions. */
export function getMenuRenderExpression(
  category: RadialMenuCategory,
): ((input: string) => React.ReactNode | null) | undefined {
  switch (category) {
    case "dynamic":
      return renderDynamicExpression;
    case "tuplet":
      return renderTupletExpression;
    case "barline":
      return renderAddMeasuresExpression;
    case "time-signature":
      return renderTimeSignatureExpression;
    default:
      return undefined;
  }
}

export function getMenuSearchPlaceholder(category: RadialMenuCategory): string {
  switch (category) {
    case "barline":
      return "Filter or add measures (+4)…";
    case "tuplet":
      return "Filter or enter ratio (5:3)…";
    case "dynamic":
      return "Filter or build expression (p<f)…";
    case "time-signature":
      return "Filter or enter time (5/8)…";
    default:
      return "Filter…";
  }
}
