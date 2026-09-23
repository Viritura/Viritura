import { describe, expect, it, vi } from "vitest";
import { paintRhythmSourceCursor } from "../components/rhythmSourceCursor";

const staff = { y: 50, height: 40, spatium: 10 };

vi.mock("../components/inputCursorHelpers", () => ({
  resolveCursorX: () => 120,
  resolveStaffForCursor: () => staff,
  mapEnginePointToViewport: (point: { x: number; y: number }) => point,
}));

function makeContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    roundRect: vi.fn(),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const baseArgs = {
  cursor: { measureIndex: 0, beatPosition: 1, partIndex: 0 },
  source: { partIndex: 1, staffIndex: 0, voice: 1 as const },
  staves: [staff],
  spatialIndex: {},
  score: {},
  displayList: { measureBounds: [{ index: 0, partIndex: 1 }] },
  viewMode: "page" as const,
};

describe("paintRhythmSourceCursor", () => {
  it("paints a dashed source cursor and glasses badge when the source staff is visible", () => {
    const ctx = makeContext();

    paintRhythmSourceCursor(ctx, baseArgs as unknown as Parameters<typeof paintRhythmSourceCursor>[1]);

    expect(ctx.setLineDash).toHaveBeenCalledWith([4.5, 3.2]);
    expect(ctx.moveTo).toHaveBeenCalledWith(120, 45);
    expect(ctx.lineTo).toHaveBeenCalledWith(120, 95);
    expect(ctx.roundRect).toHaveBeenCalledOnce();
    expect(ctx.arc).toHaveBeenCalledTimes(2);
  });

  it("does not paint a source cursor when its part is not rendered", () => {
    const ctx = makeContext();

    paintRhythmSourceCursor(ctx, {
      ...baseArgs,
      displayList: { measureBounds: [{ index: 0, partIndex: 0 }] },
    } as unknown as Parameters<typeof paintRhythmSourceCursor>[1]);

    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.roundRect).not.toHaveBeenCalled();
  });
});
