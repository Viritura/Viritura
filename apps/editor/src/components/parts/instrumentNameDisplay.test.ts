import { describe, expect, it } from "vitest";
import type { LayoutContent } from "@viritura/core";
import {
  instrumentNameDisplayFor,
  instrumentNameDisplayLayoutIds,
  setInstrumentNameDisplay,
  setScoreInstrumentNameDisplay,
} from "./instrumentNameDisplay";

const content: LayoutContent[] = [
  {
    type: "group",
    content: [
      { type: "staff", sources: [{ part: "fl", labelref: "name" }] },
      { type: "staff", labelref: "name", sources: [{ part: "ob" }] },
    ],
  },
];

describe("instrument name display policy", () => {
  it("recognizes the conventional default across staff- and source-level MNX references", () => {
    expect(instrumentNameDisplayFor(content)).toBe("fullThenShort");
  });

  it("writes canonical standard-MNX references without mutating the source layout", () => {
    const original = structuredClone(content);
    const short = setInstrumentNameDisplay(content, "short");
    expect(instrumentNameDisplayFor(short)).toBe("short");
    expect(short[0]).toMatchObject({
      content: [
        { labelref: "shortName", sources: [{ part: "fl" }] },
        { labelref: "shortName", sources: [{ part: "ob" }] },
      ],
    });
    expect(content).toEqual(original);
  });

  it("removes literal and referenced labels when hidden", () => {
    const custom: LayoutContent[] = [{ type: "staff", label: "Solo", sources: [{ part: "vn", labelref: "name" }] }];
    const hidden = setInstrumentNameDisplay(custom, "hidden");
    expect(instrumentNameDisplayFor(hidden)).toBe("hidden");
    expect(hidden).toEqual([{ type: "staff", sources: [{ part: "vn" }] }]);
  });

  it("finds every layout used by authored pages and mid-system changes", () => {
    expect(
      instrumentNameDisplayLayoutIds({
        layout: "base",
        pages: [
          {
            systems: [
              { measure: "m1", layout: "first", layoutChanges: [{ layout: "later", location: { measure: "m2" } }] },
            ],
          },
        ],
      }),
    ).toEqual(new Set(["base", "first", "later"]));
  });

  it("applies a policy to every layout used by a score without changing unrelated layouts", () => {
    const layouts = ["base", "first", "later", "other"].map((id) => ({
      id,
      content: structuredClone(content),
    }));
    const updated = setScoreInstrumentNameDisplay(
      layouts,
      {
        layout: "base",
        pages: [
          {
            systems: [
              { measure: "m1", layout: "first", layoutChanges: [{ layout: "later", location: { measure: "m2" } }] },
            ],
          },
        ],
      },
      "hidden",
    );

    expect(updated.slice(0, 3).every((layout) => instrumentNameDisplayFor(layout.content) === "hidden")).toBe(true);
    expect(updated[3]).toBe(layouts[3]);
  });
});
