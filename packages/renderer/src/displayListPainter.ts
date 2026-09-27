/**
 * DisplayList Canvas Painter — renders RenderCommands from the WASM engine.
 *
 * This replaces the old painter.ts which did its own layout calculation.
 * Now the layout is computed in Rust/WASM and this just paints the commands.
 */

import type { DisplayList, RenderCommand } from "./wasm";
import type { GlyphAtlas } from "./glyphAtlas";
import { resolveBasePath } from "./basePath";
import { canvasTextFont, TEXT_FONT_FAMILY } from "./textFont";

/** Outcome of {@link loadMusicFont}: names of faces that failed to load. */
export interface FontLoadResult {
  readonly failed: readonly string[];
}

/** Options for {@link loadMusicFont}. */
export interface LoadMusicFontOptions {
  /**
   * Also load the bundled Libertinus Serif text face as `Viritura Serif`.
   * Default true. When false, text falls back to the page's generic `serif`
   * (or a `Viritura Serif` face the host registers itself).
   */
  readonly textFont?: boolean;
}

interface FaceSpec {
  readonly name: string;
  readonly create: (basePath: string) => FontFace;
}

const MUSIC_FACES: readonly FaceSpec[] = [
  {
    name: "Bravura",
    create: (basePath) =>
      new FontFace("Bravura", `url(${basePath}fonts/Bravura.otf)`, {
        // Restrict to SMuFL Private Use Area + Musical Symbols block.
        // Without this, the browser falls back to Bravura for U+266D (♭) etc.
        // in text runs, rendering oversized music glyphs that obscure text labels.
        unicodeRange: "U+E000-F8FF, U+F0000-FFFFF",
      }),
  },
];

// Libertinus Serif — OFL-licensed text font with ♭♯♮ support. Registered
// under a private family (see textFont.ts) so embedding pages keep their
// own generic `serif`; the engine's DrawText { font: "serif" } maps to it.
const TEXT_FACES: readonly FaceSpec[] = (
  [
    ["Libertinus Serif", "Regular", {}],
    ["Libertinus Serif Bold", "Bold", { weight: "bold" }],
    ["Libertinus Serif Italic", "Italic", { style: "italic" }],
    ["Libertinus Serif Bold Italic", "BoldItalic", { weight: "bold", style: "italic" }],
  ] as const
).map(([name, file, descriptors]) => ({
  name,
  create: (basePath: string) =>
    new FontFace(TEXT_FONT_FAMILY, `url(${basePath}fonts/LibertinusSerif-${file}.otf)`, descriptors),
}));

/**
 * Loads a set of faces once. A result is cached only when the required face
 * loaded, so a failed fetch (network, CSP, wrong asset base) can be retried.
 */
function faceGroupLoader(faces: readonly FaceSpec[], required: string | null): () => Promise<FontLoadResult> {
  let loaded = false;
  let pending: Promise<FontLoadResult> | null = null;
  const load = async (): Promise<FontLoadResult> => {
    const basePath = resolveBasePath();
    const results = await Promise.allSettled(faces.map((face) => face.create(basePath).load()));
    const failed: string[] = [];
    for (const [i, result] of results.entries()) {
      if (result.status === "fulfilled") {
        document.fonts.add(result.value);
      } else {
        failed.push(faces[i]!.name);
        console.warn(`Failed to load ${faces[i]!.name} font:`, result.reason);
      }
    }
    return { failed };
  };
  return async () => {
    if (loaded) return { failed: [] };
    if (pending) return pending;
    const attempt = load();
    pending = attempt;
    try {
      const result = await attempt;
      if (required === null || !result.failed.includes(required)) loaded = true;
      return result;
    } catch (e) {
      console.warn("Failed to load fonts:", e);
      return { failed: faces.map((face) => face.name) };
    } finally {
      if (!loaded && pending === attempt) pending = null;
    }
  };
}

const loadMusicFaces = faceGroupLoader(MUSIC_FACES, "Bravura");
const loadTextFaces = faceGroupLoader(TEXT_FACES, null);

/**
 * Load the Bravura SMuFL font (always — layout metrics are Bravura's) and, by
 * default, the Libertinus Serif text font so Canvas can use them.
 */
export async function loadMusicFont(opts: LoadMusicFontOptions = {}): Promise<FontLoadResult> {
  const groups = opts.textFont === false ? [loadMusicFaces()] : [loadMusicFaces(), loadTextFaces()];
  const results = await Promise.all(groups);
  return { failed: results.flatMap((result) => result.failed) };
}

/**
 * Paint a DisplayList onto a Canvas 2D context.
 * Optionally uses a GlyphAtlas for accelerated glyph rendering.
 */
