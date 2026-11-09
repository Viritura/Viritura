import { describe, expect, it } from "vitest";
import type { GradualTempo, Score } from "@viritura/core";
import { parseMnx, parseMnxUnvalidated } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

function score(ramp: GradualTempo): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "m0",
          gradualTempo: ramp,
          systemText: [
            {
              id: "label",
              text: [{ text: "rit." }],
              position: { fraction: [0, 1] },
              placement: "above",
            },
          ],
        },
      ],
    },
    parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
  };
}
const span = {
  position: { fraction: [0, 1] as [number, number] },
  end: { measure: "m0", position: { fraction: [1, 1] as [number, number] } },
};

describe("native tempo ramp persistence", () => {
  it.each(["linear", "early", "late", "smooth"] as const)("round-trips %s curves and ratio targets", (curve) => {
    const ramp: GradualTempo = { ...span, endRatio: 0.8, curve, systemTextId: "label" };
    const restored = parseMnx(serializeMnx(score(ramp)));
    expect(restored.global.measures[0]!.gradualTempo).toEqual(ramp);
    expect(restored.global.measures[0]!.systemText?.[0]?.text).toEqual([{ text: "rit." }]);
  });

  it("preserves legacy absolute ramps without adding a ratio or curve", () => {
    const ramp: GradualTempo = { ...span, endBpm: 60, startBpm: 120, kind: "rit" };
    expect(parseMnx(serializeMnx(score(ramp))).global.measures[0]!.gradualTempo).toEqual(ramp);
  });

  it.each([
    { endRatio: 0 },
    { endRatio: -1 },
    { endBpm: 0 },
    { endRatio: 0.8, endBpm: 90 },
    {},
    { endRatio: 0.8, curve: "unknown" },
  ])("rejects malformed ramp %j even through unvalidated parsing", (target) => {
    const document = serializeMnx(score({ ...span, endBpm: 60 }));
    document.global.measures[0]!._x = { viritura: { gradualTempo: { ...span, ...target } } };
    expect(() => parseMnxUnvalidated(document)).toThrow("Invalid tempo ramp");
    expect(() => parseMnx(document)).toThrow();
  });
});
