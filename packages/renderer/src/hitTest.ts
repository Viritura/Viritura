/**
 * Hit-testing and spatial index for mapping canvas coordinates to element IDs.
 *
 * Two approaches:
 * 1. SpatialIndex class (preferred) — flat bounding-box entries sorted by x.
 * 2. buildHitRegions / hitTest functions — computes approximate bboxes from render commands + element IDs.
 */

import type { DisplayList, RenderCommand } from "./wasm";
import { paintBeatRuler, type RulerTick } from "./beatRuler";

// ── Element type classification ──────────────────────────────────────

/** Known element types derived from element ID patterns. */
export type ScoreElementType =
  | "clef"
  | "time"
  | "key"
  | "barline"
  | "event"
  | "slur"
  | "tie"
  | "dynamics"
  | "hairpin"
  | "pedal"
  | "ottava"
  | "volta"
  | "note"
  | "accidental"
  | "unknown";

/**
 * Classify an element ID into a ScoreElementType.
 *
 * ID patterns (from Rust engine render_geometry.rs and spanner renderers):
 * - `p{part}/m{measure}/clef`       → clef
 * - `p{part}/m{measure}/time`       → time (synonym: `m{m}/time`)
 * - `p{part}/m{measure}/key`        → key
 * - `p{part}/m{measure}/barline`    → barline
 * - `p{part}/m{measure}/v{v}/e{e}`  → event (also `p{p}/m{m}/s{s}/{id}`)
 * - `p{part}/m{measure}/dyn{i}`     → dynamics
 * - `p{part}/m{measure}/hairpin{i}` → hairpin
 * - `p{part}/m{measure}/pedal{i}`   → pedal
 * - `p{part}/m{measure}/ottava{i}`  → ottava
 * - `p{part}/m{measure}/volta{i}`   → volta
 */
export function getElementType(id: string): ScoreElementType {
  if (id.startsWith("slur/")) return "slur";
  if (id.startsWith("tie/")) return "tie";
  const last = id.slice(id.lastIndexOf("/") + 1);
  if (last === "clef") return "clef";
  if (last === "time") return "time";
  if (last === "key") return "key";
  if (last === "barline") return "barline";
  if (last.startsWith("dyn")) return "dynamics";
  if (last.startsWith("hairpin")) return "hairpin";
  if (last.startsWith("pedal")) return "pedal";
  if (last.startsWith("ottava")) return "ottava";
  if (last.startsWith("volta")) return "volta";
  if (/^n\d/.test(last)) return "note";
  if (/^acc\d/.test(last)) return "accidental";
  // Events: v{voice}/e{idx}, s{seq}/{id}, or bare event IDs
  if (/^[ve]/.test(last) || id.includes("/s") || id.includes("/v")) return "event";
  return "unknown";
}

// ── ElementBBox (flat) ───────────────────────────────────────────────

/** A bounding box for a logical element in the display list. */
export interface ElementBBox {
  /** The element ID (e.g. "p0/m1/s0/ev-1"). */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ── SpatialIndex ─────────────────────────────────────────────────────

/**
 * Spatial index for hit-testing rendered score elements.
 *
 * Prefers precise element bounding boxes from the Rust layout engine when
 * available (clefs, time/key signatures, barlines, events, dynamics, and
 * spanners). Falls back to approximating bboxes from render commands.
 */
export class SpatialIndex {
  /** Entries sorted by x-coordinate for binary-search. */
  private readonly entries: ElementBBox[];

  /** Y coordinate of the most recent hit-test, used to disambiguate duplicate staves. */
  lastHitY = 0;

  constructor(entries: ElementBBox[]) {
    this.entries = entries.slice().sort((a, b) => a.x - b.x);
  }

  /** Build a spatial index from a DisplayList.
   *
   * Prefers engine-provided `elementBboxes` (precise, from Rust layout engine).
   * Falls back to approximating bboxes from render commands when bboxes are
   * not available (e.g. older engine versions or JSON-only output).
   */
  static fromDisplayList(dl: DisplayList): SpatialIndex {
    // Prefer engine-provided element bboxes (precise, computed by Rust layout)
    if (dl.elementBboxes && dl.elementBboxes.length > 0) {
      return SpatialIndex.fromElementBboxes(dl);
    }
    return SpatialIndex.fromCommands(dl);
  }

