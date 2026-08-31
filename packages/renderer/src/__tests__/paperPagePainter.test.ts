import { describe, expect, it } from "vitest";
import { computeHorizonPaperGeometry } from "../paperPagePainter";
import type { DisplayList, RenderCommand } from "../wasm";

function displayList(commands: RenderCommand[], height = 400): DisplayList {
  return { commands, width: 600, height } as DisplayList;
}

describe("computeHorizonPaperGeometry", () => {
  it("centers paper and viewport extent on actual music ink", () => {
    const geometry = computeHorizonPaperGeometry(
      displayList([{ type: "DrawRect", x: 40, y: 80, w: 300, h: 120, color: "#000" } as RenderCommand]),
    );

    expect(geometry.y).toBe(20);
    expect(geometry.height).toBe(240);
    expect(geometry.contentHeight / 2).toBe(140);
    expect(geometry.y + geometry.height / 2).toBe(140);
  });

  it("does not let nominal display-list height bias ink centering", () => {
    const short = computeHorizonPaperGeometry(
      displayList([{ type: "DrawRect", x: 0, y: 50, w: 100, h: 50, color: "#000" } as RenderCommand], 200),
    );
    const tall = computeHorizonPaperGeometry(
      displayList([{ type: "DrawRect", x: 0, y: 50, w: 100, h: 50, color: "#000" } as RenderCommand], 800),
    );

    expect(tall).toEqual(short);
  });

  it("keeps the same center when padding extends above the coordinate origin", () => {
    const geometry = computeHorizonPaperGeometry(
      displayList([{ type: "DrawRect", x: 0, y: 5, w: 100, h: 45, color: "#000" } as RenderCommand]),
    );

    expect(geometry.y).toBe(-15);
    expect(geometry.contentHeight / 2).toBe(27.5);
    expect(geometry.y + geometry.height / 2).toBe(27.5);
  });

  it("prefers precise engine boxes over conservative tagged glyph bounds", () => {
    const geometry = computeHorizonPaperGeometry({
      commands: [
        {
          type: "DrawGlyph",
          x: 50,
          y: 100,
          codepoint: 0xe050,
          font: "Bravura",
          size: 100,
          color: "#000",
          rotation: 0,
        },
      ],
      elementIds: ["p0/m0/clef"],
      elementBboxes: [{ elementId: "p0/m0/clef", bbox: { x: 40, y: 80, width: 30, height: 40 } }],
      width: 600,
      height: 400,
    });

    expect(geometry.y).toBe(20);
    expect(geometry.height).toBe(160);
    expect(geometry.contentHeight / 2).toBe(100);
  });

  it("falls back to nominal dimensions when no command has ink bounds", () => {
    const geometry = computeHorizonPaperGeometry(displayList([], 300));

    expect(geometry).toEqual({ x: -20, y: -20, width: 640, height: 340, contentHeight: 300 });
  });
});
