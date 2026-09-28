/**
 * Reads Denigma formatted-text payloads into `TextContent` chunks.
 *
 * Finale stores an expression as a sequence of runs, each carrying its own
 * font record, and a run may resolve to SMuFL glyphs rather than Unicode text.
 * Both map onto our chunk model directly.
 *
 * Font size and font family are deliberately not imported, matching the
 * MusicXML reader. Finale can express a size relative to the preceding run,
 * but MusicXML states sizes in absolute points with no recoverable
 * denominator, so importing one and not the other would give the same visual
 * property two fidelity levels depending on the source format. Both stay
 * omitted until MNX settles on a text sizing unit.
 */

import type { TextContent, TextContentChunk, TextDecoration, TextRunStyle } from "@viritura/core";
import type { FormattedText } from "./types";

type FormattedRun = NonNullable<FormattedText["runs"]>[number];

function runStyle(run: FormattedRun): TextRunStyle | undefined {
  const font = run.font;
  if (!font) return undefined;
  const style: TextRunStyle = {};
  if (font.bold) style.weight = "bold";
  if (font.italic) style.fontStyle = "italic";

  const decorations: TextDecoration[] = [];
  if (font.underline) decorations.push("underline");
  if (font.strikeout) decorations.push("strikethrough");
  if (decorations.length > 0) style.decorations = decorations;

  return Object.keys(style).length > 0 ? style : undefined;
}

function chunkFor(run: FormattedRun): TextContentChunk | undefined {
  if (run.font?.hidden) return undefined;
  const style = runStyle(run);
  if (run.glyphs && run.glyphs.length > 0) {
    return style ? { glyphs: run.glyphs, style } : { glyphs: run.glyphs };
  }
  if (run.text === "") return undefined;
  return style ? { text: run.text, style } : { text: run.text };
}

/**
 * Trim only the outer edges of the chunk list, so padding added for layout is
 * dropped while spacing between interior runs survives.
 */
function trimEdges(chunks: TextContentChunk[]): TextContent | undefined {
  const result = chunks.map((chunk) => ({ ...chunk }));
  const first = result[0];
  if (first && "text" in first) first.text = first.text.replace(/^\s+/, "");
  const last = result.at(-1);
  if (last && "text" in last) last.text = last.text.replace(/\s+$/, "");
  const kept = result.filter((chunk) => !("text" in chunk) || chunk.text !== "");
  return kept.length > 0 ? kept : undefined;
}

/**
 * Convert a formatted-text payload to chunks, preserving per-run formatting
 * and SMuFL glyph runs. Returns `undefined` when nothing visible remains.
 */
export function formattedTextContent(text: FormattedText | undefined): TextContent | undefined {
  if (!text) return undefined;
  if (text.runs && text.runs.length > 0) {
    const chunks = text.runs.map(chunkFor).filter((chunk): chunk is TextContentChunk => chunk !== undefined);
    if (chunks.length > 0) return trimEdges(chunks);
  }
  const plain = text.plain.trim();
  return plain ? [{ text: plain }] : undefined;
}

/** True when any run carries formatting we cannot yet represent. */
export function hasUnimportedFormatting(text: FormattedText | undefined): boolean {
  return text?.runs?.some((run) => run.font?.name !== undefined || run.font?.size !== undefined) === true;
}
