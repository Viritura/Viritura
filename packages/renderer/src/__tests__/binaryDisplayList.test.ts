import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  decodeBinaryDisplayList,
  paintBinaryDisplayList,
  getBinaryDisplayListDimensions,
  getBinaryDisplayListPages,
  getBinaryDisplayListBboxes,
} from "../binaryDisplayList";
import { SpatialIndex } from "../hitTest";

/**
 * Helper: encode a color string "#RRGGBB" into a u32, then pack as f32 bits.
 * Must match Rust encode_color().
 */
function encodeColor(hex: string): number {
  const rgb = parseInt(hex.slice(1), 16);
  const buf = new ArrayBuffer(4);
  new Uint32Array(buf)[0] = rgb;
  return new Float32Array(buf)[0] as number;
}

/**
 * Build a minimal binary display list buffer with header + commands.
 */
function buildBinaryBuffer(
  width: number,
  height: number,
  commands: number[][],
  pages: number[][] = [],
  elementIds?: { stringTable: string[]; indices: number[] },
  bboxes: number[][] = [],
  measureBounds: number[][] = [],
): Float32Array {
  const data: number[] = [];
  const numStrings = elementIds?.stringTable.length ?? 0;
  // Header (7 floats): width, height, commands, pages, strings, bboxes, slur geometries.
  data.push(width, height, commands.length, pages.length, numStrings, bboxes.length, 0);
  // Pages
  for (const page of pages) {
    for (const val of page) {
      data.push(val);
    }
  }
  // Element bboxes
  for (const bbox of bboxes) {
    for (const val of bbox) {
      data.push(val);
    }
  }
  // Commands
  for (const cmd of commands) {
    for (const val of cmd) {
      data.push(val);
    }
  }
  // Element ID string table
  if (elementIds) {
    for (const str of elementIds.stringTable) {
      const codepoints = [...str].map((c) => c.codePointAt(0)!);
      data.push(codepoints.length);
      for (const cp of codepoints) {
        data.push(cp);
      }
    }
    for (const idx of elementIds.indices) {
      data.push(idx);
    }
  } else {
    // Per-command indices (all -1)
    for (let i = 0; i < commands.length; i++) {
      data.push(-1);
    }
  }
  if (measureBounds.length > 0) {
    data.push(measureBounds.length);
    for (const bounds of measureBounds) {
      for (const val of bounds) {
        data.push(val);
      }
    }
  }
  return new Float32Array(data);
}

/** Create mock CanvasRenderingContext2D */
function createMockCtx(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

describe("getBinaryDisplayListDimensions", () => {
  it("should extract width and height from header", () => {
    const data = buildBinaryBuffer(800, 600, []);
    const dims = getBinaryDisplayListDimensions(data);
    expect(dims.width).toBe(800);
    expect(dims.height).toBe(600);
  });
});

describe("getBinaryDisplayListPages", () => {
  it("should decode page layout from binary", () => {
    const data = buildBinaryBuffer(
      800,
      1200,
      [],
      [
        // Page 0: page_num=0, num_systems=2, indices=[0,1], y_offset=0, height=600
        [0, 2, 0, 1, 0, 600],
        // Page 1: page_num=1, num_systems=1, indices=[2], y_offset=600, height=600
        [1, 1, 2, 600, 600],
      ],
    );
    const pages = getBinaryDisplayListPages(data);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.pageNumber).toBe(0);
    expect(pages[0]!.systemIndices).toEqual([0, 1]);
    expect(pages[0]!.yOffset).toBe(0);
    expect(pages[0]!.height).toBe(600);
    expect(pages[1]!.pageNumber).toBe(1);
    expect(pages[1]!.systemIndices).toEqual([2]);
  });
});

