/**
 * Reads MusicXML formatted text into `TextContent` chunks.
 *
 * A `<direction-type>` may hold an unbounded run of `<words>` and `<symbol>`
 * children, which together form one styled text sequence. `<symbol>` carries a
 * canonical SMuFL glyph name, so it maps onto a glyph run directly.
 *
 * Size and font family are deliberately not imported. MusicXML states
 * `font-size` in absolute points and, unlike positions and distances, does not
 * scale it through `<scaling>`, so there is no denominator in the file from
 * which to recover our staff-relative multiplier. Both properties stay omitted
 * until MNX settles on a text sizing unit, so every import path normalizes the
 * same way rather than each one guessing differently.
 */

import type { TextContent, TextContentChunk, TextDecoration, TextRunStyle } from "@viritura/core";
import { childElements } from "../xmlHelpers";
import { normalizeMusicXmlColor } from "./colors";

/** `number-of-lines` is 0–3; any nonzero count means the line is drawn. */
function hasLines(element: Element, attribute: string): boolean {
  const raw = element.getAttribute(attribute);
  if (raw === null) return false;
  const count = Number(raw);
  return Number.isFinite(count) && count > 0;
}

function runStyle(element: Element): TextRunStyle | undefined {
  const style: TextRunStyle = {};
  if (element.getAttribute("font-weight") === "bold") style.weight = "bold";
  if (element.getAttribute("font-style") === "italic") style.fontStyle = "italic";

  const decorations: TextDecoration[] = [];
  if (hasLines(element, "underline")) decorations.push("underline");
  if (hasLines(element, "overline")) decorations.push("overline");
  if (hasLines(element, "line-through")) decorations.push("strikethrough");
  if (decorations.length > 0) style.decorations = decorations;

  // A rehearsal mark's enclosure is owned by the mark, not by its run, so it
  // is read separately by `rehearsalStyleFromDirectionType` instead.
  if (element.tagName !== "rehearsal") {
    const enclosure = element.getAttribute("enclosure");
    if (enclosure === "rectangle" || enclosure === "square") style.enclosure = "box";
    if (enclosure === "circle" || enclosure === "oval") style.enclosure = "circle";
  }

  const color = normalizeMusicXmlColor(element.getAttribute("color"));
  if (color) style.color = color;

  return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * The display style of a `<rehearsal>` direction-type, or `undefined` when it
 * matches our default. MusicXML defaults a rehearsal enclosure to `square`,
 * which is our `boxed` default, so neither an unspecified enclosure nor an
 * explicit square one carries information worth writing.
 */
export function rehearsalStyleFromDirectionType(directionType: Element): "circled" | "plain" | undefined {
  const rehearsal = childElements(directionType).find((child) => child.tagName === "rehearsal");
  switch (rehearsal?.getAttribute("enclosure")) {
    case "circle":
    case "oval":
      return "circled";
    case "none":
      return "plain";
    default:
      return undefined;
  }
}

const TEXT_TAGS = new Set(["words", "rehearsal"]);

function chunkFor(element: Element): TextContentChunk | undefined {
  const style = runStyle(element);
  if (TEXT_TAGS.has(element.tagName)) {
    const text = element.textContent ?? "";
    if (text === "") return undefined;
    return style ? { text, style } : { text };
  }
  const glyph = element.textContent?.trim() ?? "";
  if (glyph === "") return undefined;
  return style ? { glyphs: [glyph], style } : { glyphs: [glyph] };
}

/**
 * Collect the formatted-text sequence of one `<direction-type>`, or
 * `undefined` when it carries no visible text. `<words>` and `<rehearsal>`
 * contribute text runs; `<symbol>` contributes a SMuFL glyph run.
 */
export function textContentFromDirectionType(directionType: Element): TextContent | undefined {
  const chunks = childElements(directionType)
    .filter((child) => TEXT_TAGS.has(child.tagName) || child.tagName === "symbol")
    .map(chunkFor)
    .filter((chunk): chunk is TextContentChunk => chunk !== undefined);
  if (chunks.length === 0) return undefined;
  // A leading/trailing run may be padded for layout; trim only at the edges so
  // interior spacing between runs survives.
  return trimEdges(chunks);
}

function trimEdges(chunks: TextContentChunk[]): TextContent | undefined {
  const result = chunks.map((chunk) => ({ ...chunk }));
  const first = result[0];
  if (first && "text" in first) first.text = first.text.replace(/^\s+/, "");
  const last = result.at(-1);
  if (last && "text" in last) last.text = last.text.replace(/\s+$/, "");
  const kept = result.filter((chunk) => !("text" in chunk) || chunk.text !== "");
  return kept.length > 0 ? kept : undefined;
}

/** The visible text of a chunk list, for deduplication and diagnostics. */
export function plainOf(content: TextContent): string {
  return content.map((chunk) => ("text" in chunk ? chunk.text : "")).join("");
}
