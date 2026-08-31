/**
 * Per-tag binary display list decoders and painters.
 *
 * Split out of `binaryDisplayList.ts` so that the two top-level entry
 * points (`decodeBinaryDisplayList`, `paintBinaryDisplayList`) stay
 * within complexity and length budgets — see eslint config.
 */

import type { RenderCommand } from "./wasm";

// ───────────────────────────────────────────────
// Tag and table constants (must match Rust binary.rs)
// ───────────────────────────────────────────────

const TAG_DRAW_LINE = 1;
const TAG_DRAW_RECT = 2;
const TAG_DRAW_CIRCLE = 3;
const TAG_DRAW_ELLIPSE = 4;
const TAG_DRAW_GLYPH = 5;
const TAG_DRAW_BEZIER = 6;
const TAG_DRAW_QUADRATIC = 7;
const TAG_DRAW_FILLED_BEZIER = 8;
const TAG_DRAW_POLYGON = 9;
const TAG_DRAW_TEXT = 10;
const TAG_SET_OPACITY = 11;
const TAG_DRAW_STRETCHED_GLYPH = 12;

// Font IDs match the engine's binary protocol (render/binary.rs):
// 0 = Bravura (music), then text fonts packed as 1 + family*4 + style where
// family is serif=0/sans-serif=1/monospace=2 and style is
// (bold) | (italic << 1).
const FONT_TABLE = [
  "Bravura",
  "serif",
  "serif",
  "serif",
  "serif",
  "sans-serif",
  "sans-serif",
  "sans-serif",
  "sans-serif",
  "monospace",
  "monospace",
  "monospace",
  "monospace",
] as const;
const FONT_STYLE_TABLE = [
  "",
  "",
  "bold ",
  "italic ",
  "bold italic ",
  "",
  "bold ",
  "italic ",
  "bold italic ",
  "",
  "bold ",
  "italic ",
  "bold italic ",
] as const;
const FONT_DECODE_TABLE = [
  "Bravura",
  "serif",
  "serif bold",
  "serif italic",
  "serif bold italic",
  "sans-serif",
  "sans-serif bold",
  "sans-serif italic",
  "sans-serif bold italic",
  "monospace",
  "monospace bold",
  "monospace italic",
  "monospace bold italic",
] as const;

const ALIGN_TABLE: readonly CanvasTextAlign[] = ["left", "center", "right"];
const BASELINE_TABLE: readonly CanvasTextBaseline[] = ["top", "middle", "bottom", "alphabetic"];

// ───────────────────────────────────────────────
// BinaryReader — fast typed-array reader for the binary buffer.
// ───────────────────────────────────────────────

export class BinaryReader {
  private readonly f32Data: Float32Array;
  private readonly u32Data: Uint32Array;
  pos: number = 0;

  constructor(data: Float32Array) {
    this.f32Data = data;
    this.u32Data = new Uint32Array(data.buffer, data.byteOffset, data.length);
  }

  f32(): number {
    const val = this.f32Data[this.pos] ?? 0;
    this.pos++;
    return val;
  }

  u32(): number {
    const val = this.u32Data[this.pos] ?? 0;
    this.pos++;
    return val;
  }

  color(): string {
    const rgb = this.u32Data[this.pos] ?? 0;
    this.pos++;
    return "#" + (rgb & 0xffffff).toString(16).padStart(6, "0").toUpperCase();
  }

  colorFast(): string {
    const rgb = this.u32Data[this.pos] ?? 0;
    this.pos++;
    return "#" + (rgb & 0xffffff).toString(16).padStart(6, "0");
  }

  skip(n: number): void {
    this.pos += n;
  }
}

// ───────────────────────────────────────────────
// Per-tag DECODERS (structured RenderCommand emit)
// ───────────────────────────────────────────────

type Decoder = (r: BinaryReader) => RenderCommand;

function decodeDrawLine(r: BinaryReader): RenderCommand {
  return {
    type: "DrawLine",
    x1: r.f32(),
    y1: r.f32(),
    x2: r.f32(),
    y2: r.f32(),
    width: r.f32(),
    color: r.color(),
  };
}

function decodeDrawRect(r: BinaryReader): RenderCommand {
  return {
    type: "DrawRect",
    x: r.f32(),
    y: r.f32(),
    w: r.f32(),
    h: r.f32(),
    color: r.color(),
  };
}

function decodeDrawCircle(r: BinaryReader): RenderCommand {
  return {
    type: "DrawCircle",
    cx: r.f32(),
    cy: r.f32(),
    r: r.f32(),
    color: r.color(),
  };
}

function decodeDrawEllipse(r: BinaryReader): RenderCommand {
  const cx = r.f32(),
    cy = r.f32();
  const rx = r.f32(),
    ry = r.f32();
  const angle = r.f32();
  const filled = r.f32() !== 0;
  const color = r.color();
  return { type: "DrawEllipse", cx, cy, rx, ry, angle, filled, color };
}

