/**
 * Dynamics radial menu — items, expression builder, and canvas preview.
 */

import React from "react";
import { Tooltip, type RadialMenuItem } from "@viritura/ui";
import { DYNAMIC_ITEMS as PALETTE_DYNAMIC_ITEMS } from "../components/palette/paletteItems";

import {
  parseDynamicExpression,
  isCompoundExpression,
  dynamicToGlyph,
  tokensToGlyphString,
  tokensToLabel,
  parseMixedExpression,
  isMixedExpression,
  mixedTokensToLabel,
} from "./dynamicExpressionParser";
import styles from "./dynamicPreview.module.css";

// ═══════════════════════════════════════════
// Items & search
// ═══════════════════════════════════════════

// Search keys map for dynamic items.
// Each ID maps to additional search aliases. The ID itself is always an
// exact-match key (added below), so e.g. typing "pp" exact-matches
// Pianissimo without also matching Pianississimo ("ppp").
const DYNAMIC_SEARCH: Record<string, string[]> = {
  ppp: ["pianississimo", "very quiet"],
  pp: ["pianissimo", "quiet"],
  p: ["piano", "soft"],
  mp: ["mezzo piano", "medium soft"],
  mf: ["mezzo forte", "medium loud"],
  f: ["forte", "loud"],
  ff: ["fortissimo"],
  fff: ["fortississimo", "very loud"],
  fp: ["forte piano"],
  pf: ["piano forte"],
  sfz: ["sforzando", "accent"],
  rfz: ["rinforzando"],
  n: ["niente", "nothing", "silent"],
};

export const DYNAMIC_ITEMS: RadialMenuItem[] = PALETTE_DYNAMIC_ITEMS.map((p) => {
  const baseKeys = DYNAMIC_SEARCH[p.id] ?? [];
  return {
    id: p.id,
    icon: p.label, // SMuFL glyph string
    label: p.title.replace(/\s*\(.*\)/, ""), // strip parenthetical
    // Include the dynamic ID itself as an exact search key (e.g. "pp")
    // so it exact-matches before prefix-matching longer variants
    searchKeys: [p.id, ...baseKeys],
  };
});

// ═══════════════════════════════════════════
// Expression builder
// ═══════════════════════════════════════════

/**
 * Render a dynamic expression preview for the radial menu center hub.
 * Uses native font rendering — the parent .expressionPreview container
 * already sets font-family: Bravura, font-size, and flexbox centering.
 * Bravura's built-in advance widths and kerning handle glyph spacing,
 * matching the score canvas output.
 *
 * Returns null if the input should be handled by normal filter matching.
 */
export function renderDynamicExpression(input: string): React.ReactNode | null {
  // Mode 1: mixed expression with text (e.g. "p lovingly", "mf dolce")
  if (isMixedExpression(input)) {
    const tokens = parseMixedExpression(input);
    if (!tokens) return null;
    const label = mixedTokensToLabel(tokens);
    return (
      <Tooltip content={label}>
        <span className={styles.mixedExpression}>
          {tokens.map((t, i) => {
            if (t.type === "dynamic") return <span key={i}>{dynamicToGlyph(t.value)}</span>;
            if (t.type === "text") {
              return (
                <span key={i} className={styles.textToken}>
                  {t.value}
                </span>
              );
            }
            return <span key={i}>{t.type === "crescendo" ? "\uE53E" : "\uE53F"}</span>;
          })}
        </span>
      </Tooltip>
    );
  }

  // Mode 2: compound expression with hairpins
  if (isCompoundExpression(input)) {
    const tokens = parseDynamicExpression(input);
    if (!tokens) return null;
    return (
      <Tooltip content={tokensToLabel(tokens)}>
        <span>{tokensToGlyphString(tokens)}</span>
      </Tooltip>
    );
  }

  // Mode 3: any valid dynamic letters string (custom or known preset)
  const tokens = parseDynamicExpression(input);
  if (tokens && tokens.length === 1 && tokens[0]?.type === "dynamic") {
    return (
      <Tooltip content={input}>
        <span>{dynamicToGlyph(input)}</span>
      </Tooltip>
    );
  }

  // Mode 4: pure text expression (e.g. "dolce", "rit.") — no dynamic tokens
  if (input.trim()) {
    const mixedTokens = parseMixedExpression(input);
    if (mixedTokens && mixedTokens.every((t) => t.type === "text")) {
      const label = mixedTokensToLabel(mixedTokens);
      return (
        <Tooltip content={label}>
          <span className={styles.textToken}>{label}</span>
        </Tooltip>
      );
    }
  }

  return null;
}

/** Re-export parser utilities for use in App.tsx expression handler */
export { parseDynamicExpression };
