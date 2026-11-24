import type { DiagnosticCollector, TextContent, TextRunStyle } from "@viritura/core";
import { node, type XmlAttributes, type XmlContext, type XmlElement } from "./xml";

function textStyle(style: TextRunStyle | undefined): XmlAttributes {
  return {
    "font-family": style?.font,
    "font-weight":
      style?.weight === "bold" || style?.weight === 700 ? "bold" : style?.weight === undefined ? undefined : "normal",
    "font-style": style?.fontStyle === "oblique" ? "italic" : style?.fontStyle,
    color: style?.color,
    underline: style?.decorations?.includes("underline") ? 1 : undefined,
    overline: style?.decorations?.includes("overline") ? 1 : undefined,
    "line-through": style?.decorations?.includes("strikethrough") ? 1 : undefined,
    enclosure: style?.enclosure === "box" ? "rectangle" : style?.enclosure,
  };
}

export function textElements(
  context: XmlContext,
  content: TextContent,
  diagnostics: DiagnosticCollector,
  tag = "words",
  attributes: XmlAttributes = {},
): XmlElement[] {
  return content.flatMap((chunk) => {
    if (
      chunk.style?.size !== undefined ||
      (typeof chunk.style?.weight === "number" && chunk.style.weight !== 400 && chunk.style.weight !== 700)
    ) {
      diagnostics.info(
        "",
        "Relative text sizes and numeric font weights are reflowed by the receiving application.",
        "musicxml-text-style",
      );
    }
    if ("text" in chunk) return [node(context, tag, chunk.text, { ...textStyle(chunk.style), ...attributes })];
    const symbolTag = tag === "credit-words" ? "credit-symbol" : "symbol";
    return chunk.glyphs.map((glyph) =>
      node(context, symbolTag, glyph, { ...textStyle(chunk.style), ...textStyle(chunk.smuflStyle), ...attributes }),
    );
  });
}
