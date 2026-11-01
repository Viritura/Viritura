import { useMemo } from "react";
import type { Score } from "@viritura/core";
import { computeHorizonPaperGeometry } from "@viritura/renderer";
import type { SelectionState } from "../../store/selectionStore";
import { buildTrackPoints, buildTrackSystems, LANE_HEIGHT, positionTrackChords } from "./trackGeometry";
import { CHORD_TRACK_GAP, chordTrackScale, scaleTrackSystem } from "./trackViewport";
import { trackHeaderGeometry } from "./trackHeaderGeometry";
import { trackBeatStep, trackPositionEqual } from "./useChordTrackEditing";
import type { ChordTrackProps, TimedChord, TrackPoint } from "./types";

interface GeometryArgs {
  displayList: ChordTrackProps["displayList"];
  viewport: ChordTrackProps["viewport"];
  score: Score | null;
  chords: readonly TimedChord[];
  grid: "quarter" | "eighth" | "sixteenth";
  safeAreaLeft: number;
  selection: SelectionState;
  hover: TrackPoint | null;
  size: { width: number; height: number };
}

export function useChordTrackGeometry({
  displayList,
  viewport,
  score,
  chords,
  grid,
  safeAreaLeft,
  selection,
  hover,
  size,
}: GeometryArgs) {
  const system = useMemo(() => buildTrackSystems(displayList)[0], [displayList]);
  const scale = useMemo(() => chordTrackScale(displayList), [displayList]);
  const paintSystem = useMemo(() => (system ? scaleTrackSystem(system, 1 / scale) : null), [system, scale]);
  const paper = useMemo(() => computeHorizonPaperGeometry(displayList), [displayList]);
  const railScoreY = paper.y + paper.height + CHORD_TRACK_GAP * scale;
  const railY = (railScoreY - viewport.scrollY) * viewport.zoom;
  const laneZoom = viewport.zoom * scale;
  const scoreX = (x: number) => (x - viewport.scrollX) * viewport.zoom;
  const allPoints =
    system && score ? buildTrackPoints(system, grid === "sixteenth" ? 0.25 : grid === "eighth" ? 0.5 : 1, chords) : [];
  const finePoints = system && score ? buildTrackPoints(system, 0.25, chords) : [];
  const beatPoints =
    system && score
      ? system.measures.flatMap((measure) =>
          buildTrackPoints({ ...system, measures: [measure] }, trackBeatStep(score, measure.index)),
        )
      : [];
  const header = trackHeaderGeometry(scoreX(system?.measures[0]?.x ?? 0), laneZoom, true, safeAreaLeft);
  const positioned = paintSystem
    ? positionTrackChords(paintSystem, chords).map((entry) => ({
        ...entry,
        point: { ...entry.point, x: entry.point.x * scale },
        width: entry.width * scale,
      }))
    : [];
  const selected =
    selection.kind === "single"
      ? positioned.find((entry) => entry.chord.elementId === selection.elementId)?.point
      : null;
  const candidate = hover ?? selected ?? null;
  const active = candidate
    ? (allPoints.find((point) => trackPositionEqual(point, candidate)) ??
      positioned.find((entry) => trackPositionEqual(entry.point, candidate))?.point ??
      null)
    : null;
  const points = allPoints.filter((point) => scoreX(point.x) >= header.right && scoreX(point.x) <= size.width);
  const laneVisible = railY < size.height && railY + LANE_HEIGHT * laneZoom > 0;
  return {
    system,
    scale,
    paintSystem,
    railScoreY,
    railY,
    laneZoom,
    scoreX,
    allPoints,
    finePoints,
    beatPoints,
    header,
    positioned,
    active,
    points,
    laneVisible,
  };
}
