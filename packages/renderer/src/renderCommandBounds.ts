import type { RenderCommand } from "./wasm";

export interface RenderBounds {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

/** Conservative command bounds shared by direct-paint and retained-layer culling. */
export function renderCommandBounds(cmd: RenderCommand): RenderBounds | null {
  switch (cmd.type) {
    case "DrawEllipse":
      return { x: cmd.cx - cmd.rx, y: cmd.cy - cmd.ry, x2: cmd.cx + cmd.rx, y2: cmd.cy + cmd.ry };
    case "DrawLine":
      return {
        x: Math.min(cmd.x1, cmd.x2) - cmd.width,
        y: Math.min(cmd.y1, cmd.y2) - cmd.width,
        x2: Math.max(cmd.x1, cmd.x2) + cmd.width,
        y2: Math.max(cmd.y1, cmd.y2) + cmd.width,
      };
    case "DrawRect":
      return { x: cmd.x, y: cmd.y, x2: cmd.x + cmd.w, y2: cmd.y + cmd.h };
    case "DrawCircle":
      return { x: cmd.cx - cmd.r, y: cmd.cy - cmd.r, x2: cmd.cx + cmd.r, y2: cmd.cy + cmd.r };
    case "DrawGlyph":
      return { x: cmd.x - cmd.size, y: cmd.y - cmd.size, x2: cmd.x + cmd.size * 2, y2: cmd.y + cmd.size };
    case "DrawStretchedGlyph":
      // A stretched glyph is only ever narrowed, so the proportional box still
      // contains it; its height is the one dimension `size` speaks for.
      return { x: cmd.x - cmd.size, y: cmd.y - cmd.size, x2: cmd.x + cmd.size * 2, y2: cmd.y + cmd.size };
    case "DrawText": {
      const charCount = cmd.text?.length ?? 1;
      const estimatedWidth = charCount * cmd.size * 0.6;
      const left =
        cmd.align === "right" ? cmd.x - estimatedWidth : cmd.align === "center" ? cmd.x - estimatedWidth / 2 : cmd.x;
      return { x: left, y: cmd.y - cmd.size, x2: left + estimatedWidth, y2: cmd.y + cmd.size * 0.3 };
    }
    case "DrawBezier":
      return {
        x: Math.min(cmd.x1, cmd.x2, cmd.cx1, cmd.cx2) - cmd.width,
        y: Math.min(cmd.y1, cmd.y2, cmd.cy1, cmd.cy2) - cmd.width,
        x2: Math.max(cmd.x1, cmd.x2, cmd.cx1, cmd.cx2) + cmd.width,
        y2: Math.max(cmd.y1, cmd.y2, cmd.cy1, cmd.cy2) + cmd.width,
      };
    case "DrawQuadratic":
      return {
        x: Math.min(cmd.x1, cmd.x2, cmd.cx) - cmd.width,
        y: Math.min(cmd.y1, cmd.y2, cmd.cy) - cmd.width,
        x2: Math.max(cmd.x1, cmd.x2, cmd.cx) + cmd.width,
        y2: Math.max(cmd.y1, cmd.y2, cmd.cy) + cmd.width,
      };
    case "DrawFilledBezier":
      return {
        x: Math.min(cmd.x1, cmd.x2, cmd.ocx1, cmd.ocx2, cmd.icx1, cmd.icx2),
        y: Math.min(cmd.y1, cmd.y2, cmd.ocy1, cmd.ocy2, cmd.icy1, cmd.icy2),
        x2: Math.max(cmd.x1, cmd.x2, cmd.ocx1, cmd.ocx2, cmd.icx1, cmd.icx2),
        y2: Math.max(cmd.y1, cmd.y2, cmd.ocy1, cmd.ocy2, cmd.icy1, cmd.icy2),
      };
    case "DrawPolygon": {
      if (cmd.points.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [px, py] of cmd.points) {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
      return { x: minX, y: minY, x2: maxX, y2: maxY };
    }
    case "SetOpacity":
      return null;
  }
}
