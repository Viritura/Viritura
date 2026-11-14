import { describe, expect, it } from "vitest";
import { parseMnx, parseMnxUnvalidated } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

function document(systemText: unknown) {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          _x: { viritura: { ...(systemText === undefined ? {} : { systemText }) } },
        },
      ],
    },
    parts: [
      {
        id: "p1",
        measures: [
          {
            sequences: [{ content: [] }],
            _x: { viritura: { expressions: [{ text: "Staff only", position: { fraction: [0, 1] }, staff: 1 }] } },
          },
        ],
      },
      { id: "p2", measures: [{ sequences: [{ content: [] }] }] },
    ],
  };
}

const TEXT = {
  id: "system-1",
  text: [{ text: "Together\nThen freely", style: { fontStyle: "italic" } }, { glyphs: ["dynamicPiano"] }],
  position: { fraction: [1, 4] },
  placement: "above",
  manualOffset: [2, -1],
  avoidCollisions: false,
};

describe("shared system-text persistence", () => {
  it.each([
    { bpm: 84.5, value: { base: "quarter", dots: 1 }, showMetronomeMark: false },
    { swing: { mode: "swing", subdivision: "eighth", ratio: [2, 1] } },
    { bpm: 72, value: { base: "half" }, swing: { mode: "straight" } },
  ])("round-trips optional playback without changing music attachment %j", (tempo) => {
    const source = { ...TEXT, tempo, showText: false, frame: { border: "solid", padding: 1 } };
    const restored = parseMnx(serializeMnx(parseMnx(document([source]))));
    expect(restored.global.measures[0].systemText).toEqual([source]);
    expect(restored.global.measures[0].tempos).toBeUndefined();
    expect(restored.parts[0].measures[0].expressions).toHaveLength(1);
  });

  it("supports a metronome-only instruction without placeholder printed text", () => {
    const source = { ...TEXT, text: [{ text: "" }], tempo: { bpm: 96, value: { base: "quarter" } } };
    expect(parseMnx(serializeMnx(parseMnx(document([source])))).global.measures[0].systemText).toEqual([source]);
  });

  it.each([
    undefined,
    {},
    { width: { unit: "staffSpaces", value: 16 }, padding: 0.5, border: "solid", eraseBackground: true },
    { horizontalAlignment: "center", paragraphJustification: "justify", width: { unit: "staffSpaces", value: 20 } },
  ])("preserves global ownership and optional shared presentation %j", (frame) => {
    const source = { ...TEXT, ...(frame === undefined ? {} : { frame }) };
    const score = parseMnx(document([source]));
    expect(score.global.measures[0].systemText).toEqual([source]);
    const restored = parseMnx(serializeMnx(score));
    expect(restored.global.measures[0].systemText).toEqual([source]);
    expect(restored.parts[0].measures[0].expressions).toHaveLength(1);
    expect(restored.parts[1].measures[0].expressions).toBeUndefined();
  });

  it("does not invent system scope on legacy staff/page text", () => {
    const score = parseMnx(document(undefined));
    expect(score.global.measures[0].systemText).toBeUndefined();
    expect(score.parts[0].measures[0].expressions?.[0].text).toEqual([{ text: "Staff only" }]);
  });

  it.each([
    null,
    {},
    [{ ...TEXT, id: "" }],
    [{ ...TEXT, staff: 1 }],
    [{ ...TEXT, voice: "v1" }],
    [{ ...TEXT, locator: { type: "page", pageIndex: 0 } }],
    [{ ...TEXT, position: { fraction: [0, 0] } }],
    [{ ...TEXT, position: { fraction: [Infinity, 1] } }],
    [{ ...TEXT, manualOffset: [NaN, 0] }],
    [{ ...TEXT, manualOffset: [1] }],
    [{ ...TEXT, text: [] }],
    [{ ...TEXT, tempo: {} }],
    [{ ...TEXT, tempo: { bpm: 0, value: { base: "quarter" } } }],
    [{ ...TEXT, tempo: { bpm: Infinity, value: { base: "quarter" } } }],
    [{ ...TEXT, tempo: { bpm: NaN, value: { base: "quarter" } } }],
    [{ ...TEXT, tempo: { bpm: 100 } }],
    [{ ...TEXT, tempo: { value: { base: "quarter" }, swing: { mode: "straight" } } }],
    [{ ...TEXT, tempo: { swing: { mode: "straight" }, showMetronomeMark: false } }],
    [{ ...TEXT, frame: { width: { unit: "textColumnFraction", value: 0.5 } } }],
    [{ ...TEXT, frame: { padding: -1 } }],
    [{ ...TEXT, frame: { width: { unit: "staffSpaces", value: Infinity } } }],
    [TEXT, TEXT],
  ])("rejects malformed system text on validated and recovery paths %j", (texts) => {
    expect(() => parseMnx(document(texts))).toThrow();
    expect(() => parseMnxUnvalidated(document(texts))).toThrow(/systemText/);
  });
});
