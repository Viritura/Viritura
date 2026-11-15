import { describe, expect, it } from "vitest";
import type { LayoutGroup } from "@viritura/core";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

const STAVES = [
  { type: "staff", sources: [{ part: "P1" }] },
  { type: "staff", sources: [{ part: "P2" }] },
];

/** Builds one layout whose groups nest in the given order, outermost first. */
function document(...symbols: string[]) {
  const content = symbols.reduceRight<unknown[]>(
    (inner, symbol) => [{ type: "group", symbol, content: inner }],
    STAVES,
  );
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: ["P1", "P2"].map((id) => ({ id, measures: [{ sequences: [{ content: [] }] }] })),
    layouts: [{ id: "full", content }],
  };
}

describe("legacy staff-group symbol migration", () => {
  it("upgrades editor-only line and none symbols to MNX square and noSymbol", () => {
    const outer = parseMnx(document("none", "line")).layouts?.[0]?.content[0] as LayoutGroup;
    expect(outer.symbol).toBe("noSymbol");
    expect((outer.content[0] as LayoutGroup).symbol).toBe("square");
  });

  it("preserves nested brackets across parsing and serialization", () => {
    const score = parseMnx(document("bracket", "bracket", "bracket"));
    const outer = parseMnx(serializeMnx(score)).layouts?.[0]?.content[0] as LayoutGroup;
    const middle = outer.content[0] as LayoutGroup;
    expect(outer.symbol).toBe("bracket");
    expect(middle.symbol).toBe("bracket");
    expect((middle.content[0] as LayoutGroup).symbol).toBe("bracket");
  });

  it.each(["brace", "square", "noSymbol"])("keeps brackets nested in %s groups", (symbol) => {
    const outer = parseMnx(document(symbol, "bracket")).layouts?.[0]?.content[0] as LayoutGroup;
    expect((outer.content[0] as LayoutGroup).symbol).toBe("bracket");
  });

  it("preserves nested brackets when another group uses a legacy symbol", () => {
    const outer = parseMnx(document("bracket", "bracket", "line")).layouts?.[0]?.content[0] as LayoutGroup;
    const middle = outer.content[0] as LayoutGroup;
    expect(middle.symbol).toBe("bracket");
    expect((middle.content[0] as LayoutGroup).symbol).toBe("square");
  });
});
