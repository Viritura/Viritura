/**
 * Shape-conformal selection highlight: an element is shown as selected by
 * re-inking its own render commands in the selection colour and wrapping them
 * in a soft halo of the same hue.
 *
 * The alternative — a rectangle around the hit region — degrades badly for
 * anything that isn't rectangular. A long or steeply-sloped slur produces a
 * huge, mostly-empty box whose corners land nowhere near the ink; a notehead
 * gets a box bigger than itself; a barline gets a sliver. Painting the
 * element's own geometry sidesteps all of that: the cue is always exactly the
 * shape of the thing selected.
 *
 * The halo is what carries the cue for viewers who can't rely on hue: it is a
 * thickness and luminance change on the ink itself, so it survives
 * desaturation. Colour is the redundant second channel, not the only one.
 */

import { traceFilledBezier, filledBezierMidline, paintCommand } from "./displayListPainter";
import type { DisplayList, RenderCommand } from "./wasm";

type FilledBezier = Extract<RenderCommand, { type: "DrawFilledBezier" }>;

/** Halo width added around the element's ink, in px at layout scale. */
const HALO_WIDTH = 7;
/** Halo width in high-contrast mode — heavier so it reads without the hue. */
const HALO_WIDTH_CONTRAST = 10;
/** Halo alpha (hex suffix) in normal and high-contrast modes. */
const HALO_ALPHA = "25"; // ~14%
const HALO_ALPHA_CONTRAST = "80"; // ~50%

/**
 * True when the user has asked for a higher-contrast presentation. Read per
 * paint (cheap) so the overlay follows a mid-session OS setting change without
 * needing a listener.
 */
function isContrastMode(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(prefers-contrast: more)").matches || matchMedia("(forced-colors: active)").matches;
}

// ── Element → commands index ──────────────────────────────────────

interface CommandIndex {
  /**
   * Version of the display list this index was built from. The layout pipeline
   * reuses one DisplayList object across incremental edits, swapping or
   * mutating its command arrays in place (see PatchReconstructor), so object
   * identity alone cannot tell a stale index from a fresh one.
   */
  version: number | undefined;
  /** Commands tagged with exactly this element id. */
  exact: Map<string, RenderCommand[]>;
  /** Memoised `exact` lookups widened to include descendant ids. */
  resolved: Map<string, RenderCommand[]>;
}

/**
 * Per-DisplayList command index, memoised against the list identity so the
 * O(commands) walk happens once per layout rather than once per frame.
 */
const indexCache = new WeakMap<DisplayList, CommandIndex>();

/**
 * Render commands that draw `elementId`, including those of its descendants.
 *
 * Descendants matter because the engine tags sub-parts under child ids: an
 * event owns its stem and accidental directly but its noteheads are tagged
 * `…/n0`, `…/n1` and its augmentation dots `…/dot/0/0`. Selecting the event
 * has to light all of them.
 *
 * `version` must advance whenever the display list's contents change.
 * Omitting it disables memoisation, which is correct but costs an O(commands)
 * walk per call — fine for one-shot renders (export, print preview), wrong for
 * the interactive paint loop.
 */
export function commandsForElement(
  displayList: DisplayList,
  elementId: string,
  version?: number,
): RenderCommand[] | undefined {
  const index = getIndex(displayList, version);
  const memo = index.resolved.get(elementId);
  if (memo) return memo.length > 0 ? memo : undefined;

  const collected = [...(index.exact.get(elementId) ?? [])];
  const childPrefix = `${elementId}/`;
  for (const [id, cmds] of index.exact) {
    if (id.startsWith(childPrefix)) collected.push(...cmds);
  }
  index.resolved.set(elementId, collected);
  return collected.length > 0 ? collected : undefined;
}

function getIndex(displayList: DisplayList, version: number | undefined): CommandIndex {
  const cached = indexCache.get(displayList);
  // An undefined version never matches, so an un-versioned caller rebuilds
  // every time rather than reading a stale index.
  if (cached && version !== undefined && cached.version === version) return cached;
  const index: CommandIndex = { version, exact: buildExactIndex(displayList), resolved: new Map() };
  indexCache.set(displayList, index);
  return index;
}

function buildExactIndex(displayList: DisplayList): Map<string, RenderCommand[]> {
  const exact = new Map<string, RenderCommand[]>();
  const ids = displayList.elementIds;
  if (!ids || ids.length === 0) return exact;

  for (let i = 0; i < displayList.commands.length; i++) {
    const cmd = displayList.commands[i];
    // SetOpacity carries no geometry and would leak its alpha into the overlay.
    if (!cmd || cmd.type === "SetOpacity") continue;
    const id = ids[i];
    if (!id) continue;
    const bucket = exact.get(id);
    // One id can own several commands: a barline across staves, a cross-system
    // slur's segments, a beam's spans.
    if (bucket) bucket.push(cmd);
    else exact.set(id, [cmd]);
  }
  return exact;
}

