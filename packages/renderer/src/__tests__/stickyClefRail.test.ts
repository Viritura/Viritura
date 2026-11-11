import { afterEach, describe, expect, it, vi } from "vitest";
import { extractStickyClefInfo, paintStickyClefs, stickyClefRailWidth, type StaffInfo } from "../overlayPainter";
import * as wasm from "../wasm";
import type { DisplayList, DrawGlyph, MeasureBounds } from "../wasm";

const SHARP = 0xe262;
const FLAT = 0xe260;
const NATURAL = 0xe261;
const TREBLE = 0xe050;
const BASS = 0xe062;
const SP = 10;

const staff: StaffInfo = { x: 0, xEnd: 800, y: 100, height: 40, spatium: SP, index: 0 };

function glyph(x: number, y: number, codepoint: number, color = "#000000"): DrawGlyph {
  return { type: "DrawGlyph", x, y, codepoint, color, size: 4 * SP, font: "Bravura", rotation: 0 };
}

function bound(index: number, y = 100, partIndex = 0, staffIndex = 0): MeasureBounds {
  return {
    index,
    partIndex,
    partId: `#${partIndex}`,
    staffIndex,
    x: index * 200,
    width: 200,
    y,
    height: 4 * SP,
    prefixWidth: 0,
    totalBeats: 4,
    beatAnchors: [],
  };
}

function fixture(initialKey = true) {
  const dl: DisplayList = {
    commands: [],
    elementIds: [],
    measureBounds: [bound(0), bound(1), bound(2)],
    width: 800,
    height: 300,
  };
  const add = (command: DisplayList["commands"][number], id: string | null) => {
    dl.commands.push(command);
    dl.elementIds!.push(id);
  };
  add(glyph(20, 130, TREBLE), "p0/m0/clef");
  if (initialKey) {
    add(glyph(60, 100, SHARP, "#a02030"), "p0/m0/key");
    add(glyph(71, 115, SHARP, "#a02030"), "p0/m0/key");
  }
  add(glyph(120, 110, FLAT), "p0/m0/s0/ev0");
  add(glyph(240, 100, NATURAL), "p0/m1/key");
  add(glyph(251, 120, FLAT), "p0/m1/key");
  add(glyph(262, 105, FLAT), "p0/m1/key");
  add(glyph(440, 120, NATURAL), "p0/m2/key");
  add(glyph(451, 105, NATURAL), "p0/m2/key");
  return { dl, add };
}

interface PaintedText {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
}

function canvas() {
  const texts: PaintedText[] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn(() => ({ width: 35, actualBoundingBoxAscent: 8 })),
    fillText: vi.fn(),
  };
  context.fillText.mockImplementation((text: string, x: number, y: number) => {
    texts.push({ text, x, y, font: context.font, color: context.fillStyle });
  });
  return { ctx: context as unknown as CanvasRenderingContext2D, context, texts };
}

function paint(dl: DisplayList, contentX: number) {
  const info = extractStickyClefInfo(dl, [staff]);
  const output = canvas();
  paintStickyClefs(output.ctx, [staff], info, contentX, 1);
  return { ...output, info };
}

function accidentals(texts: PaintedText[]): PaintedText[] {
  return texts.filter((text) => [SHARP, FLAT, NATURAL].includes(text.text.codePointAt(0)!));
}

afterEach(() => vi.restoreAllMocks());

