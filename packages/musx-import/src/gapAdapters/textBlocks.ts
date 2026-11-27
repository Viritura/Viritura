import type { TextContent, TextFramePageAnchor } from "@viritura/core";
import type { DenigmaGapOutcome } from "../types";
import type { FormattedText } from "./types";
import { ensureArrayProperty, ensureViritura, type TargetIndex } from "./targetIndex";
import { formattedTextContent, hasUnimportedFormatting } from "./textRuns";
import { isFormattedText, isRecord, type AdaptedDenigmaGap, type GapApplication, type JsonRecord } from "./types";
import type { PageTextGap } from "./normalizeReport";

const EVPU_PER_STAFF_SPACE = 24;
const REFERENCE_STAFF_SIZE_EVPU = 96;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function framePresentationReasons(frame: JsonRecord, width: number, height: number): string[] {
  const reasons: string[] = [];
  if (height > 0) reasons.push("The source frame's fixed height is not represented.");
  if (frame["wordWrap"] === false) reasons.push("The source frame disables word wrapping.");
  if (frame["noExpandSingleWord"] === true) reasons.push("Single-word frame expansion is not represented.");
  if (frame["positionFromFrameEdge"] === false) {
    reasons.push("The source frame's handle is not positioned from its edge.");
  }
  if (frame["hasCustomShape"] === true) reasons.push("Custom frame shapes are not represented.");
  if (frame["lineSpacingPercent"] !== undefined && frame["lineSpacingPercent"] !== 100) {
    reasons.push("Source line spacing is not represented.");
  }
  if (frame["borderThickness"] !== undefined && frame["borderThickness"] !== 0) {
    reasons.push("Source border thickness is not represented.");
  }
  if (frame["cornerRadius"] !== undefined && frame["cornerRadius"] !== 0) {
    reasons.push("Rounded source frame corners are not represented.");
  }
  if (width < 0) reasons.push("The source frame width is invalid.");
  return reasons;
}

function framePresentation(frame: JsonRecord, unit: string): { value: JsonRecord; reasons: string[] } | undefined {
  if (frame["unit"] !== unit || unit !== "evpu") return undefined;
  const width = frame["width"];
  const height = frame["height"];
  const inset = frame["inset"] ?? 0;
  if (
    !isFiniteNumber(width) ||
    width < 0 ||
    !isFiniteNumber(height) ||
    height < 0 ||
    !isFiniteNumber(inset) ||
    inset < 0
  ) {
    return undefined;
  }

  const value: JsonRecord = {
    paragraphJustification:
      frame["justify"] === "center" || frame["justify"] === "right" || frame["justify"] === "justify"
        ? frame["justify"]
        : "left",
    padding: inset / EVPU_PER_STAFF_SPACE,
    border: frame["showBorder"] === false ? "none" : "solid",
    sourceReference: { unit, referenceStaffSize: REFERENCE_STAFF_SIZE_EVPU },
  };
  if (width > 0) value["width"] = { unit: "staffSpaces", value: width / EVPU_PER_STAFF_SPACE };
  return { value, reasons: framePresentationReasons(frame, width, height) };
}

function outcome(disposition: DenigmaGapOutcome["disposition"], reason?: string): GapApplication {
  return { outcome: { disposition, ...(reason ? { reason } : {}) } };
}

function mergeReasons(reasons: string[]): string | undefined {
  return [...new Set(reasons)].join(" ") || undefined;
}

function hasTextInserts(text: FormattedText | undefined): boolean {
  return text?.runs?.some((run) => run.insert !== undefined) === true;
}

function applyTextBlockOffset(
  vendor: JsonRecord,
  textBlock: JsonRecord,
  frame: JsonRecord,
  target: JsonRecord,
): { horizontalOffset: number; verticalOffset: number; hasMetricPosition: boolean; handleX: number; handleY: number } {
  const handleX = isFiniteNumber(frame["handleOffsetX"]) ? frame["handleOffsetX"] : 0;
  const handleY = isFiniteNumber(frame["handleOffsetY"]) ? frame["handleOffsetY"] : 0;
  const horizontalOffset = (textBlock["horizontalOffset"] as number) + handleX;
  const verticalOffset = (textBlock["verticalOffset"] as number) + handleY;
  const hasMetricPosition = isRecord(target["position"]);
  const existingOffset = vendor["manualOffset"];
  const prior = Array.isArray(existingOffset) && existingOffset.length === 2 ? existingOffset : [0, 0];
  const x = isFiniteNumber(prior[0]) ? prior[0] : 0;
  const y = isFiniteNumber(prior[1]) ? prior[1] : 0;
  const mappedX = hasMetricPosition ? 0 : horizontalOffset / EVPU_PER_STAFF_SPACE;
  if (mappedX !== 0 || verticalOffset !== 0) {
    vendor["manualOffset"] = [x + mappedX, y + verticalOffset / EVPU_PER_STAFF_SPACE];
  }
  return { horizontalOffset, verticalOffset, hasMetricPosition, handleX, handleY };
}

