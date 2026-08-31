import { useEffect, type RefObject } from "react";

// Representative notehead + accidental SMuFL glyphs to warm the raster cache.
const WARMUP_GLYPHS = [0xe0a2, 0xe0a3, 0xe0a4, 0xe260, 0xe261, 0xe262];
const WARMUP_SIZES = [24, 32, 40];

/**
 * Warm the Bravura glyph raster + canvas text path the moment note-input mode
 * activates, so the first real keystroke doesn't pay a one-time font-shaping
 * cost (~100ms cold on a large score) inside its <16ms interaction budget.
 *
 * Purely a paint-path warm-up: it draws throwaway glyphs off-canvas and never
 * touches engine layout or the optimistic measurement.
 */
export function useGlyphWarmup(canvasRef: RefObject<HTMLCanvasElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      ctx.save();
      ctx.globalAlpha = 0;
      for (const size of WARMUP_SIZES) {
        ctx.font = `${size}px Bravura`;
        for (const cp of WARMUP_GLYPHS) ctx.fillText(String.fromCodePoint(cp), -9999, -9999);
      }
      ctx.restore();
    };
    void (document.fonts?.load?.("32px Bravura").then(warm) ?? Promise.resolve().then(warm));
    return () => {
      cancelled = true;
    };
  }, [canvasRef, active]);
}
