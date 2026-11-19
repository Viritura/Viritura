import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

function document(partMeasure: Record<string, unknown>) {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [{ id: "p1", measures: [{ sequences: [{ content: [] }], ...partMeasure }] }],
  };
}

describe("native part-measure positioned text", () => {
  it("round-trips native text, expression type, and Viritura chunk/item extensions", () => {
    const text = [
      {
        id: "direction-1",
        type: "expression",
        text: [{ text: "dolce", _x: { viritura: { style: { fontStyle: "italic" } } } }],
        position: { fraction: [1, 4] },
        _x: { viritura: { manualOffset: [1, -0.5], avoidCollisions: false } },
      },
    ];
    const score = parseMnx(document({ text }));
    expect(score.parts[0]?.measures[0]?.expressions?.[0]).toMatchObject({
      id: "direction-1",
      type: "expression",
      text: [{ text: "dolce", style: { fontStyle: "italic" } }],
      manualOffset: [1, -0.5],
      avoidCollisions: false,
    });

    const serialized = serializeMnx(score) as {
      parts: { measures: { text?: unknown[]; _x?: { viritura?: Record<string, unknown> } }[] }[];
    };
    expect(serialized.parts[0]?.measures[0]?.text).toEqual(text);
    expect(serialized.parts[0]?.measures[0]?._x?.viritura?.["expressions"]).toBeUndefined();
  });

  it("round-trips separate text and SMuFL styles on a native glyph chunk", () => {
    const text = [
      {
        type: "expression",
        text: [
          {
            type: "smufl",
            glyphs: ["dynamicPiano"],
            _x: { viritura: { style: { weight: "bold" }, smuflStyle: { color: "#ff0000" } } },
          },
        ],
        position: { fraction: [0, 1] },
      },
    ];
    const score = parseMnx(document({ text }));
    expect(score.parts[0]?.measures[0]?.expressions?.[0]?.text).toEqual([
      { glyphs: ["dynamicPiano"], style: { weight: "bold" }, smuflStyle: { color: "#ff0000" } },
    ]);

    const serialized = serializeMnx(score) as { parts: { measures: { text?: unknown[] }[] }[] };
    expect(serialized.parts[0]?.measures[0]?.text).toEqual(text);
    expect(parseMnx(serialized).parts[0]?.measures[0]?.expressions?.[0]?.text).toEqual(
      score.parts[0]?.measures[0]?.expressions?.[0]?.text,
    );
  });

  it("repairs vendor-shaped chunks written into native positioned text", () => {
    // Earlier MusicXML conversions wrote chunk-level `style` and untyped glyph
    // runs into native `text`, which the MNX schema rejects.
    const text = [
      {
        type: "expression",
        text: [
          { text: "rit.", style: { fontStyle: "italic" } },
          { glyphs: ["dynamicPiano"], smuflStyle: { color: "#ff0000" } },
        ],
        position: { fraction: [0, 1] },
      },
    ];
    const score = parseMnx(document({ text }));
    expect(score.parts[0]?.measures[0]?.expressions?.[0]?.text).toEqual([
      { text: "rit.", style: { fontStyle: "italic" } },
      { glyphs: ["dynamicPiano"], smuflStyle: { color: "#ff0000" } },
    ]);

    const serialized = serializeMnx(score) as { parts: { measures: { text?: { text: unknown }[] }[] }[] };
    expect(serialized.parts[0]?.measures[0]?.text?.[0]?.text).toEqual([
      { text: "rit.", _x: { viritura: { style: { fontStyle: "italic" } } } },
      { type: "smufl", glyphs: ["dynamicPiano"], _x: { viritura: { smuflStyle: { color: "#ff0000" } } } },
    ]);
  });

  it("rejects the retired Viritura expressions extension", () => {
    const legacy = { text: [{ text: "dolce" }], position: { fraction: [1, 4] } };
    expect(() => parseMnx(document({ _x: { viritura: { expressions: [legacy] } } }))).toThrow();
  });
});
