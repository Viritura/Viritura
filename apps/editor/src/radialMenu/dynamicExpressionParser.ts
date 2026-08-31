/**
 * Dynamic expression parser for compound dynamic strings.
 * Supports standard input like "p<f", "mf>pp", "fp<ff>p".
 *
 * Tokens:
 *   - Dynamic markings: any combination of the dynamic letters p, m, f, r, z, n, s
 *   - Hairpins: < (crescendo), > (diminuendo)
 *
 * If a dynamic token matches a pre-composed SMuFL glyph (e.g. "sfz" → U+E539),
 * that glyph is used. Otherwise the token is rendered by joining individual
 * SMuFL letter glyphs (p=U+E520, m=U+E521, f=U+E522, r=U+E523, s=U+E524,
 * z=U+E525, n=U+E526). This follows the SMuFL spec implementation notes:
 * "Scoring applications may choose to draw dynamics either using multiple
 * glyphs or using the pre-composed glyph."
 */

type DynamicToken = { type: "dynamic"; value: string };
type HairpinToken = { type: "crescendo" } | { type: "diminuendo" };
type TextToken = { type: "text"; value: string };
export type ExpressionToken = DynamicToken | HairpinToken;
export type MixedExpressionToken = DynamicToken | HairpinToken | TextToken;

/** Valid dynamic letters — the characters that can appear in a dynamic token. */
const DYNAMIC_LETTERS = new Set(["p", "m", "f", "r", "z", "n", "s"]);

/**
 * Parse a dynamic expression string into tokens.
 * Returns null if the string contains invalid characters or is empty.
 *
 * Dynamic tokens are greedily consumed: any contiguous run of dynamic
 * letters (p, m, f, r, z, n, s) becomes a single dynamic token. Hairpin
 * operators (< >) separate tokens.
 *
 * Examples:
 *   "p<f"     → [dynamic("p"), crescendo, dynamic("f")]
 *   "mf>pp"   → [dynamic("mf"), diminuendo, dynamic("pp")]
 *   "fp<ff>p" → [dynamic("fp"), crescendo, dynamic("ff"), diminuendo, dynamic("p")]
 *   "pmf"     → [dynamic("pmf")]  (custom — will use individual letter glyphs)
 *   "<"       → [crescendo]
 *   "p<"      → [dynamic("p"), crescendo]  (partial — valid while typing)
 */
export function parseDynamicExpression(input: string): ExpressionToken[] | null {
  if (!input) return null;
  const normalized = input.replace(/\s+/g, "");
  if (!normalized) return null;
  const tokens: ExpressionToken[] = [];
  let pos = 0;
  while (pos < normalized.length) {
    if (normalized[pos] === "<") {
      tokens.push({ type: "crescendo" });
      pos++;
      continue;
    }
    if (normalized[pos] === ">") {
      tokens.push({ type: "diminuendo" });
      pos++;
      continue;
    }
    // Greedily consume a run of dynamic letters
    if (DYNAMIC_LETTERS.has(normalized[pos]!)) {
      let end = pos + 1;
      while (end < normalized.length && DYNAMIC_LETTERS.has(normalized[end]!)) {
        end++;
      }
      tokens.push({ type: "dynamic", value: normalized.slice(pos, end) });
      pos = end;
      continue;
    }
    return null; // invalid character
  }
  return tokens.length > 0 ? tokens : null;
}

/**
 * Check if an input string looks like a compound dynamic expression.
 * Returns true if it contains hairpin characters (< or >) and parses successfully.
 */
export function isCompoundExpression(input: string): boolean {
  if (!input) return false;
  // Must contain at least one hairpin to be considered compound
  if (!input.includes("<") && !input.includes(">")) return false;
  return parseDynamicExpression(input) !== null;
}

/**
 * Check if an input is a valid custom dynamic (letters only, no hairpins)
 * that doesn't match any known preset dynamic ID.
 */
export function isCustomDynamic(input: string): boolean {
  if (!input || input.length === 0) return false;
  // Must be all dynamic letters
  for (const ch of input) {
    if (!DYNAMIC_LETTERS.has(ch)) return false;
  }
  // Not a known preset
  return !PRECOMPOSED_GLYPH_MAP[input];
}

// ═══════════════════════════════════════════
// Glyph mapping
// ═══════════════════════════════════════════

/** SMuFL individual dynamic letter glyphs (dynamicPiano, dynamicMezzo, etc.) */
const LETTER_GLYPH_MAP: Record<string, string> = {
  p: "\uE520", // dynamicPiano
  m: "\uE521", // dynamicMezzo
  f: "\uE522", // dynamicForte
  r: "\uE523", // dynamicRinforzando
  s: "\uE524", // dynamicSforzando
  z: "\uE525", // dynamicZ
  n: "\uE526", // dynamicNiente
};

