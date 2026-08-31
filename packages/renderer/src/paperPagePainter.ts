import { renderCommandBounds } from "./renderCommandBounds";
import type { DisplayList } from "./wasm";

/**
 * Paint a paper-textured page rectangle using the canonical --paper-shadow
 * recipe from packages/ui/src/tokens.css. This is the same shadow stack
 * used on palette tiles, radial menu wedges, library cards, and the Paper
 * component — so the score canvas matches the rest of the surface system.
 *
 * CSS recipe (light theme):
 *   0 0.5px 1px   rgba(80,  60, 30, 0.14)
 *   0 1.5px 3px  -1 rgba(120, 90, 40, 0.14)
 *   0 4px   8px  -3 rgba(140,110, 50, 0.10)
 *   inset 0 1px 0 rgba(255,255,255,0.9)        // lit rim
 *   inset 0 0  0 1px rgba(120,100, 60, 0.10)   // edge stroke
 *
 * Canvas 2D shadow API has no `spread`. We approximate a negative spread
 * by shrinking the rect that *casts* the shadow (the shadow footprint
 * gets smaller while staying centered), then paint the real page fill on
 * top with shadows disabled.
 */

interface ShadowLayer {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number; // negative = footprint smaller than page rect
  color: string;
}

interface PaperShadowRecipe {
  cast: ShadowLayer[];
  rimColor: string; // inset 0 1px 0
  edgeStrokeColor: string; // inset 0 0 0 1px
}

const LIGHT_RECIPE: PaperShadowRecipe = {
  cast: [
    { offsetX: 0, offsetY: 0.5, blur: 1, spread: 0, color: "rgba(80, 60, 30, 0.14)" },
    { offsetX: 0, offsetY: 1.5, blur: 3, spread: -1, color: "rgba(120, 90, 40, 0.14)" },
    { offsetX: 0, offsetY: 4, blur: 8, spread: -3, color: "rgba(140, 110, 50, 0.10)" },
  ],
  rimColor: "rgba(255, 255, 255, 0.9)",
  edgeStrokeColor: "rgba(120, 100, 60, 0.10)",
};

const DARK_RECIPE: PaperShadowRecipe = {
  cast: [
    { offsetX: 0, offsetY: 0.5, blur: 1, spread: 0, color: "rgba(0, 0, 0, 0.40)" },
    { offsetX: 0, offsetY: 1.5, blur: 3, spread: -1, color: "rgba(20, 14, 4, 0.40)" },
    { offsetX: 0, offsetY: 4, blur: 8, spread: -3, color: "rgba(30, 20, 8, 0.32)" },
  ],
  rimColor: "rgba(255, 235, 200, 0.10)",
  edgeStrokeColor: "rgba(0, 0, 0, 0.35)",
};

/** Bounding extent (px) the shadow paints past the page rect on each side. */
export const PAPER_SHADOW_MARGIN = 12;
export const HORIZON_PAPER_PADDING = 20;

export interface HorizonPaperGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Symmetric vertical extent centered on the paper and its music ink. */
  contentHeight: number;
}

interface InkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function inkBounds(displayList: DisplayList): InkBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const preciseElementIds = new Set<string>();

  for (const element of displayList.elementBboxes ?? []) {
    preciseElementIds.add(element.elementId);
    minX = Math.min(minX, element.bbox.x);
    minY = Math.min(minY, element.bbox.y);
    maxX = Math.max(maxX, element.bbox.x + element.bbox.width);
    maxY = Math.max(maxY, element.bbox.y + element.bbox.height);
  }

  for (let index = 0; index < displayList.commands.length; index++) {
    const command = displayList.commands[index]!;
    const elementId = displayList.elementIds?.[index];
    const hasPreciseBounds = elementId != null && preciseElementIds.has(elementId);
    if (
      hasPreciseBounds &&
      (command.type === "DrawGlyph" || command.type === "DrawStretchedGlyph" || command.type === "DrawText")
    ) {
      continue;
    }
    const bounds = renderCommandBounds(command);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x2);
    maxY = Math.max(maxY, bounds.y2);
  }

  return Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
    ? { minX, minY, maxX, maxY }
    : null;
}

/** Size horizon paper around actual music ink rather than nominal engine height. */
export function computeHorizonPaperGeometry(displayList: DisplayList): HorizonPaperGeometry {
  const musicInk = inkBounds(displayList);
  if (!musicInk) {
    return {
      x: -HORIZON_PAPER_PADDING,
      y: -HORIZON_PAPER_PADDING,
      width: displayList.width + HORIZON_PAPER_PADDING * 2,
      height: displayList.height + HORIZON_PAPER_PADDING * 2,
      contentHeight: displayList.height,
    };
  }

  const { minX, minY, maxX, maxY } = musicInk;
  const horizontalPadding = Math.min(minX + HORIZON_PAPER_PADDING, displayList.width + HORIZON_PAPER_PADDING - maxX);
  const verticalPadding = Math.max(HORIZON_PAPER_PADDING, horizontalPadding);
  const y = minY - verticalPadding;
  const height = maxY - minY + verticalPadding * 2;
  const paperCenter = y + height / 2;
  return {
    x: -HORIZON_PAPER_PADDING,
    y,
    width: displayList.width + HORIZON_PAPER_PADDING * 2,
    height,
    contentHeight: paperCenter > 0 ? paperCenter * 2 : displayList.height,
  };
}

function detectRecipe(): PaperShadowRecipe {
  if (typeof document === "undefined") return LIGHT_RECIPE;
  const theme = document.documentElement.dataset.theme;
  return theme === "dark" || theme === "midnight" ? DARK_RECIPE : LIGHT_RECIPE;
}

/**
 * Paint a paper page rectangle at (x, y, w, h) with the canonical paper
 * shadow stack and fill. The fill can be a solid color string or a
 * CanvasPattern (e.g. the noise-textured paper pattern).
 */
export function paintPaperPage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  paperFill: string | CanvasPattern,
): void {
  const recipe = detectRecipe();

  // Cast shadow layers — paint each as a shadowed fillRect whose footprint
  // is shrunk by |spread|. The fill color doesn't matter for the shadow
  // itself, but we use a neutral so any unblurred edge isn't visible
  // (the real page fill overdraws on top).
  for (const layer of recipe.cast) {
    const s = layer.spread; // typically <= 0
    const fx = x - s;
    const fy = y - s;
    const fw = w + s * 2;
    const fh = h + s * 2;
    if (fw <= 0 || fh <= 0) continue;
    ctx.save();
    ctx.shadowColor = layer.color;
    ctx.shadowBlur = layer.blur;
    ctx.shadowOffsetX = layer.offsetX;
    ctx.shadowOffsetY = layer.offsetY;
    // Fill with a transparent-ish color so the cast color reads cleanly.
    // Using paperFill here would tint the shadow; using black would
    // double-darken. A 1-alpha black on the shrunk footprint is enough
    // for the shadow API to emit pixels without leaving a visible rect.
    ctx.fillStyle = "#000";
    ctx.fillRect(fx, fy, fw, fh);
    ctx.restore();
  }

  // Real page fill — no shadow, overdraws the shadow-casting rects above.
  ctx.fillStyle = paperFill;
  ctx.fillRect(x, y, w, h);

  // Inset edge stroke (1px just inside the rect).
  ctx.save();
  ctx.strokeStyle = recipe.edgeStrokeColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();

  // Lit rim (top 1px highlight).
  ctx.save();
  ctx.fillStyle = recipe.rimColor;
  ctx.fillRect(x, y, w, 1);
  ctx.restore();
}
