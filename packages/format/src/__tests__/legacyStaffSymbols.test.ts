import { describe, expect, it } from "vitest";
import type { LayoutGroup } from "@viritura/core";
import { parseMnx } from "../mnx/parser";

function document(outerSymbol: string, innerSymbol: string) {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: ["P1", "P2"].map((id) => ({ id, measures: [{ sequences: [{ content: [] }] }] })),
    layouts: [
      {
        id: "full",
        content: [
          {
            type: "group",
            symbol: outerSymbol,
            content: [
              {
                type: "group",
                symbol: innerSymbol,
                content: [
                  { type: "staff", sources: [{ part: "P1" }] },
                  { type: "staff", sources: [{ part: "P2" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("legacy staff-group symbol migration", () => {
  it("upgrades editor-only line and none symbols to MNX square and noSymbol", () => {
    const outer = parseMnx(document("none", "line")).layouts?.[0]?.content[0] as LayoutGroup;
    expect(outer.symbol).toBe("noSymbol");
    expect((outer.content[0] as LayoutGroup).symbol).toBe("square");
  });

  it("upgrades brackets nested in a bracket to MNX square sub-brackets", () => {
    const outer = parseMnx(document("bracket", "bracket")).layouts?.[0]?.content[0] as LayoutGroup;
    expect(outer.symbol).toBe("bracket");
    expect((outer.content[0] as LayoutGroup).symbol).toBe("square");
  });

  it("keeps brackets nested in a brace as brackets", () => {
    const outer = parseMnx(document("brace", "bracket")).layouts?.[0]?.content[0] as LayoutGroup;
    expect((outer.content[0] as LayoutGroup).symbol).toBe("bracket");
  });
});