/** Pre-composed SMuFL dynamics glyphs (ligatures). */
const PRECOMPOSED_GLYPH_MAP: Record<string, string> = {
  pppppp: "\uE527",
  ppppp: "\uE528",
  pppp: "\uE529",
  ppp: "\uE52A",
  pp: "\uE52B",
  p: "\uE520",
  mp: "\uE52C",
  mf: "\uE52D",
  pf: "\uE52E",
  f: "\uE522",
  ff: "\uE52F",
  fff: "\uE530",
  ffff: "\uE531",
  fffff: "\uE532",
  ffffff: "\uE533",
  fp: "\uE534",
  fz: "\uE535",
  sf: "\uE536",
  sfp: "\uE537",
  sfpp: "\uE538",
  sfz: "\uE539",
  sfzp: "\uE53A",
  sffz: "\uE53B",
  rf: "\uE53C",
  rfz: "\uE53D",
  n: "\uE526",
};

// ═══════════════════════════════════════════
// Advance widths & kerning (mirrors Rust smufl.rs exactly)
// ═══════════════════════════════════════════

/** Advance width of individual dynamic letter glyphs in staff spaces (Bravura metadata). */
const LETTER_WIDTH: Record<string, number> = {
  p: 1.46,
  m: 1.748,
  f: 1.456,
  r: 1.108,
  s: 0.916,
  z: 0.976,
  n: 1.232,
};

/** Kerning pairs derived from pre-composed vs summed letter widths. */
const KERN_PAIRS: Record<string, number> = {
  ff: -0.476,
  fz: -0.444,
  fp: -0.44,
  rf: -0.064,
  mf: -0.016,
};

/** Pre-composed glyph advance widths in staff spaces (Bravura metadata). */
const PRECOMPOSED_WIDTH: Record<string, number> = {
  pppppp: 8.496,
  ppppp: 7.104,
  pppp: 5.668,
  ppp: 4.288,
  pp: 2.908,
  p: 1.46,
  mp: 3.304,
  mf: 3.188,
  pf: 3.08,
  f: 1.456,
  ff: 2.436,
  fff: 3.324,
  ffff: 4.28,
  fffff: 5.24,
  ffffff: 6.2,
  fp: 2.476,
  fz: 1.988,
  sf: 2.416,
  sfp: 3.384,
  sfpp: 4.792,
  sfz: 2.928,
  sfzp: 4.3,
  sffz: 3.856,
  rf: 2.5,
  rfz: 2.976,
  n: 1.232,
};

/** Positioned glyph for canvas rendering. */
export interface PositionedGlyph {
  /** Glyph string (single codepoint character). */
  glyph: string;
  /** X offset in staff spaces from the left edge. */
  x: number;
}

/**
 * Measure a dynamic value and return positioned glyphs + total width.
 * Uses the same advance width and kerning logic as the Rust engine.
 * Works for both pre-composed and custom letter dynamics.
 */
export function measureDynamicGlyphs(value: string): {
  glyphs: PositionedGlyph[];
  width: number;
} {
  const precomposed = PRECOMPOSED_GLYPH_MAP[value];
  if (precomposed) {
    return {
      glyphs: [{ glyph: precomposed, x: 0 }],
      width: PRECOMPOSED_WIDTH[value] ?? 2.0,
    };
  }
  // Build from individual letter glyphs with kerning
  const glyphs: PositionedGlyph[] = [];
  let x = 0;
  const chars = value.split("");
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const letterGlyph = LETTER_GLYPH_MAP[ch];
    if (!letterGlyph) continue;
    glyphs.push({ glyph: letterGlyph, x });
    const advance = LETTER_WIDTH[ch] ?? 1.0;
    const kern = i + 1 < chars.length ? (KERN_PAIRS[ch + chars[i + 1]] ?? 0) : 0;
    x += advance + kern;
  }
  return { glyphs, width: x };
}

/**
 * Measure a full expression (dynamics + hairpins) and return positioned glyphs + total width.
 * Hairpin glyphs (U+E53E crescendo, U+E53F diminuendo) are used for preview only.
 */
export function measureExpressionGlyphs(tokens: ExpressionToken[]): {
  glyphs: PositionedGlyph[];
  width: number;
} {
  const allGlyphs: PositionedGlyph[] = [];
  let x = 0;
  const GAP = 0.3; // space between tokens in staff spaces
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    if (token.type === "dynamic") {
      const measured = measureDynamicGlyphs(token.value);
      for (const g of measured.glyphs) {
        allGlyphs.push({ glyph: g.glyph, x: x + g.x });
      }
      x += measured.width;
    } else {
      const hairpinGlyph = token.type === "crescendo" ? "\uE53E" : "\uE53F";
      allGlyphs.push({ glyph: hairpinGlyph, x });
      x += 2.0; // hairpin glyph advance width in staff spaces
    }
    if (t < tokens.length - 1) x += GAP;
  }
  return { glyphs: allGlyphs, width: x };
}

/**
 * Convert a dynamic value string to a Bravura glyph string.
 * Uses the pre-composed glyph if available (proper ligature/kerning),
 * otherwise builds from individual letter glyphs per SMuFL spec.
 */
