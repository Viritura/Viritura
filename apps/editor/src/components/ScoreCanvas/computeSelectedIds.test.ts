import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { computeSelectedIds } from "./computeSelectedIds";

describe("computeSelectedIds", () => {
  it("highlights intermediate measure repeats in a Shift-click range", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}, {}, {}] },
      parts: [
        {
          name: "Harp",
          measures: Array.from({ length: 3 }, () => ({
            sequences: [{ content: [] }],
            measureRepeat: { number: 1 },
          })),
        },
      ],
    };

    const ids = computeSelectedIds(
      {
        kind: "range",
        startElementId: "p0/m0/measurerepeat",
        endElementId: "p0/m2/measurerepeat",
      },
      null,
      score,
    );

    expect([...ids]).toEqual(["p0/m0/measurerepeat", "p0/m1/measurerepeat", "p0/m2/measurerepeat"]);
  });
});
