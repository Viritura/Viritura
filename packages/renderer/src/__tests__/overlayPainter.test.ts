import { describe, it, expect } from "vitest";
import {
  detectStaves,
  detectHorizonStaves,
  extractStickyClefInfo,
  findStaffAtPosition,
  snapToStaffPosition,
  getStaffPosition,
  noteheadForDuration,
  NOTEHEAD_WHOLE,
  NOTEHEAD_HALF,
  NOTEHEAD_BLACK,
} from "../overlayPainter";
import type { DisplayList } from "../wasm";

/** Create a minimal display list with staff lines at the given position. */
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
  return { commands, width: x2 + 50, height: topY + count * spatium * 10 };
}

describe("detectStaves", () => {
  it("detects a single 5-line staff", () => {
    const dl = makeStaffDisplayList(50, 500, 100, 12);
    const staves = detectStaves(dl);
    expect(staves).toHaveLength(1);
    expect(staves[0]!.x).toBe(50);
    expect(staves[0]!.xEnd).toBe(500);
    expect(staves[0]!.y).toBe(100);
    expect(staves[0]!.spatium).toBe(12);
    expect(staves[0]!.height).toBe(48);
  });

  it("detects multiple staves", () => {
    const dl = makeStaffDisplayList(50, 500, 100, 12, 3);
    const staves = detectStaves(dl);
    expect(staves).toHaveLength(3);
    expect(staves[0]!.y).toBe(100);
    expect(staves[1]!.y).toBe(196); // 100 + 12*8
    expect(staves[2]!.y).toBe(292); // 100 + 12*16
  });

  it("returns empty for display list with no staff lines", () => {
    const dl: DisplayList = {
      commands: [{ type: "DrawRect", x: 0, y: 0, w: 100, h: 100, color: "#000" }],
      width: 100,
      height: 100,
    };
    expect(detectStaves(dl)).toHaveLength(0);
  });

  it("ignores thick lines (not staff lines)", () => {
    const dl: DisplayList = {
      commands: [
        { type: "DrawLine", x1: 50, y1: 100, x2: 500, y2: 100, width: 5.0, color: "#000" },
        { type: "DrawLine", x1: 50, y1: 112, x2: 500, y2: 112, width: 5.0, color: "#000" },
        { type: "DrawLine", x1: 50, y1: 124, x2: 500, y2: 124, width: 5.0, color: "#000" },
        { type: "DrawLine", x1: 50, y1: 136, x2: 500, y2: 136, width: 5.0, color: "#000" },
        { type: "DrawLine", x1: 50, y1: 148, x2: 500, y2: 148, width: 5.0, color: "#000" },
      ],
      width: 550,
      height: 200,
    };
    expect(detectStaves(dl)).toHaveLength(0);
  });

  it("detects staff lines at large spatium (A3 score: thickness scales with spatium)", () => {
    // The engine draws staff lines at 0.13 * spatium px thick. On an A3 score
    // (spatiumMm 1.625 at 12 px/mm → spatium 19.5px), staff lines are ~2.5px
    // thick — above the old fixed 2.0px cutoff that silently dropped every
    // staff and broke mouse note entry. Thinness is now relative to spacing.
    const spatium = 19.5;
    const lineWidth = 0.13 * spatium; // ≈ 2.535
    const commands: DisplayList["commands"] = [];
    for (let i = 0; i < 5; i++) {
      commands.push({
        type: "DrawLine",
        x1: 60,
        y1: 100 + i * spatium,
        x2: 700,
        y2: 100 + i * spatium,
        width: lineWidth,
        color: "#000000",
      });
    }
    const staves = detectStaves({ commands, width: 760, height: 400 });
    expect(staves).toHaveLength(1);
    expect(staves[0]!.spatium).toBeCloseTo(spatium, 5);
  });

  it("ignores a thick beam-like horizontal band at large spatium", () => {
    // Strokes that clear the absolute collection ceiling (< 8px) but exceed the
    // relative thinness bound (0.35 * spatium ≈ 6.8px) must NOT register as a
    // staff even when evenly spaced — the relative thinness check rejects them.
    const spatium = 19.5;
    const commands: DisplayList["commands"] = [];
    for (let i = 0; i < 5; i++) {
      commands.push({
        type: "DrawLine",
        x1: 60,
        y1: 100 + i * spatium,
        x2: 700,
        y2: 100 + i * spatium,
        width: 7.0, // > 0.35 * 19.5 (6.825) but < 8.0 collection ceiling
        color: "#000000",
      });
    }
    expect(detectStaves({ commands, width: 760, height: 400 })).toHaveLength(0);
  });
});

