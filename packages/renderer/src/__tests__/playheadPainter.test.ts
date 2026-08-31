import { describe, it, expect, vi } from "vitest";
import { beatToX, findSystemYExtent, paintPlayhead, paintPlayheadAtPosition } from "../playheadPainter";
import { detectStaves } from "../overlayPainter";
import type { MeasureBounds, DisplayList } from "../wasm";
import type { StaffInfo } from "../overlayPainter";

// ─── Test fixtures ─────────────────────────────────────────

function makeMeasureBounds(overrides: Partial<MeasureBounds> = {}): MeasureBounds {
  return {
    index: 0,
    partIndex: 0,
    staffIndex: 0,
    x: 50,
    width: 200,
    y: 100,
    height: 48,
    prefixWidth: 30,
    totalBeats: 4,
    beatAnchors: [
      [0, 80],
      [1, 120],
      [2, 160],
      [3, 200],
    ],
    ...overrides,
  };
}

function makeStaves(): StaffInfo[] {
  return [
    { x: 50, xEnd: 500, y: 100, spatium: 12, height: 48, index: 0 },
    { x: 50, xEnd: 500, y: 196, spatium: 12, height: 48, index: 1 },
  ];
}

function makeStaffDisplayList(x1: number, x2: number, topY: number, spatium: number, count: number = 1): DisplayList {
  const commands: DisplayList["commands"] = [];
  for (let s = 0; s < count; s++) {
    const staffTopY = topY + s * spatium * 8;
    for (let i = 0; i < 5; i++) {
      commands.push({
        type: "DrawLine",
        x1,
        y1: staffTopY + i * spatium,
        x2,
        y2: staffTopY + i * spatium,
        width: 0.8,
        color: "#000000",
      });
    }
  }
  return {
    commands,
    width: x2 + 50,
    height: topY + count * spatium * 10,
    measureBounds: [
      makeMeasureBounds({ index: 0 }),
      makeMeasureBounds({
        index: 1,
        x: 250,
        beatAnchors: [
          [0, 280],
          [1, 320],
          [2, 360],
          [3, 400],
        ],
      }),
    ],
  };
}

function mockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
  } as unknown as CanvasRenderingContext2D;
}

// ─── beatToX tests ─────────────────────────────────────────

