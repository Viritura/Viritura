import type { DisplayList, MeasureBounds } from "@viritura/renderer";
import { compareChordSymbolPositions } from "@viritura/core";
import type { TimedChord, TrackPoint, TrackSystem } from "./types";

export const LANE_HEIGHT = 76;
export const MUSIC_PADDING = 60;

export function buildTrackSystems(displayList: DisplayList): TrackSystem[] {
  const groups = new Map<number, MeasureBounds[]>();
  for (const bounds of displayList.measureBounds ?? []) {
    if (bounds.ghostStaff || bounds.isExpansion || bounds.isHidden) continue;
    const id = bounds.systemIndex ?? 0;
    const group = groups.get(id) ?? [];
    group.push(bounds);
    groups.set(id, group);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([id, bounds]) => {
      const byMeasure = new Map<number, MeasureBounds>();
      for (const bound of bounds) {
        const previous = byMeasure.get(bound.index);
        byMeasure.set(bound.index, previous ? mergeBeatAnchors(previous, bound) : bound);
      }
      const sourceTop = Math.min(...bounds.map((bound) => bound.y)) - MUSIC_PADDING;
      const sourceBottom = Math.max(...bounds.map((bound) => bound.y + bound.height)) + MUSIC_PADDING;
      return {
        id,
        measures: [...byMeasure.values()].sort((a, b) => a.index - b.index),
        sourceTop,
        musicHeight: sourceBottom - sourceTop,
        width: displayList.width,
      };
    });
}

/** A silent upper staff must not discard rhythmic columns supplied by lower staffs. */
function mergeBeatAnchors(previous: MeasureBounds, incoming: MeasureBounds): MeasureBounds {
  if (incoming.totalBeats <= 0) return previous;
  if (previous.totalBeats <= 0) {
    return { ...previous, totalBeats: incoming.totalBeats, beatAnchors: incoming.beatAnchors };
  }
  const anchors = new Map(previous.beatAnchors);
  for (const [beat, x] of incoming.beatAnchors) {
    const normalizedBeat =
      incoming.totalBeats === previous.totalBeats ? beat : (beat * previous.totalBeats) / incoming.totalBeats;
    const existing = [...anchors.keys()].find((candidate) => Math.abs(candidate - normalizedBeat) < 1e-9);
    if (existing === undefined) anchors.set(normalizedBeat, x);
    else anchors.set(existing, Math.min(anchors.get(existing)!, x));
  }
  return { ...previous, beatAnchors: [...anchors].sort(([a], [b]) => a - b) };
}

/** Unsmoothened anchors: insertion positions must not inherit playhead barline smoothing. */
export function trackBeatToX(bounds: MeasureBounds, beat: number): number {
  const anchors = bounds.beatAnchors;
  if (anchors.length === 0) {
    if (bounds.totalBeats <= 0) return bounds.x + bounds.prefixWidth;
    return bounds.x + bounds.prefixWidth + (beat / bounds.totalBeats) * (bounds.width - bounds.prefixWidth);
  }
  const first = anchors[0]!;
  if (beat <= first[0]) return first[1];
  for (let i = 1; i < anchors.length; i++) {
    const previous = anchors[i - 1]!;
    const next = anchors[i]!;
    if (beat <= next[0]) {
      const span = next[0] - previous[0];
      return span === 0 ? next[1] : previous[1] + ((beat - previous[0]) / span) * (next[1] - previous[1]);
    }
  }
  return anchors[anchors.length - 1]![1];
}

export function buildTrackPoints(system: TrackSystem, step: number, chords: readonly TimedChord[] = []): TrackPoint[] {
  return system.measures.flatMap((measure) => {
    const beats = new Set<number>();
    for (let beat = 0; beat < measure.totalBeats - 1e-9; beat += step) {
      beats.add(beat);
    }
    for (const chord of chords) {
      if (chord.measureIndex !== measure.index) continue;
      if (chord.symbol.position.graceIndex !== undefined) continue;
      const beat = (chord.symbol.position.fraction[0] / chord.symbol.position.fraction[1]) * 4;
      if (beat >= 0 && beat < measure.totalBeats) beats.add(beat);
    }
    return [...beats]
      .sort((a, b) => a - b)
      .map((beat) => ({
        measureIndex: measure.index,
        beat,
        x: trackBeatToX(measure, beat),
      }));
  });
}

export function sameTrackPoint(a: TrackPoint | null, b: TrackPoint | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.measureIndex === b.measureIndex &&
    Math.abs(a.beat - b.beat) < 1e-9 &&
    a.position?.graceIndex === b.position?.graceIndex
  );
}

export function pointChord(chords: readonly TimedChord[], point: TrackPoint) {
  return chords.find(
    (chord) =>
      chord.measureIndex === point.measureIndex &&
      (point.position
        ? compareChordSymbolPositions(chord.symbol.position, point.position) === 0
        : chord.symbol.position.graceIndex === undefined &&
          Math.abs((chord.symbol.position.fraction[0] / chord.symbol.position.fraction[1]) * 4 - point.beat) < 1e-9),
  );
}

export function positionTrackChords(system: TrackSystem, chords: readonly TimedChord[]) {
  const positioned = chords
    .flatMap((chord) => {
      const measure = system.measures.find((candidate) => candidate.index === chord.measureIndex);
      if (!measure) return [];
      const beat = (chord.symbol.position.fraction[0] / chord.symbol.position.fraction[1]) * 4;
      return [
        {
          chord,
          point: {
            measureIndex: chord.measureIndex,
            beat,
            x: trackBeatToX(measure, beat),
            position: chord.symbol.position,
          },
        },
      ];
    })
    .sort((a, b) => a.point.x - b.point.x);
  const last = system.measures[system.measures.length - 1]!;
  return positioned.map((entry, index) => ({
    ...entry,
    width: Math.max(12, (positioned[index + 1]?.point.x ?? last.x + last.width) - entry.point.x - 6),
  }));
}