describe("detectHorizonStaves", () => {
  it("collapses measure bounds from multiple chunks by staff index", () => {
    const dl: DisplayList = {
      commands: [],
      width: 1000,
      height: 240,
      measureBounds: [
        {
          index: 0,
          partIndex: 0,
          staffIndex: 0,
          x: 50,
          width: 200,
          y: 100,
          height: 48,
          prefixWidth: 20,
          totalBeats: 4,
          beatAnchors: [],
        },
        {
          index: 1,
          partIndex: 0,
          staffIndex: 0,
          x: 250,
          width: 300,
          y: 100,
          height: 48,
          prefixWidth: 0,
          totalBeats: 4,
          beatAnchors: [],
        },
        {
          index: 0,
          partIndex: 1,
          staffIndex: 1,
          x: 50,
          width: 500,
          y: 200,
          height: 48,
          prefixWidth: 20,
          totalBeats: 4,
          beatAnchors: [],
        },
      ],
    };

    expect(detectHorizonStaves(dl)).toEqual([
      { x: 50, xEnd: 550, y: 100, spatium: 12, height: 48, index: 0 },
      { x: 50, xEnd: 550, y: 200, spatium: 12, height: 48, index: 1 },
    ]);
  });
});

describe("findStaffAtPosition", () => {
  const dl = makeStaffDisplayList(50, 500, 100, 12, 2);
  const staves = detectStaves(dl);

  it("finds the correct staff for a position on the first staff", () => {
    const staff = findStaffAtPosition(staves, 200, 124);
    expect(staff).not.toBeNull();
    expect(staff!.y).toBe(100);
  });

  it("finds the correct staff for a position on the second staff", () => {
    const staff = findStaffAtPosition(staves, 200, 220);
    expect(staff).not.toBeNull();
    expect(staff!.y).toBe(196);
  });

  it("returns null for position outside any staff range", () => {
    const staff = findStaffAtPosition(staves, 200, 500);
    expect(staff).toBeNull();
  });

  it("returns null for X position outside staff bounds", () => {
    const staff = findStaffAtPosition(staves, 10, 124);
    expect(staff).toBeNull();
  });
});

describe("snapToStaffPosition", () => {
  const staff = { x: 50, xEnd: 500, y: 100, spatium: 12, height: 48, index: 0 };

  it("snaps to exact staff line positions", () => {
    // Top line
    expect(snapToStaffPosition(100, staff)).toBe(100);
    // Second line
    expect(snapToStaffPosition(112, staff)).toBe(112);
    // Bottom line
    expect(snapToStaffPosition(148, staff)).toBe(148);
  });

  it("snaps to space positions between lines", () => {
    // Between top and second line
    expect(snapToStaffPosition(105, staff)).toBe(106);
    // Between second and third line
    expect(snapToStaffPosition(118, staff)).toBe(118);
  });

  it("snaps to ledger line positions above staff", () => {
    expect(snapToStaffPosition(88, staff)).toBe(88);
    expect(snapToStaffPosition(91, staff)).toBe(94); // space above top line
  });

  it("snaps to ledger line positions below staff", () => {
    expect(snapToStaffPosition(160, staff)).toBe(160);
  });
});

describe("getStaffPosition", () => {
  const staff = { x: 50, xEnd: 500, y: 100, spatium: 12, height: 48, index: 0 };

  it("returns 0 for top line", () => {
    expect(getStaffPosition(100, staff)).toBe(0);
  });

  it("returns 4 for bottom line", () => {
    expect(getStaffPosition(148, staff)).toBe(4);
  });

  it("returns 0.5 for first space", () => {
    expect(getStaffPosition(106, staff)).toBe(0.5);
  });

  it("returns negative for above staff", () => {
    expect(getStaffPosition(88, staff)).toBe(-1);
  });

  it("returns >4 for below staff", () => {
    expect(getStaffPosition(160, staff)).toBe(5);
  });
});