  /**
   * Build from engine-provided element bounding boxes.
   * These are precise bboxes computed during Rust layout (render_geometry.rs).
   * Supplements with command-derived bboxes for tagged commands not covered
   * by element_bboxes (e.g., spanners, text annotations).
   */
  private static fromElementBboxes(dl: DisplayList): SpatialIndex {
    const entries: ElementBBox[] = [];
    const seen = new Set<string>();
    // Index entries by elementId so the same-staff lookup below is O(1) per
    // bbox instead of a linear scan of `entries`. Without this the loop is
    // O(n²) and a large orchestral score (100k+ bboxes) stalls the thread for
    // tens of seconds. Each id maps to the (usually 1–2) entries already
    // pushed for that element across staves.
    const byId = new Map<string, ElementBBox[]>();

    // Add all engine-provided bboxes
    for (const eb of dl.elementBboxes!) {
      // Find an existing entry with the same ID that's on the same staff
      // (close in Y). Entries far apart in Y are on different staves and
      // should remain separate (e.g. condensed + expansion staves).
      const bucket = byId.get(eb.elementId);
      const existing = bucket?.find((e) => Math.abs(e.y - eb.bbox.y) < 60);
      if (!existing) {
        seen.add(eb.elementId);
        const entry: ElementBBox = {
          id: eb.elementId,
          x: eb.bbox.x,
          y: eb.bbox.y,
          width: eb.bbox.width,
          height: eb.bbox.height,
        };
        entries.push(entry);
        if (bucket) bucket.push(entry);
        else byId.set(eb.elementId, [entry]);
      } else {
        // Merge bboxes for the same element on the same staff (e.g. multi-measure spanners)
        mergeBBox(existing, eb.bbox.x, eb.bbox.y, eb.bbox.width, eb.bbox.height);
      }
    }

    // Expand barline hitboxes:
    // 1. Horizontal padding — barlines are thin and hard to click.
    // 2. Vertical extension — each per-staff barline bbox extends to fill
    //    the gap between staves so clicking between staves still hits the
    //    barline. Each barline extends downward to the midpoint between its
    //    bottom edge and the next staff's barline top edge, and upward to
    //    the midpoint between its top and the previous staff's bottom.
    const BARLINE_H_PAD = 3;
    const barlineEntries = entries.filter((e) => e.id.endsWith("/barline"));
    // Group by barline ID to find entries for the same barline across staves
    const barlineGroups = new Map<string, ElementBBox[]>();
    for (const be of barlineEntries) {
      const group = barlineGroups.get(be.id) ?? [];
      group.push(be);
      barlineGroups.set(be.id, group);
    }
    for (const group of barlineGroups.values()) {
      // Sort by Y position (top staff first)
      group.sort((a, b) => a.y - b.y);
      for (let i = 0; i < group.length; i++) {
        const entry = group[i]!;
        // Horizontal padding
        (entry as { x: number }).x -= BARLINE_H_PAD;
        (entry as { width: number }).width += BARLINE_H_PAD * 2;
        // Vertical extension: extend to fill gaps between staves
        if (i > 0) {
          const prevBottom = group[i - 1]!.y + group[i - 1]!.height;
          const mid = (prevBottom + entry.y) / 2;
          const oldTop = entry.y;
          (entry as { y: number }).y = mid;
          (entry as { height: number }).height += oldTop - mid;
        }
        if (i < group.length - 1) {
          const nextTop = group[i + 1]!.y;
          const bottom = entry.y + entry.height;
          const mid = (bottom + nextTop) / 2;
          (entry as { height: number }).height = mid - entry.y;
        }
      }
    }

    // Supplement with tagged commands not in element_bboxes (e.g., spanners)
    if (dl.elementIds && dl.elementIds.length > 0) {
      for (let i = 0; i < dl.commands.length; i++) {
        const engineId = dl.elementIds[i];
        if (!engineId || seen.has(engineId)) continue;

        const cmd = dl.commands[i];
        if (!cmd) continue;
        const bbox = commandBBox(cmd);
        if (!bbox) continue;

        seen.add(engineId);
        entries.push({ id: engineId, ...bbox });
      }
    }

    return new SpatialIndex(entries);
  }