function decodeDrawGlyph(r: BinaryReader): RenderCommand {
  const x = r.f32(),
    y = r.f32();
  const codepoint = r.f32();
  const fontId = r.f32();
  const size = r.f32();
  const color = r.color();
  const rotation = r.f32();
  return {
    type: "DrawGlyph",
    x,
    y,
    codepoint,
    font: FONT_TABLE[fontId] ?? "serif",
    size,
    color,
    rotation,
  };
}

function decodeDrawStretchedGlyph(r: BinaryReader): RenderCommand {
  const x = r.f32(),
    y = r.f32();
  const codepoint = r.f32();
  const fontId = r.f32();
  const size = r.f32();
  const color = r.color();
  const scale_x = r.f32();
  return {
    type: "DrawStretchedGlyph",
    x,
    y,
    codepoint,
    font: FONT_TABLE[fontId] ?? "serif",
    size,
    color,
    scale_x,
  };
}

function decodeDrawBezier(r: BinaryReader): RenderCommand {
  return {
    type: "DrawBezier",
    x1: r.f32(),
    y1: r.f32(),
    cx1: r.f32(),
    cy1: r.f32(),
    cx2: r.f32(),
    cy2: r.f32(),
    x2: r.f32(),
    y2: r.f32(),
    width: r.f32(),
    color: r.color(),
  };
}

function decodeDrawQuadratic(r: BinaryReader): RenderCommand {
  return {
    type: "DrawQuadratic",
    x1: r.f32(),
    y1: r.f32(),
    cx: r.f32(),
    cy: r.f32(),
    x2: r.f32(),
    y2: r.f32(),
    width: r.f32(),
    color: r.color(),
  };
}

function decodeDrawFilledBezier(r: BinaryReader): RenderCommand {
  return {
    type: "DrawFilledBezier",
    x1: r.f32(),
    y1: r.f32(),
    x2: r.f32(),
    y2: r.f32(),
    ocx1: r.f32(),
    ocy1: r.f32(),
    ocx2: r.f32(),
    ocy2: r.f32(),
    icx1: r.f32(),
    icy1: r.f32(),
    icx2: r.f32(),
    icy2: r.f32(),
    ix1: r.f32(),
    iy1: r.f32(),
    ix2: r.f32(),
    iy2: r.f32(),
    color: r.color(),
    line_style: r.f32(),
  };
}

function decodeDrawPolygon(r: BinaryReader): RenderCommand {
  const nPoints = r.f32();
  const points: [number, number][] = [];
  for (let i = 0; i < nPoints; i++) {
    points.push([r.f32(), r.f32()]);
  }
  return { type: "DrawPolygon", points, color: r.color() };
}

function decodeDrawText(r: BinaryReader): RenderCommand {
  const x = r.f32(),
    y = r.f32();
  const size = r.f32();
  const color = r.color();
  const alignIdx = r.f32();
  const baselineIdx = r.f32();
  const fontId = r.f32();
  const textLen = r.f32();
  let text = "";
  for (let i = 0; i < textLen; i++) {
    text += String.fromCodePoint(r.f32());
  }
  return {
    type: "DrawText",
    x,
    y,
    size,
    color,
    align: (ALIGN_TABLE[alignIdx] ?? "left") as "left" | "center" | "right",
    baseline: (BASELINE_TABLE[baselineIdx] ?? "alphabetic") as "top" | "middle" | "bottom" | "alphabetic",
    font: FONT_DECODE_TABLE[fontId] ?? "serif",
    text,
  };
}

function decodeSetOpacity(r: BinaryReader): RenderCommand {
  return { type: "SetOpacity", opacity: r.f32() };
}

export const DECODERS: Record<number, Decoder> = {
  [TAG_DRAW_LINE]: decodeDrawLine,
  [TAG_DRAW_RECT]: decodeDrawRect,
  [TAG_DRAW_CIRCLE]: decodeDrawCircle,
  [TAG_DRAW_ELLIPSE]: decodeDrawEllipse,
  [TAG_DRAW_GLYPH]: decodeDrawGlyph,
  [TAG_DRAW_STRETCHED_GLYPH]: decodeDrawStretchedGlyph,
  [TAG_DRAW_BEZIER]: decodeDrawBezier,
  [TAG_DRAW_QUADRATIC]: decodeDrawQuadratic,
  [TAG_DRAW_FILLED_BEZIER]: decodeDrawFilledBezier,
  [TAG_DRAW_POLYGON]: decodeDrawPolygon,
  [TAG_DRAW_TEXT]: decodeDrawText,
  [TAG_SET_OPACITY]: decodeSetOpacity,
};

// ───────────────────────────────────────────────
// Per-tag PAINTERS (direct canvas paint)
// ───────────────────────────────────────────────

