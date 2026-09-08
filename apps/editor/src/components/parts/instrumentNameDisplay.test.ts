import { describe, expect, it } from "vitest";
import type { LayoutContent } from "@viritura/core";
import {
  instrumentNameDisplayFor,
  instrumentNameDisplayLayoutIds,
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
    expect(instrumentNameDisplayFor(content, {})).toEqual({
      firstSystem: "full",
      subsequentSystems: "short",
    });
  });

  it("writes canonical standard-MNX references without mutating the source layout", () => {
    const original = structuredClone(content);
    const updated = setScoreInstrumentNameDisplay([{ id: "base", content }], [{ layout: "base" }], 0, {
      firstSystem: "short",
      subsequentSystems: "short",
    });
    expect(instrumentNameDisplayFor(updated.layouts[0]!.content, updated.scores[0]!)).toEqual({
      firstSystem: "short",
      subsequentSystems: "short",
    });
    expect(updated.layouts[0]!.content[0]).toMatchObject({
      content: [
        { labelref: "shortName", sources: [{ part: "fl" }] },
        { labelref: "shortName", sources: [{ part: "ob" }] },
      ],
    });
    expect(content).toEqual(original);
  });

  it("removes literal and referenced labels for the standard hidden policy", () => {
    const custom: LayoutContent[] = [{ type: "staff", label: "Solo", sources: [{ part: "vn", labelref: "name" }] }];
    const updated = setScoreInstrumentNameDisplay([{ id: "base", content: custom }], [{ layout: "base" }], 0, {
      firstSystem: "hidden",
      subsequentSystems: "hidden",
    });
    expect(updated.scores[0]!.instrumentNameDisplay).toBeUndefined();
    expect(updated.layouts[0]!.content).toEqual([{ type: "staff", sources: [{ part: "vn" }] }]);
  });

  it("treats group labels as custom and removes them when applying a policy", () => {
    const labelledGroup: LayoutContent[] = [
      {
        type: "group",
        symbol: "brace",
        label: "Piano",
        content: [{ type: "staff", sources: [{ part: "pno", labelref: "name" }] }],
      },
    ];
    expect(instrumentNameDisplayFor(labelledGroup, {})).toEqual({
      firstSystem: "custom",
      subsequentSystems: "custom",
    });

    const updated = setScoreInstrumentNameDisplay([{ id: "base", content: labelledGroup }], [{ layout: "base" }], 0, {
      firstSystem: "hidden",
      subsequentSystems: "hidden",
    });
    expect(updated.layouts[0]!.content[0]).not.toHaveProperty("label");
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
      [
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
      ],
      0,
      { firstSystem: "hidden", subsequentSystems: "full" },
    );

    expect(updated.scores[0]!.instrumentNameDisplay).toEqual({
      firstSystem: "hidden",
      subsequentSystems: "full",
    });
    expect(updated.layouts.slice(0, 3).every((layout) => layout.content[0])).toBe(true);
    expect(updated.layouts[3]).toBe(layouts[3]);
  });

  it("clones and repoints layouts shared with another score", () => {
    const layouts = [{ id: "shared", content: structuredClone(content) }];
    const scores = [
      { name: "Score", layout: "shared" },
      { name: "Part", layout: "shared" },
    ];

    const updated = setScoreInstrumentNameDisplay(layouts, scores, 0, {
      firstSystem: "hidden",
      subsequentSystems: "hidden",
    });

    expect(updated.layouts).toHaveLength(2);
    expect(updated.scores[0]!.layout).not.toBe("shared");
    expect(updated.scores[1]!.layout).toBe("shared");
    expect(updated.layouts.find((layout) => layout.id === "shared")!.content).toEqual(content);
    expect(updated.layouts.find((layout) => layout.id === updated.scores[0]!.layout)!.content).toEqual([
      {
        type: "group",
        content: [
          { type: "staff", sources: [{ part: "fl" }] },
          { type: "staff", sources: [{ part: "ob" }] },
        ],
      },
    ]);
  });
});
