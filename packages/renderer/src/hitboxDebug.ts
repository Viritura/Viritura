import type { SpatialIndex, ElementBBox } from "./hitTest";
import type { DisplayList, MeasureBounds } from "./wasm";
import { classifyElement } from "./selectionOverlay";
import { isBeamElementId } from "./beamHitTest";

export type HitboxDebugKind = "event" | "note" | "annotation" | "spanner" | "structure" | "unknown";

interface HitboxDebugStyle {
  readonly label: string;
  readonly color: string;
}

export const HITBOX_DEBUG_STYLES: Readonly<Record<HitboxDebugKind, HitboxDebugStyle>> = {
  event: { label: "Events", color: "#2563EB" },
  note: { label: "Noteheads", color: "#059669" },
  annotation: { label: "Annotations", color: "#D97706" },
  spanner: { label: "Spanners", color: "#DB2777" },
  structure: { label: "Structure", color: "#0891B2" },
  unknown: { label: "Unknown", color: "#DC2626" },
};

const STRUCTURE_PATTERN =
  /^(?:clef|key|time|barline|beam\d*|gracebeam\d*|tuplet\d*|mnum|mmrcount|measurerepeat|segno|coda|fine)$/;

export function getHitboxDebugKind(id: string): HitboxDebugKind {
  if (id.includes("/accidental/")) return "annotation";
  const last = id.slice(id.lastIndexOf("/") + 1);
  if (STRUCTURE_PATTERN.test(last)) return "structure";
  const category = classifyElement(id);
  if (category !== "event") return category;
  if (/^p\d+\/m\d+\/[sv]\d+\//.test(id)) return "event";
  return "unknown";
}

export interface HitboxDebugBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface HitboxDebugOptions {
  readonly measureBounds?: readonly MeasureBounds[];
  readonly zoom?: number;
  readonly bounds?: HitboxDebugBounds;
  readonly displayList?: DisplayList;
}

/**
 * Draw exact engine hit geometry. Category fills make overlaps visible, center
 * marks expose degenerate boxes, and the legend summarizes target categories.
 */
export function paintHitboxDebug(
  ctx: CanvasRenderingContext2D,
  spatialIndex: SpatialIndex,
  options: HitboxDebugOptions = {},
): void {
  const zoom = Math.max(options.zoom ?? 1, 0.01);
  ctx.save();
  paintMeasureTargets(ctx, options.measureBounds ?? [], zoom, options.bounds);
  paintBeamTargets(ctx, options.displayList, zoom, options.bounds);

  for (const entry of spatialIndex.all) {
    if (options.displayList && isBeamElementId(entry.id)) continue;
    if (!intersectsBounds(entry, options.bounds)) continue;
    const kind = getHitboxDebugKind(entry.id);
    const style = HITBOX_DEBUG_STYLES[kind];
    const invalid = entry.width <= 0 || entry.height <= 0;
    const color = invalid ? HITBOX_DEBUG_STYLES.unknown.color : style.color;

    ctx.setLineDash(kind === "unknown" || invalid ? [4 / zoom, 3 / zoom] : []);
    ctx.lineWidth = (invalid ? 2 : kind === "note" ? 1.5 : 1) / zoom;
    ctx.fillStyle = color;
    ctx.globalAlpha = invalid ? 0.2 : 0.08;
    ctx.fillRect(entry.x, entry.y, Math.max(entry.width, 1 / zoom), Math.max(entry.height, 1 / zoom));
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.strokeRect(entry.x, entry.y, Math.max(entry.width, 1 / zoom), Math.max(entry.height, 1 / zoom));
    paintCenterMark(ctx, entry, color, zoom);
  }

  function paintBeamTargets(
    ctx: CanvasRenderingContext2D,
    displayList: DisplayList | undefined,
    zoom: number,
    bounds: HitboxDebugBounds | undefined,
  ): void {
    if (!displayList?.elementIds) return;
    const color = HITBOX_DEBUG_STYLES.structure.color;
    ctx.setLineDash([]);
    ctx.lineWidth = 1 / zoom;
    for (let index = 0; index < displayList.commands.length; index++) {
      const command = displayList.commands[index];
      const id = displayList.elementIds[index];
      if (!id || !isBeamElementId(id) || command?.type !== "DrawPolygon") continue;
      const box = polygonBounds(command.points);
      if (!intersectsBounds(box, bounds)) continue;
      ctx.beginPath();
      const first = command.points[0];
      if (!first) continue;
      ctx.moveTo(first[0], first[1]);
      for (const point of command.points.slice(1)) ctx.lineTo(point[0], point[1]);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.95;
      ctx.stroke();
    }
  }

  function polygonBounds(points: readonly [number, number][]): ElementBBox {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { id: "", x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  ctx.restore();
}

function paintMeasureTargets(
  ctx: CanvasRenderingContext2D,
  measureBounds: readonly MeasureBounds[],
  zoom: number,
  bounds: HitboxDebugBounds | undefined,
): void {
  ctx.strokeStyle = "#7C3AED";
  ctx.fillStyle = "#7C3AED";
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.globalAlpha = 0.04;
  for (const measure of measureBounds) {
    if (!intersectsBounds(measure, bounds)) continue;
    ctx.fillRect(measure.x, measure.y, measure.width, measure.height);
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(measure.x, measure.y, measure.width, measure.height);
    ctx.globalAlpha = 0.04;
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function paintCenterMark(ctx: CanvasRenderingContext2D, entry: ElementBBox, color: string, zoom: number): void {
  const radius = 1.75 / zoom;
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.95;
  ctx.arc(entry.x + entry.width / 2, entry.y + entry.height / 2, radius, 0, Math.PI * 2);
  ctx.fill();
}

function intersectsBounds(
  rect: Pick<ElementBBox, "x" | "y" | "width" | "height">,
  bounds: HitboxDebugBounds | undefined,
): boolean {
  if (!bounds) return true;
  return !(
    rect.x > bounds.maxX ||
    rect.x + rect.width < bounds.minX ||
    rect.y > bounds.maxY ||
    rect.y + rect.height < bounds.minY
  );
}

export function paintHitboxDebugLegend(
  ctx: CanvasRenderingContext2D,
  spatialIndex: SpatialIndex,
  measureCount: number,
  devicePixelRatio = 1,
): void {
  const summary = hitboxSummary(spatialIndex);
  const counts = summary.counts;

  const rows = (Object.keys(HITBOX_DEBUG_STYLES) as HitboxDebugKind[]).filter((kind) => (counts.get(kind) ?? 0) > 0);
  const width = 210;
  const lineHeight = 17;
  const extraRows = (measureCount > 0 ? 1 : 0) + (summary.degenerate > 0 ? 1 : 0);
  const height = 34 + (rows.length + extraRows) * lineHeight;
  const canvasHeight = ctx.canvas.height / devicePixelRatio;
  const top = Math.max(12, canvasHeight - height - 12);
  ctx.save();
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = "#111827";
  ctx.fillRect(12, top, width, height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "600 11px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`HITBOXES  ${spatialIndex.size} elements`, 22, top + 9);
  let y = top + 29;
  for (const kind of rows) {
    const style = HITBOX_DEBUG_STYLES[kind];
    paintLegendRow(ctx, style.color, `${style.label}: ${counts.get(kind) ?? 0}`, y);
    y += lineHeight;
  }
  if (measureCount > 0) {
    paintLegendRow(ctx, "#7C3AED", `Measure targets: ${measureCount}`, y, true);
    y += lineHeight;
  }
  if (summary.degenerate > 0) {
    paintLegendRow(ctx, HITBOX_DEBUG_STYLES.unknown.color, `Degenerate: ${summary.degenerate}`, y, true);
  }
  ctx.restore();
}

interface HitboxSummary {
  readonly counts: ReadonlyMap<HitboxDebugKind, number>;
  readonly degenerate: number;
}

const summaryCache = new WeakMap<SpatialIndex, HitboxSummary>();

function hitboxSummary(spatialIndex: SpatialIndex): HitboxSummary {
  const cached = summaryCache.get(spatialIndex);
  if (cached) return cached;
  const counts = new Map<HitboxDebugKind, number>();
  let degenerate = 0;
  for (const entry of spatialIndex.all) {
    const kind = getHitboxDebugKind(entry.id);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (entry.width <= 0 || entry.height <= 0) degenerate += 1;
  }
  const summary = { counts, degenerate };
  summaryCache.set(spatialIndex, summary);
  return summary;
}

function paintLegendRow(ctx: CanvasRenderingContext2D, color: string, label: string, y: number, dashed = false): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [4, 3] : []);
  ctx.strokeRect(22, y + 2, 11, 8);
  ctx.setLineDash([]);
  ctx.fillStyle = "#E5E7EB";
  ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.fillText(label, 41, y);
}