export function paintDisplayList(
  ctx: CanvasRenderingContext2D,
  displayList: DisplayList,
  glyphAtlas?: GlyphAtlas,
  background: string | null = "#FFFFFF",
): void {
  ctx.clearRect(0, 0, displayList.width, displayList.height);
  if (background !== null) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, displayList.width, displayList.height);
  }

  // Execute each render command
  for (const cmd of displayList.commands) {
    if (cmd.type === "DrawGlyph" && glyphAtlas?.isBuilt && cmd.rotation === 0) {
      const drawn = glyphAtlas.drawGlyph(ctx, cmd.codepoint, cmd.x, cmd.y, cmd.size, cmd.color);
      if (drawn) continue;
    }
    paintCommand(ctx, cmd);
  }
}

type CmdOfType<T extends RenderCommand["type"]> = Extract<RenderCommand, { type: T }>;

function paintLine(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawLine">): void {
  ctx.strokeStyle = cmd.color;
  ctx.lineWidth = cmd.width;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(cmd.x1, cmd.y1);
  ctx.lineTo(cmd.x2, cmd.y2);
  ctx.stroke();
}

function paintEllipse(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawEllipse">): void {
  ctx.save();
  ctx.translate(cmd.cx, cmd.cy);
  ctx.rotate(cmd.angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, cmd.rx, cmd.ry, 0, 0, Math.PI * 2);
  if (cmd.filled) {
    ctx.fillStyle = cmd.color;
    ctx.fill();
  } else {
    ctx.strokeStyle = cmd.color;
    ctx.lineWidth = Math.max(cmd.rx * 0.05, 1);
    ctx.stroke();
  }
  ctx.restore();
}

function paintText(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawText">): void {
  ctx.fillStyle = cmd.color;
  ctx.font = canvasTextFont(cmd.font, cmd.size);
  ctx.textAlign = cmd.align;
  ctx.textBaseline = cmd.baseline;
  ctx.fillText(cmd.text, cmd.x, cmd.y);
}

function paintGlyph(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawGlyph">): void {
  ctx.fillStyle = cmd.color;
  ctx.font = `${cmd.size}px ${cmd.font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  // Rust's JSON encoding omits zero rotation (binary commands include it).
  if (cmd.rotation != null && cmd.rotation !== 0) {
    ctx.save();
    ctx.translate(cmd.x, cmd.y);
    ctx.rotate(cmd.rotation);
    ctx.fillText(String.fromCodePoint(cmd.codepoint), 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(String.fromCodePoint(cmd.codepoint), cmd.x, cmd.y);
  }
}

function paintStretchedGlyph(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawStretchedGlyph">): void {
  ctx.fillStyle = cmd.color;
  ctx.font = `${cmd.size}px ${cmd.font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.save();
  ctx.translate(cmd.x, cmd.y);
  ctx.scale(cmd.scale_x, 1);
  ctx.fillText(String.fromCodePoint(cmd.codepoint), 0, 0);
  ctx.restore();
}

function paintBezier(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawBezier">): void {
  ctx.strokeStyle = cmd.color;
  ctx.lineWidth = cmd.width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cmd.x1, cmd.y1);
  ctx.bezierCurveTo(cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x2, cmd.y2);
  ctx.stroke();
}

function paintQuadratic(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawQuadratic">): void {
  ctx.strokeStyle = cmd.color;
  ctx.lineWidth = cmd.width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cmd.x1, cmd.y1);
  ctx.quadraticCurveTo(cmd.cx, cmd.cy, cmd.x2, cmd.y2);
  ctx.stroke();
}

/**
 * Trace the crescent outline of a solid filled-bezier onto `ctx` as the
 * current path, without painting. Shared by the normal painter and the
 * selection highlight so the two can never disagree about the shape.
 *
 * (x1,y1)/(x2,y2) are outer-contour endpoints; (ix1,iy1)/(ix2,iy2)
 * are inner-contour endpoints. Tips are closed with a small quadratic
 * curve that bulges outward along the local tangent, producing the
 * gentle rounded cap of standard engraving practice.
 */
export function traceFilledBezier(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cmd: CmdOfType<"DrawFilledBezier">,
): void {
  const cap1tx = cmd.x1 - cmd.ocx1;
  const cap1ty = cmd.y1 - cmd.ocy1;
  const cap1tl = Math.hypot(cap1tx, cap1ty) || 1;
  const cap1w = Math.hypot(cmd.x1 - cmd.ix1, cmd.y1 - cmd.iy1);
  const cap1ext = cap1w * 0.55;
  const cap1cx = (cmd.x1 + cmd.ix1) / 2 + (cap1tx / cap1tl) * cap1ext;
  const cap1cy = (cmd.y1 + cmd.iy1) / 2 + (cap1ty / cap1tl) * cap1ext;

  const cap2tx = cmd.x2 - cmd.ocx2;
  const cap2ty = cmd.y2 - cmd.ocy2;
  const cap2tl = Math.hypot(cap2tx, cap2ty) || 1;
  const cap2w = Math.hypot(cmd.x2 - cmd.ix2, cmd.y2 - cmd.iy2);
  const cap2ext = cap2w * 0.55;
  const cap2cx = (cmd.x2 + cmd.ix2) / 2 + (cap2tx / cap2tl) * cap2ext;
  const cap2cy = (cmd.y2 + cmd.iy2) / 2 + (cap2ty / cap2tl) * cap2ext;

  ctx.beginPath();
  ctx.moveTo(cmd.x1, cmd.y1);
  ctx.bezierCurveTo(cmd.ocx1, cmd.ocy1, cmd.ocx2, cmd.ocy2, cmd.x2, cmd.y2);
  ctx.quadraticCurveTo(cap2cx, cap2cy, cmd.ix2, cmd.iy2);
  ctx.bezierCurveTo(cmd.icx2, cmd.icy2, cmd.icx1, cmd.icy1, cmd.ix1, cmd.iy1);
  ctx.quadraticCurveTo(cap1cx, cap1cy, cmd.x1, cmd.y1);
  ctx.closePath();
}