type Painter = (ctx: CanvasRenderingContext2D, r: BinaryReader) => void;

function paintDrawLine(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const x1 = r.f32(),
    y1 = r.f32(),
    x2 = r.f32(),
    y2 = r.f32();
  const lineWidth = r.f32();
  ctx.strokeStyle = r.colorFast();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function paintDrawRect(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const x = r.f32(),
    y = r.f32(),
    w = r.f32(),
    h = r.f32();
  ctx.fillStyle = r.colorFast();
  ctx.fillRect(x, y, w, h);
}

function paintDrawCircle(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const cx = r.f32(),
    cy = r.f32(),
    radius = r.f32();
  ctx.fillStyle = r.colorFast();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

function paintDrawEllipse(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const cx = r.f32(),
    cy = r.f32(),
    rx = r.f32(),
    ry = r.f32();
  const angle = r.f32();
  const filled = r.f32() !== 0;
  const color = r.colorFast();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  if (filled) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(rx * 0.05, 1);
    ctx.stroke();
  }
  ctx.restore();
}

function paintDrawGlyph(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const x = r.f32(),
    y = r.f32();
  const codepoint = r.f32();
  const fontId = r.f32();
  const size = r.f32();
  ctx.fillStyle = r.colorFast();
  const rotation = r.f32();
  ctx.font = `${size}px ${FONT_TABLE[fontId] ?? "serif"}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if (rotation !== 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillText(String.fromCodePoint(codepoint), 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(String.fromCodePoint(codepoint), x, y);
  }
}

function paintDrawStretchedGlyph(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const x = r.f32(),
    y = r.f32();
  const codepoint = r.f32();
  const fontId = r.f32();
  const size = r.f32();
  ctx.fillStyle = r.colorFast();
  const scaleX = r.f32();
  ctx.font = `${size}px ${FONT_TABLE[fontId] ?? "serif"}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scaleX, 1);
  ctx.fillText(String.fromCodePoint(codepoint), 0, 0);
  ctx.restore();
}

function paintDrawBezier(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const x1 = r.f32(),
    y1 = r.f32();
  const cx1 = r.f32(),
    cy1 = r.f32();
  const cx2 = r.f32(),
    cy2 = r.f32();
  const x2 = r.f32(),
    y2 = r.f32();
  const lineWidth = r.f32();
  ctx.strokeStyle = r.colorFast();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
  ctx.stroke();
}

function paintDrawQuadratic(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const x1 = r.f32(),
    y1 = r.f32();
  const cx = r.f32(),
    cy = r.f32();
  const x2 = r.f32(),
    y2 = r.f32();
  const lineWidth = r.f32();
  ctx.strokeStyle = r.colorFast();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.stroke();
}

interface FilledBezierGeom {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ocx1: number;
  ocy1: number;
  ocx2: number;
  ocy2: number;
  icx1: number;
  icy1: number;
  icx2: number;
  icy2: number;
  ix1: number;
  iy1: number;
  ix2: number;
  iy2: number;
}

function paintFilledBezierSolid(ctx: CanvasRenderingContext2D, g: FilledBezierGeom, fillColor: string): void {
  // Solid: filled crescent shape with finite-width rounded tips.
  // Cap is a quadratic curve bulging outward along the local tangent.
  const cap1tx = g.x1 - g.ocx1;
  const cap1ty = g.y1 - g.ocy1;
  const cap1tl = Math.hypot(cap1tx, cap1ty) || 1;
  const cap1w = Math.hypot(g.x1 - g.ix1, g.y1 - g.iy1);
  const cap1ext = cap1w * 0.55;
  const cap1cx = (g.x1 + g.ix1) / 2 + (cap1tx / cap1tl) * cap1ext;
  const cap1cy = (g.y1 + g.iy1) / 2 + (cap1ty / cap1tl) * cap1ext;

  const cap2tx = g.x2 - g.ocx2;
  const cap2ty = g.y2 - g.ocy2;
  const cap2tl = Math.hypot(cap2tx, cap2ty) || 1;
  const cap2w = Math.hypot(g.x2 - g.ix2, g.y2 - g.iy2);
  const cap2ext = cap2w * 0.55;
  const cap2cx = (g.x2 + g.ix2) / 2 + (cap2tx / cap2tl) * cap2ext;
  const cap2cy = (g.y2 + g.iy2) / 2 + (cap2ty / cap2tl) * cap2ext;

  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(g.x1, g.y1);
  ctx.bezierCurveTo(g.ocx1, g.ocy1, g.ocx2, g.ocy2, g.x2, g.y2);
  ctx.quadraticCurveTo(cap2cx, cap2cy, g.ix2, g.iy2);
  ctx.bezierCurveTo(g.icx2, g.icy2, g.icx1, g.icy1, g.ix1, g.iy1);
  ctx.quadraticCurveTo(cap1cx, cap1cy, g.x1, g.y1);
  ctx.closePath();
  ctx.fill();
}

