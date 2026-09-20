import {
  mergeGlobalChordSymbols,
  resolveChordSymbol,
  type ChordSymbol,
  type ChordSymbolSource,
  type Score,
  type Space,
} from "@viritura/core";
import type { CapturedChordSymbol, ClipboardTrack } from "./ClipboardFragment";
import { capturedAnnotationDestination, resolvePhysicalStaffDestination } from "./annotations";
import { ensurePasteMeasure } from "./pasteContent";

interface ChordPlacementContext {
  partIndex: number;
  anchorStaffIndex: number;
  tracks?: ClipboardTrack[];
  positionFor: (item: CapturedChordSymbol) => { measureIndex: number; fraction: Space["duration"] };
  onWarning?: (message: string) => void;
}

function normalizeChordCapture(captured: CapturedChordSymbol): CapturedChordSymbol {
  // Version-5 native fragments used a chord-local staff field. It is provenance,
  // not canonical harmony, and must not survive the clipboard boundary.
  const { displayStaff, ...chordSymbol } = captured.chordSymbol as ChordSymbol & { displayStaff?: unknown };
  const sourceStaff = captured.sourceStaff ?? displayStaff;
  if (
    sourceStaff !== undefined &&
    (typeof sourceStaff !== "number" || !Number.isSafeInteger(sourceStaff) || sourceStaff < 1)
  ) {
    throw new Error("Invalid clipboard harmony source staff.");
  }
  const offsets = captured.sourcePartOffsets ?? [captured.partOffset ?? 0];
  if (!Array.isArray(offsets) || !offsets.every((offset) => Number.isSafeInteger(offset))) {
    throw new Error("Invalid clipboard harmony source parts.");
  }
  return { ...captured, chordSymbol, ...(sourceStaff === undefined ? {} : { sourceStaff }) };
}

/** All mutations belong to the caller's single, cloned paste transaction. */
export function applyCapturedChordSymbols(
  score: Score,
  captured: readonly CapturedChordSymbol[] | undefined,
  context: ChordPlacementContext,
): void {
  const sources = new Map<number, ChordSymbolSource[]>();
  const ordered = (captured ?? [])
    .map(normalizeChordCapture)
    .sort((left, right) =>
      left.staffOffset !== undefined && right.staffOffset !== undefined
        ? left.staffOffset - right.staffOffset
        : (left.partOffset ?? 0) - (right.partOffset ?? 0) || (left.sourceStaff ?? 1) - (right.sourceStaff ?? 1),
    );
  for (const [sourceIndex, item] of ordered.entries()) {
    const destination = capturedAnnotationDestination(
      score,
      context.partIndex,
      context.anchorStaffIndex,
      context.tracks,
      item.partOffset ?? 0,
      item.sourceStaff ?? 1,
      item.staffOffset,
    );
    const part = score.parts[destination.partIndex];
    if (!part) throw new Error("Clipboard harmony has no destination part.");
    const position = context.positionFor(item);
    if (!Number.isSafeInteger(position.measureIndex) || position.measureIndex < 0) {
      throw new Error("Invalid clipboard harmony measure.");
    }
    ensurePasteMeasure(score, position.measureIndex);
    const chord = {
      ...structuredClone(item.chordSymbol),
      position: { ...item.chordSymbol.position, fraction: position.fraction },
    };
    const resolution = resolveChordSymbol(chord);
    if (resolution.status === "unsupported") context.onWarning?.(resolution.message);
    part.chordSymbolVisibility = "show";
    const measureSources = sources.get(position.measureIndex) ?? [];
    measureSources.push({ partIndex: sourceIndex, chordSymbols: [chord] });
    sources.set(position.measureIndex, measureSources);
  }
  for (const [measureIndex, measureSources] of sources) {
    const merged = mergeGlobalChordSymbols(score.global.measures[measureIndex]!, measureSources);
    score.global.measures[measureIndex] = merged.measure;
    for (const warning of merged.warnings) context.onWarning?.(warning.message);
  }
  if (sources.size > 0) {
    const sourceParts = new Set(ordered.flatMap((item) => item.sourcePartOffsets ?? [item.partOffset ?? 0]));
    const mappedSources = new Set<number>();
    for (const track of context.tracks ?? []) {
      if (!sourceParts.has(track.partOffset)) continue;
      mappedSources.add(track.partOffset);
      const destinationPart =
        track.staffOffset === undefined
          ? context.partIndex + track.partOffset
          : resolvePhysicalStaffDestination(score, context.partIndex, context.anchorStaffIndex, track.staffOffset)
              .partIndex;
      const part = score.parts[destinationPart];
      if (part) part.chordSymbolVisibility = "show";
    }
    for (const offset of sourceParts) {
      if (mappedSources.has(offset)) continue;
      // The primary physical origin was already resolved above; only additional
      // annotation-only source parts need the legacy part-relative fallback.
      if (ordered.some((item) => (item.partOffset ?? 0) === offset)) continue;
      const part = score.parts[context.partIndex + offset];
      if (!part) throw new Error("Clipboard harmony has no destination part.");
      part.chordSymbolVisibility = "show";
    }
  }
}
