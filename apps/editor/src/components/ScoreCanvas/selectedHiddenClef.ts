import type { Clef, Score } from "@viritura/core";
import { beatToX, type MeasureBounds } from "@viritura/renderer";
import type { SelectionState } from "../../store/selectionStore";
import { parseClefElementId } from "../../score/clefElementId";
import { SMUFL } from "../palette/smuflGlyphs";
import { partLocalStaffIndex } from "./hitTesting";

export interface SelectedHiddenClefOverlay {
  x: number;
  y: number;
  codepoint: number;
  size: number;
}

function resolveClefGlyphKey(clef: Clef): keyof typeof SMUFL {
  if (clef.glyph && clef.glyph in SMUFL) return clef.glyph as keyof typeof SMUFL;
  if (clef.sign === "G") {
    if (clef.octave === -2) return "gClef15mb";
    if (clef.octave === -1) return "gClef8vb";
    if (clef.octave === 1) return "gClef8va";
    if (clef.octave === 2) return "gClef15ma";
    return "gClef";
  }
  if (clef.sign === "F") {
    if (clef.octave === -2) return "fClef15mb";
    if (clef.octave === -1) return "fClef8vb";
    if (clef.octave === 1) return "fClef8va";
    if (clef.octave === 2) return "fClef15ma";
    return "fClef";
  }
  if (clef.sign === "C") {
    if (clef.octave === -1) return "cClef8vb";
    return "cClef";
  }
  return "unpitchedPercussionClef1";
}

function resolveClefCodepoint(clef: Clef): number {
  return SMUFL[resolveClefGlyphKey(clef)].codePointAt(0) ?? 0xe050;
}

function resolveMeasureBoundsForClef(
  measureBounds: readonly MeasureBounds[] | undefined,
  selection: SelectionState,
  partIndex: number,
  measureIndex: number,
  staff: number | undefined,
): MeasureBounds | null {
  if (!measureBounds?.length) return null;
  if (selection.kind === "single" && selection.measureAnchor) {
    const anchorMatchesStaff =
      staff === undefined ||
      selection.measureAnchor.localStaffIndex === undefined ||
      selection.measureAnchor.localStaffIndex + 1 === staff;
    const bound = measureBounds.find(
      (candidate) =>
        anchorMatchesStaff &&
        candidate.partIndex === selection.measureAnchor!.partIndex &&
        candidate.index === selection.measureAnchor!.measureIndex &&
        candidate.staffIndex === selection.measureAnchor!.staffIndex,
    );
    if (bound) return bound;
  }
  const matching = measureBounds.filter(
    (candidate) => candidate.partIndex === partIndex && candidate.index === measureIndex,
  );
  if (matching.length === 0) return null;
  if (staff !== undefined) {
    return (
      matching.find((candidate) => partLocalStaffIndex(measureBounds, partIndex, candidate.staffIndex) + 1 === staff) ??
      null
    );
  }
  return matching[0] ?? null;
}

function clefStartX(bounds: MeasureBounds): number {
  const spatium = bounds.height / 4;
  const prefixOffset = bounds.prefixWidth > 0 ? Math.min(bounds.prefixWidth * 0.45, spatium * 1.4) : spatium * 0.9;
  return bounds.x + prefixOffset;
}

export function resolveSelectedHiddenClefOverlay(
  score: Score | null,
  selection: SelectionState,
  measureBounds: readonly MeasureBounds[] | undefined,
): SelectedHiddenClefOverlay | null {
  if (selection.kind !== "single" || !score) return null;
  const location = parseClefElementId(selection.elementId);
  if (!location) return null;
  const clefEntry = score.parts[location.partIndex]?.measures[location.measureIndex]?.clefs?.[location.clefIndex];
  if (!clefEntry?.clef.hide) return null;

  const bounds = resolveMeasureBoundsForClef(
    measureBounds,
    selection,
    location.partIndex,
    location.measureIndex,
    clefEntry.staff,
  );
  if (!bounds) return null;

  const beat = clefEntry.position ? (clefEntry.position.fraction[0] / clefEntry.position.fraction[1]) * 4 : 0;
  const x =
    beat > 0
      ? (beatToX({ measureIndex: location.measureIndex, beat }, [bounds]) ?? clefStartX(bounds))
      : clefStartX(bounds);
  const spatium = bounds.height / 4;
  return {
    x,
    y: bounds.y + (2 - clefEntry.clef.staffPosition / 2) * spatium,
    codepoint: resolveClefCodepoint(clefEntry.clef),
    size: spatium * 4,
  };
}
