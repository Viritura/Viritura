/**
 * Helpers for useDiffEngine — canvas painting, geometry, and JSON utilities.
 */
import {
  getScoreInfo,
  wasmComputeFullScoreLayout,
  wasmComputeLayout,
  paintCommandsCulled,
  type DisplayList,
  GlyphAtlas,
} from "@viritura/renderer";
import type { DiffNode } from "../diff/semanticDiff";
import { getMeasureOverallStatus, type MeasureDiffResult } from "../diff/measureDiff";
import type { MeasureBounds } from "../diff/measureBounds";

export const ATLAS_FONT_SIZE = 48;
const FOCUS_BORDER = "rgba(25, 118, 210, 0.85)";
const FOCUS_MARKER_SIZE = 6;

const OVERLAY_COLORS: Record<string, string> = {
  "original-modified": "rgba(198, 40, 40, 0.18)",
  "original-removed": "rgba(198, 40, 40, 0.18)",
  "modified-modified": "rgba(46, 125, 50, 0.18)",
  "modified-added": "rgba(46, 125, 50, 0.18)",
};
const OVERLAY_COLORS_DIM: Record<string, string> = {
  "original-modified": "rgba(198, 40, 40, 0.06)",
  "original-removed": "rgba(198, 40, 40, 0.06)",
  "modified-modified": "rgba(46, 125, 50, 0.06)",
  "modified-added": "rgba(46, 125, 50, 0.06)",
};
const BORDER_COLORS: Record<string, string> = {
  "original-modified": "rgba(198, 40, 40, 0.4)",
  "original-removed": "rgba(198, 40, 40, 0.4)",
  "modified-modified": "rgba(46, 125, 50, 0.4)",
  "modified-added": "rgba(46, 125, 50, 0.4)",
};
const BORDER_COLORS_DIM: Record<string, string> = {
  "original-modified": "rgba(198, 40, 40, 0.12)",
  "original-removed": "rgba(198, 40, 40, 0.12)",
  "modified-modified": "rgba(46, 125, 50, 0.12)",
  "modified-added": "rgba(46, 125, 50, 0.12)",
};

export interface FocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function repaintCanvas(
  canvas: HTMLCanvasElement,
  dl: DisplayList,
  scrollX: number,
  scrollY: number,
  zoom: number,
  glyphAtlas: GlyphAtlas | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  // Bake glyphs at the exact device scale this frame paints at, so atlas blits
  // are 1:1 with device pixels instead of being resampled (and aliased).
  glyphAtlas?.ensureDeviceScale(dpr * zoom);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -scrollX * dpr * zoom, -scrollY * dpr * zoom);

  // Cull off-screen commands so each frame only paints the visible slice of the
  // score, not the entire galley. A Review-mode full-score horizon can be
  // hundreds of measures wide and is painted twice (original + modified), so
  // iterating every command per frame dominated scroll cost. The visible rect
  // is in content (pre-zoom) coordinates; pad it so glyphs straddling the edge
  // aren't clipped. Mirrors the main canvas's direct-paint cull.
  const CULL_MARGIN = 64;
  const viewW = canvas.width / (dpr * zoom);
  const viewH = canvas.height / (dpr * zoom);
  const cullX1 = scrollX - CULL_MARGIN;
  const cullY1 = scrollY - CULL_MARGIN;
  const cullX2 = scrollX + viewW + CULL_MARGIN;
  const cullY2 = scrollY + viewH + CULL_MARGIN;
  paintCommandsCulled(ctx, dl.commands, glyphAtlas, cullX1, cullX2, cullY1, cullY2);
}

export function computeLayout(json: string, _pageWidth: number): DisplayList | null {
  try {
    JSON.parse(json);
    const info = getScoreInfo(json);
    return info.partCount > 1 ? wasmComputeFullScoreLayout(json, 12, 0) : wasmComputeLayout(json, 0, 12, 0);
  } catch {
    return null;
  }
}

/**
 * Returns a copy of the raw MNX JSON string with `scores[*].useWritten`
 * set to the given flag. Presentation-only override used by Review's
 * concert/written pitch toggle — does not mutate the source document.
 */
