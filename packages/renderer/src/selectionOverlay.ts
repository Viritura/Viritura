/**
 * Selection-overlay rendering for the Canvas score view.
 *
 * Split out from hitTest.ts so the latter can stay focused on the
 * SpatialIndex / hit-region machinery and the overlay painting can
 * grow its own helpers without crowding it.
 */

import type { SpatialIndex, ElementBBox } from "./hitTest";
import type { MeasureBounds, DisplayList, RenderCommand } from "./wasm";
import {
  commandsForElement,
  drawsLetterforms,
  filledBeziersIn,
  paintElementHighlight,
  paintTextShade,
  paintCurveAnchors,
} from "./selectionHighlight";

/** Voice colors matching standard notation convention. */
const VOICE_COLORS: Record<number, string> = {
  0: "#4285F4", // voice 1: blue (matches Google blue)
  1: "#2E7D32", // voice 2: green
  2: "#E65100", // voice 3: orange
  3: "#6A1B9A", // voice 4: purple
};

/** Extract the sequence (voice) index from an element ID like "p0/m1/s0/ev-1". */
function getVoiceFromId(id: string): number {
  const match = id.match(/\/s(\d+)\//);
  return match ? parseInt(match[1]!, 10) : 0;
}

type ElementCategory = "event" | "annotation" | "spanner" | "note";

/** Last-token prefixes that indicate a spanner element. */
const SPANNER_PREFIXES = ["hairpin", "pedal", "ottava", "slur", "volta"] as const;

/** Last-token prefixes that indicate an annotation element. */
const ANNOTATION_PREFIXES = [
  "art",
  "ferm",
  "orn",
  "trill",
  "fing",
  "arp",
  "trem",
  "breath",
  "dyn",
  "expr",
  "tempo",
  "rehearsal",
  "jump",
  "caesura",
  "chord",
  "mnum",
] as const;

/** Classify an element ID into a rendering category for the selection overlay. */
export function classifyElement(id: string): ElementCategory {
  // Top-level slur/tie connectors live under their own namespaces.
  if (id.startsWith("slur/") || id.startsWith("tie/")) return "spanner";

  const last = id.split("/").pop() ?? "";

  // Individual chord note (e.g. "n0", "n1").
  if (/^n\d/.test(last)) return "note";

  // Accidental qualifying one chord note (e.g. "acc0"). Selectable on its own,
  // so it must not be mistaken for the note it spells.
  if (/^acc\d/.test(last)) return "annotation";

  // Spanners attached to events/measures.
  if (last === "tie") return "spanner";
  if (SPANNER_PREFIXES.some((p) => last.startsWith(p))) return "spanner";

  // Annotations attached to events/measures (everything that isn't a spanner).
  if (ANNOTATION_PREFIXES.some((p) => last.startsWith(p))) return "annotation";

  return "event";
}

/**
 * Paint selection overlay on top of the score.
 * Color matches the voice of the selected elements.
 *
 * Pass `displayList` to opt elements into the shape-conformal highlight —
 * their own ink, re-coloured and haloed — instead of a box around their hit
 * region. Elements the list can't resolve fall back to the box.
 *
 * `displayListVersion` must advance whenever the list's contents change: the
 * layout pipeline reuses one DisplayList object across incremental edits, so
 * without it the highlight would keep re-inking pre-edit commands (a deleted
 * accidental would stay on screen until the selection moved elsewhere).
 */
export function paintSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  spatialIndex: SpatialIndex,
  selectedIds: ReadonlySet<string>,
  displayList?: DisplayList,
  displayListVersion?: number,
): void {
  if (selectedIds.size === 0) return;

  ctx.save();
  const firstId = selectedIds.values().next().value;
  const voiceIdx = firstId ? getVoiceFromId(firstId) : 0;
  const color = VOICE_COLORS[voiceIdx] ?? VOICE_COLORS[0]!;

  for (const id of expandGlobalKeySelections(selectedIds, spatialIndex)) {
    paintSelectionFor(ctx, id, spatialIndex, color, displayList, displayListVersion);
  }

  ctx.restore();
}

const PAD = 2;

/**
 * MNX key signatures belong to a global measure, while the engine emits a
 * part-scoped selectable copy on every staff. Selecting any copy therefore
 * highlights every copy at that vertical measure boundary.
 */
function expandGlobalKeySelections(selectedIds: ReadonlySet<string>, spatialIndex: SpatialIndex): Set<string> {
  const expanded = new Set(selectedIds);
  for (const selectedId of selectedIds) {
    const match = selectedId.match(/^(?:p\d+\/)?m(\d+)\/key$/);
    if (!match) continue;
    const measureToken = `/m${match[1]}/key`;
    const globalId = `m${match[1]}/key`;
    for (const entry of spatialIndex.all) {
      if (entry.id === globalId || entry.id.endsWith(measureToken)) expanded.add(entry.id);
    }
  }
  return expanded;
}

