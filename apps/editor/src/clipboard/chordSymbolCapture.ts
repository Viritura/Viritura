import type { ChordSymbol, LayoutContent, Score } from "@viritura/core";
import { resolveAnnotationLocation, type AnnotationLocation, type EventLocation } from "../score/ElementPath";
import type { MeasureSelectionPoint, SelectionTrackRhythmicRange } from "../store/selectionStore";
import { resolveChordRange } from "../store/chordRange";
import type { CapturedChordSymbol } from "./ClipboardFragment";
import { partStaffOffset } from "./clipboardTrackMapping";
import {
  addWholeFractions,
  exactWholeFraction,
  sequenceBoundaryFraction,
  subtractWholeFractions,
} from "./clipboardTrackPlacement";
import { annotationInTrackRanges, type CaptureOrigin } from "./annotations";
import { getEventAtLocation } from "../score/ElementPath";
import { resolveCondensedSelectionEvents } from "../score/condensedWriteback";

interface ChordLocation extends AnnotationLocation {
  sourceStaff?: number;
}

interface ChordSource {
  partIndex: number;
  staff: number;
}

export function eventChordSources(score: Score, locations: readonly EventLocation[]): ChordSource[] {
  return locations.map((location) => ({
    partIndex: location.partIndex,
    staff:
      score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex]?.staff ?? 1,
  }));
}

export function captureEventChordSymbols(
  score: Score,
  location: EventLocation,
  startBeat: number,
  endBeat: number,
  selectedScoreIndex?: number,
): CapturedChordSymbol[] {
  const staff = eventChordSources(score, [location])[0]!.staff;
  return captureChordSymbols(
    score,
    location.partIndex,
    location.measureIndex,
    location.measureIndex,
    startBeat,
    endBeat,
    0,
    staff - 1,
    new Set([staff]),
    { selectedScoreIndex },
  );
}

/** Canonical IDs need a physical origin only during capture, never in the score. */
export function resolveClipboardChordLocations(
  score: Score,
  locations: readonly AnnotationLocation[],
  sources: readonly ChordSource[],
  selectedScoreIndex?: number,
): ChordLocation[] {
  return locations.flatMap((location) => {
    if (location.type !== "chord" || location.partIndex !== undefined) return [location];
    const rendered = locations.filter(
      (candidate) =>
        candidate.type === "chord" &&
        candidate.measureIndex === location.measureIndex &&
        candidate.annotationIndex === location.annotationIndex &&
        candidate.partIndex !== undefined,
    );
    if (rendered.length > 0) return rendered;
    const visible = [...new Set(sources.map((source) => source.partIndex))].flatMap((partIndex) => {
      const staff = chordCaptureStaff(score, partIndex, selectedScoreIndex, location.measureIndex);
      return staff === undefined ? [] : [{ partIndex, staff }];
    });
    const fallback = score.parts.flatMap((_, partIndex) => {
      const staff = chordCaptureStaff(score, partIndex, selectedScoreIndex, location.measureIndex);
      return staff === undefined ? [] : [{ partIndex, staff }];
    });
    const origins = visible.length > 0 ? visible : sources.length > 0 ? sources.slice(0, 1) : fallback.slice(0, 1);
    return origins.length > 0
      ? origins.map(({ partIndex, staff }) => ({ ...location, partIndex, sourceStaff: staff }))
      : [location];
  });
}

export function chordCutLocations(locations: readonly AnnotationLocation[]): AnnotationLocation[] {
  const unique = new Map<string, AnnotationLocation>();
  for (const location of locations) {
    const canonical =
      location.type === "chord"
        ? {
            kind: "global" as const,
            type: location.type,
            measureIndex: location.measureIndex,
            annotationIndex: location.annotationIndex,
          }
        : location;
    unique.set(JSON.stringify(canonical), canonical);
  }
  return [...unique.values()];
}

