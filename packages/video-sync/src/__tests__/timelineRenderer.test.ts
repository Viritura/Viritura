import { describe, expect, it, vi } from "vitest";
import { drawTimeline, isDrawable, type TimelinePalette } from "../timelineRenderer";
import type { TimelineScene, TimelineThumbnail } from "../timelineTypes";

const PALETTE: TimelinePalette = {
  surface: "#111",
  grid: "#333",
  text: "#fff",
  textMuted: "#999",
  bar: "#4a9eff",
  barAlt: "#333",
  hit: "#f55",
  hitUnlocked: "#999",
  playhead: "#4a9eff",
  waveform: "#999",
  selection: "#4a9eff",
};

/**
 * A context that records `drawImage` and no-ops everything else.
 *
 * The renderer only needs the 2D API to accept calls; what matters for these
 * tests is which images it tried to draw and whether it got to the end.
 */
function fakeContext() {
  const drawn: unknown[] = [];
  const filled: unknown[][] = [];
  const stroked: number[] = [];
  const moves: unknown[][] = [];
  const target = {
    drawImage: (image: unknown) => {
      if (isDrawable(image as CanvasImageSource) === false) {
        throw new Error("InvalidStateError: The image source is detached");
      }
      drawn.push(image);
    },
    fillRect: (...args: unknown[]) => filled.push(args),
    moveTo: (...args: unknown[]) => moves.push(args),
    stroke: () => stroked.push(1),
    canvas: { width: 800, height: 200 },
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as keyof typeof obj];
      return () => undefined;
    },
    set() {
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, drawn, filled, stroked, moves };
}

function thumbnail(pictureSeconds: number, width: number): TimelineThumbnail {
  return { pictureSeconds, widthPx: 78, image: { width } as unknown as CanvasImageSource };
}

function scene(thumbnails: readonly TimelineThumbnail[]): TimelineScene {
  return {
    viewport: { startSeconds: 0, secondsPerPixel: 0.05 },
    widthPx: 800,
    heightPx: 200,
    devicePixelRatio: 1,
    durationSeconds: 150,
    bars: [{ number: 1, startSeconds: 0, endSeconds: 2 }],
    hits: [],
    playheadSeconds: 1,
    frameRate: 24,
    thumbnails,
  };
}

describe("isDrawable", () => {
  it("rejects a bitmap whose dimensions have been zeroed by close()", () => {
    expect(isDrawable({ width: 0 } as unknown as CanvasImageSource)).toBe(false);
    expect(isDrawable({ width: 78 } as unknown as CanvasImageSource)).toBe(true);
  });

  it("accepts a source that does not report a numeric width", () => {
    expect(isDrawable({} as unknown as CanvasImageSource)).toBe(true);
  });
});

describe("drawTimeline with a detached thumbnail", () => {
  it("skips the dead tile and still draws the live ones", () => {
    // A filmstrip tile must not be able to take the bars, waveform and playhead
    // down with it, which is what an uncaught drawImage throw used to do.
    const { ctx, drawn } = fakeContext();
    const live = thumbnail(0, 78);
    const dead = thumbnail(4, 0);
    const alsoLive = thumbnail(8, 78);

    expect(() => drawTimeline(ctx, scene([live, dead, alsoLive]), PALETTE)).not.toThrow();
    expect(drawn).toEqual([live.image, alsoLive.image]);
  });

  describe("selected marker interval", () => {
    it("fills the region and strokes its two boundaries", () => {
      const { ctx, filled, stroked, moves } = fakeContext();
      const selectedScene: TimelineScene = {
        ...scene([]),
        selectedSpan: { fromSeconds: 10, toSeconds: 20 },
      };

      drawTimeline(ctx, selectedScene, PALETTE);

      expect(filled).toContainEqual([200, 0, 200, 200]);
      expect(moves).toContainEqual([200.5, 0]);
      expect(moves).toContainEqual([400.5, 0]);
      expect(stroked.length).toBeGreaterThan(0);
    });
  });

  it("completes the rest of the paint", () => {
    const { ctx } = fakeContext();
    const restore = vi.fn();
    const spied = new Proxy(ctx, {
      get(obj, prop) {
        if (prop === "restore") return restore;
        return Reflect.get(obj, prop);
      },
    }) as CanvasRenderingContext2D;

    drawTimeline(spied, scene([thumbnail(0, 0)]), PALETTE);
    // The outermost save/restore pair only balances if the paint ran to the end.
    expect(restore).toHaveBeenCalled();
  });
});