export function dynamicToGlyph(value: string): string {
  // Try pre-composed glyph first
  const precomposed = PRECOMPOSED_GLYPH_MAP[value];
  if (precomposed) return precomposed;
  // Build from individual letter glyphs
  return value
    .split("")
    .map((ch) => LETTER_GLYPH_MAP[ch] ?? ch)
    .join("");
}

/**
 * Convert parsed tokens into a Bravura glyph string for preview rendering.
 * Dynamic tokens use pre-composed glyphs where available, otherwise individual
 * letter glyphs. Hairpins use hairpin glyphs (for preview only — actual
 * rendering uses DrawLine primitives per SMuFL implementation notes).
 */
export function tokensToGlyphString(tokens: ExpressionToken[]): string {
  return tokens
    .map((t) => {
      if (t.type === "dynamic") return dynamicToGlyph(t.value);
      if (t.type === "crescendo") return "\uE53E"; // preview only
      return "\uE53F"; // preview only
    })
    .join("");
}

/**
 * Convert parsed tokens into a human-readable label string.
 * e.g., "p < f" or "mf > pp"
 */
export function tokensToLabel(tokens: ExpressionToken[]): string {
  return tokens
    .map((t) => {
      if (t.type === "dynamic") return t.value;
      if (t.type === "crescendo") return "<";
      return ">";
    })
    .join(" ");
}

// ═══════════════════════════════════════════
// Mixed expression text (e.g. "p lovingly", "mf dolce")
// ═══════════════════════════════════════════

/**
 * Check if a word consists entirely of dynamic letters.
 */
function isDynamicWord(word: string): boolean {
  if (!word) return false;
  for (const ch of word) {
    if (!DYNAMIC_LETTERS.has(ch)) return false;
  }
  return true;
}

/**
 * Parse a mixed expression string like "p lovingly" or "mf dolce".
 * Splits by spaces; words made entirely of dynamic letters become dynamic tokens,
 * everything else becomes text tokens. Consecutive text words are merged.
 * Returns null if the input is empty or only whitespace.
 */
export function parseMixedExpression(input: string): MixedExpressionToken[] | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/);
  const tokens: MixedExpressionToken[] = [];

  for (const word of words) {
    if (isDynamicWord(word)) {
      tokens.push({ type: "dynamic", value: word });
    } else {
      // Merge consecutive text tokens
      const last = tokens[tokens.length - 1];
      if (last && last.type === "text") {
        last.value += " " + word;
      } else {
        tokens.push({ type: "text", value: word });
      }
    }
  }
  return tokens.length > 0 ? tokens : null;
}

/**
 * Check if a string is a mixed expression (contains both dynamic and non-dynamic words).
 * Returns true if the input has at least one space and parses into a mix of token types.
 */
export function isMixedExpression(input: string): boolean {
  if (!input || !input.includes(" ")) return false;
  const tokens = parseMixedExpression(input);
  if (!tokens || tokens.length < 2) return false;
  const hasDynamic = tokens.some((t) => t.type === "dynamic");
  const hasText = tokens.some((t) => t.type === "text");
  return hasDynamic && hasText;
}

/** Positioned element for canvas rendering of mixed expressions. */
export interface PositionedElement {
  type: "glyph" | "text";
  /** Glyph string (SMuFL codepoint) or text string */
  content: string;
  /** X offset in staff spaces from the left edge */
  x: number;
}

/**
 * Measure a mixed expression and return positioned elements + total width.
 * Dynamic tokens use SMuFL glyphs; text tokens are measured using an approximate
 * italic serif character width (relative to staff space units).
 */
export function measureMixedExpression(tokens: MixedExpressionToken[]): {
  elements: PositionedElement[];
  width: number;
} {
  const elements: PositionedElement[] = [];
  let x = 0;
  const GAP = 0.3; // space between tokens in staff spaces
  const TEXT_CHAR_WIDTH = 0.5; // approximate italic serif char width in staff spaces

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    if (token.type === "dynamic") {
      const measured = measureDynamicGlyphs(token.value);
      for (const g of measured.glyphs) {
        elements.push({ type: "glyph", content: g.glyph, x: x + g.x });
      }
      x += measured.width;
    } else if (token.type === "text") {
      elements.push({ type: "text", content: token.value, x });
      x += token.value.length * TEXT_CHAR_WIDTH;
    } else {
      // Hairpin glyph
      const hairpinGlyph = token.type === "crescendo" ? "\uE53E" : "\uE53F";
      elements.push({ type: "glyph", content: hairpinGlyph, x });
      x += 2.0;
    }
    if (t < tokens.length - 1) x += GAP;
  }
  return { elements, width: x };
}

/**
 * Convert mixed tokens into a human-readable label string.
 */
export function mixedTokensToLabel(tokens: MixedExpressionToken[]): string {
  return tokens
    .map((t) => {
      if (t.type === "dynamic") return t.value;
      if (t.type === "text") return t.value;
      if (t.type === "crescendo") return "<";
      return ">";
    })
    .join(" ");
}