function paintFilledBezierSolid(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawFilledBezier">): void {
  ctx.fillStyle = cmd.color;
  traceFilledBezier(ctx, cmd);
  ctx.fill();
}

/**
 * Midline (spine) cubic of a filled bezier — the average of the outer and
 * inner contours. Dashed slurs/ties are stroked along it.
 */
export function filledBezierMidline(cmd: CmdOfType<"DrawFilledBezier">): {
  x1: number;
  y1: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  x2: number;
  y2: number;
  thickness: number;
} {
  return {
    x1: cmd.x1,
    y1: cmd.y1,
    cx1: (cmd.ocx1 + cmd.icx1) / 2,
    cy1: (cmd.ocy1 + cmd.icy1) / 2,
    cx2: (cmd.ocx2 + cmd.icx2) / 2,
    cy2: (cmd.ocy2 + cmd.icy2) / 2,
    x2: cmd.x2,
    y2: cmd.y2,
    thickness: Math.hypot(cmd.ocx1 - cmd.icx1, cmd.ocy1 - cmd.icy1),
  };
}

function paintFilledBezierDashed(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawFilledBezier">): void {
  const mid = filledBezierMidline(cmd);
  const strokeWidth = Math.max(mid.thickness * 0.5, 1);
  ctx.strokeStyle = cmd.color;
  ctx.lineWidth = strokeWidth;
  if (cmd.line_style === 1) {
    ctx.lineCap = "butt";
    ctx.setLineDash([Math.max(strokeWidth * 2.4, 5), Math.max(strokeWidth * 1.8, 4)]);
  } else if (cmd.line_style === 2) {
    ctx.lineCap = "round";
    ctx.setLineDash([0.001, Math.max(strokeWidth * 2.2, 3.5)]);
  } else {
    ctx.lineCap = "round";
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.moveTo(mid.x1, mid.y1);
  ctx.bezierCurveTo(mid.cx1, mid.cy1, mid.cx2, mid.cy2, mid.x2, mid.y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintPolygon(ctx: CanvasRenderingContext2D, cmd: CmdOfType<"DrawPolygon">): void {
  const pts = cmd.points;
  if (pts.length < 3) return;
  ctx.fillStyle = cmd.color;
  ctx.beginPath();
  const first = pts[0];
  if (first) ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const pt = pts[i];
    if (pt) ctx.lineTo(pt[0], pt[1]);
  }
  ctx.closePath();
  ctx.fill();
}

export function paintCommand(ctx: CanvasRenderingContext2D, cmd: RenderCommand): void {
  switch (cmd.type) {
    case "DrawLine":
      paintLine(ctx, cmd);
      break;
    case "DrawEllipse":
      paintEllipse(ctx, cmd);
      break;
    case "DrawRect":
      ctx.fillStyle = cmd.color;
      ctx.fillRect(cmd.x, cmd.y, cmd.w, cmd.h);
      break;
    case "DrawCircle":
      ctx.fillStyle = cmd.color;
      ctx.beginPath();
      ctx.arc(cmd.cx, cmd.cy, cmd.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "DrawText":
      paintText(ctx, cmd);
      break;
    case "DrawGlyph":
      paintGlyph(ctx, cmd);
      break;
    case "DrawStretchedGlyph":
      paintStretchedGlyph(ctx, cmd);
      break;
    case "DrawBezier":
      paintBezier(ctx, cmd);
      break;
    case "DrawQuadratic":
      paintQuadratic(ctx, cmd);
      break;
    case "DrawFilledBezier":
      if (cmd.line_style === 0 || cmd.line_style === undefined) {
        paintFilledBezierSolid(ctx, cmd);
      } else {
        paintFilledBezierDashed(ctx, cmd);
      }
      break;
    case "DrawPolygon":
      paintPolygon(ctx, cmd);
      break;
    case "SetOpacity":
      ctx.globalAlpha = cmd.opacity;
      break;
  }
}
