import { describe, expect, it, vi } from "vitest";
import { normalizeErasingFrameOrder, paintInkCommands } from "../inkMask";
import { paintDisplayList } from "../displayListPainter";
import { paintCommandsCulled } from "../tileCache";
import { decodeBinaryDisplayList, paintBinaryDisplayList } from "../binaryDisplayList";
import type { DisplayList, RenderCommand } from "../wasm";

function context() {
  const ctx = {
    canvas: { width: 100, height: 100 },
    globalAlpha: 1,
    getTransform: vi.fn(() => ({ a: 2, b: 0, c: 0, d: 2, e: -10, f: -20 })),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    fillStyle: "",
    textAlign: "",
    textBaseline: "",
    font: "",
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const ink: RenderCommand = { type: "DrawRect", x: 0, y: 0, w: 80, h: 80, color: "#000000" };
const mask: RenderCommand = { type: "EraseRect", x: 10, y: 10, w: 30, h: 30 };
const foreground: RenderCommand = { type: "DrawRect", x: 20, y: 20, w: 5, h: 5, color: "#ff0000" };

describe("ink knockout", () => {
  it("clips earlier ink without clearing or filling the paper, preserving later foreground", () => {
    const ctx = context();
    const clipping: number[] = [];
    paintInkCommands(ctx, [ink, mask, foreground], () => clipping.push(vi.mocked(ctx.clip).mock.calls.length));
    expect(clipping).toEqual([1, 1]);
    expect(ctx.clip).toHaveBeenCalledWith("evenodd");
    expect(ctx.rect).toHaveBeenCalledWith(10, 10, 30, 30);
    expect(ctx.clearRect).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.save).toHaveBeenCalledTimes(2);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
  });

  it("intersects separate exclusion clips so overlapping erasers never restore ink", () => {
    const ctx = context();
    paintInkCommands(ctx, [ink, mask, { ...mask, x: 20 }, foreground], () => {});
    expect(ctx.clip).toHaveBeenCalledTimes(3);
  });

  it("keeps opacity state across masking batches", () => {
    const ctx = context();
    const opacity: number[] = [];
    paintInkCommands(ctx, [{ type: "SetOpacity", opacity: 0.4 }, ink, mask, foreground], (cmd) => {
      if (cmd.type === "SetOpacity") ctx.globalAlpha = cmd.opacity;
      else opacity.push(ctx.globalAlpha);
    });
    expect(opacity).toEqual([0.4, 0.4]);
  });

  it("uses the same mask for transparent direct paint and culled paint", () => {
    const direct = context();
    paintDisplayList(direct, { commands: [ink, mask, foreground], width: 100, height: 100 }, undefined, null);
    expect(direct.fillRect).toHaveBeenCalledTimes(2);
    expect(direct.clip).toHaveBeenCalledTimes(1);
    const culled = context();
    paintCommandsCulled(culled, [ink, mask, foreground], null, 0, 100, 0, 100);
    expect(culled.fillRect).toHaveBeenCalledTimes(2);
    expect(culled.clip).toHaveBeenCalledTimes(1);
  });

  it("raises staff knockout foreground above later barlines but below page furniture, keeping tags and opacity", () => {
    const dl: DisplayList = {
      width: 100,
      height: 100,
      commands: [
        { type: "SetOpacity", opacity: 0.4 },
        mask,
        foreground,
        { type: "SetOpacity", opacity: 1 },
        ink,
        { ...foreground, y: 50 },
      ],
      elementIds: [null, "p0/m0/expr0", "p0/m0/expr0", null, "barline", "text-frame/page"],
    };
    const out = normalizeErasingFrameOrder(dl);
    const index = (id: string) => out.elementIds!.indexOf(id);
    expect(index("barline")).toBeLessThan(index("p0/m0/expr0"));
    expect(index("p0/m0/expr0")).toBeLessThan(index("text-frame/page"));
    expect(out.commands[index("p0/m0/expr0")]).toEqual(mask);
    expect(out.commands[index("p0/m0/expr0") - 1]).toEqual({ type: "SetOpacity", opacity: 0.4 });
    expect(out.commands[index("text-frame/page") - 1]).toEqual({ type: "SetOpacity", opacity: 1 });
    expect(normalizeErasingFrameOrder({ ...dl, ...out })).toEqual(out);
  });

  it("decodes and paints binary ink knockout tag 13", () => {
    const data = new Float32Array([
      100, 100, 3, 0, 0, 0, 0, 2, 0, 0, 80, 80, 0, 13, 10, 10, 30, 30, 2, 20, 20, 5, 5, 0,
    ]);
    expect(decodeBinaryDisplayList(data).commands[1]).toEqual(mask);
    const ctx = context();
    paintBinaryDisplayList(ctx, data);
    expect(ctx.clip).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledTimes(3); // Paper + two ink rectangles, never a white knockout.
  });
});