describe("decodeBinaryDisplayList", () => {
  it("should decode an empty display list", () => {
    const data = buildBinaryBuffer(400, 300, []);
    const dl = decodeBinaryDisplayList(data);
    expect(dl.width).toBe(400);
    expect(dl.height).toBe(300);
    expect(dl.commands).toHaveLength(0);
  });

  it("should decode DrawLine command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [1, 10, 20, 300, 20, 1.5, black], // DrawLine
    ]);
    const dl = decodeBinaryDisplayList(data);
    expect(dl.commands).toHaveLength(1);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawLine");
    if (cmd.type === "DrawLine") {
      expect(cmd.x1).toBe(10);
      expect(cmd.y1).toBe(20);
      expect(cmd.x2).toBe(300);
      expect(cmd.y2).toBe(20);
      expect(cmd.width).toBe(1.5);
      expect(cmd.color).toBe("#000000");
    }
  });

  it("should decode DrawGlyph command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [5, 50, 100, 0xe050, 0, 40, black, 0], // DrawGlyph: Bravura font (id=0)
    ]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawGlyph");
    if (cmd.type === "DrawGlyph") {
      expect(cmd.x).toBe(50);
      expect(cmd.y).toBe(100);
      expect(cmd.codepoint).toBe(0xe050);
      expect(cmd.font).toBe("Bravura");
      expect(cmd.size).toBe(40);
    }
  });

  it("should decode DrawStretchedGlyph command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [12, 12, 200, 0xe000, 0, 150, black, 0.5], // brace, half-width
    ]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawStretchedGlyph");
    if (cmd.type === "DrawStretchedGlyph") {
      expect(cmd.x).toBe(12);
      expect(cmd.y).toBe(200);
      expect(cmd.codepoint).toBe(0xe000);
      expect(cmd.font).toBe("Bravura");
      expect(cmd.size).toBe(150);
      expect(cmd.scale_x).toBe(0.5);
    }
  });

  it("should decode DrawRect command", () => {
    const red = encodeColor("#FF0000");
    const data = buildBinaryBuffer(800, 600, [
      [2, 5, 10, 20, 3, red], // DrawRect
    ]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawRect");
    if (cmd.type === "DrawRect") {
      expect(cmd.x).toBe(5);
      expect(cmd.y).toBe(10);
      expect(cmd.w).toBe(20);
      expect(cmd.h).toBe(3);
      expect(cmd.color).toBe("#FF0000");
    }
  });

  it("should decode DrawCircle command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [3, 15, 25, 2, black], // DrawCircle
    ]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawCircle");
    if (cmd.type === "DrawCircle") {
      expect(cmd.cx).toBe(15);
      expect(cmd.cy).toBe(25);
      expect(cmd.r).toBe(2);
    }
  });

  it("should decode DrawEllipse command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [4, 30, 40, 5, 3.5, -0.15, 1, black], // DrawEllipse, filled=true
    ]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawEllipse");
    if (cmd.type === "DrawEllipse") {
      expect(cmd.cx).toBe(30);
      expect(cmd.cy).toBe(40);
      expect(cmd.filled).toBe(true);
    }
  });

  it("should decode DrawText command with codepoints", () => {
    const black = encodeColor("#000000");
    // "D.S." = 4 chars: D=68, .=46, S=83, .=46
    const data = buildBinaryBuffer(800, 600, [
      [10, 10, 20, 12, black, 2, 3, 3, 4, 68, 46, 83, 46],
      // tag=10, x=10, y=20, size=12, color, align=right(2), baseline=alphabetic(3), font=serif_italic(3), len=4, "D.S."
    ]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawText");
    if (cmd.type === "DrawText") {
      expect(cmd.text).toBe("D.S.");
      expect(cmd.font).toBe("serif italic");
      expect(cmd.align).toBe("right");
      expect(cmd.baseline).toBe("alphabetic");
      expect(cmd.size).toBe(12);
    }
  });

  it("should decode DrawPolygon command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [9, 4, 0, 0, 10, 0, 10, 5, 0, 5, black], // DrawPolygon: 4 points
    ]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawPolygon");
    if (cmd.type === "DrawPolygon") {
      expect(cmd.points).toHaveLength(4);
      expect(cmd.points[0]).toEqual([0, 0]);
      expect(cmd.points[1]).toEqual([10, 0]);
      expect(cmd.points[2]).toEqual([10, 5]);
      expect(cmd.points[3]).toEqual([0, 5]);
    }
  });

  it("should decode DrawFilledBezier command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [8, 0, 10, 100, 10, 25, -5, 75, -5, 25, 0, 75, 0, 0, 11, 100, 11, black, 0],
    ]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawFilledBezier");
    if (cmd.type === "DrawFilledBezier") {
      expect(cmd.x1).toBe(0);
      expect(cmd.y1).toBe(10);
      expect(cmd.x2).toBe(100);
      expect(cmd.y2).toBe(10);
      expect(cmd.ocx1).toBe(25);
      expect(cmd.ix1).toBe(0);
      expect(cmd.iy1).toBe(11);
      expect(cmd.ix2).toBe(100);
      expect(cmd.iy2).toBe(11);
    }
  });

  it("should decode DrawBezier command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [[6, 0, 10, 25, -5, 75, -5, 100, 10, 2, black]]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawBezier");
    if (cmd.type === "DrawBezier") {
      expect(cmd.x1).toBe(0);
      expect(cmd.width).toBe(2);
    }
  });

  it("should decode DrawQuadratic command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [[7, 0, 10, 50, -10, 100, 10, 1.5, black]]);
    const dl = decodeBinaryDisplayList(data);
    const cmd = dl.commands[0]!;
    expect(cmd.type).toBe("DrawQuadratic");
    if (cmd.type === "DrawQuadratic") {
      expect(cmd.x1).toBe(0);
      expect(cmd.cx).toBe(50);
      expect(cmd.width).toBe(1.5);
    }
  });

  it("should decode multiple commands", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [1, 0, 0, 100, 0, 1, black], // DrawLine
      [5, 10, 20, 0xe0a4, 0, 32, black, 0], // DrawGlyph
      [2, 50, 50, 10, 100, black], // DrawRect
    ]);
    const dl = decodeBinaryDisplayList(data);
    expect(dl.commands).toHaveLength(3);
    expect(dl.commands[0]!.type).toBe("DrawLine");
    expect(dl.commands[1]!.type).toBe("DrawGlyph");
    expect(dl.commands[2]!.type).toBe("DrawRect");
  });

  it("should include pages when present", () => {
    const data = buildBinaryBuffer(800, 1200, [], [[0, 2, 0, 1, 0, 600]]);
    const dl = decodeBinaryDisplayList(data);
    expect(dl.pages).toBeDefined();
    expect(dl.pages).toHaveLength(1);
  });

  it("should omit pages when none exist", () => {
    const data = buildBinaryBuffer(800, 600, []);
    const dl = decodeBinaryDisplayList(data);
    expect(dl.pages).toBeUndefined();
  });
});

