import { TileCache, type DisplayList as RendererDisplayList } from "@viritura/renderer";
import { unwrapDisplayList } from "./displayListHandle";
import { displayListWithInk } from "./paint";
import type { DisplayList, TilePaintOptions, TileRenderer } from "./types";

/** Create a cached tile painter for large unpaged (horizon) layouts. */
export function createTileRenderer(): TileRenderer {
  const cache = new TileCache();
  let version = 0;
  let source: RendererDisplayList | null = null;
  let sourceInk: string | undefined;
  let painted: RendererDisplayList | null = null;

  return {
    paint(canvas: HTMLCanvasElement, displayList: DisplayList, opts: TilePaintOptions): boolean {
      const raw = unwrapDisplayList(displayList);
      if (raw !== source || opts.ink !== sourceInk || !painted) {
        source = raw;
        sourceInk = opts.ink;
        painted = displayListWithInk(raw, opts.ink);
        version++;
      }
      cache.paintFrame({
        canvas,
        displayList: painted,
        scrollX: opts.scrollX,
        scrollY: opts.scrollY,
        zoom: opts.zoom,
        version,
        glyphAtlas: null,
        viewMode: "horizon",
        canvasBg: opts.background ?? "rgba(0,0,0,0)",
        paperFill: null,
      });
      return cache.hasPendingTiles;
    },
    invalidate(): void {
      version++;
      cache.invalidate();
    },
  };
}
