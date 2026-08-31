/**
 * Extract per-measure X boundaries from a DisplayList.
 *
 * Uses element IDs (format: "p{part}/m{measure}/...") to determine
 * which render commands belong to which measure, then computes
 * the X extent of each measure.
 */

import type { DisplayList, RenderCommand } from "@viritura/renderer";

/** X boundaries of a single measure in the rendered score. */
export interface MeasureBounds {
  measureIndex: number;
  xStart: number;
  xEnd: number;
  yStart: number;
  yEnd: number;
}

/**
 * Extract measure X boundaries from a DisplayList's element IDs.
 * Falls back to uniform division if no element IDs are available.
 */
export function extractMeasureBounds(dl: DisplayList, measureCount: number): MeasureBounds[] {
  // Try to use element IDs first
  if (dl.elementIds && dl.elementIds.length > 0) {
    const bounds = extractFromElementIds(dl);
    if (bounds.length > 0) return bounds;
  }

  // Fallback: divide score width uniformly
  return uniformBounds(dl.width, dl.height, measureCount);
}

/** Parse measure index from an element ID like "p0/m3/s0/ev-1" or "m3/time". */
function parseMeasureIndex(elementId: string): number | null {
  const match = elementId.match(/(?:^|\/)(m(\d+))(?:\/|$)/);
  if (match && match[2] !== undefined) return parseInt(match[2], 10);
  return null;
}

/** Get command X position (leftmost point). */
function commandMinX(cmd: RenderCommand): number | null {
  switch (cmd.type) {
    case "DrawGlyph":
    case "DrawText":
      return cmd.x;
    case "DrawRect":
      return cmd.x;
    case "DrawLine":
      return Math.min(cmd.x1, cmd.x2);
    case "DrawCircle":
      return cmd.cx - cmd.r;
    case "DrawEllipse":
      return cmd.cx - cmd.rx;
    case "DrawBezier":
    case "DrawQuadratic":
      return Math.min(cmd.x1, cmd.x2);
    case "DrawFilledBezier":
      return Math.min(cmd.x1, cmd.x2);
    case "DrawPolygon": {
      if (cmd.points.length === 0) return null;
      return Math.min(...cmd.points.map((p) => p[0]));
    }
    default:
      return null;
  }
}

/** Get command rightmost X position. */
function commandMaxX(cmd: RenderCommand): number | null {
  switch (cmd.type) {
    case "DrawGlyph":
      return cmd.x + cmd.size * 0.6;
    case "DrawText":
      return cmd.x + cmd.text.length * cmd.size * 0.5;
    case "DrawRect":
      return cmd.x + cmd.w;
    case "DrawLine":
      return Math.max(cmd.x1, cmd.x2);
    case "DrawCircle":
      return cmd.cx + cmd.r;
    case "DrawEllipse":
      return cmd.cx + cmd.rx;
    case "DrawBezier":
    case "DrawQuadratic":
      return Math.max(cmd.x1, cmd.x2);
    case "DrawFilledBezier":
      return Math.max(cmd.x1, cmd.x2);
    case "DrawPolygon": {
      if (cmd.points.length === 0) return null;
      return Math.max(...cmd.points.map((p) => p[0]));
    }
    default:
      return null;
  }
}

/** Get command Y extent. */
function commandMinY(cmd: RenderCommand): number | null {
  switch (cmd.type) {
    case "DrawGlyph":
      return cmd.y - cmd.size;
    case "DrawText":
      return cmd.y - cmd.size;
    case "DrawRect":
      return cmd.y;
    case "DrawLine":
      return Math.min(cmd.y1, cmd.y2);
    case "DrawCircle":
      return cmd.cy - cmd.r;
    case "DrawEllipse":
      return cmd.cy - cmd.ry;
    default:
      return null;
  }
}

function commandMaxY(cmd: RenderCommand): number | null {
  switch (cmd.type) {
    case "DrawGlyph":
      return cmd.y + cmd.size * 0.2;
    case "DrawText":
      return cmd.y + cmd.size * 0.3;
    case "DrawRect":
      return cmd.y + cmd.h;
    case "DrawLine":
      return Math.max(cmd.y1, cmd.y2);
    case "DrawCircle":
      return cmd.cy + cmd.r;
    case "DrawEllipse":
      return cmd.cy + cmd.ry;
    default:
      return null;
  }
}

function extractFromElementIds(dl: DisplayList): MeasureBounds[] {
  const measureExtents = new Map<number, { minX: number; maxX: number; minY: number; maxY: number }>();

  for (let i = 0; i < dl.commands.length; i++) {
    const eid = dl.elementIds![i];
    if (!eid) continue;

    const mIdx = parseMeasureIndex(eid);
    if (mIdx === null) continue;

    const cmd = dl.commands[i];
    if (!cmd) continue;

    const minX = commandMinX(cmd);
    const maxX = commandMaxX(cmd);
    const minY = commandMinY(cmd);
    const maxY = commandMaxY(cmd);
    if (minX === null || maxX === null) continue;

    const existing = measureExtents.get(mIdx);
    if (existing) {
      existing.minX = Math.min(existing.minX, minX);
      existing.maxX = Math.max(existing.maxX, maxX);
      if (minY !== null) existing.minY = Math.min(existing.minY, minY);
      if (maxY !== null) existing.maxY = Math.max(existing.maxY, maxY);
    } else {
      measureExtents.set(mIdx, {
        minX,
        maxX,
        minY: minY ?? 0,
        maxY: maxY ?? dl.height,
      });
    }
  }

  const bounds: MeasureBounds[] = [];
  for (const [mIdx, ext] of measureExtents) {
    bounds.push({
      measureIndex: mIdx,
      xStart: ext.minX,
      xEnd: ext.maxX,
      yStart: ext.minY,
      yEnd: ext.maxY,
    });
  }

  bounds.sort((a, b) => a.measureIndex - b.measureIndex);
  return bounds;
}

function uniformBounds(width: number, height: number, measureCount: number): MeasureBounds[] {
  if (measureCount <= 0) return [];
  const marginLeft = 40;
  const usableWidth = width - marginLeft;
  const measureWidth = usableWidth / measureCount;

  const bounds: MeasureBounds[] = [];
  for (let i = 0; i < measureCount; i++) {
    bounds.push({
      measureIndex: i,
      xStart: marginLeft + i * measureWidth,
      xEnd: marginLeft + (i + 1) * measureWidth,
      yStart: 0,
      yEnd: height,
    });
  }
  return bounds;
}

/**
 * Compute X boundaries for each measure in the display list.
 * Uses element IDs to group commands by measure.
 */
export function computeMeasureBounds(dl: DisplayList): MeasureBounds[] {
  if (dl.elementIds && dl.elementIds.length > 0) {
    return extractFromElementIds(dl);
  }
  return [];
}

/**
 * Find the X position to scroll to for a given measure index.
 * Returns the center X of the measure, or null if not found.
 */
export function getMeasureCenterX(bounds: MeasureBounds[], measureIndex: number): number | null {
  const measure = bounds.find((b) => b.measureIndex === measureIndex);
  if (!measure) return null;
  return (measure.xStart + measure.xEnd) / 2;
}