describe("beatToX", () => {
  const bounds = [makeMeasureBounds()];

  it("returns exact X for beat at an anchor point", () => {
    expect(beatToX({ measureIndex: 0, beat: 0 }, bounds)).toBe(80);
    expect(beatToX({ measureIndex: 0, beat: 1 }, bounds)).toBe(120);
    expect(beatToX({ measureIndex: 0, beat: 2 }, bounds)).toBe(160);
    expect(beatToX({ measureIndex: 0, beat: 3 }, bounds)).toBe(200);
  });

  it("interpolates between anchor points", () => {
    const x = beatToX({ measureIndex: 0, beat: 0.5 }, bounds);
    expect(x).toBe(100); // midpoint between 80 and 120
  });

  it("interpolates at 1.5 beats", () => {
    const x = beatToX({ measureIndex: 0, beat: 1.5 }, bounds);
    expect(x).toBe(140); // midpoint between 120 and 160
  });

  it("extrapolates past last anchor", () => {
    const x = beatToX({ measureIndex: 0, beat: 4 }, bounds);
    // Last two anchors: [2, 160] and [3, 200], slope = 40px/beat
    // 4 beats → 200 + 40 = 240
    expect(x).toBe(240);
  });

  it("clamps beat below 0 to 0", () => {
    const x = beatToX({ measureIndex: 0, beat: -1 }, bounds);
    // First two anchors: [0, 80] and [1, 120], slope = 40px/beat
    // -1 is clamped to 0 → 80
    expect(x).toBe(80);
  });

  it("returns null for unknown measure index", () => {
    expect(beatToX({ measureIndex: 99, beat: 0 }, bounds)).toBeNull();
  });

  it("handles empty beatAnchors with linear fallback", () => {
    const emptyAnchors = [makeMeasureBounds({ beatAnchors: [] })];
    const x = beatToX({ measureIndex: 0, beat: 2 }, emptyAnchors);
    // With prefix=30, total width=200, content width = 170
    // 2/4 beats → 50 + 30 + 0.5 * 170 = 165
    expect(x).toBe(165);
  });

  it("works with multiple measures", () => {
    const multiBounds = [
      makeMeasureBounds({ index: 0 }),
      makeMeasureBounds({
        index: 1,
        x: 250,
        beatAnchors: [
          [0, 280],
          [2, 360],
          [4, 440],
        ],
      }),
    ];
    expect(beatToX({ measureIndex: 1, beat: 0 }, multiBounds)).toBe(280);
    expect(beatToX({ measureIndex: 1, beat: 1 }, multiBounds)).toBe(320);
    expect(beatToX({ measureIndex: 1, beat: 2 }, multiBounds)).toBe(360);
  });

  it("handles single anchor point", () => {
    const singleAnchor = [makeMeasureBounds({ beatAnchors: [[0, 100]] })];
    expect(beatToX({ measureIndex: 0, beat: 0 }, singleAnchor)).toBe(100);
    // Past single anchor — returns anchor value (no slope info)
    expect(beatToX({ measureIndex: 0, beat: 2 }, singleAnchor)).toBe(100);
  });

  it("smooths the barline crossing to the next measure on the same system", () => {
    // Measure 0 ends with the synthetic (totalBeats, rightEdge) anchor at
    // (4, 250); measure 1 starts at x=300 with its beat-0 anchor at 330.
    // The measure end should map to 330 (continuity), not 250 (right edge).
    const sameSystem = [
      makeMeasureBounds({
        index: 0,
        x: 50,
        width: 200, // rightEdge = 250
        totalBeats: 4,
        systemIndex: 0,
        beatAnchors: [
          [0, 80],
          [2, 160],
          [4, 250], // synthetic measure-end anchor at the right edge
        ],
      }),
      makeMeasureBounds({
        index: 1,
        x: 300,
        prefixWidth: 30,
        totalBeats: 4,
        systemIndex: 0,
        beatAnchors: [
          [0, 330],
          [4, 480],
        ],
      }),
    ];
    // End of measure 0 maps to measure 1's first-content X for continuity.
    expect(beatToX({ measureIndex: 0, beat: 4 }, sameSystem)).toBe(330);
    // Start of measure 1 is the same X → no jump across the barline.
    expect(beatToX({ measureIndex: 1, beat: 0 }, sameSystem)).toBe(330);
    // A real interior anchor is untouched.
    expect(beatToX({ measureIndex: 0, beat: 2 }, sameSystem)).toBe(160);
  });

  it("does NOT smooth across a system break", () => {
    // Measure 1 begins a new system → measure 0 must reach its own right edge.
    const acrossBreak = [
      makeMeasureBounds({
        index: 0,
        x: 50,
        width: 200, // rightEdge = 250
        totalBeats: 4,
        systemIndex: 0,
        beatAnchors: [
          [0, 80],
          [2, 160],
          [4, 250],
        ],
      }),
      makeMeasureBounds({
        index: 1,
        x: 60,
        prefixWidth: 30,
        totalBeats: 4,
        systemIndex: 1, // different system (wrapped to next line)
        beatAnchors: [
          [0, 90],
          [4, 240],
        ],
      }),
    ];
    expect(beatToX({ measureIndex: 0, beat: 4 }, acrossBreak)).toBe(250);
  });
});

// ─── findSystemYExtent tests ───────────────────────────────