/** The filled-bezier (slur/tie) commands among `commands`. */
export function filledBeziersIn(commands: readonly RenderCommand[]): FilledBezier[] {
  return commands.filter((c): c is FilledBezier => c.type === "DrawFilledBezier");
}

/**
 * True when an element reads as letterforms rather than as a shape. Those get
 * a shaded box rather than the ink treatment: an outline traced around
 * letterforms fills their counters and crowds the spacing, and the text
 * becomes harder to read exactly when you're trying to read it. A notehead has
 * no counters to clog, so it keeps the shape-conformal halo.
 *
 * Two families qualify:
 *
 * - Prose (`DrawText`): tempo marks, expressions, rehearsal marks, lyrics,
 *   chord symbols.
 * - Dynamics letters (`…/dyn{group}`): drawn as SMuFL glyphs, but `p`, `mf`,
 *   `sfz` are read as words, and Bravura's dynamics letters are the tightest
 *   counters on the page. Hairpins are shapes rather than letters and carry
 *   their own `…/hairpin{group}` ids, so they keep the ink treatment.
 */
export function drawsLetterforms(elementId: string, commands: readonly RenderCommand[]): boolean {
  if (commands.some((c) => c.type === "DrawText")) return true;
  return elementId.slice(elementId.lastIndexOf("/") + 1).startsWith("dyn");
}

/** Curve commands for `elementId`, or undefined when it doesn't draw a curve. */
export function curveCommandsFor(
  displayList: DisplayList,
  elementId: string,
  version?: number,
): FilledBezier[] | undefined {
  const commands = commandsForElement(displayList, elementId, version);
  if (!commands) return undefined;
  const curves = filledBeziersIn(commands);
  return curves.length > 0 ? curves : undefined;
}

// ── Painting ──────────────────────────────────────────────────────

/**
 * Paint the selection highlight for one element: a halo pass behind all of its
 * ink, then the ink itself re-coloured. The two passes are separate loops so a
 * halo can never land on top of a neighbouring stroke of the same element.
 */
export function paintElementHighlight(
  ctx: CanvasRenderingContext2D,
  commands: readonly RenderCommand[],
  color: string,
): void {
  const contrast = isContrastMode();
  const haloWidth = contrast ? HALO_WIDTH_CONTRAST : HALO_WIDTH;
  const haloColor = color + (contrast ? HALO_ALPHA_CONTRAST : HALO_ALPHA);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  for (const cmd of commands) paintHalo(ctx, cmd, haloColor, haloWidth);
  ctx.restore();

  ctx.save();
  for (const cmd of commands) paintCommand(ctx, { ...cmd, color } as RenderCommand);
  ctx.restore();
}

