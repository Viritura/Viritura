import { describe, it, expect } from "vitest";
import type { LayoutContent, Score } from "@viritura/core";
import { reorderInstrumentInScore } from "../instrumentMutations";

function staff(part: string): LayoutContent {
  return { type: "staff", sources: [{ part }] } as unknown as LayoutContent;
}
function group(label: string, content: LayoutContent[]): LayoutContent {
  return { type: "group", symbol: "bracket", label, content } as unknown as LayoutContent;
}

/** Collect part ids in depth-first (visual) order from layout content. */
function partOrder(content: LayoutContent[]): string[] {
  const ids: string[] = [];
  const walk = (nodes: LayoutContent[]) => {
    for (const node of nodes) {
      if (node.type === "group") walk(node.content);
      else for (const s of node.sources) if (s.part) ids.push(s.part);
    }
  };
  walk(content);
  return ids;
}

function makeScore(content: LayoutContent[], partIds: string[]): Score {
  return {
    parts: partIds.map((id) => ({ id, name: id })),
    layouts: [{ id: "full", content }],
    scores: [{ name: "Full Score", layout: "full" }],
    global: { measures: [] },
  } as unknown as Score;
}

describe("reorderInstrumentInScore", () => {
  it("reorders both the parts roster and the full-score layout (flat staves)", () => {
    const score = makeScore([staff("a"), staff("b"), staff("c")], ["a", "b", "c"]);
    // Move 'c' before 'a'.
    const next = reorderInstrumentInScore(score, "c", "a", false);
    expect(next.parts.map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(partOrder(next.layouts![0]!.content)).toEqual(["c", "a", "b"]);
  });

  it("places a part after the target when placeAfter is true", () => {
    const score = makeScore([staff("a"), staff("b"), staff("c")], ["a", "b", "c"]);
    // Move 'a' to after 'b'.
    const next = reorderInstrumentInScore(score, "a", "b", true);
    expect(next.parts.map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(partOrder(next.layouts![0]!.content)).toEqual(["b", "a", "c"]);
  });

  it("moves a part into the target's family group and prunes the emptied group", () => {
    const content = [group("Woodwinds", [staff("fl")]), group("Strings", [staff("vln"), staff("vc")])];
    const score = makeScore(content, ["fl", "vln", "vc"]);
    // Drag the lone flute to sit after the violin (joins the Strings group).
    const next = reorderInstrumentInScore(score, "fl", "vln", true);
    const root = next.layouts![0]!.content;
    // Emptied Woodwinds group is pruned; only the Strings group remains.
    expect(root.length).toBe(1);
    expect(root[0]!.type).toBe("group");
    expect(partOrder(root)).toEqual(["vln", "fl", "vc"]);
    expect(next.parts.map((p) => p.id)).toEqual(["vln", "fl", "vc"]);
  });

  it("keeps a multi-staff (brace) part together when reordered", () => {
    const piano = group("Piano", [staff("pno"), staff("pno")]);
    (piano as unknown as { symbol: string }).symbol = "brace";
    const score = makeScore([staff("a"), piano, staff("b")], ["a", "pno", "b"]);
    // Move the piano before 'a'.
    const next = reorderInstrumentInScore(score, "pno", "a", false);
    const root = next.layouts![0]!.content;
    expect(root[0]!.type).toBe("group"); // brace group moved as a unit
    expect(partOrder(root)).toEqual(["pno", "pno", "a", "b"]);
    expect(next.parts.map((p) => p.id)).toEqual(["pno", "a", "b"]);
  });

  it("is a no-op when source and target are the same part", () => {
    const score = makeScore([staff("a"), staff("b")], ["a", "b"]);
    const next = reorderInstrumentInScore(score, "a", "a", false);
    expect(next).toBe(score);
  });
});
