// ─── Paper background pattern (single source of truth = --paper-bg) ───
//
// Parses the `--paper-bg` CSS variable at runtime and bakes it into a
// CanvasPattern so that the music canvas page fill matches palette tiles,
// the radial menu, and the Paper component exactly — no duplicated noise
// definition. If `tokens.css` ever changes the noise, this picks up the
// new value on the next theme switch.
//
// PDF export is unaffected: it runs through `exportPdf` in
// @viritura/renderer, which renders to a PDF document directly (not through
// `repaintCanvas`). So the paper texture stays a screen-only treatment.

/** Pure cream fallback color (matches the substrate color in --paper-bg). */
export const PAPER_CREAM_FALLBACK = "#fbf8ef";

/**
 * The light-theme `--paper-bg` value, inlined here so the score canvas
 * always renders cream pages regardless of the active UI theme. Dark/
 * midnight themes use a dark warm-grey substrate (good for palette tiles
 * and the radial menu), but black music ink on a dark page is illegible.
 * Music notation is conventionally black-on-cream, so we treat the score
 * surface as a fixed paper material independent of UI chrome.
 * Keep this in sync with `:root { --paper-bg }` in `packages/ui/src/tokens.css`.
 */
const LIGHT_PAPER_BG = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch' seed='4'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"), #fbf8ef`;

/** Cache: paper pattern keyed by the raw `--paper-bg` CSS value, so a theme
 *  switch invalidates without us having to track theme names. */
const paperPatternCache = new Map<string, CanvasPattern | null>();
const paperPatternLoading = new Map<string, Promise<CanvasPattern | null>>();

interface ParsedPaperBg {
  noiseUrl: string | null;
  cream: string;
}

function parsePaperBg(raw: string): ParsedPaperBg {
  const urlMatch = raw.match(/url\(\s*["']?(data:[^"')]+|[^"')\s]+)["']?\s*\)/);
  // The substrate color is the last #hex or rgb()/rgba() token in the value
  const colorMatches = raw.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g);
  return {
    noiseUrl: urlMatch?.[1] ?? null,
    cream: colorMatches?.[colorMatches.length - 1] ?? PAPER_CREAM_FALLBACK,
  };
}

/**
 * Get a CanvasPattern for the current theme's paper. Returns null on first
 * call (image not yet loaded), then resolves the returned promise; callers
 * should re-paint when the promise settles.
 */
export function getPaperPattern(ctx: CanvasRenderingContext2D): {
  pattern: CanvasPattern | null;
  cream: string;
  ready: Promise<CanvasPattern | null> | null;
} {
  // Always use the light-theme paper recipe regardless of the active UI
  // theme. See `LIGHT_PAPER_BG` above for the rationale.
  const raw = LIGHT_PAPER_BG;

  const parsed = parsePaperBg(raw);
  const cached = paperPatternCache.get(raw);
  if (cached !== undefined) {
    return { pattern: cached, cream: parsed.cream, ready: null };
  }
  // Already loading?
  const inflight = paperPatternLoading.get(raw);
  if (inflight) return { pattern: null, cream: parsed.cream, ready: inflight };

  if (!parsed.noiseUrl) {
    paperPatternCache.set(raw, null);
    return { pattern: null, cream: parsed.cream, ready: null };
  }

  const promise = new Promise<CanvasPattern | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 220;
      const h = img.naturalHeight || 220;
      const tile = document.createElement("canvas");
      tile.width = w;
      tile.height = h;
      const tctx = tile.getContext("2d");
      if (!tctx) {
        paperPatternCache.set(raw, null);
        resolve(null);
        return;
      }
      // Substrate (cream) then noise multiplied on top, matching the CSS
      // `background: url(noise), cream; background-blend-mode: multiply, normal;`
      tctx.fillStyle = parsed.cream;
      tctx.fillRect(0, 0, w, h);
      tctx.globalCompositeOperation = "multiply";
      tctx.drawImage(img, 0, 0);
      const pattern = ctx.createPattern(tile, "repeat");
      paperPatternCache.set(raw, pattern);
      paperPatternLoading.delete(raw);
      resolve(pattern);
    };
    img.onerror = () => {
      paperPatternCache.set(raw, null);
      paperPatternLoading.delete(raw);
      resolve(null);
    };
    img.src = parsed.noiseUrl!;
  });
  paperPatternLoading.set(raw, promise);
  return { pattern: null, cream: parsed.cream, ready: promise };
}