function paintHalo(ctx: CanvasRenderingContext2D, cmd: RenderCommand, haloColor: string, haloWidth: number): void {
  ctx.strokeStyle = haloColor;
  ctx.fillStyle = haloColor;

  switch (cmd.type) {
    case "DrawGlyph":
      haloGlyph(ctx, cmd, haloWidth);
      break;
    case "DrawText":
      haloText(ctx, cmd, haloWidth);
      break;
    case "DrawLine":
      ctx.lineWidth = cmd.width + haloWidth;
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.lineTo(cmd.x2, cmd.y2);
      ctx.stroke();
      break;
    case "DrawRect":
      ctx.lineWidth = haloWidth;
      ctx.strokeRect(cmd.x, cmd.y, cmd.w, cmd.h);
      ctx.fillRect(cmd.x, cmd.y, cmd.w, cmd.h);
      break;
    case "DrawCircle":
      ctx.lineWidth = haloWidth;
      ctx.beginPath();
      ctx.arc(cmd.cx, cmd.cy, cmd.r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "DrawEllipse":
      haloEllipse(ctx, cmd, haloWidth);
      break;
    case "DrawPolygon":
      haloPolygon(ctx, cmd, haloWidth);
      break;
    case "DrawBezier":
      ctx.lineWidth = cmd.width + haloWidth;
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.bezierCurveTo(cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x2, cmd.y2);
      ctx.stroke();
      break;
    case "DrawQuadratic":
      ctx.lineWidth = cmd.width + haloWidth;
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.quadraticCurveTo(cmd.cx, cmd.cy, cmd.x2, cmd.y2);
      ctx.stroke();
      break;
    case "DrawFilledBezier":
      haloFilledBezier(ctx, cmd, haloWidth);
      break;
    default:
      break;
  }
}

function haloGlyph(ctx: CanvasRenderingContext2D, cmd: Extract<RenderCommand, { type: "DrawGlyph" }>, w: number): void {
  ctx.font = `${cmd.size}px ${cmd.font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = w;
  const glyph = String.fromCodePoint(cmd.codepoint);
  if (cmd.rotation !== 0) {
    ctx.save();
    ctx.translate(cmd.x, cmd.y);
    ctx.rotate(cmd.rotation);
    ctx.strokeText(glyph, 0, 0);
    ctx.restore();
  } else {
    ctx.strokeText(glyph, cmd.x, cmd.y);
  }
}

function haloText(ctx: CanvasRenderingContext2D, cmd: Extract<RenderCommand, { type: "DrawText" }>, w: number): void {
  // Font-string assembly mirrors paintText so the outline traces the same run.
  const fontParts = cmd.font.split(" ");
  const fontFamily = fontParts[0] ?? "serif";
  const fontStyle = fontParts.slice(1).join(" ");
  ctx.font = fontStyle ? `${fontStyle} ${cmd.size}px ${fontFamily}` : `${cmd.size}px ${fontFamily}`;
  ctx.textAlign = cmd.align;
  ctx.textBaseline = cmd.baseline;
  ctx.lineWidth = w;
  ctx.strokeText(cmd.text, cmd.x, cmd.y);
}

function haloEllipse(
  ctx: CanvasRenderingContext2D,
  cmd: Extract<RenderCommand, { type: "DrawEllipse" }>,
  w: number,
): void {
  ctx.save();
  ctx.translate(cmd.cx, cmd.cy);
  ctx.rotate(cmd.angle);
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.ellipse(0, 0, cmd.rx, cmd.ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function haloPolygon(
  ctx: CanvasRenderingContext2D,
  cmd: Extract<RenderCommand, { type: "DrawPolygon" }>,
  w: number,
): void {
  const pts = cmd.points;
  if (pts.length < 3) return;
  ctx.lineWidth = w;
  ctx.beginPath();
  const first = pts[0];
  if (first) ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const pt = pts[i];
    if (pt) ctx.lineTo(pt[0], pt[1]);
  }
  ctx.closePath();
  ctx.stroke();
}

function haloFilledBezier(ctx: CanvasRenderingContext2D, cmd: FilledBezier, w: number): void {
  const dashed = cmd.line_style !== 0 && cmd.line_style !== undefined;
  if (!dashed) {
    traceFilledBezier(ctx, cmd);
    ctx.lineWidth = w;
    ctx.stroke();
    return;
  }
  // Dashed curves are stroked along the midline, so the halo follows the
  // midline too — a continuous band that reads as one selected object even
  // though the ink itself is broken.
  const mid = filledBezierMidline(cmd);
  ctx.lineWidth = Math.max(mid.thickness * 0.5, 1) + w;
  ctx.beginPath();
  ctx.moveTo(mid.x1, mid.y1);
  ctx.bezierCurveTo(mid.cx1, mid.cy1, mid.cx2, mid.cy2, mid.x2, mid.y2);
  ctx.stroke();
}

// ── Letterform shading ────────────────────────────────────────────

/** Padding around a run's measured box, in px at layout scale. */
const TEXT_SHADE_PAD = 3;
/** Fill and border alpha (hex suffix) for the shaded box. */
const SHADE_FILL_ALPHA = "25"; // ~14%
const SHADE_BORDER_ALPHA = "99"; // ~60%
const SHADE_FILL_ALPHA_CONTRAST = "50"; // ~31%
const SHADE_BORDER_ALPHA_CONTRAST = "FF";

/**
 * Shade the box an element occupies, leaving its letterforms untouched. The
 * box is measured from the commands themselves rather than taken from the hit
 * region, so it hugs the actual run instead of whatever padding the hit region
 * carries.
 */
export function paintTextShade(
  ctx: CanvasRenderingContext2D,
  commands: readonly RenderCommand[],
  color: string,
): boolean {
  const box = measureCommands(ctx, commands);
  if (!box) return false;

  const contrast = isContrastMode();
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = color + (contrast ? SHADE_FILL_ALPHA_CONTRAST : SHADE_FILL_ALPHA);
  ctx.strokeStyle = color + (contrast ? SHADE_BORDER_ALPHA_CONTRAST : SHADE_BORDER_ALPHA);
  ctx.lineWidth = contrast ? 2 : 1;
  const x = box.minX - TEXT_SHADE_PAD;
  const y = box.minY - TEXT_SHADE_PAD;
  const w = box.maxX - box.minX + TEXT_SHADE_PAD * 2;
  const h = box.maxY - box.minY + TEXT_SHADE_PAD * 2;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
  return true;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function measureCommands(ctx: CanvasRenderingContext2D, commands: readonly RenderCommand[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const cmd of commands) {
    const box = measureCommand(ctx, cmd);
    if (!box) continue;
    bounds = bounds ? union(bounds, box) : box;
  }
  return bounds;
}

function union(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function measureCommand(ctx: CanvasRenderingContext2D, cmd: RenderCommand): Bounds | null {
  switch (cmd.type) {
    case "DrawText":
      return measureRun(ctx, cmd.text, cmd.x, cmd.y, cmd.size, textFont(cmd), cmd.align, cmd.baseline);
    case "DrawGlyph":
      // A metronome mark mixes a note glyph with its text; measure both so the
      // box wraps the whole mark.
      return measureRun(
        ctx,
        String.fromCodePoint(cmd.codepoint),
        cmd.x,
        cmd.y,
        cmd.size,
        `${cmd.size}px ${cmd.font}`,
        "left",
        "alphabetic",
      );
    case "DrawLine":
      return {
        minX: Math.min(cmd.x1, cmd.x2),
        minY: Math.min(cmd.y1, cmd.y2),
        maxX: Math.max(cmd.x1, cmd.x2),
        maxY: Math.max(cmd.y1, cmd.y2),
      };
    case "DrawRect":
      return { minX: cmd.x, minY: cmd.y, maxX: cmd.x + cmd.w, maxY: cmd.y + cmd.h };
    default:
      return null;
  }
}

function textFont(cmd: Extract<RenderCommand, { type: "DrawText" }>): string {
  const fontParts = cmd.font.split(" ");
  const fontFamily = fontParts[0] ?? "serif";
  const fontStyle = fontParts.slice(1).join(" ");
  return fontStyle ? `${fontStyle} ${cmd.size}px ${fontFamily}` : `${cmd.size}px ${fontFamily}`;
}

/**
 * Bounds of one painted run. `measureText` reports its actual-bounding-box
 * offsets relative to the anchor point *after* alignment and baseline are
 * applied, so the four values map straight onto the box. Canvas
 * implementations without those metrics (jsdom) fall back to an estimate from
 * the font size.
 */
function measureRun(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  font: string,
  align: CanvasTextAlign,
  baseline: CanvasTextBaseline,
): Bounds {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  const m = typeof ctx.measureText === "function" ? ctx.measureText(text) : undefined;
  ctx.restore();

  if (m && typeof m.actualBoundingBoxAscent === "number" && typeof m.actualBoundingBoxRight === "number") {
    return {
      minX: x - m.actualBoundingBoxLeft,
      minY: y - m.actualBoundingBoxAscent,
      maxX: x + m.actualBoundingBoxRight,
      maxY: y + m.actualBoundingBoxDescent,
    };
  }

  const width = m?.width ?? text.length * size * 0.6;
  const left = align === "center" ? x - width / 2 : align === "right" || align === "end" ? x - width : x;
  return { minX: left, minY: y - size * 0.8, maxX: left + width, maxY: y + size * 0.25 };
}

// ── Curve anchors ─────────────────────────────────────────────────

/**
 * Endpoints of a curve group, as the midpoint of each tip's outer and inner
 * contour. For a cross-system curve the start comes from the first segment and
 * the end from the last, so the two drag handles land on the outermost tips.
 */
export function curveEndpoints(commands: readonly FilledBezier[]): {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
} | null {
  const first = commands[0];
  const last = commands[commands.length - 1];
  if (!first || !last) return null;
  return {
    startX: (first.x1 + first.ix1) / 2,
    startY: (first.y1 + first.iy1) / 2,
    endX: (last.x2 + last.ix2) / 2,
    endY: (last.y2 + last.iy2) / 2,
  };
}

/** Radius of the anchor handles drawn at a selected curve's tips. */
const ANCHOR_RADIUS = 4;

/** Paint the two drag anchors at a selected curve's real tips. */
export function paintCurveAnchors(
  ctx: CanvasRenderingContext2D,
  commands: readonly FilledBezier[],
  color: string,
): void {
  const ends = curveEndpoints(commands);
  if (!ends) return;
  ctx.save();
  paintAnchorHandle(ctx, ends.startX, ends.startY, color);
  paintAnchorHandle(ctx, ends.endX, ends.endY, color);
  ctx.restore();
}

function paintAnchorHandle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, ANCHOR_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