export function applyUseWrittenOverride(json: string, useWritten: boolean): string {
  try {
    const parsed = JSON.parse(json) as { scores?: Array<{ useWritten?: boolean }> };
    if (Array.isArray(parsed.scores)) {
      for (const score of parsed.scores) {
        score.useWritten = useWritten;
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return json;
  }
}

interface FindMeasureState {
  partIndex: number;
  measureIndex: number;
  inGlobalMeasures: boolean;
  inParts: boolean;
  inPartMeasures: boolean;
  currentPartIndex: number;
  currentMeasureIndex: number;
}

function processFindMeasureChar(
  ch: string,
  lineNo: number,
  state: FindMeasureState,
  bracketStack: string[],
): number | null {
  if (ch === "{" || ch === "[") {
    bracketStack.push(ch);
    if (
      state.inGlobalMeasures &&
      state.partIndex === -1 &&
      ch === "{" &&
      state.currentMeasureIndex < state.measureIndex
    ) {
      state.currentMeasureIndex++;
      if (state.currentMeasureIndex === state.measureIndex) return lineNo + 1;
    }
    if (
      state.inParts &&
      state.partIndex >= 0 &&
      !state.inPartMeasures &&
      ch === "{" &&
      state.currentPartIndex < state.partIndex
    ) {
      state.currentPartIndex++;
    }
    if (
      state.inPartMeasures &&
      state.currentPartIndex === state.partIndex &&
      ch === "{" &&
      state.currentMeasureIndex < state.measureIndex
    ) {
      state.currentMeasureIndex++;
      if (state.currentMeasureIndex === state.measureIndex) return lineNo + 1;
    }
  } else if (ch === "}" || ch === "]") {
    bracketStack.pop();
  }
  return null;
}

export function findMeasureLine(json: string, partIndex: number, measureIndex: number): number {
  if (measureIndex < 0) return 1;
  const lines = json.split("\n");
  const state: FindMeasureState = {
    partIndex,
    measureIndex,
    inGlobalMeasures: false,
    inParts: false,
    inPartMeasures: false,
    currentPartIndex: -1,
    currentMeasureIndex: -1,
  };
  const bracketStack: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    const depth = bracketStack.length;
    if (partIndex === -1 && trimmed.includes('"measures"') && depth <= 2) {
      state.inGlobalMeasures = true;
      state.currentMeasureIndex = -1;
    } else if (partIndex >= 0 && trimmed.includes('"parts"')) {
      state.inParts = true;
      state.currentPartIndex = -1;
    }
    for (const ch of trimmed) {
      const hit = processFindMeasureChar(ch, i, state, bracketStack);
      if (hit !== null) return hit;
    }
    if (state.inParts && state.currentPartIndex === partIndex && trimmed.includes('"measures"')) {
      state.inPartMeasures = true;
      state.currentMeasureIndex = -1;
    }
  }
  return 1;
}

function collectEventIdsFromContentPath(node: DiffNode, mnxJson: string, ids: Set<string>): void {
  const contentMatch = node.path.match(/parts\[(\d+)\]\.measures\[(\d+)\]\.sequences\[(\d+)\]\.content\[(\d+)\]/);
  if (!contentMatch || !mnxJson || node.type === "unchanged") return;
  ids.add(`p${contentMatch[1]}/m${contentMatch[2]}/v${contentMatch[3]}/e${contentMatch[4]}`);
  try {
    const doc = JSON.parse(mnxJson);
    const event =
      doc?.parts?.[Number(contentMatch[1])]?.measures?.[Number(contentMatch[2])]?.sequences?.[Number(contentMatch[3])]
        ?.content?.[Number(contentMatch[4])];
    if (event?.id) ids.add(event.id);
    if (Array.isArray(event?.notes)) {
      for (const note of event.notes) {
        if (note?.id) ids.add(note.id);
      }
    }
  } catch {
    /* ignore */
  }
}

function collectEventIds(node: DiffNode, mnxJson: string): Set<string> {
  const ids = new Set<string>();
  const isLeaf = !node.children || node.children.length === 0;
  collectEventIdsFromContentPath(node, mnxJson, ids);
  if (isLeaf && node.type !== "unchanged") {
    const json = node.beforeJson ?? node.afterJson ?? "";
    const idMatch = json.match(/"id"\s*:\s*"([^"]+)"/);
    if (idMatch?.[1]) ids.add(idMatch[1]);
  }
  if (node.children) {
    for (const child of node.children) {
      for (const id of collectEventIds(child, mnxJson)) ids.add(id);
    }
  }
  return ids;
}

function cmdPosition(cmd: DisplayList["commands"][number]): { x: number; y: number } | null {
  switch (cmd.type) {
    case "DrawGlyph":
    case "DrawText":
      return { x: cmd.x, y: cmd.y };
    case "DrawRect":
      return { x: cmd.x, y: cmd.y };
    case "DrawLine":
      return { x: Math.min(cmd.x1, cmd.x2), y: Math.min(cmd.y1, cmd.y2) };
    case "DrawCircle":
      return { x: cmd.cx, y: cmd.cy };
    case "DrawEllipse":
      return { x: cmd.cx, y: cmd.cy };
    default:
      return null;
  }
}

