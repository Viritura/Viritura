import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { TileCache } from "../tileCache";
import type { DisplayList, RenderCommand } from "../wasm";

/**
 * Records the canvas operations relevant to these tests across every tile
 * context the cache creates. DrawRect → fillRect; SetOpacity → globalAlpha.
 */
interface Recorder {
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  alphas: number[];
}

function makeRecordingCtx(rec: Recorder): CanvasRenderingContext2D {
  let alpha = 1;
  const fillRect = (x: number, y: number, w: number, h: number) => {
    // The opaque tile-background clear is a full-tile fillRect at 0,0; ignore it.
    if (x === 0 && y === 0 && w >= 256 && h >= 256) return;
    rec.rects.push({ x, y, w, h });
  };
  const base: Record<string, unknown> = {
    fillRect,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    imageSmoothingEnabled: true,
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop === "globalAlpha") return alpha;
      if (prop in target) return target[prop];
      // Any unknown 2D-context method is a recorded no-op (gradients return self).
      return (..._args: unknown[]) => undefined;
    },
    set(target, prop: string, value) {
      if (prop === "globalAlpha") {
        alpha = value as number;
        rec.alphas.push(alpha);
        return true;
      }
      target[prop] = value;
      return true;
    },
  };
  return new Proxy(base, handler) as unknown as CanvasRenderingContext2D;
}

const origDocument = globalThis.document;
const origWindow = globalThis.window;
let sharedRec: Recorder;

beforeEach(() => {
  sharedRec = { rects: [], alphas: [] };
  const tileCtx = makeRecordingCtx(sharedRec);
  globalThis.document = {
    documentElement: { dataset: {} },
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => tileCtx),
    })),
  } as unknown as Document;
  globalThis.window = { devicePixelRatio: 1 } as unknown as Window & typeof globalThis;
});

afterAll(() => {
  globalThis.document = origDocument;
  globalThis.window = origWindow;
});

function rect(x: number, w: number): RenderCommand {
  return { type: "DrawRect", x, y: 0, w, h: 40, color: "#000" } as RenderCommand;
}

function horizonDisplayList(commands: RenderCommand[], width: number): DisplayList {
  return { commands, width, height: 80 } as DisplayList;
}

function paintViewport(cache: TileCache, displayList: DisplayList): Recorder {
  const mainCtx = makeRecordingCtx(sharedRec);
  const canvas = {
    width: 256,
    height: 256,
    getContext: vi.fn(() => mainCtx),
  } as unknown as HTMLCanvasElement;
  cache.paintFrame({
    canvas,
    displayList,
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    version: 1,
    glyphAtlas: null,
    viewMode: "horizon",
  });
  return sharedRec;
}

describe("TileCache horizon bucketing", () => {
  it("paints commands inside the visible band and culls distant ones", () => {
    // A rect near the origin (visible) and one ~5000px away (off-screen for a
    // 256px viewport at zoom 1). Only the near rect should be painted.
    const near = rect(20, 30);
    const far = rect(5000, 30);
    const cache = new TileCache();
    const rec = paintViewport(cache, horizonDisplayList([near, far], 6000));

    expect(rec.rects.some((r) => r.x === 20 && r.w === 30)).toBe(true);
    expect(rec.rects.some((r) => r.x === 5000)).toBe(false);
  });

  it("does not scan every command per tile (band culling, not full-list)", () => {
    // Thousands of rects spread across a very wide horizon score; only the
    // handful overlapping the visible band should ever be painted.
    const commands: RenderCommand[] = [];
    for (let i = 0; i < 2000; i++) commands.push(rect(i * 100, 20));
    const cache = new TileCache();
    const rec = paintViewport(cache, horizonDisplayList(commands, 200_000));

    // Visible content for cols 0..1 spans ~0..1024 content px → far fewer than
    // the full 2000 commands should be painted.
    expect(rec.rects.length).toBeGreaterThan(0);
    expect(rec.rects.length).toBeLessThan(60);
    // Nothing from the far end of the score should appear.
    expect(rec.rects.some((r) => r.x > 5000)).toBe(false);
  });

  it("preserves SetOpacity (order-dependent global state) in every band", () => {
    // SetOpacity has no position; it must still be applied for tiles whose band
    // is far from index 0, so reduced-opacity expansion content renders dimmed.
    const setOpacity: RenderCommand = { type: "SetOpacity", opacity: 0.4 } as RenderCommand;
    const farRect = rect(4000, 30);
    const cache = new TileCache();

    // Scroll so the far rect's band is visible.
    const mainCtx = makeRecordingCtx(sharedRec);
    const canvas = {
      width: 256,
      height: 256,
      getContext: vi.fn(() => mainCtx),
    } as unknown as HTMLCanvasElement;
    cache.paintFrame({
      canvas,
      displayList: horizonDisplayList([setOpacity, farRect], 6000),
      scrollX: 3950,
      scrollY: 0,
      zoom: 1,
      version: 1,
      glyphAtlas: null,
      viewMode: "horizon",
    });

    expect(sharedRec.rects.some((r) => r.x === 4000)).toBe(true);
    expect(sharedRec.alphas).toContain(0.4);
  });
});
