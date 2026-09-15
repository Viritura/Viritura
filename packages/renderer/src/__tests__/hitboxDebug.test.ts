import { describe, expect, it, vi } from "vitest";
import { SpatialIndex } from "../hitTest";
import { getHitboxDebugKind, paintHitboxDebug, paintHitboxDebugLegend } from "../hitboxDebug";

function context(): CanvasRenderingContext2D {
  return {
    canvas: { width: 900, height: 420 },
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  } as unknown as CanvasRenderingContext2D;
}

describe("getHitboxDebugKind", () => {
  it.each([
    ["p0/m0/s0/e0", "event"],
    ["p0/m0/s0/e0/n0", "note"],
    ["p0/m0/s0/e0/art-staccato", "annotation"],
    ["slur/a/b", "spanner"],
    ["p0/m0/hairpin0", "spanner"],
    ["p0/m0/pedal0", "spanner"],
    ["m0/volta", "spanner"],
    ["m0/barline", "structure"],
    ["m0/segno", "structure"],
    ["p0/m0/s0/e0/accidental/0/paren", "annotation"],
    ["unrecognized", "unknown"],
  ] as const)("classifies %s as %s", (id, expected) => {
    expect(getHitboxDebugKind(id)).toBe(expected);
  });
});

describe("paintHitboxDebug", () => {
  it("draws categorized element boxes, centers, and measure targets without labels", () => {
    const ctx = context();
    const index = new SpatialIndex([
      { id: "p0/m0/s0/e0", x: 10, y: 20, width: 30, height: 40 },
      { id: "slur/a/b", x: 50, y: 10, width: 80, height: 20 },
    ]);

    paintHitboxDebug(ctx, index, {
      zoom: 1,
      measureBounds: [
        {
          index: 0,
          partIndex: 0,
          staffIndex: 0,
          x: 0,
          y: 0,
          width: 200,
          height: 48,
          prefixWidth: 0,
          totalBeats: 4,
          beatAnchors: [],
        },
      ],
    });

    expect(ctx.strokeRect).toHaveBeenCalledTimes(3);
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("draws a fixed legend with category and measure counts", () => {
    const ctx = context();
    const index = new SpatialIndex([
      { id: "p0/m0/s0/e0", x: 0, y: 0, width: 10, height: 10 },
      { id: "p0/m0/s0/e0/n0", x: 0, y: 0, width: 10, height: 10 },
    ]);

    paintHitboxDebugLegend(ctx, index, 3, 2);

    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.fillText).toHaveBeenCalledWith("HITBOXES  2 elements", 22, 122);
    expect(ctx.fillText).toHaveBeenCalledWith("Measure targets: 3", 41, expect.any(Number));
  });

  it("culls boxes outside the requested engine bounds", () => {
    const ctx = context();
    const index = new SpatialIndex([
      { id: "p0/m0/s0/e0", x: 10, y: 10, width: 20, height: 20 },
      { id: "p0/m1/s0/e1", x: 10, y: 500, width: 20, height: 20 },
    ]);

    paintHitboxDebug(ctx, index, {
      zoom: 0.5,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    });

    expect(ctx.strokeRect).toHaveBeenCalledOnce();
    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 10, 20, 20);
  });

  it("draws beam polygons instead of their rectangular spatial entry", () => {
    const ctx = context();
    const index = new SpatialIndex([{ id: "p0/m0/beam0", x: 10, y: 10, width: 100, height: 30 }]);
    paintHitboxDebug(ctx, index, {
      displayList: {
        width: 200,
        height: 100,
        commands: [
          {
            type: "DrawPolygon",
            points: [
              [10, 10],
              [110, 20],
              [110, 25],
              [10, 15],
            ],
            color: "#000",
          },
        ],
        elementIds: ["p0/m0/beam0"],
      },
    });

    expect(ctx.stroke).toHaveBeenCalledOnce();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });
});