function cmdBounds(cmd: DisplayList["commands"][number]): FocusRect | null {
  switch (cmd.type) {
    case "DrawGlyph": {
      const ascent = cmd.size * 0.75;
      const descent = cmd.size * 0.25;
      return { x: cmd.x, y: cmd.y - ascent, w: cmd.size, h: ascent + descent };
    }
    case "DrawText": {
      const ascent = cmd.size * 0.75;
      const descent = cmd.size * 0.25;
      return { x: cmd.x, y: cmd.y - ascent, w: cmd.text.length * cmd.size * 0.6, h: ascent + descent };
    }
    case "DrawRect":
      return { x: cmd.x, y: cmd.y, w: cmd.w, h: cmd.h };
    case "DrawLine":
      return {
        x: Math.min(cmd.x1, cmd.x2),
        y: Math.min(cmd.y1, cmd.y2),
        w: Math.abs(cmd.x2 - cmd.x1) || 1,
        h: Math.abs(cmd.y2 - cmd.y1) || 1,
      };
    case "DrawCircle":
      return { x: cmd.cx - cmd.r, y: cmd.cy - cmd.r, w: cmd.r * 2, h: cmd.r * 2 };
    default:
      return null;
  }
}

interface BoundsAcc {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  found: boolean;
}

function expandBoundsFromEventIds(eventIds: Set<string>, dl: DisplayList, acc: BoundsAcc): void {
  for (const eb of dl.elementBboxes!) {
    if (!eb.elementId) continue;
    if (!eventIds.has(eb.elementId) && ![...eventIds].some((id) => eb.elementId?.endsWith(`/${id}`))) continue;
    acc.found = true;
    acc.minX = Math.min(acc.minX, eb.bbox.x);
    acc.minY = Math.min(acc.minY, eb.bbox.y);
    acc.maxX = Math.max(acc.maxX, eb.bbox.x + eb.bbox.width);
    acc.maxY = Math.max(acc.maxY, eb.bbox.y + eb.bbox.height);
  }
}

function collectGlyphsInRange(commands: DisplayList["commands"], xStart: number, xEnd: number) {
  const glyphs: Array<{ cmd: DisplayList["commands"][number]; sig: string }> = [];
  for (const cmd of commands) {
    if (cmd.type !== "DrawGlyph" && cmd.type !== "DrawText") continue;
    const pos = cmdPosition(cmd);
    if (!pos || pos.x < xStart || pos.x > xEnd) continue;
    const sig = cmd.type === "DrawGlyph" ? `glyph:${cmd.codepoint}` : `text:${(cmd as { text: string }).text}`;
    glyphs.push({ cmd, sig });
  }
  return glyphs;
}

function expandBoundsFromGlyphDiff(dl: DisplayList, otherDl: DisplayList, mb: MeasureBounds, acc: BoundsAcc): void {
  const thisGlyphs = collectGlyphsInRange(dl.commands, mb.xStart, mb.xEnd);
  const otherGlyphs = collectGlyphsInRange(otherDl.commands, mb.xStart - 50, mb.xEnd + 50);
  const otherSigs = new Map<string, number>();
  for (const g of otherGlyphs) otherSigs.set(g.sig, (otherSigs.get(g.sig) ?? 0) + 1);
  const thisSigCounts = new Map<string, number>();
  for (const g of thisGlyphs) thisSigCounts.set(g.sig, (thisSigCounts.get(g.sig) ?? 0) + 1);
  for (const g of thisGlyphs) {
    const thisCount = thisSigCounts.get(g.sig) ?? 0;
    const otherCount = otherSigs.get(g.sig) ?? 0;
    if (thisCount <= otherCount) continue;
    const bounds = cmdBounds(g.cmd);
    if (bounds) {
      acc.found = true;
      acc.minX = Math.min(acc.minX, bounds.x);
      acc.minY = Math.min(acc.minY, bounds.y);
      acc.maxX = Math.max(acc.maxX, bounds.x + bounds.w);
      acc.maxY = Math.max(acc.maxY, bounds.y + bounds.h);
    }
    thisSigCounts.set(g.sig, thisCount - 1);
  }
}