/** Global navigation coordinates (-1) cannot bound a physical clipboard range. */
export function resolveChordClipboardRange(
  score: Score,
  startId: string,
  endId: string,
  selectedScoreIndex?: number,
  measureAnchor?: MeasureSelectionPoint,
  measureFocus?: MeasureSelectionPoint,
) {
  const resolved = resolveChordRange(score, startId, endId, measureAnchor, measureFocus);
  if (!resolved) return resolved;
  const { range, selectedIds } = resolved;
  if (selectedScoreIndex !== undefined) {
    const selection = { kind: "multi" as const, elementIds: [...selectedIds], measureAnchor };
    for (const location of resolveCondensedSelectionEvents(score, selection, selectedScoreIndex)) {
      const event = getEventAtLocation(score, location);
      if (event?.type !== "event") continue;
      selectedIds.add(
        `p${location.partIndex}/m${location.measureIndex}/s${location.sequenceIndex}/${event.id ?? `e${location.eventIndex}`}`,
      );
      range.startPart = Math.min(range.startPart, location.partIndex);
      range.endPart = Math.max(range.endPart, location.partIndex);
      range.startVoice = Math.min(range.startVoice, location.sequenceIndex);
      range.endVoice = Math.max(range.endVoice, location.sequenceIndex);
    }
  }
  return resolved;
}

/** Render copies retain source context, but always identify the global annotation. */
export function clipboardAnnotationLocation(elementId: string): ChordLocation | null {
  const match = elementId.match(/^m(\d+)\/chord(\d+)(?:\/p(\d+)\/staff(\d+))?$/);
  if (!match) return resolveAnnotationLocation(elementId);
  return {
    kind: "global",
    type: "chord",
    measureIndex: Number(match[1]),
    annotationIndex: Number(match[2]),
    ...(match[3] === undefined ? {} : { partIndex: Number(match[3]), sourceStaff: Number(match[4]) }),
  };
}

function captureLayoutId(score: Score, scoreIndex: number, measureIndex: number): string | undefined {
  const definition = score.scores?.[scoreIndex];
  let inherited = definition?.layout;
  let active = inherited;
  for (const system of definition?.pages?.flatMap((page) => page.systems) ?? []) {
    const start = score.global.measures.findIndex((measure) => measure.id === system.measure);
    if (start < 0 || start > measureIndex) continue;
    inherited = system.layout ?? inherited;
    active = inherited;
    for (const change of system.layoutChanges ?? []) {
      const index = score.global.measures.findIndex((measure) => measure.id === change.location.measure);
      if (index >= start && index <= measureIndex) active = change.layout;
    }
  }
  return active;
}

export function chordCaptureStaff(
  score: Score,
  partIndex: number,
  selectedScoreIndex?: number,
  measureIndex = 0,
): number | undefined {
  const part = score.parts[partIndex];
  if (!part || part.chordSymbolVisibility === "hide") return undefined;
  const layoutId = captureLayoutId(score, selectedScoreIndex ?? 0, measureIndex);
  const layout = score.layouts?.find((candidate) => candidate.id === layoutId);
  if (!layout) return part.chordSymbolVisibility === "show" || partIndex === 0 ? 1 : undefined;
  const sources = (content: LayoutContent[]): { part: string; staff?: number }[] =>
    content.flatMap((node) => (node.type === "group" ? sources(node.content) : node.sources));
  const ordered = sources(layout.content);
  const source = ordered.find((candidate) => candidate.part === part.id);
  if (!source || (part.chordSymbolVisibility !== "show" && ordered[0]?.part !== part.id)) return undefined;
  return source.staff ?? 1;
}

export function chordSymbolStaffAtLocation(score: Score, location: ChordLocation): number | undefined {
  if (location.type !== "chord" || location.annotationIndex === undefined) {
    return undefined;
  }

  const symbol = score.global.measures[location.measureIndex]?.chordSymbols?.[location.annotationIndex];
  return symbol ? (location.sourceStaff ?? 1) : undefined;
}

export function selectedChordStaffOffset(
  score: Score,
  locations: readonly AnnotationLocation[],
  startPart: number,
): number {
  return Math.min(
    ...locations.flatMap((location) => {
      const staff = chordSymbolStaffAtLocation(score, location);
      return staff === undefined ? [] : [partStaffOffset(score, startPart, location.partIndex ?? startPart, staff)];
    }),
  );
}