describe("findSystemYExtent", () => {
  const staves = makeStaves();

  it("finds Y extent spanning both staves", () => {
    const extent = findSystemYExtent(staves, 200);
    expect(extent).not.toBeNull();
    // Top staff: y=100, margin = 0.5*12 = 6 → yTop = 94
    expect(extent!.yTop).toBe(94);
    // Bottom staff: y=196, height=48, margin=6 → yBottom = 250
    expect(extent!.yBottom).toBe(250);
  });

  it("returns null for X outside all staves", () => {
    expect(findSystemYExtent(staves, 600)).toBeNull();
  });

  it("returns null for empty staves array", () => {
    expect(findSystemYExtent([], 200)).toBeNull();
  });

  it("works with a single staff", () => {
    const single = [staves[0]!];
    const extent = findSystemYExtent(single, 200);
    expect(extent).not.toBeNull();
    expect(extent!.yTop).toBe(94);
    expect(extent!.yBottom).toBe(154); // 100 + 48 + 6
  });

  it("spans an overflowing tall system past the next page's yOffset", () => {
    // Simulate a tall orchestral system whose lower staves extend below the
    // nominal page bottom (the next page's yOffset). The page filter alone
    // would clip them; the system band must win and include them.
    const tall: StaffInfo[] = [
      { x: 50, xEnd: 500, y: 100, spatium: 12, height: 48, index: 0 },
      { x: 50, xEnd: 500, y: 400, spatium: 12, height: 48, index: 1 },
      // Below the next page's yOffset (800) — would be clipped by pageYRange.
      { x: 50, xEnd: 500, y: 900, spatium: 12, height: 48, index: 2 },
    ];
    const pageYRange = { yOffset: 0, yEnd: 800 };
    const systemYRange = { yTop: 100, yBottom: 948 };

    const extent = findSystemYExtent(tall, 200, pageYRange, systemYRange);
    expect(extent).not.toBeNull();
    // Bottom staff (y=900) must be included despite exceeding pageYRange.yEnd.
    expect(extent!.yBottom).toBe(954); // 900 + 48 + 6
  });
});

// ─── paintPlayhead tests ───────────────────────────────────

describe("paintPlayhead", () => {
  it("draws a vertical line with correct coordinates", () => {
    const ctx = mockCtx();
    paintPlayhead(ctx, 150, 94, 250);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(150, 94);
    expect(ctx.lineTo).toHaveBeenCalledWith(150, 250);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("uses default color and width", () => {
    const ctx = mockCtx();
    paintPlayhead(ctx, 100, 0, 500);

    expect(ctx.strokeStyle).toBe("rgba(33, 150, 243, 0.6)");
    expect(ctx.lineWidth).toBe(2);
  });

  it("accepts custom color and width", () => {
    const ctx = mockCtx();
    paintPlayhead(ctx, 100, 0, 500, "rgba(0, 255, 0, 0.8)", 3);

    expect(ctx.strokeStyle).toBe("rgba(0, 255, 0, 0.8)");
    expect(ctx.lineWidth).toBe(3);
  });
});

// ─── paintPlayheadAtPosition tests ─────────────────────────

describe("paintPlayheadAtPosition", () => {
  it("returns null when no measureBounds in display list", () => {
    const ctx = mockCtx();
    const dl: DisplayList = { commands: [], width: 100, height: 100 };
    const result = paintPlayheadAtPosition(ctx, { measureIndex: 0, beat: 0 }, dl, []);
    expect(result).toBeNull();
  });

  it("returns X coordinate and paints the playhead", () => {
    const ctx = mockCtx();
    const dl = makeStaffDisplayList(50, 500, 100, 12, 2);
    const staves = detectStaves(dl);

    const x = paintPlayheadAtPosition(ctx, { measureIndex: 0, beat: 1 }, dl, staves);

    expect(x?.x).toBe(120);
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("falls back to full height when no staves match", () => {
    const ctx = mockCtx();
    const dl: DisplayList = {
      commands: [],
      width: 500,
      height: 300,
      measureBounds: [makeMeasureBounds()],
    };

    const x = paintPlayheadAtPosition(
      ctx,
      { measureIndex: 0, beat: 0 },
      dl,
      [], // no staves
    );

    expect(x?.x).toBe(80);
    // Should draw from 0 to displayList.height
    expect(ctx.moveTo).toHaveBeenCalledWith(80, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(80, 300);
  });
});