describe("sticky key signatures", () => {
  it("uses only tagged key glyphs and displays the opening key as soon as the rail appears", () => {
    const { dl } = fixture();
    const { info, texts } = paint(dl, 40);
    expect(info[0]!.keySignatures.map((key) => key.glyphs.length)).toEqual([2, 2, 0]);
    expect(accidentals(texts)).toEqual([
      { text: String.fromCodePoint(SHARP), x: 77, y: 100, font: "40px Bravura", color: "#a02030" },
      { text: String.fromCodePoint(SHARP), x: 88, y: 115, font: "40px Bravura", color: "#a02030" },
    ]);
  });

  it("updates at key changes and drops cancellation naturals from the persistent signature", () => {
    const { dl } = fixture();
    expect(accidentals(paint(dl, 239).texts).map((text) => text.text)).toEqual([
      String.fromCodePoint(SHARP),
      String.fromCodePoint(SHARP),
    ]);
    expect(accidentals(paint(dl, 240).texts).map((text) => text.text)).toEqual([
      String.fromCodePoint(FLAT),
      String.fromCodePoint(FLAT),
    ]);
    const cancelled = paint(dl, 440);
    expect(accidentals(cancelled.texts)).toEqual([]);
    expect(stickyClefRailWidth([staff], cancelled.info, 440)).toBe(35);
  });

  it("does not show a future key while the opening key is empty", () => {
    const { dl } = fixture(false);
    expect(accidentals(paint(dl, 100).texts)).toEqual([]);
    expect(accidentals(paint(dl, 240).texts)).toHaveLength(2);
  });

  it("uses the engine's key placement when the active clef changes", () => {
    const { dl, add } = fixture();
    add(glyph(150, 110, BASS), "p0/m1/clef");
    const positions = vi.spyOn(wasm, "computeKeySignaturePositions").mockReturnValue([1, 2.5]);
    const { texts } = paint(dl, 160);
    expect(positions).toHaveBeenCalledWith(2, "F");
    expect(accidentals(texts).map((text) => text.y)).toEqual([110, 125]);
    expect(texts.filter((text) => text.text === String.fromCodePoint(BASS))).toHaveLength(1);
  });

  it("uses the semantic clef when a custom glyph looks like the previous clef", () => {
    const { dl, add } = fixture();
    dl.measureBounds![0]!.clefSign = "G";
    dl.measureBounds![1]!.clefSign = "F";
    dl.measureBounds![2]!.clefSign = "F";
    add(glyph(180, 110, TREBLE), "p0/m1/clef");
    vi.spyOn(wasm, "computeKeySignaturePositions").mockReturnValue([1, 2.5]);
    expect(accidentals(paint(dl, 179).texts).map((text) => text.y)).toEqual([100, 115]);
    expect(accidentals(paint(dl, 190).texts).map((text) => text.y)).toEqual([110, 125]);
  });

  it("updates key placement for hidden and mid-measure clef changes", () => {
    const { dl } = fixture();
    dl.measureBounds![0]!.clefSign = "G";
    dl.measureBounds![0]!.clefChanges = [{ x: 150, sign: "F" }];
    dl.measureBounds![1]!.clefSign = "F";
    vi.spyOn(wasm, "computeKeySignaturePositions").mockReturnValue([1, 2.5]);
    expect(accidentals(paint(dl, 149).texts).map((text) => text.y)).toEqual([100, 115]);
    expect(accidentals(paint(dl, 151).texts).map((text) => text.y)).toEqual([110, 125]);
    expect(accidentals(paint(dl, 205).texts).map((text) => text.y)).toEqual([110, 125]);
  });

  it("falls back to visible clefs before the first semantic context", () => {
    const { dl, add } = fixture();
    dl.measureBounds![1]!.clefSign = "G";
    add(glyph(150, 110, BASS), "p0/m0/clef");
    vi.spyOn(wasm, "computeKeySignaturePositions").mockReturnValue([1, 2.5]);
    expect(accidentals(paint(dl, 160).texts).map((text) => text.y)).toEqual([110, 125]);
  });

  it("keeps the rail and staff label outside a seven-accidental signature", () => {
    const { dl, add } = fixture(false);
    for (let i = 0; i < 7; i++) add(glyph(60 + i * 11, 100 + (i % 3) * 5, SHARP), "p0/m0/key");
    add(
      {
        type: "DrawText",
        x: -5,
        y: 120,
        text: "Violin",
        font: "serif",
        size: 12,
        color: "#000",
        align: "right",
        baseline: "middle",
      },
      null,
    );
    const { info, context, texts } = paint(dl, 100);
    const width = stickyClefRailWidth([staff], info, 100);
    expect(width).toBeCloseTo(114);
    expect(context.fillRect.mock.calls[0]![2]).toBeCloseTo(width);
    expect(accidentals(texts)).toHaveLength(7);
    expect(texts.find((text) => text.text === "Violin")!.x).toBeCloseTo(100 + width);
  });

  it("keeps same-part grand-staff signatures on their own rows", () => {
    const lower: StaffInfo = { ...staff, y: 140, index: 1 };
    const dl: DisplayList = {
      commands: [
        glyph(20, 130, TREBLE),
        glyph(20, 150, BASS),
        glyph(60, 100, SHARP),
        { type: "DrawLine", x1: 0, y1: 100, x2: 800, y2: 100, width: 1, color: "#000" },
        glyph(60, 150, SHARP),
      ],
      elementIds: ["p0/m0/clef", "p0/m0/clef", "p0/m0/key", null, "p0/m0/key"],
      measureBounds: [bound(0), bound(0, 140, 0, 1)],
      width: 800,
      height: 300,
    };
    const info = extractStickyClefInfo(dl, [staff, lower]);
    expect(info.map((row) => row.clefs[0]!.codepoint)).toEqual([TREBLE, BASS]);
    expect(info.map((row) => row.keySignatures[0]!.glyphs[0]!.y)).toEqual([100, 150]);
    const output = canvas();
    paintStickyClefs(output.ctx, [staff, lower], info, 100, 1);
    expect(accidentals(output.texts).map((text) => text.y)).toEqual([100, 150]);
  });

  it("uses each staff's engraved key and sizes the rail for the widest signature", () => {
    const lower: StaffInfo = { ...staff, y: 200, index: 1 };
    const dl: DisplayList = {
      commands: [glyph(20, 130, TREBLE), glyph(20, 210, BASS), glyph(60, 100, SHARP), glyph(71, 115, SHARP)],
      elementIds: ["p0/m0/clef", "p1/m0/clef", "p0/m0/key", "p0/m0/key"],
      measureBounds: [bound(0), bound(0, 200, 1, 1)],
      width: 800,
      height: 300,
    };
    for (let i = 0; i < 7; i++) {
      dl.commands.push(glyph(60 + i * 11, 200 + (i % 3) * 5, FLAT));
      dl.elementIds!.push("p1/m0/key");
    }
    const info = extractStickyClefInfo(dl, [staff, lower]);
    const output = canvas();
    paintStickyClefs(output.ctx, [staff, lower], info, 100, 1);
    expect(stickyClefRailWidth([staff, lower], info, 100)).toBeCloseTo(114);
    expect(accidentals(output.texts).map((text) => text.text)).toEqual([
      String.fromCodePoint(SHARP),
      String.fromCodePoint(SHARP),
      ...Array.from({ length: 7 }, () => String.fromCodePoint(FLAT)),
    ]);
  });

  it("keeps signatures clear of clefs on larger-scaled staves", () => {
    const lower: StaffInfo = { ...staff, y: 200, index: 1, spatium: 20, height: 80 };
    const dl: DisplayList = {
      commands: [
        glyph(20, 130, TREBLE),
        { ...glyph(20, 220, BASS), size: 80 },
        glyph(60, 100, SHARP),
        { ...glyph(60, 220, SHARP), size: 80 },
      ],
      elementIds: ["p0/m0/clef", "p1/m0/clef", "p0/m0/key", "p1/m0/key"],
      measureBounds: [bound(0), { ...bound(0, 200, 1, 1), height: 80 }],
      width: 800,
      height: 300,
    };
    const info = extractStickyClefInfo(dl, [staff, lower]);
    const output = canvas();
    paintStickyClefs(output.ctx, [staff, lower], info, 100, 1);
    expect(stickyClefRailWidth([staff, lower], info, 100)).toBeCloseTo(96);
    expect(accidentals(output.texts).map((text) => text.x)).toEqual([174, 174]);
  });

  it("scales the safe-area inset and snaps key glyphs with the staff lines", () => {
    const { dl } = fixture();
    const info = extractStickyClefInfo(dl, [staff]);
    const { ctx, context, texts } = canvas();
    paintStickyClefs(ctx, [staff], info, 100, 2, 40, "#fff", (x, y) => ({ x: x + 0.25, y: y + 0.5 }));
    expect(context.fillRect.mock.calls[0]![0]).toBe(120);
    expect(accidentals(texts).map(({ x, y }) => [x, y])).toEqual([
      [157.25, 100.5],
      [168.25, 115.5],
    ]);
    expect(context.moveTo).toHaveBeenCalledWith(120.25, 100.5);
  });
});