function selectedChordSymbols(score: Score, locations: readonly AnnotationLocation[]) {
  return locations.flatMap((location) => {
    if (location.type !== "chord" || location.annotationIndex === undefined) {
      return [];
    }
    const chordSymbol = score.global.measures[location.measureIndex]?.chordSymbols?.[location.annotationIndex];
    if (!chordSymbol || chordSymbol.position.fraction[1] <= 0) return [];
    return [
      {
        partIndex: location.partIndex,
        staff: chordSymbolStaffAtLocation(score, location)!,
        measureIndex: location.measureIndex,
        chordSymbol,
      },
    ];
  });
}

export function selectedChordSymbolOrigin(
  score: Score,
  locations: readonly AnnotationLocation[],
  firstOrigin: CaptureOrigin,
): CaptureOrigin {
  return selectedChordSymbols(score, locations).reduce((origin, { measureIndex, chordSymbol }) => {
    const beat = (chordSymbol.position.fraction[0] / chordSymbol.position.fraction[1]) * 4;
    return measureIndex < origin.measureIndex || (measureIndex === origin.measureIndex && beat < origin.beat)
      ? { measureIndex, beat }
      : origin;
  }, firstOrigin);
}

function captureChordSymbol(
  score: Score,
  partIndex: number,
  measureIndex: number,
  chordSymbol: ChordSymbol,
  origin: CaptureOrigin,
  partOffset: number,
  anchorStaffOffset: number,
  sourceStaff = 1,
): CapturedChordSymbol {
  const cloned = structuredClone(chordSymbol);
  const start = chordCaptureOrigin(score, origin);
  if (measureIndex === origin.measureIndex) {
    cloned.position = { ...cloned.position, fraction: subtractWholeFractions(cloned.position.fraction, start) };
  }
  return {
    ...(partOffset === 0 ? {} : { partOffset }),
    sourcePartOffsets: [partOffset],
    staffOffset: partStaffOffset(score, partIndex - partOffset, partIndex, sourceStaff) - anchorStaffOffset,
    measureOffset: measureIndex - origin.measureIndex,
    offset: subtractWholeFractions(
      addWholeFractions(measuresFraction(score, origin.measureIndex, measureIndex), chordSymbol.position.fraction),
      start,
    ),
    chordSymbol: cloned,
  };
}

function chordCaptureOrigin(score: Score, origin: CaptureOrigin): [number, number] {
  for (const part of score.parts) {
    for (const sequence of part.measures[origin.measureIndex]?.sequences ?? []) {
      const boundary = sequenceBoundaryFraction(sequence.content, origin.beat);
      if (boundary) return boundary;
    }
  }
  return exactWholeFraction(origin.beat);
}

function measuresFraction(score: Score, start: number, end: number): [number, number] {
  let time = { count: 4, unit: 4 };
  let fraction: [number, number] = [0, 1];
  for (let measure = 0; measure < end; measure++) {
    time = score.global.measures[measure]?.time ?? time;
    if (measure >= start) fraction = addWholeFractions(fraction, [time.count, time.unit]);
  }
  return fraction;
}

export function captureSelectedChordSymbols(
  score: Score,
  locations: readonly AnnotationLocation[],
  origin: CaptureOrigin,
  startPart: number,
  anchorStaffOffset: number,
): CapturedChordSymbol[] {
  const seen = new Map<ChordSymbol, CapturedChordSymbol>();
  const resolved = resolveClipboardChordLocations(score, locations, [
    { partIndex: startPart, staff: anchorStaffOffset + 1 },
  ]);
  for (const { partIndex = startPart, staff, measureIndex, chordSymbol } of selectedChordSymbols(score, resolved)) {
    const existing = seen.get(chordSymbol);
    if (existing) {
      retainChordSource(existing, partIndex - startPart);
      continue;
    }
    seen.set(
      chordSymbol,
      captureChordSymbol(
        score,
        partIndex,
        measureIndex,
        chordSymbol,
        origin,
        partIndex - startPart,
        anchorStaffOffset,
        staff,
      ),
    );
  }
  return [...seen.values()];
}

