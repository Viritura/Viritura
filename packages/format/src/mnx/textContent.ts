/**
 * Shared decoding for the `text-content` vendor value.
 *
 * Owners whose vendor payload is covered by `viritura-extensions.json` get
 * chunk validation from the schema. Owners outside it (currently `tempo`)
 * would otherwise cast an arbitrary array straight to `TextContent`, so this
 * module re-checks the shape at the seam instead.
 */

import type { GlyphRun, TextContent, TextContentChunk, TextRun, TextRunStyle } from "@viritura/core";

type Obj = Record<string, unknown>;

const FONTS = new Set(["serif", "sans-serif", "monospace"]);
const FONT_STYLES = new Set(["normal", "italic", "oblique"]);
const DECORATIONS = new Set(["underline", "overline", "strikethrough"]);
const ENCLOSURES = new Set(["box", "circle"]);

function parseStyle(raw: unknown): TextRunStyle | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Obj;
  const style: TextRunStyle = {};
  if (typeof value["font"] === "string" && FONTS.has(value["font"])) {
    style.font = value["font"] as TextRunStyle["font"];
  }
  if (typeof value["size"] === "number" && Number.isFinite(value["size"]) && value["size"] > 0) {
    style.size = value["size"];
  }
  const weight = value["weight"];
  if (weight === "normal" || weight === "bold" || (typeof weight === "number" && Number.isFinite(weight))) {
    style.weight = weight;
  }
  if (typeof value["fontStyle"] === "string" && FONT_STYLES.has(value["fontStyle"])) {
    style.fontStyle = value["fontStyle"] as TextRunStyle["fontStyle"];
  }
  if (typeof value["decoration"] === "string" && DECORATIONS.has(value["decoration"])) {
    style.decoration = value["decoration"] as TextRunStyle["decoration"];
  }
  if (typeof value["enclosure"] === "string" && ENCLOSURES.has(value["enclosure"])) {
    style.enclosure = value["enclosure"] as TextRunStyle["enclosure"];
  }
  if (typeof value["color"] === "string") style.color = value["color"];
  return Object.keys(style).length > 0 ? style : undefined;
}

function parseChunk(raw: unknown): TextContentChunk | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Obj;
  const style = parseStyle(value["style"]);

  if (typeof value["text"] === "string") {
    const run: TextRun = { text: value["text"] };
    if (style) run.style = style;
    return run;
  }

  const glyphs = value["glyphs"];
  if (Array.isArray(glyphs) && glyphs.every((name) => typeof name === "string")) {
    const run: GlyphRun = { glyphs: glyphs as string[] };
    if (style) run.style = style;
    const smuflStyle = parseStyle(value["smuflStyle"]);
    if (smuflStyle) run.smuflStyle = smuflStyle;
    return run;
  }

  return undefined;
}

/**
 * Decode a vendor `text` value, or `undefined` when it is absent or malformed.
 * Unrecognized chunks are dropped rather than failing the surrounding parse,
 * matching how the rest of the vendor decoders treat unusable payloads.
 *
 * A legacy plain string is widened to a single unstyled text run, so the model
 * only ever holds chunks. New documents are written as arrays.
 */
export function parseTextContent(raw: unknown): TextContent | undefined {
  if (typeof raw === "string") return raw.length > 0 ? [{ text: raw }] : undefined;
  if (!Array.isArray(raw)) return undefined;
  const chunks = raw.map(parseChunk).filter((chunk): chunk is TextContentChunk => chunk !== undefined);
  return chunks.length > 0 ? chunks : undefined;
}