function computeMeasureRectForNode(
  node: DiffNode,
  dl: DisplayList,
  measureBounds: MeasureBounds[],
  mnxJson: string,
  otherDl: DisplayList | null | undefined,
  side: "original" | "modified",
): { measureIdx: number; rect: FocusRect } | null {
  const partsMatch = node.path.match(/parts\[\d+\]\.measures\[(\d+)\]/);
  const globalMatch = node.path.match(/global\.measures\[(\d+)\]/);
  const match = partsMatch ?? globalMatch;
  if (match?.[1] == null) return null;
  const measureIdx = Number(match[1]);

  const eventIds = collectEventIds(node, mnxJson);
  const acc: BoundsAcc = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, found: false };

  if (eventIds.size > 0) expandBoundsFromEventIds(eventIds, dl, acc);

  if (!acc.found && side === "modified" && eventIds.size === 0) {
    const mb = measureBounds.find((b) => b.measureIndex === measureIdx);
    if (mb && otherDl) expandBoundsFromGlyphDiff(dl, otherDl, mb, acc);
  }

  if (!acc.found) return null;
  const pad = 4;
  return {
    measureIdx,
    rect: { x: acc.minX - pad, y: acc.minY - pad, w: acc.maxX - acc.minX + pad * 2, h: acc.maxY - acc.minY + pad * 2 },
  };
}

export function computeAllMeasureRects(
  diffTree: DiffNode | null,
  dl: DisplayList,
  measureBounds: MeasureBounds[],
  mnxJson: string,
  otherDl?: DisplayList | null,
  side: "original" | "modified" = "modified",
): Map<number, FocusRect> {
  const rects = new Map<number, FocusRect>();
  if (!diffTree || !dl.elementBboxes || dl.elementBboxes.length === 0) return rects;

  function visitNode(node: DiffNode) {
    if (node.type === "unchanged") return;
    const result = computeMeasureRectForNode(node, dl, measureBounds, mnxJson, otherDl, side);
    if (result && !rects.has(result.measureIdx)) {
      rects.set(result.measureIdx, result.rect);
    }
    if (node.children) {
      for (const child of node.children) visitNode(child);
    }
  }
  visitNode(diffTree);
  return rects;
}

export function paintDiffOverlays(
  ctx: CanvasRenderingContext2D,
  bounds: MeasureBounds[],
  diff: MeasureDiffResult,
  side: "original" | "modified",
  scoreHeight: number,
  focusedMeasure: number | null = null,
  measureRects: Map<number, FocusRect> = new Map(),
) {
  ctx.save();
  for (const mb of bounds) {
    const status = getMeasureOverallStatus(diff, mb.measureIndex);
    if (status === "unchanged") continue;
    const isFocused = focusedMeasure === mb.measureIndex;
    const isDimmed = focusedMeasure !== null && !isFocused;
    const overlayKey = `${side}-${status}`;
    const fillColor = isDimmed ? OVERLAY_COLORS_DIM[overlayKey] : OVERLAY_COLORS[overlayKey];
    const borderColor = isDimmed ? BORDER_COLORS_DIM[overlayKey] : BORDER_COLORS[overlayKey];
    if (!fillColor) continue;

    const eventRect = measureRects.get(mb.measureIndex);
    if (eventRect) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(eventRect.x, eventRect.y, eventRect.w, eventRect.h);
      if (borderColor) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(eventRect.x, eventRect.y, eventRect.w, eventRect.h);
      }
    } else {
      const pad = 2;
      const x = mb.xStart - pad;
      const w = mb.xEnd - mb.xStart + pad * 2;
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, 0, w, scoreHeight);
      if (borderColor) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, 0, w, scoreHeight);
      }
    }
  }
  ctx.restore();
}

export function paintFocusIndicator(ctx: CanvasRenderingContext2D, fr: FocusRect) {
  ctx.strokeStyle = FOCUS_BORDER;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(fr.x, fr.y, fr.w, fr.h);
  ctx.setLineDash([]);
  const cx = fr.x + fr.w / 2;
  ctx.fillStyle = FOCUS_BORDER;
  ctx.beginPath();
  ctx.moveTo(cx - FOCUS_MARKER_SIZE, fr.y);
  ctx.lineTo(cx + FOCUS_MARKER_SIZE, fr.y);
  ctx.lineTo(cx, fr.y + FOCUS_MARKER_SIZE);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - FOCUS_MARKER_SIZE, fr.y + fr.h);
  ctx.lineTo(cx + FOCUS_MARKER_SIZE, fr.y + fr.h);
  ctx.lineTo(cx, fr.y + fr.h - FOCUS_MARKER_SIZE);
  ctx.closePath();
  ctx.fill();
}