function paintFilledBezierStroked(
  ctx: CanvasRenderingContext2D,
  g: FilledBezierGeom,
  fillColor: string,
  lineStyle: number,
): void {
  // Dashed/dotted: stroke through the midline of outer+inner curves
  // standard engraving practice renders dashed slurs as dashed bezier strokes.
  const mcx1 = (g.ocx1 + g.icx1) / 2;
  const mcy1 = (g.ocy1 + g.icy1) / 2;
  const mcx2 = (g.ocx2 + g.icx2) / 2;
  const mcy2 = (g.ocy2 + g.icy2) / 2;
  const thickness = Math.hypot(g.ocx1 - g.icx1, g.ocy1 - g.icy1);
  const strokeWidth = Math.max(thickness * 0.5, 1);
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = strokeWidth;
  if (lineStyle === 1) {
    // Dashed
    ctx.lineCap = "butt";
    ctx.setLineDash([Math.max(strokeWidth * 2.4, 5), Math.max(strokeWidth * 1.8, 4)]);
  } else if (lineStyle === 2) {
    // Dotted
    ctx.lineCap = "round";
    ctx.setLineDash([0.001, Math.max(strokeWidth * 2.2, 3.5)]);
  } else {
    // Unknown style — fallback to solid stroke
    ctx.lineCap = "round";
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.moveTo(g.x1, g.y1);
  ctx.bezierCurveTo(mcx1, mcy1, mcx2, mcy2, g.x2, g.y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintDrawFilledBezier(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const g: FilledBezierGeom = {
    x1: r.f32(),
    y1: r.f32(),
    x2: r.f32(),
    y2: r.f32(),
    ocx1: r.f32(),
    ocy1: r.f32(),
    ocx2: r.f32(),
    ocy2: r.f32(),
    icx1: r.f32(),
    icy1: r.f32(),
    icx2: r.f32(),
    icy2: r.f32(),
    ix1: r.f32(),
    iy1: r.f32(),
    ix2: r.f32(),
    iy2: r.f32(),
  };
  const fillColor = r.colorFast();
  const lineStyle = r.f32();
  if (lineStyle === 0) {
    paintFilledBezierSolid(ctx, g, fillColor);
  } else {
    paintFilledBezierStroked(ctx, g, fillColor, lineStyle);
  }
}

function paintDrawPolygon(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const nPoints = r.f32();
  if (nPoints >= 3) {
    ctx.beginPath();
    ctx.moveTo(r.f32(), r.f32());
    for (let i = 1; i < nPoints; i++) {
      ctx.lineTo(r.f32(), r.f32());
    }
    ctx.fillStyle = r.colorFast();
    ctx.closePath();
    ctx.fill();
  } else {
    r.skip(nPoints * 2 + 1);
  }
}

function paintDrawText(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  const x = r.f32(),
    y = r.f32();
  const size = r.f32();
  ctx.fillStyle = r.colorFast();
  const alignIdx = r.f32();
  const baselineIdx = r.f32();
  const fontId = r.f32();
  const textLen = r.f32();
  let text = "";
  for (let i = 0; i < textLen; i++) {
    text += String.fromCodePoint(r.f32());
  }
  ctx.font = `${FONT_STYLE_TABLE[fontId] ?? ""}${size}px ${FONT_TABLE[fontId] ?? "serif"}`;
  ctx.textAlign = ALIGN_TABLE[alignIdx] ?? "left";
  ctx.textBaseline = BASELINE_TABLE[baselineIdx] ?? "alphabetic";
  ctx.fillText(text, x, y);
}

function paintSetOpacity(ctx: CanvasRenderingContext2D, r: BinaryReader): void {
  ctx.globalAlpha = r.f32();
}

export const PAINTERS: Record<number, Painter> = {
  [TAG_DRAW_LINE]: paintDrawLine,
  [TAG_DRAW_RECT]: paintDrawRect,
  [TAG_DRAW_CIRCLE]: paintDrawCircle,
  [TAG_DRAW_ELLIPSE]: paintDrawEllipse,
  [TAG_DRAW_GLYPH]: paintDrawGlyph,
  [TAG_DRAW_STRETCHED_GLYPH]: paintDrawStretchedGlyph,
  [TAG_DRAW_BEZIER]: paintDrawBezier,
  [TAG_DRAW_QUADRATIC]: paintDrawQuadratic,
  [TAG_DRAW_FILLED_BEZIER]: paintDrawFilledBezier,
  [TAG_DRAW_POLYGON]: paintDrawPolygon,
  [TAG_DRAW_TEXT]: paintDrawText,
  [TAG_SET_OPACITY]: paintSetOpacity,
};
