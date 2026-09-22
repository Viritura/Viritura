import type { Score } from "@viritura/core";
import type { AnnotationLocation } from "../score/ElementPath";
import type { SelectionState } from "../store/selectionStore";
import type { CapturedSelection } from "./annotations";
import {
  captureSelectedChordSymbols,
  chordCutLocations,
  clipboardAnnotationLocation,
  resolveClipboardChordLocations,
  selectedChordStaffOffset,
  selectedChordSymbolOrigin,
} from "./chordSymbolCapture";
import { getActiveClef, resolveActiveTimeKey } from "./sourceContext";

function chordAnnotationElementIds(selection: SelectionState): readonly string[] {
  if (selection.kind === "single") return [selection.elementId];
  if (selection.kind === "multi") return selection.elementIds;
  return [];
}

export function buildChordAnnotationClipboardSelection(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex?: number,
): CapturedSelection | null {
  const elementIds = chordAnnotationElementIds(selection);
  if (elementIds.length === 0) return null;
  const locations = elementIds.map(clipboardAnnotationLocation);
  if (locations.some((location) => location?.type !== "chord")) return null;
  const rawLocations = locations.filter((location): location is AnnotationLocation => location !== null);
  const resolved = resolveClipboardChordLocations(score, rawLocations, [], selectedScoreIndex);
  if (resolved.length === 0) return null;
  const startPart = Math.min(...resolved.map((location) => location.partIndex ?? 0));
  const anchorStaffOffset = selectedChordStaffOffset(score, resolved, startPart);
  if (!Number.isFinite(anchorStaffOffset)) return null;
  const firstMeasure = Math.min(...resolved.map((location) => location.measureIndex));
  const origin = selectedChordSymbolOrigin(score, resolved, {
    measureIndex: firstMeasure,
    beat: Number.POSITIVE_INFINITY,
  });
  if (!Number.isFinite(origin.beat)) return null;
  const chordSymbols = captureSelectedChordSymbols(score, resolved, origin, startPart, anchorStaffOffset);
  if (chordSymbols.length === 0) return null;
  const { time, key } = resolveActiveTimeKey(score, origin.measureIndex);
  return {
    captureOrigin: origin,
    events: [],
    timeSignature: time,
    keySignature: key,
    clef: getActiveClef(score, startPart, origin.measureIndex),
    transposition: score.parts[startPart]?.transposition,
    chordSymbols,
    cutAnnotationLocations: chordCutLocations(resolved),
    partIndex: startPart,
    measureIndex: origin.measureIndex,
    sequenceIndex: 0,
    eventIndex: 0,
  };
}
