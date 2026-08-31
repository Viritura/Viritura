import type { DisplayList, GlyphAtlas } from "@viritura/renderer";

/** Paint a single render command onto a canvas 2D context. */
export function paintCommand(ctx: CanvasRenderingContext2D, cmd: DisplayList["commands"][number]): void {
  switch (cmd.type) {
    case "DrawLine":
      ctx.strokeStyle = cmd.color;
      ctx.lineWidth = cmd.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.lineTo(cmd.x2, cmd.y2);
      ctx.stroke();
      break;
    case "DrawEllipse":
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
        ctx.lineWidth = Math.max(cmd.rx * 0.2, 1);
        ctx.stroke();
      }
      ctx.restore();
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
    case "DrawText": {
      ctx.fillStyle = cmd.color;
      const parts = cmd.font.split(" ");
      const family = parts[0] || "serif";
      const mods = parts.slice(1).join(" ");
      ctx.font = mods ? `${mods} ${cmd.size}px ${family}` : `${cmd.size}px ${family}`;
      ctx.textAlign = cmd.align;
      ctx.textBaseline = cmd.baseline;
      ctx.fillText(cmd.text, cmd.x, cmd.y);
      break;
    }
    case "DrawGlyph":
      ctx.fillStyle = cmd.color;
      ctx.font = `${cmd.size}px ${cmd.font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(String.fromCodePoint(cmd.codepoint), cmd.x, cmd.y);
      break;
    case "DrawStretchedGlyph":
      ctx.fillStyle = cmd.color;
      ctx.font = `${cmd.size}px ${cmd.font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.save();
      ctx.translate(cmd.x, cmd.y);
      ctx.scale(cmd.scale_x, 1);
      ctx.fillText(String.fromCodePoint(cmd.codepoint), 0, 0);
      ctx.restore();
      break;
    case "DrawBezier":
      ctx.strokeStyle = cmd.color;
      ctx.lineWidth = cmd.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.bezierCurveTo(cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x2, cmd.y2);
      ctx.stroke();
      break;
    case "DrawFilledBezier": {
      // Rounded tip caps via quadratic curves bulging outward along the local
      // tangent. Matches industry-standard engravers slur tip appearance.
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
      ctx.fillStyle = cmd.color;
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.bezierCurveTo(cmd.ocx1, cmd.ocy1, cmd.ocx2, cmd.ocy2, cmd.x2, cmd.y2);
      ctx.quadraticCurveTo(cap2cx, cap2cy, cmd.ix2, cmd.iy2);
      ctx.bezierCurveTo(cmd.icx2, cmd.icy2, cmd.icx1, cmd.icy1, cmd.ix1, cmd.iy1);
      ctx.quadraticCurveTo(cap1cx, cap1cy, cmd.x1, cmd.y1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "DrawPolygon": {
      const f = cmd.points[0];
      if (cmd.points.length >= 3 && f) {
        ctx.fillStyle = cmd.color;
        ctx.beginPath();
        ctx.moveTo(f[0], f[1]);
        for (let i = 1; i < cmd.points.length; i++) {
          const p = cmd.points[i];
          if (p) ctx.lineTo(p[0], p[1]);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
}

/** Paint a display list onto a canvas, optionally using a glyph atlas for performance. */
export function paintCanvas(canvas: HTMLCanvasElement, dl: DisplayList, glyphAtlas: GlyphAtlas | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;

  const vw = canvas.parentElement?.clientWidth ?? dl.width;
  const vh = Math.min(dl.height, window.innerHeight - 120);

  canvas.width = vw * dpr;
  canvas.height = vh * dpr;
  canvas.style.width = `${vw}px`;
  canvas.style.height = `${vh}px`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  glyphAtlas?.ensureDeviceScale(dpr);

  for (const cmd of dl.commands) {
    if (cmd.type === "DrawGlyph" && glyphAtlas?.isBuilt) {
      const drawn = glyphAtlas.drawGlyph(ctx, cmd.codepoint, cmd.x, cmd.y, cmd.size, cmd.color);
      if (drawn) continue;
    }
    paintCommand(ctx, cmd);
  }
}
