/** A single line decoration; runs may carry several at once. */
export type TextDecoration = "underline" | "overline" | "strikethrough";

/** Inline formatting for text content, independent of its score-level owner. */
export interface TextRunStyle {
  font?: "serif" | "sans-serif" | "monospace";
  /**
   * Relative size, as a multiple of the owning text role's resolved size —
   * the CSS `em` equivalent, never an absolute point size. Score text scales
   * with the staff, so an absolute unit here would not survive a staff-size
   * change. Distinct from a role's own size, which counts staff spaces.
   */
  size?: number;
  weight?: "normal" | "bold" | number;
  fontStyle?: "normal" | "italic" | "oblique";
  /**
   * Line decorations applied together. A set, not a single value: MusicXML
   * carries `underline`, `overline` and `line-through` independently, and
   * Finale carries underline and strikeout independently.
   */
  decorations?: TextDecoration[];
  enclosure?: "box" | "circle";
  color?: string;
}

/** A run of Unicode text with optional inline formatting. */
export interface TextRun {
  text: string;
  style?: TextRunStyle;
}

/** A run of SMuFL glyph names, kept distinct from Unicode text. */
export interface GlyphRun {
  glyphs: string[];
  style?: TextRunStyle;
  smuflStyle?: TextRunStyle;
}

/** One sequential text or SMuFL-glyph chunk. */
export type TextContentChunk = TextRun | GlyphRun;

/**
 * Inline score text as ordered chunks.
 *
 * Always an array, so consumers never branch on representation. Legacy
 * documents that stored a bare string are widened to a single text run when
 * they are read; nothing downstream of the parser sees a plain string.
 */
export type TextContent = TextContentChunk[];

/** Get the human-readable text portion, excluding notation glyphs. */
export function plainTextContent(content: TextContent): string {
  return content.map((chunk) => ("text" in chunk ? chunk.text : "")).join("");
}

/** Wrap plain text as content, for callers holding a bare string. */
export function textContentFromPlain(text: string): TextContent {
  return [{ text }];
}
