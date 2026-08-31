import { describe, it, expect } from "vitest";
import { SpatialIndex, buildHitRegions, hitTest, getElementType } from "../hitTest";
import type { ElementBBox } from "../hitTest";
import type { DisplayList } from "../wasm";

// ── Legacy HitRegion tests ───────────────────────────────────────────

function makeDisplayList(overrides?: Partial<DisplayList>): DisplayList {
  return {
    commands: [],
    width: 800,
    height: 600,
    ...overrides,
  };
}

describe("buildHitRegions", () => {
  it("should return empty array when no element IDs", () => {
    const dl = makeDisplayList();
    const regions = buildHitRegions(dl);
    expect(regions).toHaveLength(0);
  });

  it("should build regions from tagged glyph commands", () => {
    const dl = makeDisplayList({
      commands: [
        {
          type: "DrawGlyph",
          x: 100,
          y: 200,
          codepoint: 0xe0a4,
          font: "Bravura",
          size: 40,
          color: "#000000",
          rotation: 0,
        },
        {
          type: "DrawGlyph",
          x: 200,
          y: 200,
          codepoint: 0xe0a4,
          font: "Bravura",
          size: 40,
          color: "#000000",
          rotation: 0,
        },
      ],
      elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"],
    });

    const regions = buildHitRegions(dl);
    expect(regions).toHaveLength(2);
    expect(regions[0]!.elementId).toBe("p0/m0/s0/ev1");
    expect(regions[1]!.elementId).toBe("p0/m0/s0/ev2");
  });

  it("should merge bounding boxes for same element ID", () => {
    const dl = makeDisplayList({
      commands: [
        {
          type: "DrawGlyph",
          x: 100,
          y: 200,
          codepoint: 0xe0a4,
          font: "Bravura",
          size: 40,
          color: "#000000",
          rotation: 0,
        },
        {
          type: "DrawCircle",
          cx: 130,
          cy: 195,
          r: 2,
          color: "#000000",
        },
      ],
      elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev1"],
    });

    const regions = buildHitRegions(dl);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.elementId).toBe("p0/m0/s0/ev1");
    expect(regions[0]!.width).toBeGreaterThan(0);
  });

  it("should skip null element IDs", () => {
    const dl = makeDisplayList({
      commands: [
        {
          type: "DrawLine",
          x1: 0,
          y1: 0,
          x2: 100,
          y2: 0,
          width: 1,
          color: "#000000",
        },
        {
          type: "DrawGlyph",
          x: 50,
          y: 100,
          codepoint: 0xe0a4,
          font: "Bravura",
          size: 40,
          color: "#000000",
          rotation: 0,
        },
      ],
      elementIds: [null, "p0/m0/s0/ev1"],
    });

    const regions = buildHitRegions(dl);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.elementId).toBe("p0/m0/s0/ev1");
  });
});

describe("hitTest (legacy)", () => {
  it("should return null for empty regions", () => {
    const result = hitTest([], 100, 200);
    expect(result).toBeNull();
  });

  it("should find element at exact center", () => {
    const regions = [{ elementId: "p0/m0/s0/ev1", x: 90, y: 170, width: 24, height: 40 }];
    const result = hitTest(regions, 102, 190);
    expect(result).not.toBeNull();
    expect(result!.elementId).toBe("p0/m0/s0/ev1");
  });

  it("should return null for point far from any element", () => {
    const regions = [{ elementId: "p0/m0/s0/ev1", x: 90, y: 170, width: 24, height: 40 }];
    const result = hitTest(regions, 500, 500);
    expect(result).toBeNull();
  });

  it("should return closest element when multiple overlap", () => {
    const regions = [
      { elementId: "p0/m0/s0/ev1", x: 90, y: 170, width: 24, height: 40 },
      { elementId: "p0/m0/s0/ev2", x: 100, y: 170, width: 24, height: 40 },
    ];
    const result = hitTest(regions, 115, 190);
    expect(result).not.toBeNull();
    expect(result!.elementId).toBe("p0/m0/s0/ev2");
  });

  it("should respect tolerance parameter", () => {
    const regions = [{ elementId: "p0/m0/s0/ev1", x: 100, y: 100, width: 20, height: 20 }];
    const result = hitTest(regions, 124, 110, 5);
    expect(result).not.toBeNull();

    const result2 = hitTest(regions, 130, 110, 5);
    expect(result2).toBeNull();
  });
});

