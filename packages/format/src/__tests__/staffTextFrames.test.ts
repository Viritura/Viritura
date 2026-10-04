import { describe, expect, it } from "vitest";
import { parseMnx, parseMnxUnvalidated } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";

function document(frame?: unknown) {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "P1",
        measures: [
          {
            sequences: [{ content: [] }],
            _x: {
              viritura: {
                expressions: [
                  {
                    text: [{ text: "Play freely\nThen resume", style: { weight: "bold" } }],
                    position: { fraction: [1, 4] },
                    placement: "above",
                    staff: 1,
                    manualOffset: [2, -1],
                    avoidCollisions: false,
                    ...(frame === undefined ? {} : { frame }),
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  };
}

describe("staff text frame presentation", () => {
  it.each([
    {},
    { padding: 0.5, border: "solid" },
    {
      width: { unit: "staffSpaces", value: 18 },
      padding: 1,
      horizontalAlignment: "center",
      paragraphJustification: "justify",
      border: "solid",
    },
  ])("round-trips rich text and musical attachment with %j", (frame) => {
    const score = parseMnx(document(frame));
    const expression = score.parts[0].measures[0].expressions?.[0];
    expect(expression?.frame).toEqual(frame);
    const roundTrip = parseMnx(serializeMnx(score));
    expect(roundTrip.parts[0].measures[0].expressions?.[0]).toEqual(expression);
    expect(expression?.position).toEqual({ fraction: [1, 4] });
    expect(expression?.manualOffset).toEqual([2, -1]);
    expect(expression?.text[0]).toEqual({ text: "Play freely\nThen resume", style: { weight: "bold" } });
  });

  it("keeps plain expressions plain", () => {
    const score = parseMnx(document());
    expect(score.parts[0].measures[0].expressions?.[0].frame).toBeUndefined();
    expect(parseMnx(serializeMnx(score)).parts[0].measures[0].expressions?.[0].frame).toBeUndefined();
  });

  it.each([
    null,
    [],
    { width: { unit: "textColumnFraction", value: 0.5 } },
    { width: { unit: "staffSpaces", value: 0 } },
    { width: { unit: "staffSpaces", value: -1 } },
    { width: { unit: "staffSpaces", value: Infinity } },
    { padding: -1 },
    { padding: NaN },
    { border: "dashed" },
    { height: 10 },
    { horizontalAlignment: "auto" },
  ])("rejects malformed presentation even on recovery import: %j", (frame) => {
    expect(() => parseMnx(document(frame))).toThrow();
    expect(() => parseMnxUnvalidated(document(frame))).toThrow(/frame/);
  });
});