function retainChordSource(captured: CapturedChordSymbol, partOffset: number): void {
  const offsets = captured.sourcePartOffsets ?? [captured.partOffset ?? 0];
  if (!offsets.includes(partOffset)) offsets.push(partOffset);
  captured.sourcePartOffsets = offsets;
}

interface ChordSymbolSelection {
  locations?: readonly AnnotationLocation[];
  tracks?: readonly SelectionTrackRhythmicRange[];
  selectedScoreIndex?: number;
  seen?: Map<ChordSymbol, CapturedChordSymbol>;
}

export function captureMeasureChordSymbols(
  score: Score,
  startPart: number,
  endPart: number,
  startMeasure: number,
  endMeasure: number,
  selectedScoreIndex?: number,
): CapturedChordSymbol[] {
  const seen = new Map<ChordSymbol, CapturedChordSymbol>();
  return Array.from({ length: endPart - startPart + 1 }, (_, offset) => startPart + offset).flatMap((partIndex) =>
    captureChordSymbols(score, partIndex, startMeasure, endMeasure, 0, Infinity, partIndex - startPart, 0, undefined, {
      selectedScoreIndex,
      seen,
    }),
  );
}

function selectedAt(
  locations: readonly AnnotationLocation[] | undefined,
  partIndex: number,
  measureIndex: number,
  annotationIndex: number,
) {
  return locations?.find(
    (location) =>
      location.type === "chord" &&
      (location.partIndex === undefined || location.partIndex === partIndex) &&
      location.measureIndex === measureIndex &&
      location.annotationIndex === annotationIndex,
  );
}

function inCaptureInterval(measure: number, beat: number, start: CaptureOrigin, end: CaptureOrigin): boolean {
  return (
    (measure !== start.measureIndex || beat >= start.beat - 1e-9) &&
    (measure !== end.measureIndex || beat < end.beat - 1e-9)
  );
}

export function captureChordSymbols(
  score: Score,
  partIndex: number,
  startMeasure: number,
  endMeasure: number,
  firstMeasureStartBeat: number,
  lastMeasureEndBeat: number,
  partOffset = 0,
  anchorStaffOffset = 0,
  sourceStaves?: ReadonlySet<number>,
  selection?: ChordSymbolSelection,
): CapturedChordSymbol[] {
  const result: CapturedChordSymbol[] = [];
  const origin = { measureIndex: startMeasure, beat: firstMeasureStartBeat };
  const { selectedScoreIndex, locations, tracks, seen } = selection ?? {};
  for (let measureIndex = startMeasure; measureIndex <= endMeasure; measureIndex++) {
    const visibleStaff = chordCaptureStaff(score, partIndex, selectedScoreIndex, measureIndex);
    const symbols = score.global.measures[measureIndex]?.chordSymbols ?? [];
    for (const [annotationIndex, chordSymbol] of symbols.entries()) {
      const selected = selectedAt(locations, partIndex, measureIndex, annotationIndex);
      if (!selected && visibleStaff === undefined) continue;
      const staff = selected ? chordSymbolStaffAtLocation(score, selected)! : visibleStaff!;
      if (!selected && sourceStaves && !sourceStaves.has(staff)) continue;
      const [numerator, denominator] = chordSymbol.position.fraction;
      if (denominator <= 0) continue;
      const beat = (numerator / denominator) * 4;
      if (
        !selected &&
        !inCaptureInterval(measureIndex, beat, origin, { measureIndex: endMeasure, beat: lastMeasureEndBeat })
      )
        continue;
      if (!selected && !annotationInTrackRanges(tracks, partIndex, staff, measureIndex, beat)) continue;
      const existing = seen?.get(chordSymbol);
      if (existing) {
        retainChordSource(existing, partOffset);
        continue;
      }
      const captured = captureChordSymbol(
        score,
        partIndex,
        measureIndex,
        chordSymbol,
        origin,
        partOffset,
        anchorStaffOffset,
        staff,
      );
      result.push(captured);
      seen?.set(chordSymbol, captured);
    }
  }
  return result;
}