describe("noteheadForDuration", () => {
  it("returns whole notehead for duration 1", () => {
    expect(noteheadForDuration("1")).toBe(NOTEHEAD_WHOLE);
  });

  it("returns half notehead for duration 2", () => {
    expect(noteheadForDuration("2")).toBe(NOTEHEAD_HALF);
  });

  it("returns black notehead for quarter and shorter", () => {
    expect(noteheadForDuration("4")).toBe(NOTEHEAD_BLACK);
    expect(noteheadForDuration("8")).toBe(NOTEHEAD_BLACK);
    expect(noteheadForDuration("16")).toBe(NOTEHEAD_BLACK);
    expect(noteheadForDuration("32")).toBe(NOTEHEAD_BLACK);
  });
});

// ─── Sticky Clef Extraction ─────────────────────────────

/** Create a display list with staff lines, a clef glyph, and an optional label. */
function makeStaffWithClef(
  staffX: number,
  staffXEnd: number,
  topY: number,
  spatium: number,
  clefCodepoint: number,
  label?: string,
): DisplayList {
  const commands: DisplayList["commands"] = [];
  // 5 staff lines
  for (let i = 0; i < 5; i++) {
    commands.push({
      type: "DrawLine",
      x1: staffX,
      y1: topY + i * spatium,
      x2: staffXEnd,
      y2: topY + i * spatium,
      width: 0.8,
      color: "#000000",
    });
  }
  // Clef glyph near left edge
  commands.push({
    type: "DrawGlyph",
    x: staffX + spatium * 1.0,
    y: topY + spatium * 3.0,
    codepoint: clefCodepoint,
    color: "#000000",
    size: spatium * 4,
    font: "Bravura",
    rotation: 0,
  });
  // Optional label
  if (label) {
    commands.push({
      type: "DrawText",
      x: staffX - spatium * 1.0,
      y: topY + spatium * 2.0,
      text: label,
      font: "serif",
      size: spatium * 1.2,
      color: "#000000",
      align: "right",
      baseline: "middle",
    });
  }
  return { commands, width: staffXEnd + 50, height: topY + spatium * 10 };
}