function textBlockReasons(textBlock: JsonRecord, offsets: ReturnType<typeof applyTextBlockOffset>): string[] {
  const reasons: string[] = [];
  if (textBlock["verticalOrigin"] !== "staff-top-line") {
    reasons.push("The source vertical offset origin is not represented.");
  } else if (offsets.verticalOffset !== 0) {
    reasons.push("The source vertical offset is relative to the staff top line, not the text anchor.");
  }
  if (offsets.hasMetricPosition && offsets.horizontalOffset !== 0) {
    reasons.push(
      "The source horizontal offset is measure-relative and cannot be combined exactly with its metric position.",
    );
  }
  if (offsets.handleX !== 0 || offsets.handleY !== 0) {
    reasons.push("Source frame-handle offsets are approximated as text offsets.");
  }
  if (textBlock["unit"] !== "evpu") reasons.push("Source frame units are not supported.");
  return reasons;
}

function applyTextBlockGap(gap: AdaptedDenigmaGap, index: TargetIndex): GapApplication {
  const textBlock = gap["textBlock"];
  const target = index.byId(gap.anchor);
  if (!isRecord(textBlock) || !target || !Array.isArray(target["text"]) || !isRecord(textBlock["frame"])) {
    return outcome("unhandled", "Text-block target or frame payload is unavailable.");
  }
  const presentation = framePresentation(textBlock["frame"], String(textBlock["unit"]));
  if (!presentation || !isFiniteNumber(textBlock["horizontalOffset"]) || !isFiniteNumber(textBlock["verticalOffset"])) {
    return outcome("unhandled", "Text-block frame units or offsets are invalid.");
  }

  const vendor = ensureViritura(target);
  vendor["frame"] = presentation.value;
  const frame = textBlock["frame"];
  const offsets = applyTextBlockOffset(vendor, textBlock, frame, target);
  const reasons = [...presentation.reasons, ...textBlockReasons(textBlock, offsets)];
  return outcome(reasons.length > 0 ? "handled-partially" : "handled", mergeReasons(reasons));
}

function pageAnchor(horizontal: string, vertical: string): TextFramePageAnchor | undefined {
  const names: Record<string, TextFramePageAnchor> = {
    "left:top": "top-left",
    "center:top": "top",
    "right:top": "top-right",
    "left:bottom": "bottom-left",
    "center:bottom": "bottom",
    "right:bottom": "bottom-right",
  };
  return names[`${horizontal}:${vertical}`];
}

