/**
 * Geometry queries over a computed layout: pages, systems, measures, and the
 * mapping between musical positions and page-local canvas coordinates.
 */

import {
  beatToX,
  computeHorizonPaperGeometry,
  type DisplayList as RendererDisplayList,
  type MeasureBounds,
  type PageLayout,
} from "@viritura/renderer";
import { pageLayoutsOf } from "./displayListHandle";
import type {
  CanvasBeatHit,
  CanvasBeatPosition,
  HorizonPaper,
  MeasureGeometry,
  PageGeometry,
  PartInfo,
  PlayheadGeometry,
  ScoreMeasurements,
  ScorePosition,
  SystemGeometry,
} from "./types";

function boundsPartId(bounds: MeasureBounds): string {
  return bounds.partId || `#${bounds.partIndex}`;
}

/** Parts in the layout, in score order. */
export function layoutParts(displayList: RendererDisplayList): PartInfo[] {
  if (displayList.parts?.length) {
    return displayList.parts.map((part) => ({ id: part.id, index: part.index, name: part.name }));
  }
  const seen = new Map<string, PartInfo>();
  for (const bounds of displayList.measureBounds ?? []) {
    const id = boundsPartId(bounds);
    if (!seen.has(id)) seen.set(id, { id, index: bounds.partIndex, name: "" });
  }
  return [...seen.values()].sort((a, b) => a.index - b.index);
}

function pageIndexForY(pages: readonly PageLayout[], y: number): number {
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    if (y >= page.yOffset && y < page.yOffset + page.height) return i;
  }
  return Math.max(0, pages.length - 1);
}

export function measureLayout(displayList: RendererDisplayList): ScoreMeasurements {
  const pages: PageGeometry[] = pageLayoutsOf(displayList).map((page, index) => ({
    index,
    width: displayList.width,
    height: page.height,
    offsetY: page.yOffset,
  }));
  return {
    pageCount: pages.length,
    pages,
    totalHeight: pages.reduce((sum, page) => sum + page.height, 0),
    maxPageWidth: displayList.width,
    parts: layoutParts(displayList),
  };
}

function visibleBounds(displayList: RendererDisplayList): MeasureBounds[] {
  return (displayList.measureBounds ?? []).filter((bounds) => !bounds.ghostStaff && !bounds.isExpansion);
}

export function measureGeometry(displayList: RendererDisplayList): MeasureGeometry[] {
  const pages = pageLayoutsOf(displayList);
  return visibleBounds(displayList).map((bounds) => {
    const page = pageIndexForY(pages, bounds.y);
    return {
      index: bounds.index,
      ...(bounds.measureId ? { measureId: bounds.measureId } : {}),
      partId: boundsPartId(bounds),
      staffIndex: bounds.staffIndex,
      systemIndex: bounds.systemIndex ?? 0,
      page,
      x: bounds.x,
      y: bounds.y - pages[page]!.yOffset,
      width: bounds.width,
      height: bounds.height,
      contentX: bounds.x + bounds.prefixWidth,
      totalBeats: bounds.totalBeats,
    };
  });
}

export function systemGeometry(displayList: RendererDisplayList): SystemGeometry[] {
  const extents = new Map<number, { page: number; x1: number; y1: number; x2: number; y2: number }>();
  for (const measure of measureGeometry(displayList)) {
    const current = extents.get(measure.systemIndex);
    const x2 = measure.x + measure.width;
    const y2 = measure.y + measure.height;
    if (!current) {
      extents.set(measure.systemIndex, { page: measure.page, x1: measure.x, y1: measure.y, x2, y2 });
      continue;
    }
    current.x1 = Math.min(current.x1, measure.x);
    current.y1 = Math.min(current.y1, measure.y);
    current.x2 = Math.max(current.x2, x2);
    current.y2 = Math.max(current.y2, y2);
  }
  return [...extents.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, e]) => ({ index, page: e.page, x: e.x1, y: e.y1, width: e.x2 - e.x1, height: e.y2 - e.y1 }));
}

export function horizonPaper(displayList: RendererDisplayList): HorizonPaper {
  const paper = computeHorizonPaperGeometry(displayList);
  return { x: paper.x, y: paper.y, width: paper.width, height: paper.height, contentHeight: paper.contentHeight };
}

