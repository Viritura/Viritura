import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { dynamicStaffAtLocation } from "../commands/dynamicStaff";
import { addDynamicExpression } from "../radialMenu/radialMenuActions";

function grandStaffScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Piano",
        staves: 2,
        measures: [
          {
            sequences: [
              {
                staff: 1,
                content: [
                  {
                    type: "event",
                    id: "top",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 5 } }],
                  },
                ],
              },
              {
                staff: 2,
                content: [
                  {
                    type: "event",
                    id: "bottom",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 3 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("dynamicStaffAtLocation", () => {
  it("uses the selected sequence staff on a multi-staff part", () => {
    const score = grandStaffScore();
    expect(
      dynamicStaffAtLocation(score, {
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 1,
        eventIndex: 0,
      }),
    ).toBe(2);
  });

  it("honors an event cross-staff override", () => {
    const score = grandStaffScore();
    const event = score.parts[0]!.measures[0]!.sequences[1]!.content[0]!;
    if (event.type === "event") event.staff = 1;
    expect(
      dynamicStaffAtLocation(score, {
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 1,
        eventIndex: 0,
      }),
    ).toBe(1);
  });

  it("keeps staff absent on a single-staff part", () => {
    const score = grandStaffScore();
    score.parts[0]!.staves = 1;
    expect(
      dynamicStaffAtLocation(score, {
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
      }),
    ).toBeUndefined();
  });
});

describe("hairpin insertion on a grand staff", () => {
  it("creates one hairpin scoped only to the selected staff", () => {
    const score = grandStaffScore();
    const result = addDynamicExpression(score, { kind: "single", elementId: "p0/m0/s1/bottom" }, [
      { type: "crescendo" },
    ]);

    const hairpins = result!.parts[0]!.measures[0]!.dynamics?.filter((group) => group.type === "gradual");
    expect(hairpins).toHaveLength(1);
    expect(hairpins![0]!.staff).toBe(2);
    expect(hairpins![0]!.staffEnd).toBeUndefined();
  });
});
