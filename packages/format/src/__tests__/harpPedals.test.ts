import { describe, expect, it } from "vitest";
import type { HarpPedalSetting } from "@viritura/core";
import { DeltaSerializer, parseMnx, serializeMnx } from "../mnx";

const setting: HarpPedalSetting = {
  id: "harp-1",
  position: { fraction: [1, 2] },
  tuning: { D: -1, C: 0, B: -1, E: -1, F: 0, G: 0, A: -1 },
  source: "calculated",
  staff: 2,
};

function document(settings: unknown[] = [setting]) {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        staves: 2,
        measures: [
          {
            sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
            _x: { viritura: { harpPedals: settings } },
          },
        ],
      },
    ],
  };
}

describe("harp pedal snapshots", () => {
  it("round-trips full tuning, source, position and presentation staff without mutating input", () => {
    const input = document();
    const score = parseMnx(input);
    const parsed = score.parts[0]!.measures[0]!.harpPedals![0]!;
    expect(parsed).toEqual(setting);
    expect(parsed.tuning).not.toBe(setting.tuning);
    expect(parsed.position.fraction).not.toBe(setting.position.fraction);
    expect(parseMnx(serializeMnx(score))).toEqual(score);
    expect(score.parts[0]!.measures[0]!.pedals).toBeUndefined();
  });

  it("preserves omitted source and staff rather than manufacturing defaults", () => {
    const { source: _source, staff: _staff, ...manual } = setting;
    const score = parseMnx(document([manual]));
    expect(score.parts[0]!.measures[0]!.harpPedals).toEqual([manual]);
    expect(parseMnx(serializeMnx(score))).toEqual(score);
  });

  it("keeps pedal edits in full and incremental MNX and WASM patches", () => {
    const score = parseMnx(document());
    const delta = new DeltaSerializer();
    delta.serialize(score);
    const updated = structuredClone(score);
    updated.parts[0]!.measures[0]!.harpPedals![0]!.tuning = { ...setting.tuning, E: 0 };
    const result = delta.serialize(updated);
    expect(JSON.parse(result.json)).toEqual(serializeMnx(updated));
    const patch = JSON.parse(delta.buildPatch(result.changedGlobalMeasures, result.changedPartMeasures));
    expect(patch.partMeasures["0"]["0"]._x.viritura.harpPedals[0].tuning.E).toBe(0);
  });

  it.each([
    { ...setting, tuning: { ...setting.tuning, C: 2 } },
    { ...setting, tuning: { C: 0 } },
    { ...setting, position: { fraction: [1, 0] } },
    { ...setting, position: { fraction: [-1, 2] } },
    { ...setting, position: { fraction: [1, 2], graceIndex: 0 } },
    { ...setting, source: "imported" },
    { ...setting, staff: 3 },
    { ...setting, id: "" },
  ])("rejects malformed or incomplete settings: %j", (invalid) => {
    expect(() => parseMnx(document([invalid]))).toThrow();
  });

  it("rejects equivalent positions and reused IDs, including across part measures", () => {
    expect(() =>
      parseMnx(document([setting, { ...setting, id: "another", position: { fraction: [2, 4] } }])),
    ).toThrow();
    expect(() => parseMnx(document([setting, { ...setting, position: { fraction: [0, 1] } }]))).toThrow();
    const input = document();
    input.global.measures.push(input.global.measures[0]!);
    input.parts[0]!.measures.push(input.parts[0]!.measures[0]!);
    expect(() => parseMnx(input)).toThrow();
  });
});