describe("paintBinaryDisplayList", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("should clear canvas and fill white background", () => {
    const data = buildBinaryBuffer(800, 600, []);
    paintBinaryDisplayList(ctx, data);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it("should paint DrawGlyph with correct font and codepoint", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [5, 50, 100, 0xe050, 0, 40, black, 0], // DrawGlyph, Bravura
    ]);
    paintBinaryDisplayList(ctx, data);
    expect(ctx.font).toBe("40px Bravura");
    expect(ctx.textAlign).toBe("left");
    expect(ctx.textBaseline).toBe("alphabetic");
    expect(ctx.fillText).toHaveBeenCalledWith(String.fromCodePoint(0xe050), 50, 100);
  });

  it("should paint DrawStretchedGlyph narrowed about its origin", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [[12, 12, 200, 0xe000, 0, 150, black, 0.5]]);
    const scale = vi.fn();
    const scaled = { ...ctx, scale } as unknown as CanvasRenderingContext2D;
    paintBinaryDisplayList(scaled, data);
    expect(scaled.font).toBe("150px Bravura");
    // Drawn at the origin under a translate + horizontal-only scale, so the
    // glyph narrows without losing height.
    expect(scaled.translate).toHaveBeenCalledWith(12, 200);
    expect(scale).toHaveBeenCalledWith(0.5, 1);
    expect(scaled.fillText).toHaveBeenCalledWith(String.fromCodePoint(0xe000), 0, 0);
  });

  it("should paint DrawLine command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [[1, 10, 20, 300, 20, 1.5, black]]);
    paintBinaryDisplayList(ctx, data);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
    expect(ctx.lineTo).toHaveBeenCalledWith(300, 20);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("should paint DrawRect command", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [[2, 0, 0, 100, 50, black]]);
    paintBinaryDisplayList(ctx, data);
    // fillRect called for background + rect
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
  });

  it("should paint multiple commands", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [1, 0, 0, 100, 0, 1, black],
      [5, 10, 20, 0xe050, 0, 32, black, 0],
      [2, 50, 50, 10, 100, black],
    ]);
    paintBinaryDisplayList(ctx, data);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2); // bg + rect
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
  });

  it("should paint DrawText with correct font style prefix", () => {
    const black = encodeColor("#000000");
    // DrawText: x=10, y=20, size=14, color, align=left(0), baseline=alphabetic(3), font=serif_bold(2), len=4, "test"
    const data = buildBinaryBuffer(800, 600, [
      [10, 10, 20, 14, black, 0, 3, 2, 4, 116, 101, 115, 116], // "test"
    ]);
    paintBinaryDisplayList(ctx, data);
    expect(ctx.font).toBe("bold 14px serif");
    expect(ctx.fillText).toHaveBeenCalledWith("test", 10, 20);
  });

  it("should paint DrawPolygon with filled path", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [[9, 4, 0, 0, 10, 0, 10, 5, 0, 5, black]]);
    paintBinaryDisplayList(ctx, data);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("should paint DrawFilledBezier", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(800, 600, [
      [8, 0, 10, 100, 10, 25, -5, 75, -5, 25, 0, 75, 0, 0, 11, 100, 11, black, 0],
    ]);
    paintBinaryDisplayList(ctx, data);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("should skip page data correctly before painting commands", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(
      800,
      1200,
      [[1, 10, 20, 300, 20, 1.5, black]], // 1 DrawLine
      [[0, 2, 0, 1, 0, 600]], // 1 page with 2 system indices
    );
    paintBinaryDisplayList(ctx, data);
    // Should still paint the line correctly despite page data
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
    expect(ctx.lineTo).toHaveBeenCalledWith(300, 20);
  });
});

