import type { LayoutDebugInfo, SystemDebug } from "@viritura/renderer";
import type { PaintLayoutDebugOpts } from "../layoutDebugPainter";
import { paintLayoutDebug } from "../layoutDebugPainter";
import { useLayoutDebugStore } from "../layoutDebugStore";
import { usePaginationDebugStore, type PaginationCategories, type PaginationDiagnostics } from "./store";
import { percent } from "./measurements";

type PaintOptions = Omit<PaintLayoutDebugOpts, "categories" | "elementBboxes">;

interface Brush {
  ctx: CanvasRenderingContext2D;
  scale: number;
  label: (text: string, x: number, y: number, color?: string) => void;
}

export function paintScoreDebug(
  ctx: CanvasRenderingContext2D,
  debug: LayoutDebugInfo,
  opts: PaintLayoutDebugOpts,
): void {
  if (useLayoutDebugStore.getState().enabled) paintLayoutDebug(ctx, debug, opts);
  paintPaginationDebug(ctx, debug, opts);
}

function paintPaginationDebug(ctx: CanvasRenderingContext2D, debug: LayoutDebugInfo, opts: PaintOptions): void {
  const { enabled, categories, selectedSystem } = usePaginationDebugStore.getState();
  const data = debug.pagination;
  if (!enabled || !data) return;
  const scale = 1 / Math.max(opts.zoom, 0.1);
  const visible = opts.visible;
  const maxLabelWidth = Math.max(120, ...debug.systems.map((s) => s.xEnd - s.xStart));
  const label = (text: string, x: number, y: number, color = "#cce9ff") => {
    ctx.font = `${11 * scale}px sans-serif`;
    const width = Math.min(maxLabelWidth, ctx.measureText(text).width + 8 * scale);
    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    ctx.fillRect(x, y, width, 16 * scale);
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(text, x + 4 * scale, y + 2 * scale, Math.max(scale, width - 8 * scale));
  };
  ctx.save();
  ctx.translate(opts.offsetX ?? 0, opts.offsetY ?? 0);
  ctx.lineWidth = scale;
  const brush = { ctx, scale, label };
  for (const page of data.pages) {
    if (visible && (page.frameBottom < visible.minY || page.frameTop > visible.maxY)) continue;
    if (!categories.pageCapacity) continue;
    const placed = debug.systems.filter((s) => s.pageIndex === page.pageIndex);
    paintPage(brush, data, page, placed, categories.reasons);
  }
  for (const system of data.systems) {
    const placed = debug.systems[system.systemIndex];
    if (!placed || (visible && (placed.bboxBottomY < visible.minY || placed.bboxTopY > visible.maxY))) continue;
    paintSystem(brush, system, placed, categories, selectedSystem === system.systemIndex);
  }
  ctx.restore();
}

function paintPage(
  { ctx, scale, label }: Brush,
  data: PaginationDiagnostics,
  page: PaginationDiagnostics["pages"][number],
  placed: SystemDebug[],
  reasons: boolean,
) {
  const x = placed[0]?.xStart ?? 16;
  if (page.kind !== "music") {
    label(`P${page.pageIndex + 1} ${page.kind} (no music)`, x, page.frameTop);
    return;
  }
  const right = Math.max(x + 120, ...placed.map((s) => s.xEnd));
  ctx.strokeStyle = "#0284c7";
  ctx.setLineDash([4 * scale, 4 * scale]);
  ctx.strokeRect(x, page.frameTop, right - x, page.capacity);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(2, 132, 199, 0.18)";
  ctx.fillRect(right - 6 * scale, page.frameTop, 6 * scale, Math.min(page.capacity, page.contentHeight));
  for (const fill of [data.minFillFraction, data.targetFillFraction]) {
    ctx.beginPath();
    ctx.moveTo(right - 12 * scale, page.frameTop + fill * page.capacity);
    ctx.lineTo(right + 4 * scale, page.frameTop + fill * page.capacity);
    ctx.stroke();
  }
  label(
    `P${page.pageIndex + 1} | capacity ${Math.round(page.capacity)}px | budget ${percent(page.contentHeight, page.capacity)} / placed ${percent(page.placedHeight, page.capacity)}${page.isFinalMusicPage ? " (final exempt)" : ""}`,
    x,
    page.frameTop - 44 * scale,
  );
  if (reasons) {
    label(
      `${page.pageIndex % 2 === (data.firstPageRecto ? 0 : 1) ? "Right" : "Left"} | ${page.physicalTurnAfter ? "physical turn" : "no music turn"} | min ${Math.round(data.minFillFraction * 100)}%, target ${Math.round(data.targetFillFraction * 100)}%`,
      x,
      page.frameTop - 28 * scale,
    );
  }
}

function paintSystem(
  { ctx, scale, label }: Brush,
  system: PaginationDiagnostics["systems"][number],
  placed: SystemDebug,
  categories: PaginationCategories,
  selected: boolean,
) {
  if (selected) {
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(placed.xStart, placed.bboxTopY, placed.xEnd - placed.xStart, placed.bboxBottomY - placed.bboxTopY);
    ctx.lineWidth = scale;
  }
  if (categories.systemDensity) {
    label(
      `S${system.systemIndex + 1} | bars ${system.firstMeasure + 1}-${system.lastMeasure + 1} | density ${percent(system.naturalWidth, system.availableWidth)} | scale ${system.naturalWidth > 0 ? (system.availableWidth / system.naturalWidth).toFixed(2) : "n/a"}x`,
      placed.xStart,
      placed.bboxTopY - 18 * scale,
    );
  }
  const b = system.boundary;
  if (!categories.restWindows || !b || (!system.pageBreakAfter && !categories.alternatives)) return;
  const color =
    b.structural || b.fermataBlocked || b.quality === "impossible"
      ? "#fda4af"
      : b.quality === "comfortable"
        ? "#86efac"
        : "#fde68a";
  const kind = system.physicalTurnAfter ? "TURN" : system.pageBreakAfter ? "FACING PAGE" : "alternative";
  label(
    `${kind} after bar ${system.lastMeasure + 1}: ${b.tailSeconds.toFixed(1)}s before + ${b.headSeconds.toFixed(1)}s after (${b.quality})`,
    placed.xStart,
    placed.bboxBottomY + 2 * scale,
    color,
  );
  if (categories.reasons) {
    const flags = [
      b.structural ? "navigation hazard" : "",
      b.fermataBlocked ? "fermata/breath nearby" : "",
      `turn cost ${b.turnCost.toFixed(2)} (if physical)`,
      !system.pageBreakAfter ? "unselected; feasibility not evaluated here" : "",
    ].filter(Boolean);
    label(flags.join(" | "), placed.xStart, placed.bboxBottomY + 19 * scale, color);
  }
}
