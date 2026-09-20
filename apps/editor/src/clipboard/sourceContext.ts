import type { KeySignature, Score, TimeSignature } from "@viritura/core";
import type { ClipboardSourceRef } from "../store/clipboardHistoryStore";
import type { SelectionState } from "../store/selectionStore";
import { resolveSelectionMeasureRange } from "../store/selectionUtils";
import { resolveEventFromSubElement, resolveEventLocation } from "../score/ElementPath";

export function getActiveClef(score: Score, partIndex: number, measureIndex: number) {
  for (let measure = measureIndex; measure >= 0; measure--) {
    const clefs = score.parts[partIndex]?.measures[measure]?.clefs;
    if (clefs && clefs.length > 0) return clefs[0]!.clef;
  }
  return undefined;
}

export function resolveActiveTimeKey(score: Score, measureIndex: number): { time: TimeSignature; key: KeySignature } {
  let activeTime: TimeSignature | undefined;
  let activeKey: KeySignature | undefined;
  for (let measure = measureIndex; measure >= 0; measure--) {
    const global = score.global.measures[measure];
    if (global?.time && !activeTime) activeTime = global.time;
    if (global?.key && !activeKey) activeKey = global.key;
  }
  return { time: activeTime ?? { count: 4, unit: 4 }, key: activeKey ?? { fifths: 0 } };
}

/**
 * Compute the snapshot reference (history snapshot id + part/measure range)
 * for the current selection at copy time. The preview uses this to render
 * the actual measures from the source score, preserving instrument names,
 * clefs, transpositions, and other engraving context that would otherwise
 * be lost when reducing to bare events.
 *
 * Returns undefined when no selection is resolvable; preview falls back to
 * the synthetic snippet rendering in that case.
 */
export function buildClipboardSourceRef(
  score: Score | null,
  selection: SelectionState,
  historyId: number | undefined,
): ClipboardSourceRef | undefined {
  if (!score) return undefined;
  if (historyId === undefined) return undefined;

  let partStart: number | undefined;
  let partEnd: number | undefined;
  let measureStart: number | undefined;
  let measureEnd: number | undefined;

  if (selection.kind === "single") {
    const loc = resolveEventLocation(selection.elementId, score);
    if (!loc) return undefined;
    partStart = partEnd = loc.partIndex;
    measureStart = measureEnd = loc.measureIndex;
  } else if (selection.kind === "range") {
    const range = resolveSelectionMeasureRange(
      selection.startElementId,
      selection.endElementId,
      score,
      selection.measureAnchor,
      selection.measureFocus,
    );
    if (!range) return undefined;
    partStart = Math.min(range.startPart, range.endPart);
    partEnd = Math.max(range.startPart, range.endPart);
    measureStart = Math.min(range.startMeasure, range.endMeasure);
    measureEnd = Math.max(range.startMeasure, range.endMeasure);
  } else if (selection.kind === "measure") {
    partStart = Math.min(selection.startPartIndex, selection.endPartIndex);
    partEnd = Math.max(selection.startPartIndex, selection.endPartIndex);
    measureStart = Math.min(selection.startMeasure, selection.endMeasure);
    measureEnd = Math.max(selection.startMeasure, selection.endMeasure);
  } else if (selection.kind === "multi") {
    // Walk all selected elements to compute the bounding part/measure box.
    for (const elementId of selection.elementIds) {
      const loc = resolveEventFromSubElement(elementId, score) ?? resolveEventLocation(elementId, score);
      if (!loc) continue;
      partStart = partStart === undefined ? loc.partIndex : Math.min(partStart, loc.partIndex);
      partEnd = partEnd === undefined ? loc.partIndex : Math.max(partEnd, loc.partIndex);
      measureStart = measureStart === undefined ? loc.measureIndex : Math.min(measureStart, loc.measureIndex);
      measureEnd = measureEnd === undefined ? loc.measureIndex : Math.max(measureEnd, loc.measureIndex);
    }
  }

  if (partStart === undefined || partEnd === undefined || measureStart === undefined || measureEnd === undefined) {
    return undefined;
  }

  const partIndices: number[] = [];
  for (let p = partStart; p <= partEnd; p++) partIndices.push(p);

  return { historyId, partIndices, startMeasure: measureStart, endMeasure: measureEnd };
}