  /**
   * Build from render commands with element IDs (fallback when no element_bboxes).
   * Approximates bboxes from command geometry.
   */
  private static fromCommands(dl: DisplayList): SpatialIndex {
    const entries: ElementBBox[] = [];
    const seen = new Set<string>();
    const hasElementIds = dl.elementIds && dl.elementIds.length > 0;
    // Map id → its entry so the merge branch is O(1), not a linear scan.
    // Keeps the whole pass O(n) for large scores.
    const byId = new Map<string, ElementBBox>();

    for (let i = 0; i < dl.commands.length; i++) {
      const cmd = dl.commands[i];
      if (!cmd) continue;
      const bbox = commandBBox(cmd);
      if (!bbox) continue;

      let id: string;
      if (hasElementIds) {
        const engineId = dl.elementIds![i];
        if (!engineId) continue;
        id = engineId;
      } else {
        id = `cmd/${i}`;
      }

      if (!seen.has(id)) {
        seen.add(id);
        const entry: ElementBBox = { id, ...bbox };
        entries.push(entry);
        byId.set(id, entry);
      } else {
        const existing = byId.get(id);
        if (existing) {
          mergeBBox(existing, bbox.x, bbox.y, bbox.width, bbox.height);
        }
      }
    }

    return new SpatialIndex(entries);
  }

  /** Return the number of entries in the index. */
  get size(): number {
    return this.entries.length;
  }

  /** All entries (read-only). */
  get all(): readonly ElementBBox[] {
    return this.entries;
  }

  /**
   * Hit-test: find the element at the given point.
   * When multiple bboxes contain the point, returns the smallest (most specific)
   * element — e.g. an articulation inside an event's bbox.
   */
  hitTest(x: number, y: number): string | null {
    this.lastHitY = y;
    let bestId: string | null = null;
    let bestArea = Infinity;
    let bestCenterDistance = Infinity;

    for (const entry of this.entries) {
      if (entry.x > x + 1) break; // past the point, stop early
      if (x >= entry.x && x <= entry.x + entry.width && y >= entry.y && y <= entry.y + entry.height) {
        const area = entry.width * entry.height;
        const centerDistance = Math.hypot(x - (entry.x + entry.width / 2), y - (entry.y + entry.height / 2));
        if (area < bestArea || (area === bestArea && centerDistance < bestCenterDistance)) {
          bestArea = area;
          bestCenterDistance = centerDistance;
          bestId = entry.id;
        }
      }
    }
    return bestId;
  }

  /**
   * Find the nearest element to the given point within a tolerance radius.
   * Distance is measured to the element's bounding box rather than its center,
   * so tall events remain easy to target at either the notehead or stem.
   * Returns the element ID or null if nothing is within range.
   */
  findNearest(x: number, y: number, tolerance: number = 10): string | null {
    this.lastHitY = y;
    let bestId: string | null = null;
    let bestDist = Infinity;
    const toleranceSq = tolerance * tolerance;

    for (const entry of this.entries) {
      // Skip entries too far away in x
      if (entry.x - tolerance > x) break;
      if (entry.x + entry.width + tolerance < x) continue;

      const dx = Math.max(entry.x - x, 0, x - (entry.x + entry.width));
      const dy = Math.max(entry.y - y, 0, y - (entry.y + entry.height));
      const distSq = dx * dx + dy * dy;

      if (distSq <= toleranceSq && distSq < bestDist) {
        bestDist = distSq;
        bestId = entry.id;
      }
    }

    return bestId;
  }

  /**
   * Get the bounding box for an element by its ID.
   * Returns undefined if not found.
   * When multiple entries share the same ID (e.g. condensed + expansion staves),
   * returns the first match.
   */
  getBBox(id: string): ElementBBox | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /**
   * Get ALL bounding boxes for an element by its ID.
   * Returns multiple entries when the same element appears on different staves
   * (e.g. condensed staff + expansion staves).
   */
  getAllBBoxes(id: string): ElementBBox[] {
    return this.entries.filter((e) => e.id === id);
  }

