import type { CSSProperties } from "react";
import { DEFAULT_TEXT_STYLES, type ExpressionPlacement, type TextRunStyle, type TextStyles } from "@viritura/core";

/**
 * The weight and slant a score element gives unstyled runs (for example
 * italic jump instructions). Runs only record departures from it, so toggling
 * italic off on italic-by-default text must write an explicit `normal`.
 */
export type InheritedTextStyle = Pick<TextRunStyle, "weight" | "fontStyle">;

function isBold(weight: TextRunStyle["weight"]): boolean {
  return weight === "bold" || (typeof weight === "number" && weight >= 600);
}

function isItalic(fontStyle: TextRunStyle["fontStyle"]): boolean {
  return fontStyle === "italic" || fontStyle === "oblique";
}

/** The style a run actually renders with once the element's defaults apply. */
export function effectiveStyle(active: TextRunStyle, inherited: InheritedTextStyle): TextRunStyle {
  return {
    ...active,
    weight: active.weight ?? inherited.weight,
    fontStyle: active.fontStyle ?? inherited.fontStyle,
  };
}

/** Flip bold or italic, leaving the run unstyled whenever it matches the default. */
export function toggledStyle(
  command: "bold" | "italic",
  active: TextRunStyle,
  inherited: InheritedTextStyle,
): Partial<TextRunStyle> {
  const effective = effectiveStyle(active, inherited);
  if (command === "bold") {
    const bold = !isBold(effective.weight);
    return { weight: bold === isBold(inherited.weight) ? undefined : bold ? "bold" : "normal" };
  }
  const italic = !isItalic(effective.fontStyle);
  return { fontStyle: italic === isItalic(inherited.fontStyle) ? undefined : italic ? "italic" : "normal" };
}

/** Preview the element's defaults in the editing field itself. */
export function inheritedFieldStyle(inherited: InheritedTextStyle): CSSProperties {
  return { fontWeight: inherited.weight, fontStyle: inherited.fontStyle };
}

/** Weight and slant of a document text style role, after per-score overrides. */
export function inheritedStyleForRole(role: string, overrides: TextStyles | undefined): InheritedTextStyle {
  const override = overrides?.[role];
  const bold = override?.bold ?? DEFAULT_TEXT_STYLES[role]?.bold ?? false;
  const italic = override?.italic ?? DEFAULT_TEXT_STYLES[role]?.italic ?? false;
  return { weight: bold ? "bold" : undefined, fontStyle: italic ? "italic" : undefined };
}

/** Expressions engrave upright above the staff and italic otherwise. */
export function inheritedStyleForExpression(placement: ExpressionPlacement | undefined): InheritedTextStyle {
  return placement === "above" ? {} : { fontStyle: "italic" };
}
