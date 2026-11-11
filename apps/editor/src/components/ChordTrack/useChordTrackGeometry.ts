import { useCallback, useMemo, type CSSProperties } from "react";
import type { Score } from "@viritura/core";
import { computeHorizonPaperGeometry } from "@viritura/renderer";
import type { SelectionState } from "../../store/selectionStore";
import { buildTrackPoints, buildTrackSystems, LANE_HEIGHT, positionTrackChords } from "./trackGeometry";
import { CHORD_TRACK_GAP, chordTrackScale, scaleTrackSystem, trackLaneY, trackBottomInset } from "./trackViewport";
import { trackHeaderGeometry } from "./trackHeaderGeometry";
import { trackPositionEqual } from "./useChordTrackEditing";
import type { ChordTrackProps, TimedChord, TrackPoint, TrackSystem } from "./types";

function buildBeatPoints(system: TrackSystem, score: Score): TrackPoint[] {
  let time = { count: 4, unit: 4 };
  let nextMeasure = 0;
  return system.measures.flatMap((measure) => {
    while (nextMeasure <= measure.index) {
      time = score.global.measures[nextMeasure]?.time ?? time;
      nextMeasure++;
    }
    const step = time.count > 3 && time.count % 3 === 0 && time.unit >= 8 ? 12 / time.unit : 4 / time.unit;
    return buildTrackPoints({ ...system, measures: [measure] }, step);
  });
}

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
  const naturalRailY = (naturalRailScoreY - viewport.scrollY) * viewport.zoom;
  const railY = trackLaneY(naturalRailY, LANE_HEIGHT * laneZoom, size.height, sticky, safeAreaTop, bottomInset);
  const pinned = railY !== naturalRailY;
  const railScoreY = railY / viewport.zoom + viewport.scrollY;
  const scoreX = useCallback((x: number) => (x - viewport.scrollX) * viewport.zoom, [viewport.scrollX, viewport.zoom]);
  const allPoints = useMemo(
    () =>
      system && score
        ? buildTrackPoints(system, grid === "sixteenth" ? 0.25 : grid === "eighth" ? 0.5 : 1, chords)
        : [],
    [system, score, grid, chords],
  );
  const finePoints = useMemo(
    () => (system && score ? buildTrackPoints(system, 0.25, chords) : []),
    [system, score, chords],
  );
  const beatPoints = useMemo(() => (system && score ? buildBeatPoints(system, score) : []), [system, score]);
  const header = trackHeaderGeometry(scoreX(system?.measures[0]?.x ?? 0), laneZoom, true, safeAreaLeft);
  const positioned = useMemo(
    () =>
      paintSystem
        ? positionTrackChords(paintSystem, chords).map((entry) => ({
            ...entry,
            point: { ...entry.point, x: entry.point.x * scale },
            width: entry.width * scale,
          }))
        : [],
    [paintSystem, chords, scale],
  );
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
  const points = useMemo(
    () => allPoints.filter((point) => scoreX(point.x) >= header.right && scoreX(point.x) <= size.width),
    [allPoints, scoreX, header.right, size.width],
  );
  const laneVisible = railY < size.height && railY + LANE_HEIGHT * laneZoom > 0;
  const surfaceStyle: CSSProperties = {
    left: Math.max(safeAreaLeft, header.left),
    right: 0,
    top: railY,
    height: LANE_HEIGHT * laneZoom,
    borderRadius: 8 * laneZoom,
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
    pinned,
  };
}