  /**
   * Get all element IDs that intersect the given rectangular region.
   */
  queryRect(x: number, y: number, width: number, height: number): string[] {
    const result: string[] = [];
    for (const entry of this.entries) {
      if (entry.x > x + width) break;
      if (entry.x + entry.width < x) continue;
      if (entry.y + entry.height < y || entry.y > y + height) continue;
      result.push(entry.id);
    }
    return result;
  }
}

// ── HitRegion-based approach (legacy, from element IDs + command bboxes) ─

/** A bounding box entry in the spatial index. */
export interface HitRegion {
  /** Model path, e.g. "p0/m3/s0/ev1" */
  elementId: string;
  /** Bounding box in canvas coordinates */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Result of a legacy hit test query. */
export interface LegacyHitTestResult {
  /** The element ID of the hit element */
  elementId: string;
  /** Distance from the query point to the element center */
  distance: number;
}

/**
 * Build hit regions from a DisplayList with element IDs.
 * Groups render commands by element ID and computes a bounding box for each.
 */
export function buildHitRegions(displayList: DisplayList): HitRegion[] {
  const { commands, elementIds } = displayList;
  if (!elementIds || elementIds.length === 0) {
    return [];
  }

  const bboxMap = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();

  for (let i = 0; i < commands.length; i++) {
    const eid = elementIds[i];
    if (!eid) continue;

    const cmd = commands[i];
    if (!cmd) continue;

    const bounds = commandBounds(cmd);
    if (!bounds) continue;

    const existing = bboxMap.get(eid);
    if (existing) {
      existing.minX = Math.min(existing.minX, bounds.x);
      existing.minY = Math.min(existing.minY, bounds.y);
      existing.maxX = Math.max(existing.maxX, bounds.x + bounds.w);
      existing.maxY = Math.max(existing.maxY, bounds.y + bounds.h);
    } else {
      bboxMap.set(eid, {
        minX: bounds.x,
        minY: bounds.y,
        maxX: bounds.x + bounds.w,
        maxY: bounds.y + bounds.h,
      });
    }
  }

  const regions: HitRegion[] = [];
  for (const [elementId, bb] of bboxMap) {
    regions.push({
      elementId,
      x: bb.minX,
      y: bb.minY,
      width: bb.maxX - bb.minX,
      height: bb.maxY - bb.minY,
    });
  }

  regions.sort((a, b) => a.x - b.x);
  return regions;
}

/**
 * Find the element at a given canvas coordinate using hit regions.
 * Returns the closest element within `tolerance` pixels, or null.
 */
export function hitTest(regions: HitRegion[], x: number, y: number, tolerance: number = 5): LegacyHitTestResult | null {
  let best: LegacyHitTestResult | null = null;

  for (const region of regions) {
    if (x < region.x - tolerance || x > region.x + region.width + tolerance) {
      continue;
    }
    if (y < region.y - tolerance || y > region.y + region.height + tolerance) {
      continue;
    }

    const cx = region.x + region.width / 2;
    const cy = region.y + region.height / 2;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

    if (!best || dist < best.distance) {
      best = { elementId: region.elementId, distance: dist };
    }
  }

  return best;
}

// ── BBox merge helper ────────────────────────────────────────────────

/** Merge another bbox into an existing mutable entry. */
function mergeBBox(existing: ElementBBox, x: number, y: number, width: number, height: number): void {
  const minX = Math.min(existing.x, x);
  const minY = Math.min(existing.y, y);
  const maxX = Math.max(existing.x + existing.width, x + width);
  const maxY = Math.max(existing.y + existing.height, y + height);
  (existing as { x: number }).x = minX;
  (existing as { y: number }).y = minY;
  (existing as { width: number }).width = maxX - minX;
  (existing as { height: number }).height = maxY - minY;
}

// ── Command BBox helpers ─────────────────────────────────────────────

/** Approximate bounding box for SpatialIndex command-based fallback. */
function commandBBox(cmd: RenderCommand): { x: number; y: number; width: number; height: number } | null {
  switch (cmd.type) {
    case "DrawGlyph": {
      const halfSize = (cmd.size * 1.3) / 4;
      return {
        x: cmd.x - halfSize * 0.1,
        y: cmd.y - halfSize,
        width: halfSize * 2,
        height: halfSize * 2,
      };
    }
    case "DrawEllipse":
      return {
        x: cmd.cx - cmd.rx,
        y: cmd.cy - cmd.ry,
        width: cmd.rx * 2,
        height: cmd.ry * 2,
      };
    case "DrawText": {
      const approxWidth = cmd.text.length * cmd.size * 0.6;
      return {
        x: cmd.x,
        y: cmd.y - cmd.size,
        width: approxWidth,
        height: cmd.size * 1.5,
      };
    }
    case "DrawRect":
      return { x: cmd.x, y: cmd.y, width: cmd.w, height: cmd.h };
    case "DrawLine": {
      const lw = cmd.width || 1;
      return {
        x: Math.min(cmd.x1, cmd.x2) - lw / 2,
        y: Math.min(cmd.y1, cmd.y2) - lw / 2,
        width: Math.abs(cmd.x2 - cmd.x1) + lw,
        height: Math.abs(cmd.y2 - cmd.y1) + lw,
      };
    }
    case "DrawFilledBezier": {
      const minX = Math.min(cmd.x1, cmd.x2);
      const minY = Math.min(cmd.y1, cmd.y2, cmd.ocy1, cmd.ocy2);
      const maxX = Math.max(cmd.x1, cmd.x2);
      const maxY = Math.max(cmd.y1, cmd.y2, cmd.ocy1, cmd.ocy2);
      // Pad thin curves so the full rectangular region is clickable
      const pad = 4;
      return {
        x: minX,
        y: minY - pad,
        width: maxX - minX,
        height: Math.max(maxY - minY, 8) + pad * 2,
      };
    }
    default:
      return null;
  }
}

/** Extract approximate bounding box from a render command (legacy, more comprehensive). */
function commandBounds(cmd: RenderCommand): { x: number; y: number; w: number; h: number } | null {
  switch (cmd.type) {
    case "DrawGlyph":
      return {
        x: cmd.x,
        y: cmd.y - cmd.size * 0.8,
        w: cmd.size * 0.6,
        h: cmd.size,
      };
    case "DrawEllipse":
      return {
        x: cmd.cx - cmd.rx,
        y: cmd.cy - cmd.ry,
        w: cmd.rx * 2,
        h: cmd.ry * 2,
      };
    case "DrawRect":
      return { x: cmd.x, y: cmd.y, w: cmd.w, h: cmd.h };
    case "DrawCircle":
      return {
        x: cmd.cx - cmd.r,
        y: cmd.cy - cmd.r,
        w: cmd.r * 2,
        h: cmd.r * 2,
      };
    case "DrawLine":
      return {
        x: Math.min(cmd.x1, cmd.x2),
        y: Math.min(cmd.y1, cmd.y2),
        w: Math.abs(cmd.x2 - cmd.x1) || cmd.width,
        h: Math.abs(cmd.y2 - cmd.y1) || cmd.width,
      };
    case "DrawText":
      return {
        x: cmd.x,
        y: cmd.y - cmd.size,
        w: cmd.text.length * cmd.size * 0.5,
        h: cmd.size,
      };
    case "DrawPolygon": {
      if (cmd.points.length === 0) return null;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [px, py] of cmd.points) {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case "DrawBezier":
      return {
        x: Math.min(cmd.x1, cmd.x2),
        y: Math.min(cmd.y1, cmd.y2),
        w: Math.abs(cmd.x2 - cmd.x1),
        h: Math.abs(cmd.y2 - cmd.y1) || cmd.width,
      };
    case "DrawFilledBezier":
      return {
        x: Math.min(cmd.x1, cmd.x2),
        y: Math.min(cmd.y1, cmd.y2, cmd.ocy1, cmd.ocy2),
        w: Math.abs(cmd.x2 - cmd.x1),
        h: Math.abs(cmd.ocy1 - cmd.y1) * 2 || 4,
      };
    case "DrawQuadratic":
      return {
        x: Math.min(cmd.x1, cmd.x2),
        y: Math.min(cmd.y1, cmd.y2, cmd.cy),
        w: Math.abs(cmd.x2 - cmd.x1),
        h: Math.abs(cmd.y2 - cmd.y1) || cmd.width,
      };
    default:
      return null;
  }
}

// Selection overlay (paintSelectionOverlay, paintMeasureSelectionOverlay, paintHitboxDebug)
// has moved to selectionOverlay.ts. Re-exported here so existing imports
// from @viritura/renderer continue to resolve.
export { paintSelectionOverlay, paintMeasureSelectionOverlay, paintHitboxDebug } from "./selectionOverlay";
import { classifyElement } from "./selectionOverlay";
import { curveCommandsFor, curveEndpoints } from "./selectionHighlight";

/** Which end of a spanner a drag handle represents. */
export type SpannerHandleEnd = "start" | "end";

/** Result of a spanner handle hit-test. */
export interface SpannerHandleHit {
  /** The element ID of the spanner (e.g. "p0/m0/hairpin0"). */
  elementId: string;
  /** Which handle was hit. */
  handle: SpannerHandleEnd;
  /** The current x position of the handle. */
  handleX: number;
  /** The y center of the spanner bbox. */
  handleY: number;
}

const HANDLE_HIT_RADIUS = 8; // px tolerance for clicking a handle

/**
 * Test if a point is near a spanner drag handle.
 * Only checks spanners in the selectedIds set.
 * Returns the handle hit info, or null if no handle was clicked.
 *
 * When `displayList` is supplied, curved spanners are tested against the tips
 * of their painted curve rather than the corners of their hit box — the same
 * points the selection overlay draws anchors on, so the grab target and the
 * affordance agree.
 */
export function hitTestSpannerHandle(
  spatialIndex: SpatialIndex,
  selectedIds: ReadonlySet<string>,
  scoreX: number,
  scoreY: number,
  displayList?: DisplayList,
  displayListVersion?: number,
): SpannerHandleHit | null {
  for (const id of selectedIds) {
    if (classifyElement(id) !== "spanner") continue;
    if (id.startsWith("tie/")) continue;

    const anchors = curveHandleAnchors(id, displayList, displayListVersion) ?? bboxHandleAnchors(id, spatialIndex);
    if (!anchors) continue;

    for (const anchor of anchors) {
      const dx = scoreX - anchor.handleX;
      const dy = scoreY - anchor.handleY;
      if (dx * dx + dy * dy <= HANDLE_HIT_RADIUS * HANDLE_HIT_RADIUS) {
        return { elementId: id, ...anchor };
      }
    }
  }
  return null;
}

type HandleAnchor = { handle: SpannerHandleEnd; handleX: number; handleY: number };

function curveHandleAnchors(
  id: string,
  displayList: DisplayList | undefined,
  version: number | undefined,
): HandleAnchor[] | null {
  if (!displayList) return null;
  const curves = curveCommandsFor(displayList, id, version);
  if (!curves || curves.length === 0) return null;
  const ends = curveEndpoints(curves);
  if (!ends) return null;
  return [
    { handle: "start", handleX: ends.startX, handleY: ends.startY },
    { handle: "end", handleX: ends.endX, handleY: ends.endY },
  ];
}

function bboxHandleAnchors(id: string, spatialIndex: SpatialIndex): HandleAnchor[] | null {
  const bbox = spatialIndex.getBBox(id);
  if (!bbox) return null;
  const cy = bbox.y + bbox.height * 0.5;
  return [
    { handle: "start", handleX: bbox.x, handleY: cy },
    { handle: "end", handleX: bbox.x + bbox.width, handleY: cy },
  ];
}

/** A snap point for the spanner drag ruler. */
export interface DragSnapPoint {
  x: number;
  beat: number;
  measureIndex: number;
  /** True if this is the snap point closest to the current drag position. */
  active?: boolean;
}

/**
 * Paint a drag preview line for a spanner handle being dragged,
 * including a ruler of snap points.
 */
export function paintSpannerDragPreview(
  ctx: CanvasRenderingContext2D,
  bbox: { x: number; y: number; width: number; height: number },
  handle: SpannerHandleEnd,
  dragX: number,
  snapPoints?: DragSnapPoint[],
): void {
  ctx.save();
  const cy = bbox.y + bbox.height * 0.5;
  const fixedX = handle === "start" ? bbox.x + bbox.width : bbox.x;

  // Draw snap ruler using the shared beat ruler painter
  if (snapPoints && snapPoints.length > 0) {
    // Use a fixed spatium of 12px (standard staff space) so ticks match
    // the note input ruler proportions regardless of spanner bbox height
    const spatium = 12;
    const rulerY = bbox.y - 4;

    // Convert snap points to RulerTick format
    const ticks: RulerTick[] = snapPoints.map((sp) => ({
      x: sp.x,
      beat: sp.beat,
      isEventOnset: true, // default snap points are event positions
      active: sp.active ?? false,
    }));

    paintBeatRuler(ctx, ticks, {
      rulerY,
      spatium,
      activeColor: "rgba(25, 118, 210, 1)",
      inactiveColor: "rgba(100, 100, 100, 1)",
    });
  }

  // Draw the preview dashed line from fixed end to drag position
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = "#1976D2CC";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.min(fixedX, dragX), cy);
  ctx.lineTo(Math.max(fixedX, dragX), cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw circle at drag position (snaps to nearest point)
  const snapX = snapPoints?.find((sp) => sp.active)?.x ?? dragX;
  ctx.fillStyle = "#1976D2";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(snapX, cy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}