function uniqueFrameId(score: JsonRecord, base: string): string {
  const frames =
    isRecord(score["_x"]) && isRecord(score["_x"]["viritura"]) ? score["_x"]["viritura"]["textFrames"] : undefined;
  const used = new Set(
    Array.isArray(frames)
      ? frames.flatMap((frame) => (isRecord(frame) && typeof frame["id"] === "string" ? [frame["id"]] : []))
      : [],
  );
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function placementPosition(
  base: JsonRecord,
  placement: JsonRecord,
  isRightPage: boolean,
): { offsetX: number; offsetY: number } | undefined {
  const override = isRecord(placement["position"]) ? placement["position"] : undefined;
  const position = { ...base, ...override };
  const offsetX =
    isRightPage && position["independentRightPages"] === true && isFiniteNumber(position["rightPageOffsetX"])
      ? position["rightPageOffsetX"]
      : position["offsetX"];
  const offsetY =
    isRightPage && position["independentRightPages"] === true && isFiniteNumber(position["rightPageOffsetY"])
      ? position["rightPageOffsetY"]
      : position["offsetY"];
  if (!isFiniteNumber(offsetX) || !isFiniteNumber(offsetY)) return undefined;
  return { offsetX, offsetY };
}

interface PageTextContext {
  text: FormattedText;
  content: TextContent;
  placements: unknown[];
  frame: JsonRecord;
  alignment: JsonRecord;
  position: JsonRecord;
  presentation: { value: JsonRecord; reasons: string[] };
}

function pageTextContext(pageText: JsonRecord): PageTextContext | undefined {
  const text = isFormattedText(pageText["text"]) ? pageText["text"] : undefined;
  const content = formattedTextContent(text, true);
  const placements = pageText["placements"];
  const frame = pageText["frame"];
  const alignment = pageText["alignment"];
  const position = pageText["position"];
  const unit = pageText["unit"];
  if (
    !text ||
    !content ||
    !Array.isArray(placements) ||
    placements.length === 0 ||
    !isRecord(frame) ||
    !isRecord(alignment) ||
    !isRecord(position) ||
    typeof unit !== "string"
  ) {
    return undefined;
  }
  const presentation = framePresentation(frame, unit);
  if (!presentation) return undefined;
  return { text, content, placements, frame, alignment, position, presentation };
}

function applyPageTextPlacement(
  value: unknown,
  placementIndex: number,
  gapIndex: number,
  context: PageTextContext,
  index: TargetIndex,
  reasons: string[],
): boolean {
  if (!isRecord(value) || value["kind"] !== "page" || typeof value["anchor"] !== "string") {
    reasons.push("A page-text placement has an unsupported target.");
    return false;
  }
  const target = index.scorePage(value["anchor"]);
  if (!target) {
    reasons.push(`Page-text target ${value["anchor"]} is not present in the MNX score views.`);
    return false;
  }
  const isRightPage = (target.pageIndex + 1) % 2 === 1;
  const horizontal =
    isRightPage && typeof context.alignment["rightPageHorizontal"] === "string"
      ? context.alignment["rightPageHorizontal"]
      : context.alignment["horizontal"];
  const vertical = context.alignment["vertical"];
  if (typeof horizontal !== "string" || typeof vertical !== "string") {
    reasons.push("A page-text placement has unsupported alignment.");
    return false;
  }
  const anchor = pageAnchor(horizontal, vertical);
  const position = placementPosition(context.position, value, isRightPage);
  if (!anchor || !position) {
    reasons.push("A page-text placement has unsupported alignment or position.");
    return false;
  }
  if (context.alignment["horizontalFrom"] !== "margin" || context.alignment["verticalFrom"] !== "margin") {
    reasons.push("Page-edge alignment is approximated using the printable margin.");
  }
  const handleX = isFiniteNumber(context.frame["handleOffsetX"]) ? context.frame["handleOffsetX"] : 0;
  const handleY = isFiniteNumber(context.frame["handleOffsetY"]) ? context.frame["handleOffsetY"] : 0;
  if (handleX !== 0 || handleY !== 0) reasons.push("Source frame-handle offsets are approximated.");
  const scoreFrames = ensureArrayProperty(ensureViritura(target.score), "textFrames");
  const id = uniqueFrameId(target.score, `denigma-page-text-${gapIndex}-${placementIndex}`);
  scoreFrames.push({
    id,
    locator: { type: "page", pageIndex: target.pageIndex },
    placement: {
      anchor,
      offset: {
        x: position.offsetX / EVPU_PER_STAFF_SPACE + handleX / EVPU_PER_STAFF_SPACE,
        y: -position.offsetY / EVPU_PER_STAFF_SPACE - handleY / EVPU_PER_STAFF_SPACE,
      },
    },
    width: context.presentation.value["width"] ?? { unit: "textColumnFraction", value: 1 },
    content: context.content,
    horizontalAlignment: horizontal,
    paragraphJustification: context.presentation.value["paragraphJustification"],
    padding: context.presentation.value["padding"],
    border: context.presentation.value["border"],
    sourceReference: context.presentation.value["sourceReference"],
  });
  return true;
}

function applyPageTextGap(gap: PageTextGap, gapIndex: number, index: TargetIndex): GapApplication {
  const context = pageTextContext(gap.pageText);
  if (!context) return outcome("unhandled", "Page-text content, placements, or frame data are unavailable.");

  const reasons = [...context.presentation.reasons];
  if (hasUnimportedFormatting(context.text)) reasons.push("Source font names and sizes are not represented.");
  if (hasTextInserts(context.text)) reasons.push("Dynamic text inserts retain only their visible source fallback.");
  const created = context.placements.reduce<number>(
    (count, placement, placementIndex) =>
      count + Number(applyPageTextPlacement(placement, placementIndex, gapIndex, context, index, reasons)),
    0,
  );
  if (created === 0) return outcome("unhandled", mergeReasons(reasons) ?? "No page-text placements were imported.");
  if (gap.pageText["assignment"] !== undefined) {
    reasons.push("Page assignments are preserved for exported pages only; future-page repetition is not modeled.");
  }
  return outcome(reasons.length > 0 ? "handled-partially" : "handled", mergeReasons(reasons));
}

export { applyPageTextGap, applyTextBlockGap };