function paintSelectionFor(
  ctx: CanvasRenderingContext2D,
  id: string,
  spatialIndex: SpatialIndex,
  color: string,
  displayList?: DisplayList,
  displayListVersion?: number,
): void {
  const bboxes = spatialIndex.getAllBBoxes(id);
  // A key signature is one global property shown on every staff. Unlike a
  // duplicated event in a condensed score, all of its staff copies are active.
  const isGlobalKey = id.endsWith("/key");
  const activeBboxes =
    bboxes.length === 0 ? [] : isGlobalKey ? bboxes : resolveActiveBboxes(id, bboxes, spatialIndex.lastHitY);

  if (
    displayList &&
    paintInkHighlight(
      ctx,
      id,
      color,
      displayList,
      !isGlobalKey && bboxes.length > 1 ? activeBboxes : null,
      displayListVersion,
    )
  ) {
    return;
  }

  const category = classifyElement(id);
  for (const bbox of activeBboxes) {
    paintForCategory(ctx, id, category, bbox, color);
  }
}

/**
 * Highlight an element from its own commands: a shaded box for letterforms
 * (prose and dynamics), the re-inked geometry for everything else. Returns
 * false when the display list has no geometry for the id, leaving the caller
 * to fall back to the hit box.
 */
function paintInkHighlight(
  ctx: CanvasRenderingContext2D,
  id: string,
  color: string,
  displayList: DisplayList,
  staffScope: readonly ElementBBox[] | null,
  displayListVersion?: number,
): boolean {
  const all = commandsForElement(displayList, id, displayListVersion);
  if (!all) return false;

  const commands = staffScope ? scopeToStaves(all, staffScope) : all;
  if (commands.length === 0) return false;

  if (drawsLetterforms(id, commands)) return paintTextShade(ctx, commands, color);

  paintElementHighlight(ctx, commands, color);

  // Curves also get their two drag anchors, at the real tips of the shape.
  // Ties remain selectable but are intentionally fixed to their note pair.
  const curves = filledBeziersIn(commands);
  if (curves.length > 0 && !id.startsWith("tie/")) paintCurveAnchors(ctx, curves, color);
  return true;
}

/**
 * A condensed score can carry the same element id on more than one staff. The
 * bbox pass already narrowed those down to the clicked staff; keep only the
 * commands drawn near it so the other copy stays unhighlighted. The band is
 * generous because an element's ink (stem tips, ledger lines) can reach well
 * outside its bbox, while staves are far enough apart that it can't reach the
 * neighbouring copy.
 */
const STAFF_SCOPE_MARGIN = 60;

function scopeToStaves(commands: readonly RenderCommand[], activeBboxes: readonly ElementBBox[]): RenderCommand[] {
  if (activeBboxes.length === 0) return [...commands];
  return commands.filter((cmd) => {
    const y = commandY(cmd);
    if (y === null) return true;
    return activeBboxes.some((b) => y >= b.y - STAFF_SCOPE_MARGIN && y <= b.y + b.height + STAFF_SCOPE_MARGIN);
  });
}

function commandY(cmd: RenderCommand): number | null {
  switch (cmd.type) {
    case "DrawGlyph":
    case "DrawText":
      return cmd.y;
    case "DrawLine":
    case "DrawBezier":
    case "DrawQuadratic":
    case "DrawFilledBezier":
      return (cmd.y1 + cmd.y2) / 2;
    case "DrawRect":
      return cmd.y + cmd.h / 2;
    case "DrawCircle":
    case "DrawEllipse":
      return cmd.cy;
    case "DrawPolygon":
      return cmd.points[0]?.[1] ?? null;
    default:
      return null;
  }
}

/**
 * When duplicate bboxes exist (condensed + expansion staves), pick the one
 * closest to the last hit-test Y so only the clicked staff is highlighted.
 * Exception: barlines merge into one tall bbox spanning the full system.
 */
