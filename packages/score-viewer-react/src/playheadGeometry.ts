import { beatToX, findSystemYExtent, type StaffInfo } from "@viritura/renderer";
import type { CanvasBeatPosition, DisplayList, Engine, PageLayout } from "@viritura/score-engine";

interface SourcePosition {
  readonly measureIndex: number;
  readonly beat: number;
}

interface PagePosition {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ResolvePlayheadGeometryOptions {
  readonly engine: Engine | null;
  readonly displayList: DisplayList | null;
  readonly beat?: number;
  readonly position?: SourcePosition;
  readonly partId?: string;
  readonly zoom: number;
  readonly pageLayouts: readonly PageLayout[];
  readonly pagePositions: readonly PagePosition[];
  readonly staves: readonly StaffInfo[];
}

export interface ScorePlayheadGeometry {
  readonly left: number;
  readonly top: number;
  readonly height: number;
  readonly sourceX: number;
  readonly localY: number;
  readonly sourceHeight: number;
}

function resolveCanvasPlayhead(
  engine: Engine,
  displayList: DisplayList,
  pageLayouts: readonly PageLayout[],
  position: SourcePosition | undefined,
  beat: number | undefined,
  partId: string | undefined,
): CanvasBeatPosition | null {
  const firstPartIndex = displayList.measureBounds?.[0]?.partIndex;
  const targetPart = partId ?? (firstPartIndex != null ? `p${firstPartIndex + 1}` : "p1");
  if (!position || !displayList.measureBounds) {
    return beat == null ? null : engine.beatToCanvas(displayList, beat, targetPart);
  }

  const bounds =
    displayList.measureBounds.find(
      (candidate) => candidate.index === position.measureIndex && candidate.partIndex === firstPartIndex,
    ) ?? displayList.measureBounds.find((candidate) => candidate.index === position.measureIndex);
  const x = beatToX(position, displayList.measureBounds);
  if (!bounds || x == null) return null;
  const page = Math.max(
    0,
    pageLayouts.findIndex(
      (pageLayout) => bounds.y >= pageLayout.yOffset && bounds.y < pageLayout.yOffset + pageLayout.height,
    ),
  );
  return { page, x, y: bounds.y, height: bounds.height };
}

function systemYRange(displayList: DisplayList, systemIndex: number | undefined) {
  if (systemIndex == null) return undefined;
  return displayList.measureBounds?.reduce<{ yTop: number; yBottom: number } | undefined>((extent, bounds) => {
    if (bounds.systemIndex !== systemIndex) return extent;
    return {
      yTop: Math.min(extent?.yTop ?? Number.POSITIVE_INFINITY, bounds.y),
      yBottom: Math.max(extent?.yBottom ?? Number.NEGATIVE_INFINITY, bounds.y + bounds.height),
    };
  }, undefined);
}

function resolveSystemExtent(
  displayList: DisplayList,
  staves: readonly StaffInfo[],
  playhead: CanvasBeatPosition,
  pageLayouts: readonly PageLayout[],
): { yTop: number; yBottom: number } {
  const pageLayout = pageLayouts[playhead.page]!;
  const anchorBounds = displayList.measureBounds?.find(
    (bounds) => bounds.y === playhead.y && playhead.x >= bounds.x && playhead.x <= bounds.x + bounds.width,
  );
  const nextPage = pageLayouts[playhead.page + 1];
  return (
    findSystemYExtent(
      [...staves],
      playhead.x,
      { yOffset: pageLayout.yOffset, yEnd: nextPage?.yOffset ?? Number.POSITIVE_INFINITY },
      systemYRange(displayList, anchorBounds?.systemIndex),
    ) ?? { yTop: playhead.y, yBottom: playhead.y + playhead.height }
  );
}

export function resolveScorePlayheadGeometry(options: ResolvePlayheadGeometryOptions): ScorePlayheadGeometry | null {
  const { engine, displayList, beat, position, partId, zoom, pageLayouts, pagePositions, staves } = options;
  if (!engine || !displayList) return null;

  const playheadPosition = resolveCanvasPlayhead(engine, displayList, pageLayouts, position, beat, partId);
  if (!playheadPosition) return null;

  const pageLayout = pageLayouts[playheadPosition.page];
  const pagePosition = pagePositions[playheadPosition.page];
  if (!pageLayout || !pagePosition) return null;

  const { yTop, yBottom } = resolveSystemExtent(displayList, staves, playheadPosition, pageLayouts);
  const localY = yTop - pageLayout.yOffset;

  return {
    left: pagePosition.x + playheadPosition.x * zoom,
    top: pagePosition.y + localY * zoom,
    height: (yBottom - yTop) * zoom,
    sourceX: playheadPosition.x,
    localY,
    sourceHeight: yBottom - yTop,
  };
}