describe("element IDs in binary display list", () => {
  it("should decode element IDs from binary", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(
      800,
      600,
      [
        [1, 0, 0, 100, 0, 1, black], // DrawLine (no ID)
        [5, 10, 20, 0xe0a4, 0, 32, black, 0], // DrawGlyph (tagged)
        [3, 15, 25, 2, black], // DrawCircle (tagged with same ID)
      ],
      [],
      {
        stringTable: ["p0/m0/s0/ev1"],
        indices: [-1, 0, 0], // cmd 0: no ID, cmd 1+2: string[0]
      },
    );
    const dl = decodeBinaryDisplayList(data);
    expect(dl.elementIds).toBeDefined();
    expect(dl.elementIds).toHaveLength(3);
    expect(dl.elementIds![0]).toBeNull();
    expect(dl.elementIds![1]).toBe("p0/m0/s0/ev1");
    expect(dl.elementIds![2]).toBe("p0/m0/s0/ev1");
  });

  it("should decode multiple unique element IDs", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(
      200,
      100,
      [
        [5, 10, 20, 0xe0a4, 0, 32, black, 0], // DrawGlyph
        [5, 30, 20, 0xe0a4, 0, 32, black, 0], // DrawGlyph
      ],
      [],
      {
        stringTable: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"],
        indices: [0, 1],
      },
    );
    const dl = decodeBinaryDisplayList(data);
    expect(dl.elementIds).toHaveLength(2);
    expect(dl.elementIds![0]).toBe("p0/m0/s0/ev1");
    expect(dl.elementIds![1]).toBe("p0/m0/s0/ev2");
  });

  it("should omit elementIds when no strings in table", () => {
    const data = buildBinaryBuffer(100, 50, []);
    const dl = decodeBinaryDisplayList(data);
    expect(dl.elementIds).toBeUndefined();
  });
});

/** Encode a string ID as [len, ...codepoints] */
function encodeId(id: string): number[] {
  return [id.length, ...Array.from(id).map((c) => c.codePointAt(0) ?? 0)];
}

describe("element bounding box decoding", () => {
  it("should decode element bboxes from binary", () => {
    const black = encodeColor("#000000");
    const bboxData = [...encodeId("p0/m0/clef"), 10, 20, 30, 40];
    const data = buildBinaryBuffer(
      100,
      50,
      [[1, 0, 0, 100, 0, 1, black]], // 1 DrawLine
      [], // no pages
      undefined,
      [bboxData],
    );
    const dl = decodeBinaryDisplayList(data);
    expect(dl.elementBboxes).toBeDefined();
    expect(dl.elementBboxes?.length).toBe(1);
    const eb = dl.elementBboxes?.[0];
    expect(eb?.elementId).toBe("p0/m0/clef");
    expect(eb?.bbox.x).toBe(10);
    expect(eb?.bbox.y).toBe(20);
    expect(eb?.bbox.width).toBe(30);
    expect(eb?.bbox.height).toBe(40);
  });

  it("should handle empty bboxes", () => {
    const data = buildBinaryBuffer(100, 50, [], [], undefined, []);
    const dl = decodeBinaryDisplayList(data);
    expect(dl.elementBboxes).toBeUndefined();
  });

  it("should extract bboxes via getBinaryDisplayListBboxes", () => {
    const bboxData = [...encodeId("note1"), 5, 10, 15, 20];
    const data = buildBinaryBuffer(100, 50, [], [], undefined, [bboxData]);
    const bboxes = getBinaryDisplayListBboxes(data);
    expect(bboxes.length).toBe(1);
    expect(bboxes[0]?.elementId).toBe("note1");
    expect(bboxes[0]?.bbox.x).toBe(5);
  });

  it("should paint correctly with bboxes present", () => {
    const ctx = createMockCtx();
    const black = encodeColor("#000000");
    const bboxData = [...encodeId("p0/m0/e0"), 10, 20, 30, 40];
    const data = buildBinaryBuffer(
      100,
      50,
      [[1, 10, 20, 300, 20, 1.5, black]], // 1 DrawLine
      [],
      undefined,
      [bboxData],
    );
    paintBinaryDisplayList(ctx, data);
    // Should paint line correctly despite bbox data
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
    expect(ctx.lineTo).toHaveBeenCalledWith(300, 20);
  });
});

