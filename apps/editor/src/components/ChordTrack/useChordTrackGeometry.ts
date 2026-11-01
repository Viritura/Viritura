import { useMemo, type CSSProperties } from "react";
import type { Score } from "@viritura/core";
import { computeHorizonPaperGeometry } from "@viritura/renderer";
import type { SelectionState } from "../../store/selectionStore";
import { buildTrackPoints, buildTrackSystems, LANE_HEIGHT, positionTrackChords } from "./trackGeometry";
import { CHORD_TRACK_GAP, chordTrackScale, scaleTrackSystem, trackLaneY, trackBottomInset } from "./trackViewport";
import { trackHeaderGeometry } from "./trackHeaderGeometry";
import { trackBeatStep, trackPositionEqual } from "./useChordTrackEditing";
import type { ChordTrackProps, TimedChord, TrackPoint } from "./types";

interface GeometryArgs {
  displayList: ChordTrackProps["displayList"];
  viewport: ChordTrackProps["viewport"];
  score: Score | null;
  chords: readonly TimedChord[];
  grid: "quarter" | "eighth" | "sixteenth";
  sticky: boolean;
  position: "above" | "below";
  safeAreaLeft: number;
  safeAreaTop?: number;
  safeAreaBottom?: number;
  selection: SelectionState;
  hover: TrackPoint | null;
  size: { width: number; height: number; bottomOverlay?: number };
}

export function useChordTrackGeometry({
  displayList,
  viewport,
  score,
  chords,
  grid,
  sticky,
  position,
  safeAreaLeft,
  safeAreaTop = 0,
  safeAreaBottom = 0,
  selection,
  hover,
  size,
}: GeometryArgs) {
  const system = useMemo(() => buildTrackSystems(displayList)[0], [displayList]);
  const scale = useMemo(() => chordTrackScale(displayList), [displayList]);
  const paintSystem = useMemo(() => (system ? scaleTrackSystem(system, 1 / scale) : null), [system, scale]);
  const paper = useMemo(() => computeHorizonPaperGeometry(displayList), [displayList]);
  const laneZoom = viewport.zoom * scale;
  const bottomInset = trackBottomInset(safeAreaBottom, sticky, size.bottomOverlay);
  const naturalRailScoreY =
    position === "above"
      ? paper.y - (CHORD_TRACK_GAP + LANE_HEIGHT) * scale
      : paper.y + paper.height + CHORD_TRACK_GAP * scale;
  const railY = trackLaneY(
    (naturalRailScoreY - viewport.scrollY) * viewport.zoom,
    LANE_HEIGHT * laneZoom,
    size.height,
    sticky,
    safeAreaTop,
    bottomInset,
  );
  const railScoreY = railY / viewport.zoom + viewport.scrollY;
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
  const surfaceStyle: CSSProperties = {
    left: Math.max(safeAreaLeft, header.left),
    right: 0,
    top: railY,
    height: LANE_HEIGHT * laneZoom,
  };
  return {
    system,
    scale,
    paintSystem,
    railScoreY,
    naturalRailScoreY,
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
    surfaceStyle,
    bottomInset,
  };
}
