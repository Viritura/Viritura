import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipPrimitives } from "@viritura/ui";
import type { Score } from "@viritura/core";
import type { DisplayList, RenderCommand } from "@viritura/renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CondensedStaffToggles } from "../condensedStaves/CondensedStaffToggles";

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{}, {}] },
  parts: [
    { id: "a", name: "Horn 1", measures: [{ sequences: [] }, { sequences: [] }] },
    { id: "b", name: "Horn 2", measures: [{ sequences: [] }, { sequences: [] }] },
  ],
  layouts: [{ id: "L", content: [{ type: "staff", sources: [{ part: "a" }, { part: "b" }] }] }],
  scores: [{ name: "Full score", layout: "L" }],
};

function glyph(x: number, y: number, codepoint: number): RenderCommand {
  return { type: "DrawGlyph", x, y, codepoint, color: "#000", size: 40, font: "Bravura", rotation: 0 };
}

function displayList(): DisplayList {
  return {
    commands: [glyph(20, 130, 0xe050), glyph(60, 100, 0xe262), glyph(71, 115, 0xe262)],
    elementIds: ["p0/m0/clef", "p0/m0/key", "p0/m0/key"],
    measureBounds: [0, 1].map((index) => ({
      index,
      partIndex: 0,
      partId: "a",
      staffIndex: 0,
      x: 200 * index,
      y: 100,
      width: 200,
      height: 40,
      prefixWidth: 0,
      totalBeats: 4,
      beatAnchors: [],
    })),
    width: 400,
    height: 220,
  };
}

afterEach(cleanup);

describe("condensed staff toggles beside the floating rail", () => {
  it("tracks changing rail widths, including in-place retained-frame updates", () => {
    const dl = displayList();
    const onToggle = vi.fn();
    const expanded = new Set<string>();
    const tree = (version: number, scrollX: number) => (
      <TooltipPrimitives.Provider>
        <CondensedStaffToggles
          score={score}
          displayList={dl}
          displayListVersion={version}
          selectedScoreIndex={0}
          expanded={expanded}
          onToggle={onToggle}
          scrollX={scrollX}
          scrollY={0}
          zoom={1}
          viewMode="horizon"
        />
      </TooltipPrimitives.Provider>
    );
    const { rerender } = render(tree(1, 120));
    const handle = screen.getByRole("button", { name: "Expand Horn 1 / Horn 2" });
    expect(Number.parseFloat(handle.style.left)).toBeCloseTo(65);
    fireEvent.click(handle);
    expect(onToggle).toHaveBeenCalledWith("0");

    for (let i = 2; i < 7; i++) {
      dl.commands.push(glyph(60 + i * 11, 100 + (i % 3) * 5, 0xe262));
      dl.elementIds!.push("p0/m0/key");
    }
    rerender(tree(2, 120));
    expect(Number.parseFloat(handle.style.left)).toBeCloseTo(120);

    dl.commands.push(glyph(240, 100, 0xe261));
    dl.elementIds!.push("p0/m1/key");
    rerender(tree(3, 250));
    expect(Number.parseFloat(handle.style.left)).toBeCloseTo(41);
  });
});
