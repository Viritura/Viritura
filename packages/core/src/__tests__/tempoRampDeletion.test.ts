import { describe, expect, it } from "vitest";
import { applyPatchesToScore, deleteMeasure, patch, removeGlobalMeasures, type Score } from "../index";

function source(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "m0",
          gradualTempo: {
            position: { fraction: [0, 1] },
            end: { measure: "m1", position: { fraction: [1, 1] } },
            endRatio: 0.8,
            systemTextId: "ramp",
          },
          systemText: [
            { id: "ramp", position: { fraction: [0, 1] }, text: [{ text: "rit." }] },
            { id: "other", position: { fraction: [0, 1] }, text: [{ text: "espressivo" }] },
          ],
        },
        { id: "m1" },
        { id: "m2" },
      ],
    },
    parts: [{ name: "Piano", measures: [0, 1, 2].map(() => ({ sequences: [{ content: [] }] })) }],
  };
}

describe("measure deletion maintains native tempo ramp references", () => {
  it.each([
    ["core operation", (score: Score) => deleteMeasure(score, 1)],
    ["structural patch", (score: Score) => applyPatchesToScore(score, [patch.removeMeasures(1, 1)])],
  ] as const)("removes an invalidated ramp and only its owned label through the %s", (_, remove) => {
    const before = source();
    const after = remove(before);
    expect(after.global.measures.map((measure) => measure.id)).toEqual(["m0", "m2"]);
    expect(after.global.measures[0]!.gradualTempo).toBeUndefined();
    expect(after.global.measures[0]!.systemText?.map((text) => text.id)).toEqual(["other"]);
    expect(after.parts[0]!.measures).toHaveLength(2);
    expect(before.global.measures[0]!.gradualTempo?.end.measure).toBe("m1");
    expect(before.global.measures[0]!.systemText).toHaveLength(2);
  });

  it("preserves stable-ID spans when removing bars inside them", () => {
    const score = source();
    score.global.measures[0]!.gradualTempo!.end.measure = "m2";
    const after = deleteMeasure(score, 1);
    expect(after.global.measures[0]!.gradualTempo).toEqual(score.global.measures[0]!.gradualTempo);
    expect(after.global.measures[0]!.systemText).toHaveLength(2);
  });

  it("removes the empty text collection when the deleted ramp owns its only label", () => {
    const score = source();
    score.global.measures[0]!.systemText!.pop();
    expect(deleteMeasure(score, 1).global.measures[0]!.systemText).toBeUndefined();
  });

  it("updates surviving legacy numeric endpoints and removes deleted numeric endpoints", () => {
    const score = source();
    score.global.measures[0]!.gradualTempo!.end.measure = "2";
    const shifted = removeGlobalMeasures(score.global.measures, 1, 1);
    expect(shifted[0]!.gradualTempo?.end.measure).toBe("1");
    score.global.measures[0]!.gradualTempo!.end.measure = "1";
    expect(removeGlobalMeasures(score.global.measures, 1, 1)[0]!.gradualTempo).toBeUndefined();
  });

  it("treats a numeric-looking stable ID as an ID rather than an index", () => {
    const score = source();
    score.global.measures[2]!.id = "1";
    score.global.measures[0]!.gradualTempo!.end.measure = "1";
    const after = deleteMeasure(score, 1);
    expect(after.global.measures[0]!.gradualTempo?.end.measure).toBe("1");
  });

  it("removes a whole range of endpoint bars without altering unaffected measures", () => {
    const score = source();
    const after = removeGlobalMeasures(score.global.measures, 0, 2);
    expect(after).toEqual([{ id: "m2" }]);
    expect(after[0]).toBe(score.global.measures[2]);
  });
});
