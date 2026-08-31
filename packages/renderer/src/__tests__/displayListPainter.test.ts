import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DisplayList, RenderCommand, DrawGlyph } from "../wasm";
import { paintDisplayList } from "../displayListPainter";

/**
 * Create a minimal mock CanvasRenderingContext2D with the methods
 * used by paintDisplayList.
 */
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
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

describe("paintDisplayList", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("should clear the canvas and fill white background", () => {
    const displayList: DisplayList = {
      commands: [],
      width: 800,
      height: 600,
    };

    paintDisplayList(ctx, displayList);

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it("should handle DrawGlyph command with correct font and codepoint", () => {
    // SMuFL codepoint for treble clef: U+E050
    const glyphCmd: DrawGlyph = {
      type: "DrawGlyph",
      x: 50,
      y: 100,
      codepoint: 0xe050,
      font: "Bravura",
      size: 40,
      color: "#000000",
      rotation: 0,
    };

    const displayList: DisplayList = {
      commands: [glyphCmd],
      width: 800,
      height: 600,
    };

    paintDisplayList(ctx, displayList);

    expect(ctx.fillStyle).toBe("#000000");
    expect(ctx.font).toBe("40px Bravura");
    expect(ctx.textAlign).toBe("left");
    expect(ctx.textBaseline).toBe("alphabetic");
    expect(ctx.fillText).toHaveBeenCalledWith(String.fromCodePoint(0xe050), 50, 100);
  });

  it("should handle DrawLine command", () => {
    const lineCmd: RenderCommand = {
      type: "DrawLine",
      x1: 10,
      y1: 20,
      x2: 300,
      y2: 20,
      width: 1.5,
      color: "#000000",
    };

    const displayList: DisplayList = {
      commands: [lineCmd],
      width: 800,
      height: 600,
    };

    paintDisplayList(ctx, displayList);

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
    expect(ctx.lineTo).toHaveBeenCalledWith(300, 20);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("should handle DrawRect command", () => {
    const rectCmd: RenderCommand = {
      type: "DrawRect",
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      color: "#FF0000",
    };

    const displayList: DisplayList = {
      commands: [rectCmd],
      width: 800,
      height: 600,
    };

    paintDisplayList(ctx, displayList);

    // fillRect is called for background + the rect command
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
  });

  it("should process multiple commands in order", () => {
    const commands: RenderCommand[] = [
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
        x: 10,
        y: 20,
        codepoint: 0xe050,
        font: "Bravura",
        size: 32,
        color: "#000000",
        rotation: 0,
      },
      {
        type: "DrawRect",
        x: 50,
        y: 50,
        w: 10,
        h: 100,
        color: "#000000",
      },
    ];

    const displayList: DisplayList = {
      commands,
      width: 800,
      height: 600,
    };

    paintDisplayList(ctx, displayList);

    // Background clear + fill, then 3 commands processed
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    // fillRect: 1 background + 1 DrawRect = 2
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
  });
});
