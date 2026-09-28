import type { TextContent, TextContentChunk, TextRunStyle } from "@viritura/core";
import { SMUFL } from "../../palette/smuflGlyphs";

const STYLE_DATA_KEYS = ["font", "size", "weight", "fontStyle", "decoration", "enclosure", "color"] as const;
const ENGINE_GLYPHS = new Set([
  "gClef",
  "gClef15mb",
  "gClef8vb",
  "gClef8va",
  "gClef15ma",
  "cClef",
  "cClef8vb",
  "fClef",
  "fClef15mb",
  "fClef8vb",
  "fClef8va",
  "fClef15ma",
  "unpitchedPercussionClef1",
  "dynamicP",
  "dynamicPP",
  "dynamicPPP",
  "dynamicPPPP",
  "dynamicMP",
  "dynamicMF",
  "dynamicF",
  "dynamicFF",
  "dynamicFFF",
  "dynamicFFFF",
  "dynamicSfz",
  "dynamicFP",
  "dynamicPF",
  "dynamicSforzando",
  "dynamicRfz",
  "dynamicNiente",
]);

function validColor(value: string | undefined): value is string {
  return value !== undefined && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isFontFamily(value: string): value is NonNullable<TextRunStyle["font"]> {
  return ["serif", "sans-serif", "monospace"].some((font) => font === value);
}

function validSize(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0 && value <= 12;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function styleAttributes(style: TextRunStyle | undefined, prefix = ""): string {
  if (!style) return "";
  const attributes = STYLE_DATA_KEYS.flatMap((key) => {
    const value = style[key];
    return value === undefined
      ? []
      : [`data-${prefix ? `${prefix}-` : ""}${key.toLowerCase()}="${escapeHtml(String(value))}"`];
  });
  return attributes.length === 0 ? "" : ` ${attributes.join(" ")}`;
}

function textStyleCss(style: TextRunStyle | undefined): string {
  if (!style) return "";
  const declarations: string[] = [];
  if (style.font && isFontFamily(style.font)) {
    declarations.push(`font-family:${style.font}`);
  }
  if (validSize(style.size)) declarations.push(`font-size:${style.size}em`);
  if (style.weight === "normal" || style.weight === "bold") {
    declarations.push(`font-weight:${style.weight}`);
  } else if (
    typeof style.weight === "number" &&
    Number.isFinite(style.weight) &&
    style.weight >= 1 &&
    style.weight <= 1000
  ) {
    declarations.push(`font-weight:${style.weight}`);
  }
  if (style.fontStyle && ["normal", "italic", "oblique"].includes(style.fontStyle)) {
    declarations.push(`font-style:${style.fontStyle}`);
  }
  if (style.decoration && ["underline", "overline", "strikethrough"].includes(style.decoration)) {
    declarations.push(`text-decoration:${style.decoration}`);
  }
  if (validColor(style.color)) declarations.push(`color:${style.color}`);
  return declarations.length === 0 ? "" : ` style="${declarations.join(";")}"`;
}

function htmlForChunk(chunk: TextContentChunk): string {
  if ("text" in chunk) {
    const attrs = styleAttributes(chunk.style);
    const css = textStyleCss(chunk.style);
    return `<span data-text-run${attrs}${css}>${escapeHtml(chunk.text)}</span>`;
  }
  const attrs = styleAttributes(chunk.style);
  const css = textStyleCss(chunk.style);
  const smuflAttributes = styleAttributes(chunk.smuflStyle, "smufl");
  const smuflCss = chunk.smuflStyle
    ? [
        chunk.smuflStyle.size === undefined ? "" : `font-size:${chunk.smuflStyle.size}em`,
        chunk.smuflStyle.color ? `color:${escapeHtml(chunk.smuflStyle.color)}` : "",
      ]
        .filter(Boolean)
        .join(";")
    : "";
  const smuflStyle = smuflCss ? ` style="${smuflCss}"` : "";
  return chunk.glyphs
    .map((name) => {
      const glyph = SMUFL[name as keyof typeof SMUFL];
      return `<span data-text-run${attrs}${css}><span data-glyph="${escapeHtml(name)}"${smuflAttributes}${smuflStyle} contenteditable="false">${escapeHtml(glyph ?? `[${name}]`)}</span></span>`;
    })
    .join("");
}

export function htmlForTextContent(content: TextContent): string {
  return content.map(htmlForChunk).join("");
}

function parsedStyleValue(key: (typeof STYLE_DATA_KEYS)[number], value: string): Partial<TextRunStyle> {
  return STYLE_VALUE_PARSERS[key](value);
}

function parsedSize(value: string): Partial<TextRunStyle> {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 && size <= 12 ? { size } : {};
}

function parsedWeight(value: string): Partial<TextRunStyle> {
  if (value === "normal" || value === "bold") return { weight: value };
  const weight = Number(value);
  return Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? { weight } : {};
}

function parsedFontStyle(value: string): Partial<TextRunStyle> {
  return value === "normal" || value === "italic" || value === "oblique" ? { fontStyle: value } : {};
}

function parsedDecoration(value: string): Partial<TextRunStyle> {
  return value === "underline" || value === "overline" || value === "strikethrough" ? { decoration: value } : {};
}

function parsedEnclosure(value: string): Partial<TextRunStyle> {
  return value === "box" || value === "circle" ? { enclosure: value } : {};
}

function parsedFont(value: string): Partial<TextRunStyle> {
  return isFontFamily(value) ? { font: value } : {};
}

function parsedColor(value: string): Partial<TextRunStyle> {
  return validColor(value) ? { color: value } : {};
}

const STYLE_VALUE_PARSERS: Record<(typeof STYLE_DATA_KEYS)[number], (value: string) => Partial<TextRunStyle>> = {
  font: parsedFont,
  size: parsedSize,
  weight: parsedWeight,
  fontStyle: parsedFontStyle,
  decoration: parsedDecoration,
  enclosure: parsedEnclosure,
  color: parsedColor,
};

function inheritedStyle(element: HTMLElement, parent: TextRunStyle, prefix = ""): TextRunStyle {
  const style = { ...parent };
  if (prefix === "") applySemanticTagStyle(style, element.tagName);
  for (const key of STYLE_DATA_KEYS) {
    const normalizedKey = key.toLowerCase();
    const datasetKey = prefix ? `${prefix}${normalizedKey[0]!.toUpperCase()}${normalizedKey.slice(1)}` : normalizedKey;
    const value = element.dataset[datasetKey];
    if (value !== undefined) Object.assign(style, parsedStyleValue(key, value));
  }
  return style;
}

function applySemanticTagStyle(style: TextRunStyle, tagName: string): void {
  if (tagName === "B" || tagName === "STRONG") style.weight = "bold";
  if (tagName === "I" || tagName === "EM") style.fontStyle = "italic";
  if (tagName === "U") style.decoration = "underline";
}

/**
 * Resolves the run style in effect at a point in the editor DOM, so toolbar
 * controls can show what the current selection already carries.
 */
export function styleAtNode(node: Node | null, root: HTMLElement): TextRunStyle {
  const ancestors: HTMLElement[] = [];
  for (let current = node; current && current !== root; current = current.parentNode) {
    if (current instanceof HTMLElement) ancestors.unshift(current);
  }
  let style: TextRunStyle = {};
  for (const element of ancestors) style = inheritedStyle(element, style);
  return style;
}

function appendText(chunks: TextContentChunk[], text: string, style: TextRunStyle): void {
  if (text.length === 0) return;
  const previous = chunks.at(-1);
  if (previous && "text" in previous && JSON.stringify(previous.style ?? {}) === JSON.stringify(style)) {
    previous.text += text;
    return;
  }
  chunks.push({ text, ...(Object.keys(style).length > 0 ? { style } : {}) });
}

function collectNode(node: Node, inherited: TextRunStyle, chunks: TextContentChunk[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    appendText(chunks, node.textContent ?? "", inherited);
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const glyphName = node.dataset.glyph;
  if (glyphName) {
    const smuflStyle = inheritedStyle(node, {}, "smufl");
    chunks.push({
      glyphs: [glyphName],
      ...(Object.keys(inherited).length > 0 ? { style: inherited } : {}),
      ...(Object.keys(smuflStyle).length > 0 ? { smuflStyle } : {}),
    });
    return;
  }
  const style = inheritedStyle(node, inherited);
  for (const child of node.childNodes) collectNode(child, style, chunks);
}

function normalizedChunks(chunks: TextContentChunk[]): TextContent {
  const merged: TextContentChunk[] = [];
  for (const chunk of chunks) {
    if (chunkLength(chunk) === 0) continue;
    if ("text" in chunk) appendText(merged, chunk.text, chunk.style ?? {});
    else merged.push(chunk);
  }
  return merged;
}

export function textContentFromEditor(element: HTMLElement): TextContent {
  const chunks: TextContentChunk[] = [];
  for (const child of element.childNodes) collectNode(child, {}, chunks);
  return normalizedChunks(chunks);
}

function chunkLength(chunk: TextContentChunk): number {
  return "text" in chunk ? chunk.text.length : chunk.glyphs.length;
}

function slicedChunk(chunk: TextContentChunk, from: number, to: number): TextContentChunk {
  if ("text" in chunk) return { ...chunk, text: chunk.text.slice(from, to) };
  return { ...chunk, glyphs: chunk.glyphs.slice(from, to) };
}

function patchedChunk(chunk: TextContentChunk, patch: Partial<TextRunStyle>): TextContentChunk {
  const style: Record<string, unknown> = { ...chunk.style };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete style[key];
    else style[key] = value;
  }
  const { style: _replaced, ...rest } = chunk;
  return Object.keys(style).length > 0 ? { ...rest, style: style as TextRunStyle } : rest;
}

/**
 * Applies a run-style patch across a plain-text offset span. Working on the
 * model rather than the editor DOM keeps runs flat, so clearing a key is never
 * shadowed by an enclosing run that a previous edit left behind.
 */
export function styledTextContent(
  content: TextContent,
  start: number,
  end: number,
  patch: Partial<TextRunStyle>,
): TextContent {
  const result: TextContentChunk[] = [];
  let offset = 0;
  for (const chunk of content) {
    const length = chunkLength(chunk);
    const from = Math.max(start - offset, 0);
    const to = Math.min(end - offset, length);
    if (from >= to) {
      result.push(chunk);
    } else {
      if (from > 0) result.push(slicedChunk(chunk, 0, from));
      result.push(patchedChunk(slicedChunk(chunk, from, to), patch));
      if (to < length) result.push(slicedChunk(chunk, to, length));
    }
    offset += length;
  }
  return normalizedChunks(result);
}

export function glyphNamesMatching(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return Object.keys(SMUFL)
    .filter((name) => {
      if (!ENGINE_GLYPHS.has(name)) return false;
      const glyph = SMUFL[name as keyof typeof SMUFL];
      const codepoint = Array.from(glyph, (character) => character.codePointAt(0) ?? 0);
      return (
        codepoint.length === 1 &&
        ((codepoint[0]! >= 0xe000 && codepoint[0]! <= 0xf8ff) ||
          (codepoint[0]! >= 0xf0000 && codepoint[0]! <= 0xffffd) ||
          (codepoint[0]! >= 0x100000 && codepoint[0]! <= 0x10fffd)) &&
        name.toLowerCase().includes(normalized)
      );
    })
    .slice(0, 30);
}

export function glyphCharacter(name: string): string | undefined {
  return SMUFL[name as keyof typeof SMUFL];
}
