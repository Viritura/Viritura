import { describe, expect, it } from "vitest";
import { isHarpInstrumentAt, resolveHarpPedalState, type HarpPedalSetting, type Part } from "../index";

const tuning = { D: 0, C: 0, B: 0, E: 0, F: 0, G: 0, A: 0 } as const;
const setting = (id: string, fraction: [number, number]): HarpPedalSetting => ({
  id,
  position: { fraction },
  tuning,
});

function harp(): Part {
  return {
    name: "Player",
    staves: 2,
    _x: { viritura: { instrumentId: "pluck.harp" } },
    measures: Array.from({ length: 3 }, () => ({ sequences: [] })),
  };
}

describe("harp pedal state", () => {
  it("is unknown before the first snapshot and takes effect at its exact position across bars", () => {
    const part = harp();
    const first = setting("first", [1, 2]);
    const later = setting("later", [3, 4]);
    part.measures[0]!.harpPedals = [later, first];
    expect(resolveHarpPedalState(part, 0, [1, 4])).toBeUndefined();
    expect(resolveHarpPedalState(part, 0, [4, 8])).toBe(first);
    expect(resolveHarpPedalState(part, 1, [0, 1])).toBe(later);
  });

  it("compares large valid fractions exactly", () => {
    const part = harp();
    const later = setting("later", [4_294_967_294, 4_294_967_295]);
    part.measures[0]!.harpPedals = [later];
    expect(resolveHarpPedalState(part, 0, [4_294_967_293, 4_294_967_294])).toBeUndefined();
    expect(resolveHarpPedalState(part, 0, later.position.fraction)).toBe(later);
  });

  it("clears inherited pedals when the player leaves and re-enters harp", () => {
    const part = harp();
    part._x!.viritura = {
      instrumentId: "pluck.harp",
      initialInstrument: "harp",
      instruments: {
        harp: { instrumentId: "pluck.harp" },
        flute: { instrumentId: "wind.flutes.flute" },
      },
    };
    part.measures[0]!.harpPedals = [setting("initial", [0, 1])];
    part.measures[0]!.instrumentChanges = [{ instrument: "flute", position: { fraction: [1, 2] } }];
    part.measures[1]!.instrumentChanges = [
      { instrument: "harp", position: { fraction: [1, 4] } },
      { transposition: { interval: { halfSteps: 0, staffDistance: 0 } }, position: { fraction: [1, 2] } },
    ];
    expect(isHarpInstrumentAt(part, 0, [1, 2])).toBe(false);
    expect(resolveHarpPedalState(part, 0, [1, 2])).toBeUndefined();
    expect(isHarpInstrumentAt(part, 1, [1, 4])).toBe(true);
    expect(resolveHarpPedalState(part, 1, [1, 4])).toBeUndefined();
    const resumed = setting("resumed", [1, 4]);
    part.measures[1]!.harpPedals = [resumed];
    expect(resolveHarpPedalState(part, 1, [1, 2])).toBe(resumed);
  });

  it("uses semantic identity, not a part name, and does not fall back for an unresolved instrument key", () => {
    const part = harp();
    part.name = "Harp";
    part._x!.viritura!.instrumentId = "wind.flutes.flute";
    expect(isHarpInstrumentAt(part, 0)).toBe(false);
    part._x!.viritura!.instrumentId = "pluck.harp";
    part._x!.viritura!.initialInstrument = "missing";
    expect(isHarpInstrumentAt(part, 0)).toBe(false);
  });
});