describe("measure bounds decoding", () => {
  it("should decode measure bounds from binary", () => {
    const measureId = encodeId("m1");
    const boundsData = [
      ...measureId,
      1, // index
      2, // partIndex
      3, // staffIndex
      4, // systemIndex
      10, // x
      200, // width
      50, // y
      40, // height
      25, // prefixWidth
      4, // totalBeats
      2, // beat anchor count
      0,
      35,
      2,
      110,
      1, // ghostStaff
      1, // isHidden
      0, // hasMusicHidden
      1, // isExpansion
    ];
    const data = buildBinaryBuffer(100, 50, [], [], undefined, [], [boundsData]);
    const dl = decodeBinaryDisplayList(data);
    expect(dl.measureBounds).toHaveLength(1);
    expect(dl.measureBounds?.[0]).toMatchObject({
      index: 1,
      measureId: "m1",
      partIndex: 2,
      staffIndex: 3,
      systemIndex: 4,
      x: 10,
      width: 200,
      y: 50,
      height: 40,
      prefixWidth: 25,
      totalBeats: 4,
      beatAnchors: [
        [0, 35],
        [2, 110],
      ],
      ghostStaff: true,
      isHidden: true,
      isExpansion: true,
    });
    expect(dl.measureBounds?.[0]?.hasMusicHidden).toBeUndefined();
  });
});

describe("end-to-end: binary decode → SpatialIndex with tagged elements", () => {
  it("should build SpatialIndex from binary with element IDs and bboxes", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(
      800,
      600,
      [
        [1, 0, 0, 100, 0, 1, black], // DrawLine (staff line, untagged)
        [5, 100, 70, 0xe0a4, 0, 40, black, 0], // DrawGlyph (notehead, tagged)
        [5, 200, 70, 0xe0a4, 0, 40, black, 0], // DrawGlyph (notehead, tagged)
      ],
      [],
      {
        stringTable: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"],
        indices: [-1, 0, 1],
      },
      [
        [...encodeId("p0/m0/s0/ev1"), 95, 55, 20, 30],
        [...encodeId("p0/m0/s0/ev2"), 195, 55, 20, 30],
      ],
    );

    const dl = decodeBinaryDisplayList(data);
    expect(dl.elementIds).toHaveLength(3);
    expect(dl.elementBboxes).toHaveLength(2);

    const si = SpatialIndex.fromDisplayList(dl);
    expect(si.size).toBe(2);

    // Verify precise bboxes are used (from element_bboxes, not approximated)
    const bbox1 = si.getBBox("p0/m0/s0/ev1");
    expect(bbox1?.x).toBe(95);
    expect(bbox1?.y).toBe(55);
    expect(bbox1?.width).toBe(20);
    expect(bbox1?.height).toBe(30);

    // Hit-test should work with precise bboxes
    expect(si.hitTest(105, 65)).toBe("p0/m0/s0/ev1");
    expect(si.hitTest(205, 65)).toBe("p0/m0/s0/ev2");
    expect(si.hitTest(400, 400)).toBeNull();
  });

  it("should fall back to command bboxes when no element_bboxes", () => {
    const black = encodeColor("#000000");
    const data = buildBinaryBuffer(
      800,
      600,
      [
        [5, 100, 70, 0xe0a4, 0, 40, black, 0], // DrawGlyph (tagged)
        [5, 200, 70, 0xe0a4, 0, 40, black, 0], // DrawGlyph (tagged)
      ],
      [],
      {
        stringTable: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"],
        indices: [0, 1],
      },
    );

    const dl = decodeBinaryDisplayList(data);
    expect(dl.elementIds).toHaveLength(2);
    expect(dl.elementBboxes).toBeUndefined();

    const si = SpatialIndex.fromDisplayList(dl);
    expect(si.size).toBe(2);
    expect(si.getBBox("p0/m0/s0/ev1")).toBeDefined();
    expect(si.getBBox("p0/m0/s0/ev2")).toBeDefined();
  });
});
