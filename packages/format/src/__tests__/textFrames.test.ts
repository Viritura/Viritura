import { describe, expect, it } from "vitest";
import { parseMnx, parseMnxUnvalidated } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { validateRawScore } from "../mnx/validator";

function documentWithFrames(textFrames: unknown) {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: "global-measure-1", time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        id: "part-1",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    scores: [{ name: "Full score", _x: { viritura: { textFrames } } }],
  };
}

describe("score text frames", () => {
  const frames = [
    {
      id: "page-title",
      locator: { type: "page", pageIndex: 0 },
      placement: { anchor: "top-left", offset: { x: 1.5, y: -2 } },
      width: { unit: "textColumnFraction", value: 0.75 },
      content: [{ text: "Title line\nSubtitle line", style: { weight: "bold" } }],
      horizontalAlignment: "center",
      paragraphJustification: "justify",
      padding: 0.5,
      border: "solid",
      sourceReference: { unit: "EVPU", referenceStaffSize: 96 },
    },
    {
      id: "measure-note",
      locator: { type: "globalMeasure", measureId: "global-measure-1" },
      placement: { anchor: "bottom-right", offset: { x: -1, y: 2 } },
      width: { unit: "staffSpaces", value: 24 },
      content: [{ text: "Measure-specific prose" }],
    },
    {
      id: "event-note",
      locator: { type: "event", partId: "part-1", eventId: "event-1" },
      placement: { anchor: "right", offset: { x: 0, y: 0 } },
      width: { unit: "staffSpaces", value: 12 },
      content: [{ text: "Event-specific prose" }],
      horizontalAlignment: "right",
      paragraphJustification: "left",
      border: "none",
    },
  ];

  it("round-trips each locator, geometry, content, and presentation through the score extension", () => {
    const score = parseMnx(documentWithFrames(frames));
    expect(score.scores?.[0]?.textFrames).toEqual(frames);

    const serialized = serializeMnx(score) as {
      scores: { _x: { viritura: { textFrames: unknown } } }[];
    };
    expect(serialized.scores[0]?._x.viritura.textFrames).toEqual(frames);
  });

  it("rejects ambiguous locators and unsupported width shapes in validated input", () => {
    const ambiguous = {
      id: "ambiguous",
      locator: { type: "page", pageIndex: 0, measureId: "global-measure-1" },
      placement: { anchor: "top", offset: { x: 0, y: 0 } },
      width: { unit: "staffSpaces", value: 10 },
      content: [{ text: "Text" }],
    };
    expect(() => parseMnx(documentWithFrames([ambiguous]))).toThrow();

    const ambiguousWidth = {
      ...frames[0],
      width: { unit: "textColumnFraction", value: 1.2 },
    };
    expect(() => parseMnx(documentWithFrames([ambiguousWidth]))).toThrow();
  });

  it.each([
    ["non-array", { id: "bad" }],
    ["missing part scope", [{ ...frames[0], locator: { type: "event", eventId: "event-1" } }]],
    ["negative page", [{ ...frames[0], locator: { type: "page", pageIndex: -1 } }]],
    ["ambiguous locator", [{ ...frames[0], locator: { type: "page", pageIndex: 0, measureId: "m1" } }]],
    ["unknown anchor", [{ ...frames[0], placement: { anchor: "center", offset: { x: 0, y: 0 } } }]],
    ["unknown width", [{ ...frames[0], width: { unit: "points", value: 12 } }]],
    ["out-of-range fraction", [{ ...frames[0], width: { unit: "textColumnFraction", value: 1.2 } }]],
    ["negative padding", [{ ...frames[0], padding: -1 }]],
    ["non-finite offset", [{ ...frames[0], placement: { anchor: "top", offset: { x: Infinity, y: 0 } } }]],
    ["unknown field", [{ ...frames[0], height: 12 }]],
    ["malformed content", [{ ...frames[0], content: [{ invalid: "text" }] }]],
  ])("rejects %s on validated and unvalidated paths", (_case, invalid) => {
    expect(() => parseMnx(documentWithFrames(invalid))).toThrow();
    expect(() => parseMnxUnvalidated(documentWithFrames(invalid))).toThrow(/textFrames/);
  });

  it("rejects duplicate IDs within one score view, but permits reuse in another", () => {
    const duplicate = documentWithFrames([frames[0], { ...frames[1], id: frames[0]!.id }]);
    expect(validateRawScore(duplicate)).toMatchObject({
      ok: false,
      errors: [{ pointer: "/scores/0/_x/viritura/textFrames/1/id", keyword: "uniqueTextFrameId" }],
    });
    expect(() => parseMnx(duplicate)).toThrow(/duplicate text frame id/);
    expect(() => parseMnxUnvalidated(duplicate)).toThrow(/duplicate id/);

    const document = documentWithFrames([frames[0]]);
    document.scores.push({ name: "Part score", _x: { viritura: { textFrames: [frames[0]] } } });
    expect(parseMnx(document).scores?.map((score) => score.textFrames?.[0]?.id)).toEqual([
      frames[0]!.id,
      frames[0]!.id,
    ]);
  });

  it("round-trips empty content and an explicit empty frame collection", () => {
    const emptyContent = { ...frames[0], content: [] };
    expect(parseMnx(documentWithFrames([emptyContent])).scores?.[0]?.textFrames?.[0]?.content).toEqual([]);
    const empty = parseMnx(documentWithFrames([]));
    expect(empty.scores?.[0]?.textFrames).toEqual([]);
    const output = serializeMnx(empty) as { scores: { _x: { viritura: { textFrames: unknown[] } } }[] };
    expect(output.scores[0]?._x.viritura.textFrames).toEqual([]);
  });
});