function resolveActiveBboxes(id: string, bboxes: ElementBBox[], lastHitY: number): ElementBBox[] {
  if (id.endsWith("/barline") && bboxes.length > 1) {
    const minX = Math.min(...bboxes.map((b) => b.x));
    const minY = Math.min(...bboxes.map((b) => b.y));
    const maxX = Math.max(...bboxes.map((b) => b.x + b.width));
    const maxY = Math.max(...bboxes.map((b) => b.y + b.height));
    return [{ id, x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
  }
  if (bboxes.length <= 1) return bboxes;
  return [bboxes.reduce((best, b) => (Math.abs(b.y - lastHitY) < Math.abs(best.y - lastHitY) ? b : best))];
}

function paintForCategory(
  ctx: CanvasRenderingContext2D,
  id: string,
  category: ElementCategory,
  bbox: ElementBBox,
  color: string,
): void {
  if (category === "spanner") return paintSpannerHighlight(ctx, bbox, color, !id.startsWith("tie/"));
  if (category === "annotation") return paintAnnotationHighlight(ctx, bbox, color);
  if (category === "note") return paintNoteHighlight(ctx, bbox, color);
  paintEventHighlight(ctx, bbox, color);
}

function paintSpannerHighlight(
  ctx: CanvasRenderingContext2D,
  bbox: ElementBBox,
  color: string,
  showHandles: boolean,
): void {
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = color + "CC"; // 80% opacity
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bbox.x - PAD, bbox.y - PAD, bbox.width + PAD * 2, bbox.height + PAD * 2);
  ctx.setLineDash([]);

  if (!showHandles) return;

  // Drag handles at left and right edges.
  const handleRadius = 4;
  const cy = bbox.y + bbox.height * 0.5;
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.arc(bbox.x, cy, handleRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(bbox.x + bbox.width, cy, handleRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function paintAnnotationHighlight(ctx: CanvasRenderingContext2D, bbox: ElementBBox, color: string): void {
  ctx.fillStyle = color + "25"; // 15% opacity
  ctx.strokeStyle = color + "80"; // 50% opacity
  ctx.lineWidth = 1;
  ctx.fillRect(bbox.x - PAD, bbox.y - PAD, bbox.width + PAD * 2, bbox.height + PAD * 2);
  ctx.strokeRect(bbox.x - PAD, bbox.y - PAD, bbox.width + PAD * 2, bbox.height + PAD * 2);
}

function paintNoteHighlight(ctx: CanvasRenderingContext2D, bbox: ElementBBox, color: string): void {
  ctx.fillStyle = color + "50"; // 31% opacity
  ctx.strokeStyle = color + "BB"; // 73% opacity
  ctx.lineWidth = 1.5;
  const r = Math.max(bbox.width, bbox.height) * 0.5 + PAD;
  const cx = bbox.x + bbox.width * 0.5;
  const cy = bbox.y + bbox.height * 0.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function paintEventHighlight(ctx: CanvasRenderingContext2D, bbox: ElementBBox, color: string): void {
  ctx.fillStyle = color + "40"; // 25% opacity
  ctx.strokeStyle = color + "99"; // 60% opacity
  ctx.lineWidth = 1.5;
  ctx.fillRect(bbox.x - PAD, bbox.y - PAD, bbox.width + PAD * 2, bbox.height + PAD * 2);
  ctx.strokeRect(bbox.x - PAD, bbox.y - PAD, bbox.width + PAD * 2, bbox.height + PAD * 2);
}

/** Measure selection color (distinct from voice-based note selection). */
const MEASURE_SELECT_FILL = "rgba(100, 149, 237, 0.12)"; // cornflower blue, very light
const MEASURE_SELECT_STROKE = "rgba(100, 149, 237, 0.50)"; // cornflower blue border
const MEASURE_SELECT_DASH = [6, 3];

/**
 * Paint a full-bar highlight for measure selection.
 * Uses a dashed border with light fill across the entire measure width,
 * visually distinct from the per-element highlights used for note selection.
 */
export function paintMeasureSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  measureBounds: readonly MeasureBounds[],
  startMeasure: number,
  endMeasure: number,
  startStaff: number,
  endStaff: number,
): void {
  const minM = Math.min(startMeasure, endMeasure);
  const maxM = Math.max(startMeasure, endMeasure);
  const minS = Math.min(startStaff, endStaff);
  const maxS = Math.max(startStaff, endStaff);

  ctx.save();
  ctx.fillStyle = MEASURE_SELECT_FILL;
  ctx.strokeStyle = MEASURE_SELECT_STROKE;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(MEASURE_SELECT_DASH);

  for (const mb of measureBounds) {
    if (mb.index < minM || mb.index > maxM) continue;
    if (mb.staffIndex < minS || mb.staffIndex > maxS) continue;

    const pad = 3;
    ctx.fillRect(mb.x - pad, mb.y - pad, mb.width + pad * 2, mb.height + pad * 2);
    ctx.strokeRect(mb.x - pad, mb.y - pad, mb.width + pad * 2, mb.height + pad * 2);
  }

  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Debug overlay: draw all hitboxes in the spatial index.
 * Slur/tie entries are highlighted in red; others in semi-transparent blue.
 */
export function paintHitboxDebug(ctx: CanvasRenderingContext2D, spatialIndex: SpatialIndex): void {
  ctx.save();
  for (const entry of spatialIndex.all) {
    const isConnector = entry.id.startsWith("slur/") || entry.id.startsWith("tie/");
    ctx.strokeStyle = isConnector ? "rgba(255,0,0,0.7)" : "rgba(0,100,255,0.15)";
    ctx.lineWidth = isConnector ? 1.5 : 0.5;
    ctx.strokeRect(entry.x, entry.y, entry.width, entry.height);
    if (isConnector) {
      ctx.fillStyle = "rgba(255,0,0,0.08)";
      ctx.fillRect(entry.x, entry.y, entry.width, entry.height);
      ctx.fillStyle = "rgba(255,0,0,0.9)";
      ctx.font = "8px sans-serif";
      ctx.fillText(entry.id, entry.x + 2, entry.y - 2);
    }
  }
  ctx.restore();
}
