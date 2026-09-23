import type { MouseEvent } from "react";
import type { PositionedClef, Score } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import type { MeasureSelectionPoint } from "../../store/selectionStore";
import { chordRangeSourceStaff } from "../../score/chordSourceContext";
import { buildClefElementId, parseClefElementId } from "../../score/clefElementId";
import { getRenderedStaffSources } from "./renderedStaffSources";
import { globalChordForElement } from "./chordFeedback";
import type { CanvasHandlerCtx } from "./canvasHandlers";

const CLEF_RANGE_MIN = 0xe050;
const CLEF_RANGE_MAX = 0xe07f;

export function chordSelectionPoint(
  score: Score,
  point: MeasureSelectionPoint,
  selectedScoreIndex: number,
  displayList: DisplayList | null,
): MeasureSelectionPoint {
  return {
    ...point,
    sourceStaff: chordRangeSourceStaff(score, point, selectedScoreIndex, getRenderedStaffSources(displayList)) ?? null,
  };
}

function clefAffectsStaff(clef: PositionedClef, localStaffIndex: number | undefined): boolean {
  if (localStaffIndex === undefined) return true;
  return (clef.staff ?? 1) === localStaffIndex + 1;
}

function visibleClefGlyphXs(
  displayList: DisplayList | null,
  elementId: string,
  measureAnchor: MeasureSelectionPoint,
): number[] {
  if (!displayList?.elementIds?.length) return [];
  const measureBounds = displayList.measureBounds?.find(
    (bounds) =>
      bounds.index === measureAnchor.measureIndex &&
      bounds.partIndex === measureAnchor.partIndex &&
      bounds.staffIndex === measureAnchor.staffIndex,
  );
  const staffTop = measureBounds?.y;
  const staffBottom = measureBounds ? measureBounds.y + measureBounds.height : undefined;
  const spatium = measureBounds ? measureBounds.height / 4 : 12;
  const glyphXs: number[] = [];

  for (let index = 0; index < displayList.commands.length; index++) {
    const command = displayList.commands[index];
    if (
      displayList.elementIds[index] !== elementId ||
      command?.type !== "DrawGlyph" ||
      command.codepoint < CLEF_RANGE_MIN ||
      command.codepoint > CLEF_RANGE_MAX
    ) {
      continue;
    }
    if (
      staffTop !== undefined &&
      staffBottom !== undefined &&
      (command.y < staffTop - spatium * 2 || command.y > staffBottom + spatium * 2)
    ) {
      continue;
    }
    glyphXs.push(command.x);
  }

  glyphXs.sort((left, right) => left - right);
  return glyphXs;
}

export function resolveCanvasSelectionElementId(
  score: Score | null,
  displayList: DisplayList | null,
  elementId: string,
  measureAnchor: MeasureSelectionPoint | undefined,
  scoreX: number,
): string {
  const clefLocation = parseClefElementId(elementId);
  if (!score || !measureAnchor || !clefLocation) return elementId;

  const clefs = score.parts[clefLocation.partIndex]?.measures[clefLocation.measureIndex]?.clefs;
  if (!clefs || clefs.length === 0) return elementId;

  const candidates = clefs
    .map((clef, clefIndex) => ({ clef, clefIndex }))
    .filter(({ clef }) => clefAffectsStaff(clef, measureAnchor.localStaffIndex));
  if (candidates.length === 0) return elementId;
  if (candidates.length === 1) {
    return buildClefElementId(clefLocation.partIndex, clefLocation.measureIndex, candidates[0]!.clefIndex);
  }

  const visibleCandidates = candidates.filter(({ clef }) => clef.clef.hide !== true);
  if (visibleCandidates.length === 0) return elementId;
  if (visibleCandidates.length === 1) {
    return buildClefElementId(clefLocation.partIndex, clefLocation.measureIndex, visibleCandidates[0]!.clefIndex);
  }

  const glyphXs = visibleClefGlyphXs(displayList, elementId, measureAnchor);
  if (glyphXs.length === visibleCandidates.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < glyphXs.length; index++) {
      const distance = Math.abs(glyphXs[index]! - scoreX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return buildClefElementId(
      clefLocation.partIndex,
      clefLocation.measureIndex,
      visibleCandidates[bestIndex]!.clefIndex,
    );
  }

  return buildClefElementId(clefLocation.partIndex, clefLocation.measureIndex, visibleCandidates[0]!.clefIndex);
}

export function selectCanvasElement(
  e: MouseEvent<HTMLCanvasElement>,
  ctx: CanvasHandlerCtx,
  elementId: string,
  measureAnchor?: MeasureSelectionPoint,
): void {
  const score = ctx.docScoreRef.current;
  if (measureAnchor && score && globalChordForElement(score, elementId)) {
    measureAnchor = chordSelectionPoint(score, measureAnchor, ctx.selectedScoreIndex, ctx.displayListRef.current);
  }
  if (e.shiftKey) ctx.extendSelection(elementId, measureAnchor);
  else if (e.ctrlKey || e.metaKey) ctx.toggleSelection(elementId);
  else if (measureAnchor) ctx.selectElement(elementId, measureAnchor);
  else ctx.selectElement(elementId);
}
