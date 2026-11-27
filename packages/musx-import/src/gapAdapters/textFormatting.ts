import { ensureViritura, type TargetIndex } from "./targetIndex";
import { isRecord, type AdaptedDenigmaGap, type GapApplication, type JsonRecord } from "./types";
import { isAdaptedDenigmaGap, type NormalizedGap } from "./normalizeReport";

interface StyledRange {
  offset: number;
  length: number;
  style: JsonRecord;
}

interface TextTarget {
  element: JsonRecord;
  content: unknown[];
  units: unknown[];
  ranges: StyledRange[];
}

function fontStyle(font: JsonRecord): JsonRecord {
  const style: JsonRecord = {};
  if (font["bold"] === true) style["weight"] = "bold";
  if (font["italic"] === true) style["fontStyle"] = "italic";
  const decorations: string[] = [];
  if (font["underline"] === true) decorations.push("underline");
  if (font["strikeout"] === true) decorations.push("strikethrough");
  if (decorations.length) style["decorations"] = decorations;
  return style;
}

function resolveTarget(gap: AdaptedDenigmaGap, anchor: string, index: TargetIndex): TextTarget | undefined {
  const owner = index.byId(gap.anchor);
  const element = index.byId(anchor);
  const content = owner?.["text"];
  if (!element || !Array.isArray(content) || !content.includes(element)) return undefined;
  const text = element["text"];
  const glyphs = element["glyphs"];
  const units = typeof text === "string" ? Array.from(text) : Array.isArray(glyphs) ? glyphs : undefined;
  return units ? { element, content, units, ranges: [] } : undefined;
}

function applyRanges(target: TextTarget): void {
  const boundaries = new Set([0, target.units.length]);
  for (const range of target.ranges) {
    boundaries.add(range.offset);
    boundaries.add(range.offset + range.length);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const elements = points.slice(0, -1).map((start, ordinal) => {
    const element = structuredClone(target.element);
    // Keep one copy of the original id; report coordinates were resolved before splitting.
    if (ordinal > 0) delete element["id"];
    const units = target.units.slice(start, points[ordinal + 1]);
    if (typeof element["text"] === "string") element["text"] = units.join("");
    else element["glyphs"] = units;
    const styles = target.ranges
      .filter((range) => start >= range.offset && start < range.offset + range.length)
      .map((range) => range.style);
    if (styles.length) {
      const vendor = ensureViritura(element);
      const existing = isRecord(vendor["style"]) ? vendor["style"] : {};
      vendor["style"] = Object.assign({}, ...styles, existing);
    }
    return element;
  });
  target.content.splice(target.content.indexOf(target.element), 1, ...elements);
}

/** Resolve every range against the original output before splitting any content elements. */
export function applyTextFormattingGaps(gaps: NormalizedGap[], index: TargetIndex): Map<number, GapApplication> {
  const applications = new Map<number, GapApplication>();
  const targets = new Map<string, TextTarget>();
  gaps.forEach((gap, gapIndex) => {
    if (!isAdaptedDenigmaGap(gap) || gap.type !== "text-formatting") return;
    const formatting = gap["formatting"];
    if (!isRecord(formatting) || !isRecord(formatting["font"]) || !gap.textRanges?.length) {
      applications.set(gapIndex, { outcome: { disposition: "unhandled", reason: "Malformed text-formatting gap." } });
      return;
    }
    const resolved = gap.textRanges.map((range) => {
      const target = targets.get(range.anchor) ?? resolveTarget(gap, range.anchor, index);
      if (target) targets.set(range.anchor, target);
      return { range, target };
    });
    if (
      resolved.some(
        ({ range, target }) =>
          !target ||
          !Number.isSafeInteger(range.offset) ||
          !Number.isSafeInteger(range.length) ||
          range.offset < 0 ||
          range.length <= 0 ||
          range.offset + range.length > target.units.length ||
          !Array.isArray(index.byId(gap.anchor)?.["text"]) ||
          !(index.byId(gap.anchor)?.["text"] as unknown[]).includes(target.element),
      )
    ) {
      applications.set(gapIndex, {
        outcome: { disposition: "unhandled", reason: "Text-formatting range is unavailable or out of bounds." },
      });
      return;
    }
    const font = formatting["font"];
    const style = fontStyle(font);
    for (const { range, target } of resolved) {
      if (!target || !Object.keys(style).length) continue;
      target.ranges.push({ ...range, style });
    }
    const partial =
      font["name"] !== undefined ||
      font["size"] !== undefined ||
      font["hidden"] === true ||
      ["baseline", "superscript", "tracking"].some((key) => formatting[key] !== undefined && formatting[key] !== 0);
    applications.set(gapIndex, {
      outcome: partial
        ? {
            disposition: "handled-partially",
            reason: "Preserved inline styling; source font, size, visibility, and spacing are not imported.",
          }
        : { disposition: "handled" },
    });
  });
  for (const target of targets.values()) {
    if (target.ranges.length) applyRanges(target);
  }
  return applications;
}