describe("extractStickyClefInfo", () => {
  it("extracts clef info for a single staff", () => {
    const dl = makeStaffWithClef(50, 800, 100, 12, 0xe050);
    const staves = detectStaves(dl);
    expect(staves).toHaveLength(1);

    const info = extractStickyClefInfo(dl, staves);
    expect(info).toHaveLength(1);
    expect(info[0]!.clefs).toHaveLength(1);
    expect(info[0]!.clefs[0]!.codepoint).toBe(0xe050);
    expect(info[0]!.label).toBeNull();
  });

  it("extracts clef and label for a staff", () => {
    const dl = makeStaffWithClef(50, 800, 100, 12, 0xe050, "Flute");
    const staves = detectStaves(dl);
    const info = extractStickyClefInfo(dl, staves);

    expect(info[0]!.clefs.length).toBeGreaterThan(0);
    expect(info[0]!.label).not.toBeNull();
    expect(info[0]!.label!.text).toBe("Flute");
    expect(info[0]!.label!.font).toBe("serif");
  });

  it("returns empty array for empty staves", () => {
    const dl: DisplayList = { commands: [], width: 100, height: 100 };
    const info = extractStickyClefInfo(dl, []);
    expect(info).toHaveLength(0);
  });

  it("handles multiple staves", () => {
    // Build a display list with 2 staves, each with different clefs
    const sp = 12;
    const commands: DisplayList["commands"] = [];
    const staff1Y = 100;
    const staff2Y = 250;
    // Staff 1 lines
    for (let i = 0; i < 5; i++) {
      commands.push({
        type: "DrawLine",
        x1: 50,
        y1: staff1Y + i * sp,
        x2: 800,
        y2: staff1Y + i * sp,
        width: 0.8,
        color: "#000",
      });
    }
    // Staff 2 lines
    for (let i = 0; i < 5; i++) {
      commands.push({
        type: "DrawLine",
        x1: 50,
        y1: staff2Y + i * sp,
        x2: 800,
        y2: staff2Y + i * sp,
        width: 0.8,
        color: "#000",
      });
    }
    // Treble clef on staff 1
    commands.push({
      type: "DrawGlyph",
      x: 55,
      y: staff1Y + 3 * sp,
      codepoint: 0xe050,
      color: "#000",
      size: sp * 4,
      font: "Bravura",
      rotation: 0,
    });
    // Bass clef on staff 2
    commands.push({
      type: "DrawGlyph",
      x: 55,
      y: staff2Y + 1 * sp,
      codepoint: 0xe062,
      color: "#000",
      size: sp * 4,
      font: "Bravura",
      rotation: 0,
    });
    // Labels
    commands.push({
      type: "DrawText",
      x: 40,
      y: staff1Y + 2 * sp,
      text: "Violin",
      font: "serif",
      size: 14,
      color: "#000",
      align: "right",
      baseline: "middle",
    });
    commands.push({
      type: "DrawText",
      x: 40,
      y: staff2Y + 2 * sp,
      text: "Cello",
      font: "serif",
      size: 14,
      color: "#000",
      align: "right",
      baseline: "middle",
    });

    const dl: DisplayList = { commands, width: 850, height: 400 };
    const staves = detectStaves(dl);
    expect(staves).toHaveLength(2);

    const info = extractStickyClefInfo(dl, staves);
    expect(info).toHaveLength(2);
    expect(info[0]!.clefs[0]!.codepoint).toBe(0xe050);
    expect(info[0]!.label!.text).toBe("Violin");
    expect(info[1]!.clefs[0]!.codepoint).toBe(0xe062);
    expect(info[1]!.label!.text).toBe("Cello");
  });

  it("collects mid-staff clef changes sorted by x", () => {
    // One staff with an initial treble clef and a later bass-clef change.
    const sp = 12;
    const dl = makeStaffWithClef(50, 800, 100, sp, 0xe050);
    dl.commands.push({
      type: "DrawGlyph",
      x: 400,
      y: 100 + sp * 1.0,
      codepoint: 0xe062, // bass clef change mid-staff
      color: "#000000",
      size: sp * 4,
      font: "Bravura",
      rotation: 0,
    });
    const staves = detectStaves(dl);
    const info = extractStickyClefInfo(dl, staves);
    expect(info[0]!.clefs).toHaveLength(2);
    // Sorted left-to-right: initial treble first, then the bass change.
    expect(info[0]!.clefs[0]!.codepoint).toBe(0xe050);
    expect(info[0]!.clefs[1]!.codepoint).toBe(0xe062);
    expect(info[0]!.clefs[0]!.x).toBeLessThan(info[0]!.clefs[1]!.x);
  });

  it("does not accumulate repeated per-chunk clefs onto duplicate staff rows", () => {
    // Stitched-horizon mode renders the same physical staff as separate chunk
    // segments at the SAME Y but different x-ranges, each repeating the active
    // clef. detectStaves sees them as distinct staff entries; the sticky
    // extractor must funnel every clef on that row into ONE staff entry so the
    // overlay shows a single clef rather than a pile of them.
    const sp = 12;
    const topY = 100;
    const commands: DisplayList["commands"] = [];
    // Two collinear chunk segments: x 0..2000 and x 2000..4000.
    for (const [x1, x2] of [
      [0, 2000],
      [2000, 4000],
    ] as const) {
      for (let i = 0; i < 5; i++) {
        commands.push({
          type: "DrawLine",
          x1,
          y1: topY + i * sp,
          x2,
          y2: topY + i * sp,
          width: 0.8,
          color: "#000000",
        });
      }
    }
    // Each chunk repeats the treble clef at its own left edge.
    for (const x of [20, 2020]) {
      commands.push({
        type: "DrawGlyph",
        x,
        y: topY + sp * 3.0,
        codepoint: 0xe050,
        color: "#000000",
        size: sp * 4,
        font: "Bravura",
        rotation: 0,
      });
    }
    const dl: DisplayList = { commands, width: 4050, height: topY + sp * 10 };
    const staves = detectStaves(dl);
    // detectStaves reports the two chunk segments as separate staff entries.
    expect(staves.length).toBeGreaterThanOrEqual(2);
    const info = extractStickyClefInfo(dl, staves);
    // All clefs funnel into a single staff entry; the others carry none.
    const withClefs = info.filter((i) => i.clefs.length > 0);
    expect(withClefs).toHaveLength(1);
    expect(withClefs[0]!.clefs).toHaveLength(2); // both repeats, on one row
  });
});