// ── SpatialIndex tests ───────────────────────────────────────────────

describe("SpatialIndex", () => {
  const entries: ElementBBox[] = [
    { id: "note-1", x: 100, y: 50, width: 12, height: 12 },
    { id: "note-2", x: 150, y: 50, width: 12, height: 12 },
    { id: "note-3", x: 200, y: 80, width: 12, height: 12 },
    { id: "rest-1", x: 250, y: 60, width: 10, height: 20 },
  ];

  it("constructs with sorted entries", () => {
    const index = new SpatialIndex(entries);
    expect(index.size).toBe(4);
  });

  describe("hitTest", () => {
    it("returns element ID when point is inside bbox", () => {
      const index = new SpatialIndex(entries);
      expect(index.hitTest(106, 56)).toBe("note-1");
    });

    it("returns null when point is outside all bboxes", () => {
      const index = new SpatialIndex(entries);
      expect(index.hitTest(0, 0)).toBeNull();
    });

    it("returns smallest matching element when overlapping", () => {
      const overlapping: ElementBBox[] = [
        { id: "event", x: 10, y: 10, width: 50, height: 50 },
        { id: "articulation", x: 15, y: 15, width: 10, height: 10 },
      ];
      const index = new SpatialIndex(overlapping);
      // Point inside both — should return smaller (articulation)
      expect(index.hitTest(20, 20)).toBe("articulation");
    });

    it("returns smallest bbox among multiple containing entries", () => {
      const nested: ElementBBox[] = [
        { id: "large", x: 0, y: 0, width: 100, height: 100 },
        { id: "medium", x: 10, y: 10, width: 40, height: 40 },
        { id: "small", x: 20, y: 20, width: 10, height: 10 },
      ];
      const index = new SpatialIndex(nested);
      expect(index.hitTest(25, 25)).toBe("small");
    });

    it("uses the nearest center to disambiguate overlapping chord noteheads", () => {
      const chordNotes: ElementBBox[] = [
        { id: "p0/m0/s0/chord/n0", x: 20, y: 20, width: 14, height: 14 },
        { id: "p0/m0/s0/chord/n1", x: 20, y: 28, width: 14, height: 14 },
      ];
      const index = new SpatialIndex(chordNotes);

      expect(index.hitTest(27, 33)).toBe("p0/m0/s0/chord/n1");
      expect(index.hitTest(27, 25)).toBe("p0/m0/s0/chord/n0");
    });
  });

  describe("findNearest", () => {
    it("finds nearest element within tolerance", () => {
      const index = new SpatialIndex(entries);
      // Just outside note-2 bbox
      expect(index.findNearest(163, 56, 20)).toBe("note-2");
    });

    it("measures from the bbox edge so tall events are targetable near the notehead", () => {
      const index = new SpatialIndex([{ id: "note", x: 100, y: 50, width: 12, height: 48 }]);

      expect(index.findNearest(114, 96, 15)).toBe("note");
    });

    it("chooses the element whose bbox edge is nearest", () => {
      const index = new SpatialIndex([
        { id: "near-edge", x: 100, y: 50, width: 12, height: 48 },
        { id: "near-center", x: 117, y: 88, width: 4, height: 4 },
      ]);

      expect(index.findNearest(114, 96, 15)).toBe("near-edge");
    });

    it("returns null when nothing within tolerance", () => {
      const index = new SpatialIndex(entries);
      expect(index.findNearest(500, 500, 5)).toBeNull();
    });
  });

  describe("getBBox", () => {
    it("returns bbox for known element", () => {
      const index = new SpatialIndex(entries);
      const bbox = index.getBBox("note-2");
      expect(bbox).toEqual({ id: "note-2", x: 150, y: 50, width: 12, height: 12 });
    });

    it("returns undefined for unknown element", () => {
      const index = new SpatialIndex(entries);
      expect(index.getBBox("nonexistent")).toBeUndefined();
    });
  });

  describe("queryRect", () => {
    it("returns elements intersecting the rect", () => {
      const index = new SpatialIndex(entries);
      const result = index.queryRect(90, 40, 70, 30);
      expect(result).toEqual(["note-1", "note-2"]);
    });

    it("returns empty array when no intersection", () => {
      const index = new SpatialIndex(entries);
      expect(index.queryRect(0, 0, 5, 5)).toEqual([]);
    });
  });

  describe("fromDisplayList", () => {
    it("builds index from glyph and ellipse commands", () => {
      const dl: DisplayList = {
        commands: [
          // Staff line — should be excluded
          { type: "DrawLine", x1: 0, y1: 50, x2: 500, y2: 50, width: 1, color: "#000" },
          // Notehead glyph
          {
            type: "DrawGlyph",
            x: 100,
            y: 70,
            codepoint: 0xe0a4,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
          // Rest glyph
          {
            type: "DrawGlyph",
            x: 200,
            y: 65,
            codepoint: 0xe4e5,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
          // Notehead ellipse
          { type: "DrawEllipse", cx: 300, cy: 70, rx: 6, ry: 5, angle: -0.15, filled: true, color: "#000" },
        ],
        width: 500,
        height: 200,
      };
      const index = SpatialIndex.fromDisplayList(dl);
      // Without elementIds, all commands with computable bboxes become entries (including DrawLine now)
      expect(index.size).toBe(4);
    });

    it("prefers engine elementBboxes over command approximation", () => {
      const dl: DisplayList = {
        commands: [
          {
            type: "DrawGlyph",
            x: 100,
            y: 70,
            codepoint: 0xe0a4,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
        ],
        width: 500,
        height: 200,
        elementBboxes: [
          { elementId: "p0/m0/clef", bbox: { x: 10, y: 20, width: 15, height: 40 } },
          { elementId: "p0/m0/time", bbox: { x: 30, y: 20, width: 20, height: 48 } },
          { elementId: "p0/m0/v0/e0", bbox: { x: 100, y: 55, width: 12, height: 35 } },
        ],
      };
      const index = SpatialIndex.fromDisplayList(dl);
      // Should use elementBboxes, not commands
      expect(index.size).toBe(3);
      expect(index.getBBox("p0/m0/clef")).toBeDefined();
      expect(index.getBBox("p0/m0/time")).toBeDefined();
      expect(index.getBBox("p0/m0/v0/e0")).toBeDefined();
    });

    it("uses precise bbox values from engine", () => {
      const dl: DisplayList = {
        commands: [],
        width: 500,
        height: 200,
        elementBboxes: [{ elementId: "p0/m0/key", bbox: { x: 50, y: 60, width: 25, height: 48 } }],
      };
      const index = SpatialIndex.fromDisplayList(dl);
      const bbox = index.getBBox("p0/m0/key");
      expect(bbox).toEqual({ id: "p0/m0/key", x: 50, y: 60, width: 25, height: 48 });
    });

    it("merges duplicate element IDs from elementBboxes", () => {
      const dl: DisplayList = {
        commands: [],
        width: 500,
        height: 200,
        elementBboxes: [
          { elementId: "p0/m0/dyn0", bbox: { x: 100, y: 120, width: 20, height: 15 } },
          { elementId: "p0/m0/dyn0", bbox: { x: 110, y: 125, width: 20, height: 15 } },
        ],
      };
      const index = SpatialIndex.fromDisplayList(dl);
      expect(index.size).toBe(1);
      const bbox = index.getBBox("p0/m0/dyn0");
      expect(bbox).toBeDefined();
      // Merged bbox should span both
      expect(bbox!.x).toBe(100);
      expect(bbox!.y).toBe(120);
      expect(bbox!.width).toBe(30); // 100..130
      expect(bbox!.height).toBe(20); // 120..140
    });

    it("keeps same-id bboxes far apart in Y as separate staves", () => {
      const dl: DisplayList = {
        commands: [],
        width: 500,
        height: 400,
        elementBboxes: [
          { elementId: "p0/m0/v0/e0", bbox: { x: 100, y: 60, width: 12, height: 35 } },
          // Same id, but far away in Y (condensed staff vs. expansion staff)
          { elementId: "p0/m0/v0/e0", bbox: { x: 100, y: 300, width: 12, height: 35 } },
        ],
      };
      const index = SpatialIndex.fromDisplayList(dl);
      // Should NOT merge: two separate entries on different staves
      expect(index.size).toBe(2);
    });

    it("scales linearly for large scores (no O(n^2) blowup)", () => {
      // Regression guard: a previous O(n^2) lookup made large orchestral
      // scores stall for tens of seconds. 50k unique bboxes must build fast.
      const elementBboxes = Array.from({ length: 50_000 }, (_, i) => ({
        elementId: `p0/m${i}/v0/e0`,
        bbox: { x: i * 2, y: 60, width: 12, height: 35 },
      }));
      const dl: DisplayList = { commands: [], width: 1, height: 1, elementBboxes };
      const start = performance.now();
      const index = SpatialIndex.fromDisplayList(dl);
      const elapsed = performance.now() - start;
      expect(index.size).toBe(50_000);
      // Comfortably under a second on CI; O(n^2) would take many seconds.
      expect(elapsed).toBeLessThan(2000);
    });

    it("includes all element types from engine bboxes", () => {
      const dl: DisplayList = {
        commands: [],
        width: 800,
        height: 400,
        elementBboxes: [
          { elementId: "p0/m0/clef", bbox: { x: 5, y: 60, width: 15, height: 40 } },
          { elementId: "p0/m0/time", bbox: { x: 25, y: 60, width: 20, height: 48 } },
          { elementId: "p0/m0/key", bbox: { x: 50, y: 60, width: 25, height: 48 } },
          { elementId: "p0/m1/barline", bbox: { x: 200, y: 60, width: 2, height: 48 } },
          { elementId: "p0/m0/v0/e0", bbox: { x: 100, y: 55, width: 12, height: 35 } },
          { elementId: "p0/m0/dyn0", bbox: { x: 100, y: 120, width: 20, height: 15 } },
        ],
      };
      const index = SpatialIndex.fromDisplayList(dl);
      expect(index.size).toBe(6);
      // All element types should be hit-testable
      expect(index.hitTest(12, 80)).toBe("p0/m0/clef");
      expect(index.hitTest(35, 80)).toBe("p0/m0/time");
      expect(index.hitTest(60, 80)).toBe("p0/m0/key");
      expect(index.hitTest(201, 80)).toBe("p0/m1/barline");
      expect(index.hitTest(106, 70)).toBe("p0/m0/v0/e0");
      expect(index.hitTest(110, 127)).toBe("p0/m0/dyn0");
    });

    it("falls back to command-based bboxes when no elementBboxes", () => {
      const dl: DisplayList = {
        commands: [
          {
            type: "DrawGlyph",
            x: 100,
            y: 70,
            codepoint: 0xe0a4,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
        ],
        width: 500,
        height: 200,
        elementIds: ["p0/m0/v0/e0"],
      };
      const index = SpatialIndex.fromDisplayList(dl);
      expect(index.size).toBe(1);
      expect(index.getBBox("p0/m0/v0/e0")).toBeDefined();
    });

    it("handles DrawRect in command fallback", () => {
      const dl: DisplayList = {
        commands: [{ type: "DrawRect", x: 50, y: 60, w: 20, h: 48, color: "#000" }],
        width: 500,
        height: 200,
        elementIds: ["p0/m0/barline"],
      };
      const index = SpatialIndex.fromDisplayList(dl);
      expect(index.size).toBe(1);
      const bbox = index.getBBox("p0/m0/barline");
      expect(bbox).toBeDefined();
      expect(bbox!.x).toBe(50);
      expect(bbox!.width).toBe(20);
    });

    it("handles DrawLine in command fallback", () => {
      const dl: DisplayList = {
        commands: [{ type: "DrawLine", x1: 100, y1: 60, x2: 100, y2: 108, width: 2, color: "#000" }],
        width: 500,
        height: 200,
        elementIds: ["p0/m1/barline"],
      };
      const index = SpatialIndex.fromDisplayList(dl);
      expect(index.size).toBe(1);
      const bbox = index.getBBox("p0/m1/barline");
      expect(bbox).toBeDefined();
      expect(bbox!.height).toBe(50); // 48 + 2 (line width)
    });

    it("ignores empty elementBboxes array and falls back to commands", () => {
      const dl: DisplayList = {
        commands: [
          {
            type: "DrawGlyph",
            x: 100,
            y: 70,
            codepoint: 0xe0a4,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
        ],
        width: 500,
        height: 200,
        elementBboxes: [],
        elementIds: ["p0/m0/v0/e0"],
      };
      const index = SpatialIndex.fromDisplayList(dl);
      expect(index.size).toBe(1);
      expect(index.getBBox("p0/m0/v0/e0")).toBeDefined();
    });

    it("uses engine-provided element IDs from elementIds array", () => {
      const dl: DisplayList = {
        commands: [
          { type: "DrawLine", x1: 0, y1: 50, x2: 500, y2: 50, width: 1, color: "#000" },
          {
            type: "DrawGlyph",
            x: 100,
            y: 70,
            codepoint: 0xe0a4,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
          {
            type: "DrawGlyph",
            x: 200,
            y: 70,
            codepoint: 0xe0a4,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
        ],
        elementIds: [null, "p0/m0/s0/ev1", "p0/m0/s0/ev2"],
        width: 500,
        height: 200,
      };
      const index = SpatialIndex.fromDisplayList(dl);
      // Line is untagged (null), so only 2 entries
      expect(index.size).toBe(2);
      expect(index.hitTest(105, 65)).toBe("p0/m0/s0/ev1");
      expect(index.hitTest(205, 65)).toBe("p0/m0/s0/ev2");
    });

    it("skips untagged commands when elementIds present", () => {
      const dl: DisplayList = {
        commands: [
          { type: "DrawLine", x1: 0, y1: 50, x2: 500, y2: 50, width: 1, color: "#000" },
          {
            type: "DrawGlyph",
            x: 100,
            y: 70,
            codepoint: 0xe0a4,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
        ],
        elementIds: [null, "p0/m0/s0/ev1"],
        width: 500,
        height: 200,
      };
      const index = SpatialIndex.fromDisplayList(dl);
      expect(index.size).toBe(1);
      // Should not hit staff line at y=50
      expect(index.hitTest(250, 50)).toBeNull();
    });

    it("prefers element_bboxes when available", () => {
      const dl: DisplayList = {
        commands: [
          {
            type: "DrawGlyph",
            x: 100,
            y: 70,
            codepoint: 0xe0a4,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
        ],
        elementIds: ["p0/m0/s0/ev1"],
        elementBboxes: [{ elementId: "p0/m0/s0/ev1", bbox: { x: 95, y: 55, width: 20, height: 30 } }],
        width: 500,
        height: 200,
      };
      const index = SpatialIndex.fromDisplayList(dl);
      expect(index.size).toBe(1);
      const bbox = index.getBBox("p0/m0/s0/ev1");
      // Should use the precise bbox from element_bboxes, not approximate from command
      expect(bbox?.x).toBe(95);
      expect(bbox?.y).toBe(55);
      expect(bbox?.width).toBe(20);
      expect(bbox?.height).toBe(30);
    });

    it("supplements element_bboxes with tagged commands not in bboxes", () => {
      const dl: DisplayList = {
        commands: [
          {
            type: "DrawGlyph",
            x: 100,
            y: 70,
            codepoint: 0xe0a4,
            font: "Bravura",
            size: 40,
            color: "#000",
            rotation: 0,
          },
          {
            type: "DrawText",
            x: 100,
            y: 120,
            text: "cresc.",
            font: "serif italic",
            size: 12,
            color: "#000",
            align: "left",
            baseline: "alphabetic",
          },
        ],
        elementIds: ["p0/m0/s0/ev1", "p0/m0/hairpin0"],
        elementBboxes: [
          { elementId: "p0/m0/s0/ev1", bbox: { x: 95, y: 55, width: 20, height: 30 } },
          // hairpin0 not in element_bboxes — should be supplemented from command
        ],
        width: 500,
        height: 200,
      };
      const index = SpatialIndex.fromDisplayList(dl);
      // Should have both entries: one from element_bboxes, one from command fallback
      expect(index.size).toBe(2);
      expect(index.getBBox("p0/m0/s0/ev1")).toBeDefined();
      expect(index.getBBox("p0/m0/hairpin0")).toBeDefined();
    });

    it("merges duplicate element IDs in element_bboxes", () => {
      const dl: DisplayList = {
        commands: [],
        elementBboxes: [
          { elementId: "p0/m0/s0/ev1", bbox: { x: 100, y: 50, width: 10, height: 10 } },
          { elementId: "p0/m0/s0/ev1", bbox: { x: 105, y: 55, width: 10, height: 10 } },
        ],
        width: 500,
        height: 200,
      };
      const index = SpatialIndex.fromDisplayList(dl);
      expect(index.size).toBe(1);
      const bbox = index.getBBox("p0/m0/s0/ev1");
      // Merged: minX=100, minY=50, maxX=115, maxY=65
      expect(bbox?.x).toBe(100);
      expect(bbox?.y).toBe(50);
      expect(bbox?.width).toBe(15);
      expect(bbox?.height).toBe(15);
    });
  });
});

// ── getElementType tests ─────────────────────────────────────────────

describe("getElementType", () => {
  it("classifies clef IDs", () => {
    expect(getElementType("p0/m0/clef")).toBe("clef");
    expect(getElementType("p1/m5/clef")).toBe("clef");
  });

  it("classifies time signature IDs", () => {
    expect(getElementType("p0/m0/time")).toBe("time");
    expect(getElementType("m3/time")).toBe("time");
  });

  it("classifies key signature IDs", () => {
    expect(getElementType("p0/m0/key")).toBe("key");
  });

  it("classifies barline IDs", () => {
    expect(getElementType("p0/m1/barline")).toBe("barline");
  });

  it("classifies event IDs", () => {
    expect(getElementType("p0/m0/v0/e0")).toBe("event");
    expect(getElementType("p0/m0/s0/ev-1")).toBe("event");
  });

  it("classifies chord notehead IDs", () => {
    expect(getElementType("p0/m0/s0/ev-1/n2")).toBe("note");
  });

  it("classifies dynamics IDs", () => {
    expect(getElementType("p0/m0/dyn0")).toBe("dynamics");
    expect(getElementType("p0/m2/dyn12")).toBe("dynamics");
  });

  it("classifies hairpin IDs", () => {
    expect(getElementType("p0/m0/hairpin0")).toBe("hairpin");
  });

  it("classifies pedal IDs", () => {
    expect(getElementType("p0/m0/pedal0")).toBe("pedal");
  });

  it("classifies ottava IDs", () => {
    expect(getElementType("p0/m0/ottava0")).toBe("ottava");
  });

  it("classifies volta IDs", () => {
    expect(getElementType("p0/m0/volta0")).toBe("volta");
  });

  it("returns unknown for unrecognized IDs", () => {
    expect(getElementType("something/random")).toBe("unknown");
  });
});
