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
    [{ ...TEXT, frame: { width: { unit: "textColumnFraction", value: 0.5 } } }],
    [{ ...TEXT, frame: { padding: -1 } }],
    [{ ...TEXT, frame: { width: { unit: "staffSpaces", value: Infinity } } }],
    [TEXT, TEXT],
  ])("rejects malformed system text on validated and recovery paths %j", (texts) => {
    expect(() => parseMnx(document(texts))).toThrow();
    expect(() => parseMnxUnvalidated(document(texts))).toThrow(/systemText/);
  });
});
