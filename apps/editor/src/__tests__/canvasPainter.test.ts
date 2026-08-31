// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { paintCommand, paintCanvas } from "../components/ScoreCanvas/canvasPainter";
import type { DisplayList, RenderCommand } from "@viritura/renderer";

function createMockContext(): CanvasRenderingContext2D {
  const calls: string[] = [];
  return {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    beginPath: vi.fn(() => calls.push("beginPath")),
    moveTo: vi.fn(() => calls.push("moveTo")),
    lineTo: vi.fn(() => calls.push("lineTo")),
    stroke: vi.fn(() => calls.push("stroke")),
    fill: vi.fn(() => calls.push("fill")),
    fillRect: vi.fn(() => calls.push("fillRect")),
    fillText: vi.fn(() => calls.push("fillText")),
    arc: vi.fn(() => calls.push("arc")),
    ellipse: vi.fn(() => calls.push("ellipse")),
    bezierCurveTo: vi.fn(() => calls.push("bezierCurveTo")),
    closePath: vi.fn(() => calls.push("closePath")),
    save: vi.fn(() => calls.push("save")),
    restore: vi.fn(() => calls.push("restore")),
    translate: vi.fn(() => calls.push("translate")),
    rotate: vi.fn(() => calls.push("rotate")),
    setTransform: vi.fn(() => calls.push("setTransform")),
    clearRect: vi.fn(() => calls.push("clearRect")),
    _calls: calls,
  } as unknown as CanvasRenderingContext2D;
}

describe("paintCommand", () => {
  it("paints DrawLine", () => {
    const ctx = createMockContext();
    const cmd: RenderCommand = {
      type: "DrawLine",
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 100,
      width: 2,
      color: "#000",
    };
    paintCommand(ctx, cmd);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("paints DrawRect", () => {
    const ctx = createMockContext();
    const cmd: RenderCommand = {
      type: "DrawRect",
      x: 10,
      y: 20,
      w: 50,
      h: 30,
      color: "#f00",
    };
    paintCommand(ctx, cmd);
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 50, 30);
    expect(ctx.fillStyle).toBe("#f00");
  });

  it("paints DrawCircle", () => {
    const ctx = createMockContext();
    const cmd: RenderCommand = {
      type: "DrawCircle",
      cx: 50,
      cy: 50,
      r: 10,
      color: "#00f",
    };
    paintCommand(ctx, cmd);
    expect(ctx.arc).toHaveBeenCalledWith(50, 50, 10, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("paints DrawText", () => {
    const ctx = createMockContext();
    const cmd: RenderCommand = {
      type: "DrawText",
      x: 10,
      y: 20,
      text: "hello",
      font: "serif",
      size: 14,
      color: "#000",
      align: "left",
      baseline: "alphabetic",
    };
    paintCommand(ctx, cmd);
    expect(ctx.fillText).toHaveBeenCalledWith("hello", 10, 20);
  });

  it("paints DrawGlyph", () => {
    const ctx = createMockContext();
    const cmd: RenderCommand = {
      type: "DrawGlyph",
      x: 10,
      y: 20,
      codepoint: 0xe050,
      font: "Bravura",
      size: 40,
      color: "#000",
      rotation: 0,
    };
    paintCommand(ctx, cmd);
    expect(ctx.fillText).toHaveBeenCalledWith(String.fromCodePoint(0xe050), 10, 20);
  });

  it("paints DrawBezier", () => {
    const ctx = createMockContext();
    const cmd: RenderCommand = {
      type: "DrawBezier",
      x1: 0,
      y1: 0,
      cx1: 20,
      cy1: 30,
      cx2: 40,
      cy2: 30,
      x2: 60,
      y2: 0,
      width: 1.5,
      color: "#000",
    };
    paintCommand(ctx, cmd);
    expect(ctx.bezierCurveTo).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("paints DrawPolygon with >= 3 points", () => {
    const ctx = createMockContext();
    const cmd: RenderCommand = {
      type: "DrawPolygon",
      points: [
        [0, 0],
        [10, 0],
        [5, 10],
      ],
      color: "#0f0",
    };
    paintCommand(ctx, cmd);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(5, 10);
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("skips DrawPolygon with < 3 points", () => {
    const ctx = createMockContext();
    const cmd: RenderCommand = {
      type: "DrawPolygon",
      points: [
        [0, 0],
        [10, 0],
      ],
      color: "#0f0",
    };
    paintCommand(ctx, cmd);
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });
});

describe("paintCanvas", () => {
  it("calls getContext and paints commands", () => {
    const ctx = createMockContext();
    const getContext = vi.fn(() => ctx);
    const parent = document.createElement("div");
    Object.defineProperty(parent, "clientWidth", { value: 800 });
    const canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    canvas.getContext = getContext;

    const dl: DisplayList = {
      width: 800,
      height: 200,
      commands: [
        { type: "DrawRect", x: 0, y: 0, w: 100, h: 50, color: "#000" },
        {
          type: "DrawLine",
          x1: 0,
          y1: 0,
          x2: 100,
          y2: 0,
          width: 1,
          color: "#000",
        },
      ],
    };

    paintCanvas(canvas, dl, null);

    expect(getContext).toHaveBeenCalledWith("2d");
    // White background fill + 1 DrawRect fill
    expect(ctx.fillRect).toHaveBeenCalled();
    // DrawLine stroke
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("uses glyph atlas for DrawGlyph when available", () => {
    const ctx = createMockContext();
    const getContext = vi.fn(() => ctx);
    const parent = document.createElement("div");
    Object.defineProperty(parent, "clientWidth", { value: 800 });
    const canvas = document.createElement("canvas");
    parent.appendChild(canvas);
    canvas.getContext = getContext;

    const mockAtlas = {
      isBuilt: true,
      ensureDeviceScale: vi.fn(),
      drawGlyph: vi.fn(() => true),
    };

    const dl: DisplayList = {
      width: 800,
      height: 200,
      commands: [
        {
          type: "DrawGlyph",
          x: 10,
          y: 20,
          codepoint: 0xe050,
          font: "Bravura",
          size: 40,
          color: "#000",
          rotation: 0,
        },
      ],
    };

    paintCanvas(canvas, dl, mockAtlas as never);

    expect(mockAtlas.drawGlyph).toHaveBeenCalledWith(ctx, 0xe050, 10, 20, 40, "#000");
    // fillText should NOT be called since atlas handled it
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});
