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
  it.each([0, 1, 2, 3, 4, 5])("round-trips click subdivision %i on standard and vendor tempos", (clickSubdivision) => {
    for (const measure of [
      { tempos: [{ bpm: 90, value: { base: "quarter" }, _x: { viritura: { clickSubdivision } } }] },
      { _x: { viritura: { tempos: [{ text: [{ text: "Subdivide" }], clickSubdivision }] } } },
    ]) {
      const score = parseMnx(document(measure));
      expect(score.global.measures[0].tempos?.[0].clickSubdivision).toBe(clickSubdivision);
      expect(parseMnx(serializeMnx(score)).global.measures[0].tempos).toEqual(score.global.measures[0].tempos);
    }
  });

  it.each([0, 3])("round-trips a click-only system instruction (%i) without inventing BPM", (clickSubdivision) => {
    const systemText = [
      {
        id: "click",
        text: [{ text: "Click triplets" }],
        position: { fraction: [1, 8] },
        tempo: { clickSubdivision },
      },
    ];
    const score = parseMnx(document({ _x: { viritura: { systemText } } }));
    expect(score.global.measures[0].systemText?.[0].tempo).toEqual({ clickSubdivision });
    expect(parseMnx(serializeMnx(score)).global.measures[0].systemText).toEqual(score.global.measures[0].systemText);
  });

  it.each([-1, 6, 1.5, null, "2", Infinity])(
    "rejects invalid click subdivision %j on strict and recovery paths",
    (clickSubdivision) => {
      for (const measure of [
        { tempos: [{ bpm: 90, value: { base: "quarter" }, _x: { viritura: { clickSubdivision } } }] },
        { _x: { viritura: { tempos: [{ bpm: 90, value: { base: "quarter" }, clickSubdivision }] } } },
        {
          _x: {
            viritura: {
              systemText: [
                { id: "click", text: [{ text: "Click" }], position: { fraction: [0, 1] }, tempo: { clickSubdivision } },
              ],
            },
          },
        },
      ]) {
        const source = document(measure);
        expect(validateRawScore(source).ok).toBe(false);
        expect(() => parseMnx(source)).toThrow();
        expect(() => parseMnxUnvalidated(source)).toThrow();
      }
    },
  );

  it("round-trips uneven click grouping on standard, vendor, and click-only system instructions", () => {
    const settings = { clickSubdivision: 2, clickGrouping: [3, 3, 2, 2, 2] };
    for (const measure of [
      { tempos: [{ bpm: 85, value: { base: "quarter" }, _x: { viritura: settings } }] },
      { _x: { viritura: { tempos: [{ text: [{ text: "2+3" }], ...settings }] } } },
      {
        _x: {
          viritura: {
            systemText: [{ id: "group", text: [{ text: "2+3" }], position: { fraction: [0, 1] }, tempo: settings }],
          },
        },
      },
    ]) {
      const score = parseMnx(document({ time: { count: 6, unit: 8 }, ...measure }));
      expect(parseMnx(serializeMnx(score)).global.measures).toEqual(score.global.measures);
    }
  });

  it.each([
    { clickGrouping: [3, 3, 2, 2, 2] },
    { clickSubdivision: 0, clickGrouping: [3, 3, 2, 2, 2] },
    { clickSubdivision: 2, clickGrouping: [3, 3, 2, 2] },
    { clickSubdivision: 2, clickGrouping: [] },
    { clickSubdivision: 2, clickGrouping: [0, 12] },
    { clickSubdivision: 2, clickGrouping: [3.5, 8.5] },
  ])("rejects invalid grouping on strict and recovery paths %j", (settings) => {
    for (const measure of [
      { tempos: [{ bpm: 85, value: { base: "quarter" }, _x: { viritura: settings } }] },
      { _x: { viritura: { tempos: [{ text: [{ text: "Group" }], ...settings }] } } },
      {
        _x: {
          viritura: {
            systemText: [{ id: "group", text: [{ text: "Group" }], position: { fraction: [0, 1] }, tempo: settings }],
          },
        },
      },
    ]) {
      const source = document({ time: { count: 6, unit: 8 }, ...measure });
      expect(validateRawScore(source).ok).toBe(false);
      expect(() => parseMnx(source)).toThrow();
      expect(() => parseMnxUnvalidated(source)).toThrow();
    }
  });

  it("diagnoses a grouping carried into an incompatible meter unless reset at its start", () => {
    const source = document({
      time: { count: 6, unit: 8 },
      tempos: [
        {
          bpm: 85,
          value: { base: "quarter" },
          _x: { viritura: { clickSubdivision: 2, clickGrouping: [3, 3, 2, 2, 2] } },
        },
      ],
    });
    source.global.measures.push({ time: { count: 5, unit: 8 } });
    expect(validateRawScore(source).ok).toBe(false);
    expect(() => parseMnxUnvalidated(source)).toThrow(/sum to 10/);
    source.global.measures[1] = {
      time: { count: 5, unit: 8 },
      tempos: [{ bpm: 85, value: { base: "quarter" } }],
    };
    expect(validateRawScore(source).ok).toBe(true);
  });

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
