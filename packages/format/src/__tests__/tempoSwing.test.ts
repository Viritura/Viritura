import { describe, expect, it } from "vitest";
import { parseMnx, parseMnxUnvalidated } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { validateRawScore } from "../mnx/validator";

function document(measure: object) {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, ...measure }] },
    parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
  };
}

const swing = { mode: "swing", subdivision: "16th", ratio: [3, 2] };

describe("tempo-owned swing persistence", () => {
  it.each([
    { mode: "straight" },
    swing,
    { mode: "swing", subdivision: "eighth", ratio: [2, 1] },
    { mode: "swing", subdivision: "16th", ratio: [300, 201] },
  ])("round-trips an explicit instruction with an independent metronome %j", (instruction) => {
    const source = document({
      tempos: [{ bpm: 90, value: { base: "half", dots: 1 }, _x: { viritura: { swing: instruction } } }],
    });
    const score = parseMnx(source);
    expect(score.global.measures[0].tempos?.[0].swing).toEqual(instruction);
    expect(parseMnx(serializeMnx(score)).global.measures[0].tempos).toEqual(score.global.measures[0].tempos);
  });

  it("preserves ordered BPM-bearing and BPM-free markings without fabricating resets", () => {
    const tempos = [
      { bpm: 90, value: { base: "quarter" }, swing },
      { location: { fraction: [1, 4] }, swing: { mode: "straight" }, text: [{ text: "Straight" }] },
      { location: { fraction: [1, 2] }, swing },
      { location: { fraction: [1, 2] }, bpm: 100, value: { base: "quarter" } },
    ];
    const score = parseMnx(document({ _x: { viritura: { tempos } } }));
    const saved = serializeMnx(score);
    expect(saved).toMatchObject({ global: { measures: [{ _x: { viritura: { tempos } } }] } });
    expect(saved).not.toMatchObject({ global: { measures: [{ tempos: expect.anything() }] } });
    expect(parseMnx(saved).global.measures[0].tempos).toEqual(score.global.measures[0].tempos);
    expect(score.global.measures[0].tempos?.[1].bpm).toBeUndefined();
  });

  it("does not turn omitted instructions or cosmetic prose into a reset or swing", () => {
    const score = parseMnx(
      document({
        tempos: [{ bpm: 90, value: { base: "quarter" }, _x: { viritura: { text: [{ text: "Swung 16ths" }] } } }],
      }),
    );
    expect(score.global.measures[0].tempos?.[0].swing).toBeUndefined();
  });

  it.each([
    null,
    {},
    { mode: "unknown" },
    { mode: "straight", ratio: [2, 1] },
    { ...swing, subdivision: "quarter" },
    { ...swing, ratio: [0, 1] },
    { ...swing, ratio: [-1, 1] },
    { ...swing, ratio: [1.5, 1] },
    { ...swing, ratio: [Infinity, 1] },
    { ...swing, ratio: [NaN, 1] },
    { ...swing, ratio: [1] },
    { ...swing, ratio: [1, 2, 3] },
    { ...swing, ratio: [Number.MAX_SAFE_INTEGER + 1, 1] },
  ])("diagnoses invalid swing on strict and recovery paths %j", (instruction) => {
    const source = document({
      tempos: [{ bpm: 90, value: { base: "quarter" }, _x: { viritura: { swing: instruction } } }],
    });
    expect(validateRawScore(source).ok).toBe(false);
    expect(() => parseMnx(source)).toThrow();
    expect(() => parseMnxUnvalidated(source)).toThrow(/tempo/i);
  });

  it.each(
    [
      [],
      [{}],
      [{ bpm: 90, swing }],
      [{ value: { base: "quarter" }, swing }],
      [{ swing, bpm: 0, value: { base: "quarter" } }],
      [{ swing, location: { fraction: [0, 0] } }],
    ].map((tempos) => ({ tempos })),
  )("rejects incomplete vendor tempo instructions %j", ({ tempos }) => {
    const source = document({ _x: { viritura: { tempos } } });
    expect(() => parseMnx(source)).toThrow();
    expect(() => parseMnxUnvalidated(source)).toThrow(/tempo/i);
  });

  it("rejects two competing tempo collections explicitly", () => {
    const source = document({
      tempos: [{ bpm: 90, value: { base: "quarter" } }],
      _x: { viritura: { tempos: [{ swing }] } },
    });
    expect(() => parseMnx(source)).toThrow(/coexist/);
    expect(() => parseMnxUnvalidated(source)).toThrow(/coexist/);
  });
});