/** First (top) staff of each measure for one part, in measure order. */
function partMeasures(displayList: RendererDisplayList, partId: string | undefined): MeasureBounds[] {
  const bounds = visibleBounds(displayList);
  const target = partId ?? (bounds[0] ? boundsPartId(bounds[0]) : undefined);
  if (target == null) return [];
  const byMeasure = new Map<number, MeasureBounds>();
  for (const b of bounds) {
    if (boundsPartId(b) !== target) continue;
    const existing = byMeasure.get(b.index);
    if (!existing || b.staffIndex < existing.staffIndex) byMeasure.set(b.index, b);
  }
  return [...byMeasure.values()].sort((a, b) => a.index - b.index);
}

function xAtBeat(measures: MeasureBounds[], bounds: MeasureBounds, beatInMeasure: number): number {
  return beatToX({ measureIndex: bounds.index, beat: beatInMeasure }, measures) ?? bounds.x + bounds.prefixWidth;
}

function resolvePosition(
  displayList: RendererDisplayList,
  position: ScorePosition,
): { bounds: MeasureBounds; x: number } | null {
  const measures = partMeasures(displayList, position.partId);
  if ("measureIndex" in position) {
    const bounds = measures.find((m) => m.index === position.measureIndex);
    return bounds ? { bounds, x: xAtBeat(measures, bounds, position.beat) } : null;
  }
  let start = 0;
  for (const bounds of measures) {
    if (position.beat < start + bounds.totalBeats) {
      return { bounds, x: xAtBeat(measures, bounds, Math.max(0, position.beat - start)) };
    }
    start += bounds.totalBeats;
  }
  return null;
}

export function positionToCanvas(displayList: RendererDisplayList, position: ScorePosition): CanvasBeatPosition | null {
  const resolved = resolvePosition(displayList, position);
  if (!resolved) return null;
  const pages = pageLayoutsOf(displayList);
  const page = pageIndexForY(pages, resolved.bounds.y);
  return { page, x: resolved.x, y: resolved.bounds.y - pages[page]!.yOffset, height: resolved.bounds.height };
}

export function playheadAt(displayList: RendererDisplayList, position: ScorePosition): PlayheadGeometry | null {
  const resolved = resolvePosition(displayList, position);
  if (!resolved) return null;
  const systemIndex = resolved.bounds.systemIndex ?? 0;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const bounds of visibleBounds(displayList)) {
    if ((bounds.systemIndex ?? 0) !== systemIndex) continue;
    top = Math.min(top, bounds.y);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  const pages = pageLayoutsOf(displayList);
  const page = pageIndexForY(pages, resolved.bounds.y);
  return { page, x: resolved.x, y: top - pages[page]!.yOffset, height: bottom - top, systemIndex };
}

function beatInMeasureAtX(bounds: MeasureBounds, x: number): number {
  const anchors = bounds.beatAnchors;
  if (anchors && anchors.length >= 2) {
    if (x <= anchors[0]![1]) return anchors[0]![0];
    for (let i = 0; i < anchors.length - 1; i++) {
      const [b0, x0] = anchors[i]!;
      const [b1, x1] = anchors[i + 1]!;
      if (x >= x0 && x <= x1) return b0 + (x1 > x0 ? (x - x0) / (x1 - x0) : 0) * (b1 - b0);
    }
    return anchors[anchors.length - 1]![0];
  }
  const contentWidth = bounds.width - bounds.prefixWidth;
  if (bounds.totalBeats <= 0 || contentWidth <= 0) return 0;
  return (Math.max(0, x - bounds.x - bounds.prefixWidth) / contentWidth) * bounds.totalBeats;
}

export function canvasToBeat(
  displayList: RendererDisplayList,
  page: number,
  x: number,
  y: number,
): CanvasBeatHit | null {
  const pages = pageLayoutsOf(displayList);
  const absY = y + (pages[page]?.yOffset ?? 0);
  const hit = visibleBounds(displayList).find(
    (b) => x >= b.x && x <= b.x + b.width && absY >= b.y && absY <= b.y + b.height,
  );
  if (!hit) return null;
  const partId = boundsPartId(hit);
  const prior = partMeasures(displayList, partId)
    .filter((b) => b.index < hit.index)
    .reduce((sum, b) => sum + b.totalBeats, 0);
  return { beat: prior + beatInMeasureAtX(hit, x), measureIndex: hit.index, partId };
}
