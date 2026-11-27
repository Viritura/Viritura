import type { DenigmaGap, DenigmaGapReport } from "../types";
import type { AdaptedDenigmaGap, JsonRecord } from "./types";
import { isRecord } from "./types";

export interface PageTextGap extends DenigmaGap {
  type: "page-text";
  pageText: JsonRecord;
  anchor?: never;
}

export type NormalizedGap = AdaptedDenigmaGap | PageTextGap;

export function isAdaptedDenigmaGap(gap: NormalizedGap): gap is AdaptedDenigmaGap {
  return gap.type !== "page-text" && typeof gap.anchor === "string";
}

export function isPageTextGap(gap: NormalizedGap): gap is PageTextGap {
  return gap.type === "page-text" && typeof gap.anchor !== "string" && isRecord(gap.pageText);
}

function resolveFontReferences(value: unknown, fonts: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveFontReferences(item, fonts));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "font" && typeof child === "string") {
        const font = fonts[child];
        if (!isRecord(font)) throw new Error(`Denigma gap report references missing font ${child}.`);
        return [key, { ...font }];
      }
      return [key, resolveFontReferences(child, fonts)];
    }),
  );
}

function normalizeGap(gap: DenigmaGap, fonts: Record<string, unknown>): NormalizedGap {
  const resolved = resolveFontReferences(gap, fonts);
  if (!isRecord(resolved) || typeof resolved.type !== "string") {
    throw new Error("Denigma returned a malformed gap.");
  }
  if (resolved.type === "page-text") {
    if (!isRecord(resolved.pageText) || resolved.anchor !== undefined) {
      throw new Error("Denigma returned a malformed page-text gap.");
    }
    return { ...resolved, pageText: resolved.pageText } as PageTextGap;
  }
  if (typeof resolved.anchor !== "string") {
    throw new Error(`Denigma ${resolved.type} gap is missing its target anchor.`);
  }

  const normalized: JsonRecord = { ...resolved };
  if (resolved.type === "expression" && isRecord(resolved.expression)) {
    if (resolved.expression.placements !== undefined) {
      normalized["placements"] = resolved.expression.placements;
    }
  } else if (resolved.type === "smart-shape" && isRecord(resolved.smartShape)) {
    if (resolved.smartShape.end !== undefined) normalized["end"] = resolved.smartShape.end;
  } else if (resolved.type === "text-formatting" && isRecord(resolved.formatting)) {
    if (resolved.formatting.ranges !== undefined) normalized["textRanges"] = resolved.formatting.ranges;
  } else if (resolved.type === "text-insert" && isRecord(resolved.insert)) {
    if (resolved.insert.ranges !== undefined) normalized["textRanges"] = resolved.insert.ranges;
  }
  return normalized as AdaptedDenigmaGap;
}

export function normalizeGapReport(report: DenigmaGapReport): NormalizedGap[] {
  return report.gaps.map((gap) => normalizeGap(gap, report.fonts ?? {}));
}
